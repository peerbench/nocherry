/**
 * Reveal routes:
 *   POST /v1/commitments/:hash/reveals
 *   GET  /v1/commitments/:hash/reveals
 *   GET  /v1/commitments/:hash/mirrors
 *   POST /v1/commitments/:hash/verify-publication
 */

import { Hono } from 'hono';
import type { AppEnv, Config } from '../types.ts'
import { getWasm } from '../wasm-registry.ts'
import { signResponse } from '../signing.ts'
import { getArrivalBeacon } from '../beacon.ts'
import { safeFetchBytes, UnsafeUrlError, ResponseTooLargeError } from '../safe-fetch.ts'

const route = new Hono<AppEnv>();

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Fetch `url` and compare its SHA-256 with `expectedHash`. `itemHash` names the
 * item in the result: in 0.2.0 it is the plain hash itself, in 0.5.0 the item
 * commitment whose opening gives `expectedHash`.
 */
async function fetchAndVerify(url: string, itemHash: string, config: Config, expectedHash: string = itemHash) {
  const wasm = getWasm();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await safeFetchBytes(url, {
        maxBytes: config.maxRevealFileBytes,
        allowUnsafeUrls: config.allowUnsafeRevealUrls === true,
      });
      if (!res.ok) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        return { hash: itemHash, url, status: 'fetch_error', detail: `HTTP ${res.status}` };
      }
      const computed = wasm.hashBytes(res.data);
      if (computed === expectedHash) {
        return { hash: itemHash, url, status: 'match' };
      }
      if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
      return { hash: itemHash, url, status: 'mismatch', computed_hash: computed };
    } catch (e: any) {
      // Policy rejections are final: retrying cannot make the URL acceptable.
      if (e instanceof UnsafeUrlError) {
        return { hash: itemHash, url, status: 'url_not_allowed', detail: e.message };
      }
      if (e instanceof ResponseTooLargeError) {
        return { hash: itemHash, url, status: 'too_large', detail: e.message };
      }
      if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
      return { hash: itemHash, url, status: 'fetch_error', detail: e.message };
    }
  }
}

route.post('/:hash/reveals', async (c) => {
  const storage = c.get('storage');
  const config = c.get('config');
  const wasm = getWasm();
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const required = ['spec_version', 'commitment_hash', 'selected_items',
    'voluntary_items', 'revealed_at', 'signing_key', 'signature'];
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  if (body.commitment_hash !== hash) {
    return c.json({ error: 'commitment_hash in body does not match URL' }, 400);
  }

  if (!Array.isArray(body.selected_items) || !Array.isArray(body.voluntary_items)) {
    return c.json({ error: 'selected_items and voluntary_items must be arrays' }, 400);
  }
  const commitmentItems = new Set(record.commitment.items);
  for (const item of [...body.selected_items, ...body.voluntary_items]) {
    if (!commitmentItems.has(item)) {
      return c.json({ error: `Item ${item} not in original commitment` }, 400);
    }
  }

  // A 0.5.0 commitment needs a 0.5.0 reveal with openings (spec v0.5 10.3);
  // the core checks their structure, that each opens its item, and the signature.
  const isV5 = record.commitment.spec_version === '0.5.0';
  if (isV5 || body.spec_version === '0.5.0') {
    if (body.spec_version !== '0.5.0') {
      return c.json({ error: 'a 0.5.0 commitment requires a 0.5.0 reveal with openings', error_code: 'reveal_format' }, 400);
    }
    if (!isV5) {
      return c.json({ error: 'a 0.5.0 reveal cannot open a 0.2.0 commitment', error_code: 'reveal_format' }, 400);
    }
    let checked: { ok: boolean; error?: string };
    try {
      checked = wasm.verifyRevealObject(JSON.stringify(body));
    } catch (e: any) {
      checked = { ok: false, error: e.message };
    }
    if (!checked.ok) {
      return c.json({ error: `Invalid reveal: ${checked.error}`, error_code: 'reveal_invalid' }, 400);
    }
  } else {
    try {
      const valid = wasm.verifySignature(
        body.signing_key,
        new TextEncoder().encode(JSON.stringify({
          spec_version: body.spec_version,
          commitment_hash: body.commitment_hash,
          selected_items: body.selected_items,
          voluntary_items: body.voluntary_items,
          revealed_at: body.revealed_at,
          signing_key: body.signing_key,
        })),
        body.signature
      );
      if (!valid) {
        return c.json({ error: 'Invalid reveal signature' }, 400);
      }
    } catch (e: any) {
      return c.json({ error: `Signature verification failed: ${e.message}` }, 400);
    }
  }
  // 0.5.0: the plain hash a fetched file must have, per item commitment.
  const openedHash = new Map<string, string>(
    isV5 ? (body.openings as { item: string; hash: string }[]).map((o) => [o.item, o.hash]) : []);

  // The reveal must declare exactly the items the beacon selected for this
  // commitment. Without this check a committer could list items of their own
  // choosing as "selected" and obtain a signed data_verified receipt for them.
  const selection = await storage.getSelection(hash);
  if (!selection || !Array.isArray(selection.selected_items)) {
    return c.json({ error: 'Selection not yet computed for this commitment; request /selection first' }, 409);
  }
  const expected = new Set<string>(selection.selected_items);
  const declared = new Set<string>(body.selected_items);
  if (declared.size !== body.selected_items.length ||
      declared.size !== expected.size ||
      [...declared].some((item) => !expected.has(item))) {
    return c.json({ error: 'selected_items does not match the beacon selection for this commitment' }, 400);
  }
  if (body.voluntary_items.some((item: string) => expected.has(item))) {
    return c.json({ error: 'voluntary_items must not contain beacon-selected items' }, 400);
  }

  const verifyEnabled = config.verifyRevealData;
  const fileUrls = body.file_urls;
  let dataVerified = false;
  let verification: any = null;

  if (verifyEnabled) {
    const selectedItems: string[] = body.selected_items || [];
    if (selectedItems.length === 0) {
      dataVerified = true;
      verification = { verified_items: 0, total_selected: 0, items: [] };
    } else if (!fileUrls || typeof fileUrls !== 'object' || Object.keys(fileUrls).length === 0) {
      verification = { verified_items: 0, total_selected: selectedItems.length, items: [], note: 'no file_urls provided' };
    } else {

    const results: any[] = [];
    for (const itemHash of selectedItems) {
      const url = fileUrls[itemHash];
      if (!url) {
        results.push({ hash: itemHash, status: 'missing_url' });
        continue;
      }
      results.push(await fetchAndVerify(url, itemHash, config, openedHash.get(itemHash) ?? itemHash));
    }

    const matchCount = results.filter(r => r.status === 'match').length;
    const allMatch = matchCount === selectedItems.length && matchCount > 0;

    dataVerified = allMatch;
    verification = { verified_items: matchCount, total_selected: selectedItems.length, items: results };
    } // end else (has file_urls)
  } else {
    verification = { verification_skipped: true };
  }

  const registeredAt = new Date().toISOString();
  const revealId = crypto.randomUUID().replace(/-/g, '');

  await storage.putReveal(revealId, hash, body, registeredAt);

  let beaconAtReveal = null;
  try {
    beaconAtReveal = await getArrivalBeacon(storage, record.commitment.beacon, registeredAt);
  } catch {
    // Non-critical
  }

  return c.json(signResponse({
    reveal_id: revealId,
    registered_at: registeredAt,
    beacon_at_reveal: beaconAtReveal,
    data_verified: dataVerified,
    verification,
    file_urls_registered: fileUrls && typeof fileUrls === 'object' ? Object.keys(fileUrls).length : 0,
  }), 201);
});

