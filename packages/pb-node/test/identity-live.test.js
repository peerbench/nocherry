/**
 * DID identity verification tests for the commit-reveal server.
 *
 * Dual-mode:
 *   npm test                → local (in-memory SQLite)
 *   SERVER_URL=… npm test   → remote (live server via fetch)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import { getApp, cleanup } from './_setup.js';

let app;

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

// A well-known did:plc (bsky.app) — always resolvable via plc.directory
const REAL_DID_PLC = 'did:plc:z72i7hdynmk6r22z27h6tvur';

function makeCommitment(kp, items, opts = {}) {
  const params = {
    items,
    reveal_probability: opts.reveal_probability || 0.10,
    beacon: opts.beacon || { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
    committed_at: opts.committed_at || new Date().toISOString(),
  };
  if (opts.identity) params.identity = opts.identity;
  return wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
}

async function req(method, path, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, init);
}

describe('DID Identity Verification', () => {
  before(async () => {
    app = await getApp();
  });

  after(async () => {
    await cleanup();
  });

  it('receipt includes key_matches_identity: null when no identity provided', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('id-test-no-identity'));
    const commitment = makeCommitment(kp, [itemHash]);

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, null);
  });

  it('receipt includes key_matches_identity: "mismatch" for real did:plc with unrelated key', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('id-test-plc-mismatch'));
    const commitment = makeCommitment(kp, [itemHash], { identity: REAL_DID_PLC });

    assert.equal(commitment.identity, REAL_DID_PLC);

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'mismatch',
      'Test signing key should not match bsky.app DID document');
  });

  it('receipt includes key_matches_identity: "error" for nonexistent did:plc', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('id-test-plc-bogus'));
    const commitment = makeCommitment(kp, [itemHash], {
      identity: 'did:plc:aaaaaaaaaaaaaaaaaaaaaa',
    });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'error',
      'Nonexistent DID should return error from plc.directory 404');
  });

  it('receipt includes key_matches_identity: "unsupported" for unknown DID method', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('id-test-unsupported'));
    const commitment = makeCommitment(kp, [itemHash], {
      identity: 'did:example:unsupported-method',
    });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'unsupported',
      'Unknown DID method should return unsupported');
  });

  it('GET receipt always returns key_matches_identity: null (point-in-time only)', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('id-test-get-null'));
    const commitment = makeCommitment(kp, [itemHash], { identity: REAL_DID_PLC });

    const postRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(postRes.status, 201);
    const postBody = await postRes.json();
    assert.equal(postBody.key_matches_identity, 'mismatch');

    // GET should always return null — identity check is point-in-time at registration
    const getRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.key_matches_identity, null,
      'GET receipt should not re-resolve identity');
  });
});
