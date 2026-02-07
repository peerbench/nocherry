/**
 * API integration tests for the commit-reveal server.
 *
 * Dual-mode:
 *   npm test                → local (in-memory SQLite)
 *   SERVER_URL=… npm test   → remote (live server via fetch)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import { getApp, cleanup, isRemote } from './_setup.js';

let app;

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
  before(async () => {
    app = await getApp();
  });

  after(async () => {
    await cleanup();
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
    if (!isRemote) {
      assert.equal(body.signer_activity.commitments_past_hour, 1);
    } else {
      assert.ok(body.signer_activity.commitments_past_hour >= 1);
    }
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

  // ── Mirror tests ──

  it('POST mirrors rejects without commitment', async () => {
    const res = await req('POST', '/v1/commitments/' + '0'.repeat(64) + '/mirrors', { foo: 'bar' });
    assert.equal(res.status, 404);
  });

  it('POST mirrors registers a valid mirror and GET returns it', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirror-test-item'));
    const commitment = makeCommitment(kp, [itemHash]);

    // Submit commitment first
    const commitRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(commitRes.status, 201);

    // Create mirror payload
    const mirrorPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      url: 'https://github.com/user/peerbench-reveals/tree/main/reveals/test',
      provider: 'github',
      registered_at: new Date().toISOString(),
      signing_key: kp.did_key,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
    const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);
    const mirror = { ...mirrorPayload, signature };

    // Register mirror
    const mirrorRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/mirrors`, mirror);
    assert.equal(mirrorRes.status, 201);
    const mirrorBody = await mirrorRes.json();
    assert.ok(mirrorBody.mirror_id);
    assert.ok(mirrorBody.server_registered_at);

    // GET mirrors
    const listRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}/mirrors`);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.commitment_hash, commitment.commitment_hash);
    assert.equal(listBody.mirrors.length, 1);
    assert.equal(listBody.mirrors[0].url, mirrorPayload.url);
    assert.equal(listBody.mirrors[0].provider, 'github');
  });

  it('POST mirrors rejects duplicate URL', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirror-dup-test'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const mirrorPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      url: 'https://github.com/user/reveals/tree/main/dup-test',
      provider: 'github',
      registered_at: new Date().toISOString(),
      signing_key: kp.did_key,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
    const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);
    const mirror = { ...mirrorPayload, signature };

    await req('POST', `/v1/commitments/${commitment.commitment_hash}/mirrors`, mirror);
    const dupRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/mirrors`, mirror);
    assert.equal(dupRes.status, 409);
  });

  it('POST mirrors rejects wrong signing key', async () => {
    const kp = wasm.generateKeypair();
    const kp2 = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirror-wrongkey-test'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    // Sign with kp2 but claim kp2's key (doesn't match commitment)
    const mirrorPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      url: 'https://github.com/user/reveals/tree/main/wrong-key',
      provider: 'github',
      registered_at: new Date().toISOString(),
      signing_key: kp2.did_key,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
    const signature = wasm.signMessage(kp2.private_key_hex, payloadBytes);
    const mirror = { ...mirrorPayload, signature };

    const res = await req('POST', `/v1/commitments/${commitment.commitment_hash}/mirrors`, mirror);
    assert.equal(res.status, 403);
  });

  it('POST mirrors rejects invalid provider', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirror-badprov-test'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const mirrorPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      url: 'https://example.com/data',
      provider: 'dropbox',
      registered_at: new Date().toISOString(),
      signing_key: kp.did_key,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
    const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);
    const mirror = { ...mirrorPayload, signature };

    const res = await req('POST', `/v1/commitments/${commitment.commitment_hash}/mirrors`, mirror);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Invalid provider'));
  });

  it('tracks signer activity across multiple commitments', { skip: isRemote && 'exact counts unreliable on shared remote server' }, async () => {
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
