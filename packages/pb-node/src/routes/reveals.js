/**
 * Reveal routes:
 *   POST /v1/commitments/:hash/reveals
 *   GET  /v1/commitments/:hash/reveals
 *   GET  /v1/commitments/:hash/mirrors    — file_urls from reveals
 *   POST /v1/commitments/:hash/verify-publication
 */

import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { signResponse } from '../signing.js';
import { getArrivalBeacon } from '../beacon.js';
import { config } from '../config.js';

const route = new Hono();

/**
 * POST /v1/commitments/:hash/reveals — submit a reveal.
 */
route.post('/:hash/reveals', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  // Check commitment exists
  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  // Validate required fields
  const required = ['spec_version', 'commitment_hash', 'selected_items',
    'voluntary_items', 'revealed_at', 'signing_key', 'signature'];
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  // Verify commitment_hash matches the path
  if (body.commitment_hash !== hash) {
    return c.json({ error: 'commitment_hash in body does not match URL' }, 400);
  }

  // Validate all revealed items are in the original commitment
  const commitmentItems = new Set(record.commitment.items);
  for (const item of [...body.selected_items, ...body.voluntary_items]) {
    if (!commitmentItems.has(item)) {
      return c.json({ error: `Item ${item} not in original commitment` }, 400);
    }
  }

  // Verify reveal signature
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
  } catch (e) {
    return c.json({ error: `Signature verification failed: ${e.message}` }, 400);
  }

  // ── Data verification ──
  const verifyEnabled = config.verifyRevealData;
  const fileUrls = body.file_urls;
  let dataVerified = false;
  let verification = null;

  if (verifyEnabled) {
    const selectedItems = body.selected_items || [];
    if (selectedItems.length === 0) {
      // Nothing to verify — skip
      dataVerified = true;
      verification = { verified_items: 0, total_selected: 0, items: [] };
    } else if (!fileUrls || typeof fileUrls !== 'object' || Object.keys(fileUrls).length === 0) {
      // No file_urls provided — accept reveal but skip verification
      verification = { verified_items: 0, total_selected: selectedItems.length, items: [], note: 'no file_urls provided' };
    } else {

    const results = [];
    for (const itemHash of selectedItems) {
      const url = fileUrls[itemHash];
      if (!url) {
        results.push({ hash: itemHash, status: 'missing_url' });
        continue;
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          results.push({ hash: itemHash, url, status: 'fetch_error', detail: `HTTP ${res.status}` });
          continue;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const computed = wasm.hashBytes(data);
        if (computed === itemHash) {
          results.push({ hash: itemHash, url, status: 'match' });
        } else {
          results.push({ hash: itemHash, url, status: 'mismatch', computed_hash: computed });
        }
      } catch (e) {
        results.push({ hash: itemHash, url, status: 'fetch_error', detail: e.message });
      }
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

  // Fetch the current beacon at reveal time
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

/**
 * GET /v1/commitments/:hash/reveals — list reveals for a commitment.
 */
route.get('/:hash/reveals', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const reveals = await storage.getReveals(hash);
  return c.json({ commitment_hash: hash, reveals });
});

/**
 * GET /v1/commitments/:hash/mirrors — file_urls extracted from reveals.
 * Replaces the old standalone mirrors endpoint.
 */
route.get('/:hash/mirrors', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const reveals = await storage.getReveals(hash);
  const mirrors = [];
  const seen = new Set();
  for (const reveal of reveals) {
    if (reveal.file_urls && typeof reveal.file_urls === 'object') {
      for (const [itemHash, url] of Object.entries(reveal.file_urls)) {
        if (!seen.has(url)) {
          seen.add(url);
          mirrors.push({ item_hash: itemHash, url, revealed_at: reveal.revealed_at });
        }
      }
    }
  }
  return c.json({ commitment_hash: hash, mirrors });
});

/**
 * POST /v1/commitments/:hash/verify-publication — fetch published data
 * from provided URLs, hash each file, verify against committed item hashes,
 * return a signed attestation.
 */
route.post('/:hash/verify-publication', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');

  let body;
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
  const results = [];

  for (const [itemHash, url] of Object.entries(file_urls)) {
    if (!committedItems.has(itemHash)) {
      results.push({ hash: itemHash, url, status: 'not_in_commitment' });
      continue;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        results.push({ hash: itemHash, url, status: 'fetch_error', detail: `HTTP ${res.status}` });
        continue;
      }
      const data = new Uint8Array(await res.arrayBuffer());
      const computed = wasm.hashBytes(data);
      if (computed === itemHash) {
        results.push({ hash: itemHash, url, status: 'match' });
      } else {
        results.push({ hash: itemHash, url, status: 'mismatch', computed_hash: computed });
      }
    } catch (e) {
      results.push({ hash: itemHash, url, status: 'fetch_error', detail: e.message });
    }
  }

  const matchCount = results.filter(r => r.status === 'match').length;
  const allMatch = matchCount === Object.keys(file_urls).length && matchCount > 0;

  const verification = {
    commitment_hash: hash,
    verified_items: matchCount,
    total_items: commitment.items.length,
    provided_items: Object.keys(file_urls).length,
    all_match: allMatch,
    items: results,
    verified_at: new Date().toISOString(),
  };

  return c.json(signResponse(verification), 200);
});

export default route;
