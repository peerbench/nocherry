/**
 * Commitment routes:
 *   POST /v1/commitments
 *   GET  /v1/commitments/:hash
 *   GET  /v1/commitments/:hash/selection
 *
 * Two object formats are accepted (spec v0.5 Section 16): 0.2.0 exactly as
 * before, and 0.5.0 with the well-formedness rules of spec v0.5 Section 7.5
 * and the per-stream uniqueness of Section 12.2.
 */

import { Hono } from 'hono';
import type { AppEnv, StorageInterface } from '../types.ts'
import { getWasm } from '../wasm-registry.ts'
import { DEFAULT_MAX_ITEMS, SPEC_VERSIONS_ACCEPTED } from '../config.ts'
import { getBeaconOutput, getArrivalBeacon, computeSelection, hasAnchorRound, checkAnchor } from '../beacon.ts'
import { signResponse } from '../signing.ts'
import { resolveIdentity } from '../did-resolver.ts'

const route = new Hono<AppEnv>();

const HASH_RE = /^[0-9a-f]{64}$/;

/** True when the commitment is a 0.5.0 commitment in a stream. */
function inStream(body: any): boolean {
  return body.spec_version === '0.5.0' && typeof body.stream_id === 'string' && Number.isInteger(body.sequence);
}

/** `stream_activity` for the receipt (spec v0.5 12.2). */
async function streamActivity(storage: StorageInterface, body: any) {
  if (!inStream(body)) return undefined;
  const entries = await storage.listStream(body.signing_key, body.stream_id);
  return {
    commitments: entries.length,
    highest_sequence: entries.reduce((m, e) => Math.max(m, e.sequence), -1),
  };
}

route.post('/', async (c) => {
  const storage = c.get('storage');
  const config = c.get('config');
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

  const isV5 = body.spec_version === '0.5.0';
  if (body.spec_version !== undefined && !(SPEC_VERSIONS_ACCEPTED as readonly string[]).includes(body.spec_version)) {
    return c.json({
      error: `Unsupported spec_version ${String(body.spec_version)}`,
      error_code: 'spec_version_unsupported',
      spec_versions_accepted: SPEC_VERSIONS_ACCEPTED,
    }, 400);
  }

  const required = ['spec_version', 'commitment_hash', 'items', 'item_count',
    isV5 ? 'reveal_probability_ppm' : 'reveal_probability', 'beacon', 'committed_at', 'signing_key', 'signature'];
  if (isV5) required.push('selection_mode', 'metadata');
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'items must be a non-empty array' }, 400);
  }
  const maxItems = config?.maxItems ?? DEFAULT_MAX_ITEMS;
  if (body.items.length > maxItems) {
    return c.json({ error: `item_count exceeds this server's limit of ${maxItems}`, error_code: 'too_many_items', max_items: maxItems }, 400);
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

  if (isV5) {
    // Every structural rule of spec v0.5 7.5 at once, from the core.
    let wellformed: { ok: boolean; error?: string };
    try {
      wellformed = wasm.validateCommitment(JSON.stringify(body));
    } catch (e: any) {
      wellformed = { ok: false, error: e.message };
    }
    if (!wellformed.ok) {
      return c.json({ error: `Malformed 0.5.0 commitment: ${wellformed.error}`, error_code: 'commitment_malformed' }, 400);
    }
  } else {
    const p = body.reveal_probability;
    if (typeof p !== 'number' || p <= 0 || p > 1) {
      return c.json({ error: 'reveal_probability must be in (0, 1]' }, 400);
    }
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
    return c.json({ error: 'Commitment already exists', error_code: 'commitment_exists' }, 409);
  }

  // Embedded consumers may mount the routes without a config.
  const registeredAt = (config?.now?.() ?? new Date()).toISOString();

  // Anchored commitments: all servers select with round anchor_round + 2, so
  // that round must still be unpublished now. Reject instead of registering.
  // 0.5.0 commitments always carry an anchor (checked above).
  if (hasAnchorRound(body.beacon)) {
    const anchor = checkAnchor(body.beacon, registeredAt);
    if (!anchor.ok) {
      return c.json({
        error: anchor.message,
        error_code: anchor.code,
        anchor_round: body.beacon.anchor_round,
        server_time: registeredAt,
      }, 400);
    }
  }

  // One commitment per (signing_key, stream_id, sequence) on this server
  // (spec v0.5 12.2). The storage's unique constraint makes this atomic; the
  // lookup here gives the client the existing hash in the answer.
  const streamTaken = async () => {
    if (!inStream(body)) return null;
    const taken = await storage.findStreamCommitment(body.signing_key, body.stream_id, body.sequence);
    if (!taken || taken.commitment_hash === body.commitment_hash) return null;
    return c.json({
      error: 'a commitment with this signing_key, stream_id and sequence is already registered',
      error_code: 'stream_sequence_taken',
      stream_id: body.stream_id,
      sequence: body.sequence,
      existing_commitment_hash: taken.commitment_hash,
      existing_registered_at: taken.registered_at,
    }, 409);
  };
  const takenBefore = await streamTaken();
  if (takenBefore) return takenBefore;

  try {
    await storage.putCommitment(body.commitment_hash, body, registeredAt);
  } catch (e: any) {
    if (e.message && (e.message.includes('UNIQUE') || e.message.includes('unique') || e.message.includes('duplicate key') || e.message.includes('already exists'))) {
      const takenNow = await streamTaken();
      if (takenNow) return takenNow;
      return c.json({ error: 'Commitment already exists', error_code: 'commitment_exists' }, 409);
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
  const activity = await streamActivity(storage, body);
  const keyMatchesIdentity = await identityPromise;

  const receipt = signResponse({
    commitment: body,
    commitment_hash: body.commitment_hash,
    registered_at: registeredAt,
    arrival_beacon: arrivalBeacon,
    selection,
    signer_activity: signerActivity,
    ...(activity ? { stream_activity: activity } : {}),
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
  const activity = await streamActivity(storage, record.commitment);

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
    ...(activity ? { stream_activity: activity } : {}),
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
