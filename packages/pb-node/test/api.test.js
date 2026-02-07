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

  // ── Mirrors (via reveals) tests ──

  it('GET mirrors returns 404 for unknown commitment', async () => {
    const res = await req('GET', '/v1/commitments/' + '0'.repeat(64) + '/mirrors');
    assert.equal(res.status, 404);
  });

  it('GET mirrors returns empty list when no reveals exist', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirrors-no-reveal-test'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const res = await req('GET', `/v1/commitments/${commitment.commitment_hash}/mirrors`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.commitment_hash, commitment.commitment_hash);
    assert.equal(body.mirrors.length, 0);
  });

  it('GET mirrors returns file_urls from reveal submissions', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('mirrors-via-reveal-test'));
    const commitment = makeCommitment(kp, [itemHash]);
    const commitRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(commitRes.status, 201);
    const receipt = await commitRes.json();

    // Create and submit a reveal with file_urls
    const selectedItems = receipt.selection.selected_items || [];
    const revealPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      selected_items: selectedItems,
      voluntary_items: commitment.items.filter(h => !selectedItems.includes(h)),
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
    };
    const revealBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
    const revealSig = wasm.signMessage(kp.private_key_hex, revealBytes);

    const fileUrls = { [itemHash]: 'https://example.com/data/result.json' };
    const revealRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/reveals`, {
      ...revealPayload, signature: revealSig, file_urls: fileUrls,
    });
    assert.equal(revealRes.status, 201);
    const revealBody = await revealRes.json();
    assert.equal(revealBody.file_urls_registered, 1, 'Should report 1 file URL registered');

    // GET mirrors should return the file_urls from the reveal
    const mirrorsRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}/mirrors`);
    assert.equal(mirrorsRes.status, 200);
    const mirrorsList = await mirrorsRes.json();
    assert.equal(mirrorsList.commitment_hash, commitment.commitment_hash);
    assert.equal(mirrorsList.mirrors.length, 1);
    assert.equal(mirrorsList.mirrors[0].item_hash, itemHash);
    assert.equal(mirrorsList.mirrors[0].url, 'https://example.com/data/result.json');
    assert.ok(mirrorsList.mirrors[0].revealed_at);
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
