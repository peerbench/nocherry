/**
 * Reveal routes:
 *   POST /v1/commitments/:hash/reveals
 *   GET  /v1/commitments/:hash/reveals
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
    if (!fileUrls || typeof fileUrls !== 'object' || Object.keys(fileUrls).length === 0) {
      return c.json({ error: 'file_urls required when server has data verification enabled. Provide a mapping of item hashes to public URLs.' }, 400);
    }

    const results = [];
    for (const itemHash of body.selected_items) {
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
    const allMatch = matchCount === body.selected_items.length && matchCount > 0;

    if (!allMatch) {
      return c.json({
        error: 'Data verification failed — not all selected items could be verified',
        verification: { verified_items: matchCount, total_selected: body.selected_items.length, items: results },
      }, 422);
    }

    dataVerified = true;
    verification = { verified_items: matchCount, total_selected: body.selected_items.length, items: results };
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

export default route;
