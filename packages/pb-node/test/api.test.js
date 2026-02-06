/**
 * API integration tests for the commit-reveal server.
 * Uses in-memory SQLite — no external dependencies needed.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import { createApp } from '../src/app.js';
import { SQLiteStorage } from '../src/storage/sqlite.js';

let app;
let storage;

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

function makeCommitment(kp, items, opts = {}) {
  const params = {
    items,
    reveal_probability: opts.reveal_probability || 0.10,
    beacon: opts.beacon || { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
    committed_at: opts.committed_at || new Date().toISOString(),
  };
  return wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
}

async function req(method, path, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);

  const url = `http://localhost${path}`;
  return app.request(url, init);
}

describe('Server API', () => {
  before(() => {
    storage = new SQLiteStorage(':memory:');
    app = createApp(storage);
  });

  after(() => {
    storage.close();
  });

  it('GET /health returns ok', async () => {
    const res = await req('GET', '/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('GET /v1/server-info returns server metadata', async () => {
    const res = await req('GET', '/v1/server-info');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.server_key.startsWith('did:key:z'));
    assert.equal(body.spec_version, '0.2.0');
    assert.ok(Array.isArray(body.beacon_types));
    assert.ok(body.retention);
  });

  it('POST /v1/commitments rejects missing fields', async () => {
    const res = await req('POST', '/v1/commitments', { foo: 'bar' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Missing'));
  });

  it('POST /v1/commitments rejects invalid signature', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, [
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    ]);
    // Tamper with signature
    const tampered = { ...commitment, signature: '00'.repeat(64) };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('POST /v1/commitments accepts valid commitment and returns receipt', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('test-item-1'));
    const commitment = makeCommitment(kp, [itemHash]);

    const res = await req('POST', '/v1/commitments', commitment);
    // May be 201 (beacon available) or 201 with null selection (beacon unavailable)
    assert.equal(res.status, 201);
    const body = await res.json();

    assert.equal(body.commitment_hash, commitment.commitment_hash);
    assert.ok(body.registered_at);
    assert.ok(body.server_key.startsWith('did:key:z'));
    assert.ok(body.server_signature);
    assert.equal(body.commitment.signing_key, kp.did_key);
    assert.ok(body.signer_activity);
    assert.equal(body.signer_activity.commitments_past_hour, 1);
  });

  it('POST /v1/commitments rejects duplicate', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('test-dup'));
    const commitment = makeCommitment(kp, [itemHash]);

    await req('POST', '/v1/commitments', commitment);
    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 409);
  });

  it('GET /v1/commitments/:hash returns stored commitment', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('test-get'));
    const commitment = makeCommitment(kp, [itemHash]);

    await req('POST', '/v1/commitments', commitment);
    const res = await req('GET', `/v1/commitments/${commitment.commitment_hash}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.commitment_hash, commitment.commitment_hash);
    assert.ok(body.server_key);
    assert.ok(body.server_signature);
  });

  it('GET /v1/commitments/:hash returns 404 for unknown', async () => {
    const res = await req('GET', '/v1/commitments/' + '0'.repeat(64));
    assert.equal(res.status, 404);
  });

  it('POST /v1/commitments rejects empty items', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, [
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    ]);
    const tampered = { ...commitment, items: [], item_count: 0 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('POST /v1/commitments rejects invalid item hashes', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, [
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    ]);
    const tampered = { ...commitment, items: ['not-a-valid-hash'], item_count: 1 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('tracks signer activity across multiple commitments', async () => {
    const kp = wasm.generateKeypair();
    for (let i = 0; i < 3; i++) {
      const itemHash = wasm.hashBytes(new TextEncoder().encode(`activity-test-${i}`));
      const commitment = makeCommitment(kp, [itemHash]);
      await req('POST', '/v1/commitments', commitment);
    }

    // The activity count should reflect all commitments from this key
    const itemHash = wasm.hashBytes(new TextEncoder().encode('activity-test-final'));
    const commitment = makeCommitment(kp, [itemHash]);
    const res = await req('POST', '/v1/commitments', commitment);
    const body = await res.json();
    assert.equal(body.signer_activity.commitments_past_hour, 4);
  });

});
