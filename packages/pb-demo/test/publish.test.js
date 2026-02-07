/**
 * Publish server tests — upload + retrieval.
 *
 * Dual-mode:
 *   node --test test/publish.test.js                              → local (embedded in-memory)
 *   PUBLISH_URL=https://reveal-r2.orgtopus.workers.dev \
 *     node --test test/publish.test.js                            → remote (live R2 server)
 *
 * When running against a remote server, uploads use Ed25519 auth with an
 * ephemeral (unlinked) key — this tests the debug-anon auth flow.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import {
  getPublisher, cleanup, isRemote, publishUrl,
  makeReceiptForItems, buildUploadForm, makeAuthHeader,
} from './publish-setup.js';

let publisher;
let kp;

async function upload(form, authKp) {
  const headers = {};
  // Remote servers require Ed25519 auth; embedded does not
  if (isRemote && authKp) {
    headers['Authorization'] = makeAuthHeader(authKp);
  }
  return publisher.request(`${publishUrl}/v1/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
}

describe('Publish server', () => {
  before(async () => {
    publisher = await getPublisher();
    kp = wasm.generateKeypair();
  });

  after(async () => {
    await cleanup();
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('uploads files with valid receipt and returns 201', async () => {
    const items = ['publish-test-alpha', 'publish-test-beta'];
    const receipt = await makeReceiptForItems(items, kp);
    const files = items.map((data, i) => ({ name: `item-${i + 1}.txt`, data }));

    const res = await upload(buildUploadForm(receipt, files), kp);
    assert.equal(res.status, 201, `Expected 201, got ${res.status}`);

    const body = await res.json();
    assert.ok(body.commitment_hash, 'response includes commitment_hash');
    assert.equal(body.files.length, 2, 'two files returned');
    assert.ok(body.files[0].url, 'file has URL');
    assert.ok(body.files[0].hash, 'file has hash');
    assert.ok(body.uploaded_at, 'response includes uploaded_at');
  });

  it('uploaded files are retrievable via GET', async () => {
    const content = 'retrievable-content-' + Date.now();
    const items = [content];
    const receipt = await makeReceiptForItems(items, kp);
    const files = [{ name: 'doc.txt', data: content }];

    const uploadRes = await upload(buildUploadForm(receipt, files), kp);
    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();

    let fileUrl = uploadBody.files[0].url;
    let getRes;
    if (isRemote) {
      getRes = await fetch(fileUrl);
    } else {
      // Embedded publisher returns URLs with /publish prefix (for demo mounting),
      // but the sub-app routes are at /v1/data/... directly
      fileUrl = fileUrl.replace('/publish/', '/');
      getRes = await publisher.request(fileUrl, { method: 'GET' });
    }
    assert.equal(getRes.status, 200);
    const retrieved = await getRes.text();
    assert.equal(retrieved, content);
  });

  it('single file upload works', async () => {
    const items = ['single-item-test'];
    const receipt = await makeReceiptForItems(items, kp);
    const files = [{ name: 'only.txt', data: items[0] }];

    const res = await upload(buildUploadForm(receipt, files), kp);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.files.length, 1);
  });

  // ── Validation errors ──────────────────────────────────────────────

  it('rejects upload with missing receipt', async () => {
    const form = new FormData();
    form.append('files[]', new Blob(['data'], { type: 'text/plain' }), 'f.txt');

    const res = await upload(form, kp);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('receipt'));
  });

  it('rejects upload with missing files', async () => {
    const items = ['no-files-test'];
    const receipt = await makeReceiptForItems(items, kp);
    const form = new FormData();
    form.append('receipt', JSON.stringify(receipt));

    const res = await upload(form, kp);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('files'));
  });

  it('rejects upload when file hash does not match commitment', async () => {
    const items = ['committed-item'];
    const receipt = await makeReceiptForItems(items, kp);
    const files = [{ name: 'wrong.txt', data: 'NOT the committed item' }];

    const res = await upload(buildUploadForm(receipt, files), kp);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.error.includes('not found in commitment'));
  });

  it('rejects upload with tampered commitment signature', async () => {
    const items = ['tamper-test'];
    const receipt = await makeReceiptForItems(items, kp);
    // Tamper with the commitment
    receipt.commitment.reveal_probability = 0.999;

    const files = [{ name: 'item.txt', data: items[0] }];
    const res = await upload(buildUploadForm(receipt, files), kp);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('signature') || body.error.toLowerCase().includes('verification'));
  });

  // ── 404 for missing files ──────────────────────────────────────────

  it('returns 404 for non-existent file', async () => {
    let res;
    if (isRemote) {
      res = await fetch(`${publishUrl}/v1/data/nonexistent-hash/missing.txt`);
    } else {
      res = await publisher.request(`${publishUrl}/v1/data/nonexistent-hash/missing.txt`, { method: 'GET' });
    }
    assert.equal(res.status, 404);
  });

  // ── Auth tests (remote only) ──────────────────────────────────────

  it('remote: rejects upload without auth header', { skip: !isRemote && 'embedded publisher has no auth' }, async () => {
    const items = ['no-auth-test'];
    const receipt = await makeReceiptForItems(items, kp);
    const files = [{ name: 'item.txt', data: items[0] }];

    // Upload WITHOUT auth header
    const res = await publisher.request(`${publishUrl}/v1/upload`, {
      method: 'POST',
      body: buildUploadForm(receipt, files),
    });
    assert.equal(res.status, 401);
  });

  it('remote: accepts upload with unlinked anon key', { skip: !isRemote && 'only relevant for remote servers' }, async () => {
    // Generate a brand new key that is definitely not linked to any account
    const anonKp = wasm.generateKeypair();
    const items = ['anon-key-test-' + Date.now()];
    const receipt = await makeReceiptForItems(items, anonKp);
    const files = [{ name: 'item.txt', data: items[0] }];

    const res = await upload(buildUploadForm(receipt, files), anonKp);
    assert.equal(res.status, 201, 'anon key should be accepted (debug-anon auth)');

    const body = await res.json();
    assert.ok(body.commitment_hash);
    assert.ok(body.files[0].url);
  });

  it('remote: rejects upload with invalid signature', { skip: !isRemote && 'only relevant for remote servers' }, async () => {
    const items = ['bad-sig-test'];
    const receipt = await makeReceiptForItems(items, kp);
    const files = [{ name: 'item.txt', data: items[0] }];
    const form = buildUploadForm(receipt, files);

    const res = await publisher.request(`${publishUrl}/v1/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Ed25519 ${kp.public_key_hex} 0 ${'00'.repeat(64)}` },
      body: form,
    });
    assert.equal(res.status, 401);
  });
});
