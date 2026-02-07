/**
 * End-to-end test: full commit-reveal-publish-verify cycle.
 *
 * Spins up an in-memory pb-node and a local file server (simulating GitHub),
 * then walks through every step of the protocol:
 *
 *   1. Generate Ed25519 keypair
 *   2. Create random data files, hash them
 *   3. Create signed commitment
 *   4. Submit commitment → server waits for drand beacon, returns receipt
 *   5. Get selection (which items to reveal)
 *   6. Create signed reveal, submit to server
 *   7. "Publish" data (serve from local HTTP server)
 *   8. Verify file_urls persisted via GET mirrors endpoint
 *   9. Call verify-publication — server fetches data from URLs, hashes, compares
 *  10. Assert signed attestation: all items match, server signature valid
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getApp, cleanup } from './_setup.js';

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

let app;
let fileServer;
let fileServerPort;
let tmpDir;

function makeCommitment(kp, items, opts = {}) {
  const params = {
    items,
    reveal_probability: opts.reveal_probability || 0.50,
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
  return app.request(`http://localhost${path}`, init);
}

/**
 * Start a simple static file server that serves files from `dir`.
 * Returns { server, port }.
 */
function startFileServer(dir) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const urlPath = decodeURIComponent(request.url);
      const filePath = join(dir, urlPath);
      try {
        const data = readFileSync(filePath);
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.end(data);
      } catch {
        response.writeHead(404);
        response.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

describe('E2E: commit → submit → reveal → publish → verify-publication', () => {
  before(async () => {
    app = await getApp();
    tmpDir = mkdtempSync(join(tmpdir(), 'pb-e2e-'));
    const result = await startFileServer(tmpDir);
    fileServer = result.server;
    fileServerPort = result.port;
  });

  after(async () => {
    await cleanup();
    if (fileServer) fileServer.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full cycle: commit, submit, reveal with file_urls, verify publication — all hashes match, signed attestation valid', async () => {
    // ── 1. Generate Ed25519 keypair ──
    const kp = wasm.generateKeypair();
    assert.ok(kp.did_key.startsWith('did:key:z'));

    // ── 2. Create 3 random data files ──
    const dataDir = join(tmpDir, 'published', 'data');
    mkdirSync(dataDir, { recursive: true });

    const files = [
      { name: 'result-01.json', content: JSON.stringify({ model: 'test-gpt', score: 0.847, task: 'mmlu' }) },
      { name: 'result-02.json', content: JSON.stringify({ model: 'test-gpt', score: 0.912, task: 'hellaswag' }) },
      { name: 'result-03.json', content: JSON.stringify({ model: 'test-gpt', score: 0.763, task: 'truthfulqa' }) },
    ];

    const itemHashes = [];
    for (const f of files) {
      writeFileSync(join(dataDir, f.name), f.content);
      const hash = wasm.hashBytes(new TextEncoder().encode(f.content));
      itemHashes.push(hash);
      f.hash = hash;
    }

    assert.equal(itemHashes.length, 3);
    // Verify hashes are valid 64-char hex
    for (const h of itemHashes) {
      assert.equal(h.length, 64);
      assert.match(h, /^[0-9a-f]+$/);
    }

    // ── 3. Create signed commitment ──
    const commitment = makeCommitment(kp, itemHashes, { reveal_probability: 0.50 });
    assert.ok(commitment.commitment_hash);
    assert.equal(commitment.item_count, 3);
    assert.equal(commitment.items.length, 3);
    assert.ok(commitment.signature);
    assert.equal(commitment.signing_key, kp.did_key);

    // Verify commitment signature locally
    const localValid = wasm.verifyCommitment(JSON.stringify(commitment));
    assert.ok(localValid, 'Commitment signature should be locally valid');

    // ── 4. Submit commitment to server ──
    const submitRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(submitRes.status, 201, 'Commitment submission should return 201');
    const receipt = await submitRes.json();

    assert.equal(receipt.commitment_hash, commitment.commitment_hash);
    assert.ok(receipt.registered_at, 'Receipt should have registered_at');
    assert.ok(receipt.server_key, 'Receipt should have server_key');
    assert.ok(receipt.server_key.startsWith('did:key:z'));
    assert.ok(receipt.server_signature, 'Receipt should have server_signature');
    assert.ok(receipt.selection, 'Receipt should have selection');
    assert.ok(receipt.selection.beacon_output, 'Selection should have beacon_output');
    assert.ok(receipt.selection.beacon_output.round, 'Beacon should have round number');
    assert.ok(receipt.selection.beacon_output.randomness, 'Beacon should have randomness');

    // ── 5. Get selection ──
    const selectedItems = receipt.selection.selected_items || [];
    const voluntaryItems = commitment.items.filter(h => !selectedItems.includes(h));

    // With 50% probability and 3 items, we expect 0-3 selected
    assert.ok(selectedItems.length >= 0 && selectedItems.length <= 3);
    assert.equal(selectedItems.length + voluntaryItems.length, 3);

    // Verify all selected items are in the commitment
    for (const item of selectedItems) {
      assert.ok(commitment.items.includes(item), `Selected item ${item} must be in commitment`);
    }

    // ── 6. Create signed reveal ──
    const revealPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      selected_items: selectedItems,
      voluntary_items: voluntaryItems,
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
    };
    const revealBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
    const revealSig = wasm.signMessage(kp.private_key_hex, revealBytes);
    const reveal = { ...revealPayload, signature: revealSig };

    // Build file_urls for server-side data verification
    const revealFileUrls = {};
    for (const item of selectedItems) {
      const file = files.find(f => f.hash === item);
      if (file) {
        revealFileUrls[item] = `http://127.0.0.1:${fileServerPort}/published/data/${file.name}`;
      }
    }

    // Submit reveal to server
    const revealRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/reveals`, { ...reveal, file_urls: revealFileUrls });
    assert.equal(revealRes.status, 201, 'Reveal submission should return 201');
    const revealBody = await revealRes.json();
    assert.ok(revealBody.reveal_id, 'Reveal response should have reveal_id');
    assert.ok(revealBody.registered_at, 'Reveal response should have registered_at');
    assert.ok(revealBody.server_key, 'Reveal response should have server_key');
    assert.ok(revealBody.server_signature, 'Reveal response should have server_signature');
    assert.equal(revealBody.data_verified, true, 'Reveal should have data_verified: true');
    assert.equal(revealBody.file_urls_registered, selectedItems.length, 'Reveal should report file_urls_registered count');

    // Verify reveal is stored
    const revealsRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}/reveals`);
    assert.equal(revealsRes.status, 200);
    const reveals = await revealsRes.json();
    assert.equal(reveals.reveals.length, 1);

    // ── 7. Data is already "published" (files served by local HTTP server) ──
    // Verify the file server is actually serving our files
    const testFetch = await fetch(`http://127.0.0.1:${fileServerPort}/published/data/${files[0].name}`);
    assert.equal(testFetch.status, 200, 'File server should serve published files');
    const testContent = await testFetch.text();
    assert.equal(testContent, files[0].content);

    // ── 8. Verify file_urls persisted via GET mirrors endpoint ──
    const mirrorsRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}/mirrors`);
    assert.equal(mirrorsRes.status, 200);
    const mirrorsList = await mirrorsRes.json();
    assert.equal(mirrorsList.commitment_hash, commitment.commitment_hash);
    // Mirrors should contain file_urls from the reveal
    assert.equal(mirrorsList.mirrors.length, selectedItems.length, 'Mirrors should contain one entry per revealed file_url');
    for (const m of mirrorsList.mirrors) {
      assert.ok(m.item_hash, 'Mirror entry should have item_hash');
      assert.ok(m.url, 'Mirror entry should have url');
      assert.ok(m.url.startsWith('http://127.0.0.1:'), 'Mirror URL should point to local file server');
      assert.ok(m.revealed_at, 'Mirror entry should have revealed_at');
    }

    // ── 9. Verify publication — server fetches each file and hashes it ──
    const fileUrls = {};
    for (const f of files) {
      fileUrls[f.hash] = `http://127.0.0.1:${fileServerPort}/published/data/${f.name}`;
    }

    const verifyRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/verify-publication`, {
      file_urls: fileUrls,
    });
    assert.equal(verifyRes.status, 200, 'Verify-publication should return 200');
    const verification = await verifyRes.json();

    // ── 10. Assert: all items match, signed attestation is valid ──
    assert.equal(verification.commitment_hash, commitment.commitment_hash);
    assert.equal(verification.all_match, true, 'All items should match');
    assert.equal(verification.verified_items, 3);
    assert.equal(verification.total_items, 3);
    assert.equal(verification.provided_items, 3);
    assert.ok(verification.verified_at);

    // Each individual item should have status 'match'
    assert.equal(verification.items.length, 3);
    for (const item of verification.items) {
      assert.equal(item.status, 'match', `Item ${item.hash.slice(0, 12)}... should match`);
      assert.ok(item.url.startsWith('http://127.0.0.1:'));
    }

    // Verify the server's signature on the attestation
    assert.ok(verification.server_key, 'Attestation should include server_key');
    assert.ok(verification.server_key.startsWith('did:key:z'));
    assert.ok(verification.server_signature, 'Attestation should include server_signature');

    const { server_signature, ...signedPayload } = verification;
    const attestBytes = new TextEncoder().encode(JSON.stringify(signedPayload));
    const sigValid = wasm.verifySignature(verification.server_key, attestBytes, server_signature);
    assert.ok(sigValid, 'Server signature on attestation must be cryptographically valid');

    // ── 11. Build and save publication.json (same structure as CLI) ──
    const publication = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      published_at: new Date().toISOString(),
      provider: 'custom',
      file_urls: fileUrls,
      server_attestations: [
        { server: 'embedded', attestation: verification },
      ],
    };
    const pubPath = join(tmpDir, 'publication.json');
    writeFileSync(pubPath, JSON.stringify(publication, null, 2) + '\n');

    // Verify publication.json can be read back and contains everything
    const saved = JSON.parse(readFileSync(pubPath, 'utf-8'));
    assert.equal(saved.spec_version, '0.2.0');
    assert.equal(saved.commitment_hash, commitment.commitment_hash);
    assert.equal(saved.provider, 'custom');
    assert.equal(Object.keys(saved.file_urls).length, 3, 'file_urls should map all 3 items');
    assert.equal(saved.server_attestations.length, 1);
    assert.equal(saved.server_attestations[0].attestation.all_match, true);
    assert.ok(saved.server_attestations[0].attestation.server_key);
    assert.ok(saved.server_attestations[0].attestation.server_signature);

    // Verify the attestation signature is still valid when loaded from disk
    const loadedAttestation = saved.server_attestations[0].attestation;
    const { server_signature: loadedSig, ...loadedPayload } = loadedAttestation;
    const loadedBytes = new TextEncoder().encode(JSON.stringify(loadedPayload));
    const loadedSigValid = wasm.verifySignature(loadedAttestation.server_key, loadedBytes, loadedSig);
    assert.ok(loadedSigValid, 'Attestation signature must remain valid after save/load from publication.json');

    // Verify file_urls contain the actual public URLs
    for (const f of files) {
      assert.ok(saved.file_urls[f.hash], `file_urls should contain hash for ${f.name}`);
      assert.ok(saved.file_urls[f.hash].includes(f.name), `URL for ${f.name} should contain filename`);
    }
  });

  it('verify-publication detects tampered data (hash mismatch)', async () => {
    const kp = wasm.generateKeypair();
    const content = 'original data for mismatch test';
    const hash = wasm.hashBytes(new TextEncoder().encode(content));

    // Write DIFFERENT content to the served file
    const mismatchDir = join(tmpDir, 'mismatch');
    mkdirSync(mismatchDir, { recursive: true });
    writeFileSync(join(mismatchDir, 'tampered.txt'), 'TAMPERED DATA — not the original');

    // Create and submit commitment with the real hash
    const commitment = makeCommitment(kp, [hash]);
    const submitRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(submitRes.status, 201);

    // Verify publication — URL serves tampered data
    const fileUrls = {
      [hash]: `http://127.0.0.1:${fileServerPort}/mismatch/tampered.txt`,
    };

    const verifyRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/verify-publication`, {
      file_urls: fileUrls,
    });
    assert.equal(verifyRes.status, 200);
    const verification = await verifyRes.json();

    assert.equal(verification.all_match, false, 'Tampered data should NOT match');
    assert.equal(verification.verified_items, 0);
    assert.equal(verification.items[0].status, 'mismatch');
    assert.ok(verification.items[0].computed_hash, 'Mismatch should include computed_hash');
    assert.notEqual(verification.items[0].computed_hash, hash);

    // Server should still sign the attestation (it reports the truth)
    assert.ok(verification.server_key);
    assert.ok(verification.server_signature);
  });

  it('verify-publication handles unreachable URLs', async () => {
    const kp = wasm.generateKeypair();
    const hash = wasm.hashBytes(new TextEncoder().encode('unreachable test'));
    const commitment = makeCommitment(kp, [hash]);
    await req('POST', '/v1/commitments', commitment);

    const fileUrls = {
      [hash]: `http://127.0.0.1:${fileServerPort}/nonexistent/path.txt`,
    };

    const verifyRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/verify-publication`, {
      file_urls: fileUrls,
    });
    assert.equal(verifyRes.status, 200);
    const verification = await verifyRes.json();

    assert.equal(verification.all_match, false);
    assert.equal(verification.verified_items, 0);
    assert.equal(verification.items[0].status, 'fetch_error');
    assert.ok(verification.items[0].detail.includes('404'));
  });

  it('verify-publication rejects unknown commitment', async () => {
    const fakeHash = '0'.repeat(64);
    const verifyRes = await req('POST', `/v1/commitments/${fakeHash}/verify-publication`, {
      file_urls: { [fakeHash]: 'http://example.com/data.txt' },
    });
    assert.equal(verifyRes.status, 404);
  });

  it('verify-publication rejects empty file_urls', async () => {
    const kp = wasm.generateKeypair();
    const hash = wasm.hashBytes(new TextEncoder().encode('empty urls test'));
    const commitment = makeCommitment(kp, [hash]);
    await req('POST', '/v1/commitments', commitment);

    const verifyRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/verify-publication`, {
      file_urls: {},
    });
    assert.equal(verifyRes.status, 400);
  });

  it('verify-publication reports not_in_commitment for unknown hashes', async () => {
    const kp = wasm.generateKeypair();
    const realHash = wasm.hashBytes(new TextEncoder().encode('real item'));
    const commitment = makeCommitment(kp, [realHash]);
    await req('POST', '/v1/commitments', commitment);

    const fakeHash = 'f'.repeat(64);
    const fileUrls = {
      [fakeHash]: `http://127.0.0.1:${fileServerPort}/published/data/result-01.json`,
    };

    const verifyRes = await req('POST', `/v1/commitments/${commitment.commitment_hash}/verify-publication`, {
      file_urls: fileUrls,
    });
    assert.equal(verifyRes.status, 200);
    const verification = await verifyRes.json();

    assert.equal(verification.all_match, false);
    assert.equal(verification.items[0].status, 'not_in_commitment');
  });
});