route.get('/:hash/reveals', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const reveals = await storage.getReveals(hash);
  return c.json({ commitment_hash: hash, reveals });
});

route.get('/:hash/mirrors', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const reveals = await storage.getReveals(hash);
  const mirrors: { item_hash: string; url: string; revealed_at: string }[] = [];
  const seen = new Set<string>();
  for (const reveal of reveals) {
    if (reveal.file_urls && typeof reveal.file_urls === 'object') {
      for (const [itemHash, url] of Object.entries(reveal.file_urls)) {
        if (!seen.has(url as string)) {
          seen.add(url as string);
          mirrors.push({ item_hash: itemHash, url: url as string, revealed_at: reveal.revealed_at });
        }
      }
    }
  }
  return c.json({ commitment_hash: hash, mirrors });
});

route.post('/:hash/verify-publication', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const { file_urls } = body;
  if (!file_urls || typeof file_urls !== 'object' || Object.keys(file_urls).length === 0) {
    return c.json({ error: 'file_urls must be a non-empty object mapping item hashes to URLs' }, 400);
  }

  const commitment = record.commitment;
  const committedItems = new Set(commitment.items);
  const results: any[] = [];

  // 0.5.0 items are commitments; the plain hash to compare against comes from
  // the openings of a registered reveal. An item no reveal has opened cannot be
  // checked against a URL.
  const openedHash = new Map<string, string>();
  if (commitment.spec_version === '0.5.0') {
    for (const reveal of await storage.getReveals(hash)) {
      for (const o of (reveal.openings ?? []) as { item: string; hash: string }[]) openedHash.set(o.item, o.hash);
    }
  }

  for (const [itemHash, url] of Object.entries(file_urls)) {
    if (!committedItems.has(itemHash)) {
      results.push({ hash: itemHash, url, status: 'not_in_commitment' });
      continue;
    }
    if (commitment.spec_version === '0.5.0' && !openedHash.has(itemHash)) {
      results.push({ hash: itemHash, url, status: 'not_opened', detail: 'no registered reveal opens this item' });
      continue;
    }
    results.push(await fetchAndVerify(url as string, itemHash, c.get('config'), openedHash.get(itemHash) ?? itemHash));
  }

  const matchCount = results.filter(r => r.status === 'match').length;
  const allMatch = matchCount === Object.keys(file_urls).length && matchCount > 0;

  return c.json(signResponse({
    commitment_hash: hash,
    verified_items: matchCount,
    total_items: commitment.items.length,
    provided_items: Object.keys(file_urls).length,
    all_match: allMatch,
    items: results,
    verified_at: new Date().toISOString(),
  }), 200);
});

export default route;
