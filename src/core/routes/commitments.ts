/**
 * Commitment routes:
 *   POST /v1/commitments
 *   GET  /v1/commitments/:hash
 *   GET  /v1/commitments/:hash/selection
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.ts'
import { getWasm } from '../wasm-registry.ts'
import { getBeaconOutput, getArrivalBeacon, computeSelection } from '../beacon.ts'
import { signResponse } from '../signing.ts'
import { resolveIdentity } from '../did-resolver.ts'

const route = new Hono<AppEnv>();

const HASH_RE = /^[0-9a-f]{64}$/;

route.post('/', async (c) => {
  const storage = c.get('storage');
  const wasm = getWasm();
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  const required = ['spec_version', 'commitment_hash', 'items',
    'reveal_probability', 'beacon', 'committed_at', 'signing_key', 'signature'];
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'items must be a non-empty array' }, 400);
  }
  // Derive item_count from items array if not provided
  if (body.item_count === undefined) {
    body.item_count = body.items.length;
  }
  if (body.items.length !== body.item_count) {
    return c.json({ error: 'item_count does not match items.length' }, 400);
  }
  for (const item of body.items) {
    if (typeof item !== 'string' || !/^[0-9a-f]{64}$/.test(item)) {
      return c.json({ error: `Invalid item hash: ${item}` }, 400);
    }
  }
  if (new Set(body.items).size !== body.items.length) {
    return c.json({ error: 'Duplicate items' }, 400);
  }

  const p = body.reveal_probability;
  if (typeof p !== 'number' || p <= 0 || p > 1) {
    return c.json({ error: 'reveal_probability must be in (0, 1]' }, 400);
  }

  try {
    const valid = wasm.verifyCommitment(JSON.stringify(body));
    if (!valid) {
      return c.json({ error: 'Invalid commitment signature' }, 400);
    }
  } catch (e: any) {
    return c.json({ error: `Signature verification failed: ${e.message}` }, 400);
  }

  // Fire off async DID identity resolution (non-blocking)
  const identityPromise = body.identity
    ? resolveIdentity(body.identity, body.signing_key)
    : Promise.resolve(null);

  const existing = await storage.getCommitment(body.commitment_hash);
  if (existing) {
    return c.json({ error: 'Commitment already exists' }, 409);
  }

  const registeredAt = new Date().toISOString();

  try {
    await storage.putCommitment(body.commitment_hash, body, registeredAt);
  } catch (e: any) {
    if (e.message && (e.message.includes('UNIQUE') || e.message.includes('unique') || e.message.includes('duplicate key') || e.message.includes('already exists'))) {
      return c.json({ error: 'Commitment already exists' }, 409);
    }
    throw e;
  }

  let arrivalBeacon = null;
  try {
    arrivalBeacon = await getArrivalBeacon(storage, body.beacon, registeredAt);
  } catch {
    // Non-critical
  }

  let selection: any = null;
  try {
    const beaconOutput = await getBeaconOutput(storage, body.beacon, registeredAt);
    selection = computeSelection(body, beaconOutput);
    await storage.putSelection(body.commitment_hash, selection, beaconOutput.round);
  } catch {
    selection = null;
  }

  const signerActivity = await storage.getSignerActivity(body.signing_key);
  const keyMatchesIdentity = await identityPromise;

  const receipt = signResponse({
    commitment: body,
    commitment_hash: body.commitment_hash,
    registered_at: registeredAt,
    arrival_beacon: arrivalBeacon,
    selection,
    signer_activity: signerActivity,
    key_matches_identity: keyMatchesIdentity,
  });

  return c.json(receipt, 201);
});

route.get('/:hash', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  const selection = await storage.getSelection(hash);
  const signerActivity = await storage.getSignerActivity(record.commitment.signing_key);

  let arrivalBeacon = null;
  try {
    arrivalBeacon = await getArrivalBeacon(storage, record.commitment.beacon, record.registered_at);
  } catch {
    // Non-critical
  }

  const receipt = signResponse({
    commitment: record.commitment,
    commitment_hash: hash,
    registered_at: record.registered_at,
    arrival_beacon: arrivalBeacon,
    selection,
    signer_activity: signerActivity,
    key_matches_identity: null,
  });

  return c.json(receipt);
});

route.get('/:hash/selection', async (c) => {
  const storage = c.get('storage');
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) return c.json({ error: 'Commitment not found' }, 404);

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: 'Commitment not found' }, 404);
  }

  let selection: any = await storage.getSelection(hash);
  if (selection) {
    return c.json(signResponse(selection));
  }

  try {
    const beaconOutput = await getBeaconOutput(storage, record.commitment.beacon, record.registered_at);
    selection = computeSelection(record.commitment, beaconOutput);
    await storage.putSelection(hash, selection, beaconOutput.round);
    return c.json(signResponse(selection));
  } catch (e: any) {
    return c.json({ error: `Selection not available: ${e.message}` }, 503);
  }
});

export default route;
