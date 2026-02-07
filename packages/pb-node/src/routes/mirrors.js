/**
 * Mirror routes:
 *   POST /v1/commitments/:hash/mirrors
 *   GET  /v1/commitments/:hash/mirrors
 *   POST /v1/commitments/:hash/verify-publication
 */

import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { signResponse } from '../signing.js';

const VALID_PROVIDERS = new Set(['github', 'huggingface', 'ipfs', 'peerbench', 'custom']);

const route = new Hono();

/**
 * POST /v1/commitments/:hash/mirrors — register a data mirror URL.
 */
route.post('/:hash/mirrors', async (c) => {
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
  const required = ['spec_version', 'commitment_hash', 'url', 'provider',
    'registered_at', 'signing_key', 'signature'];
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  // Verify commitment_hash matches the path
  if (body.commitment_hash !== hash) {
    return c.json({ error: 'commitment_hash in body does not match URL' }, 400);
  }

  // Verify signing_key matches the original commitment
  if (body.signing_key !== record.commitment.signing_key) {
    return c.json({ error: 'signing_key does not match original commitment' }, 403);
  }

  // Validate provider
  if (!VALID_PROVIDERS.has(body.provider)) {
    return c.json({ error: `Invalid provider: ${body.provider}. Must be one of: ${[...VALID_PROVIDERS].join(', ')}` }, 400);
  }

  // Verify signature
  try {
    const valid = wasm.verifySignature(
      body.signing_key,
      new TextEncoder().encode(JSON.stringify({
        spec_version: body.spec_version,
        commitment_hash: body.commitment_hash,
        url: body.url,
        provider: body.provider,
        registered_at: body.registered_at,
        signing_key: body.signing_key,
      })),
      body.signature
    );
    if (!valid) {
      return c.json({ error: 'Invalid mirror signature' }, 400);
    }
  } catch (e) {
    return c.json({ error: `Signature verification failed: ${e.message}` }, 400);
  }

  // Check for duplicate URL
  const exists = await storage.mirrorExists(hash, body.url);
  if (exists) {
    return c.json({ error: 'Mirror URL already registered for this commitment' }, 409);
  }

  const serverRegisteredAt = new Date().toISOString();
  const mirrorId = crypto.randomUUID().replace(/-/g, '');

  await storage.putMirror(mirrorId, hash, body, serverRegisteredAt);

  return c.json({
    mirror_id: mirrorId,
    server_registered_at: serverRegisteredAt,
  }, 201);
});

/**
 * GET /v1/commitments/:hash/mirrors — list mirrors for a commitment.
 */
route.get('/:hash/mirrors', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const mirrors = await storage.getMirrors(hash);
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

  // Check commitment exists
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
