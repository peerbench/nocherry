/**
 * Multi-server E2E test: 3 independent PGlite-backed commit-reveal servers.
 *
 * Each server runs in its own child process (separate module scope),
 * giving each its own Ed25519 identity. Tests the full client round-trip:
 *
 *   1. Generate client Ed25519 keypair
 *   2. Hash data items
 *   3. Create signed commitment
 *   4. Submit the SAME commitment to all 3 servers
 *   5. Verify each server returns a valid receipt with its own server_key
 *   6. Collect selections from each server (beacon-based random selection)
 *   7. Submit signed reveals to each server
 *   8. Retrieve reveals back from each server
 *   9. Cross-verify: all servers agree on commitment hash, each has unique identity
 *  10. Verify all server signatures are cryptographically valid
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as wasm from '@nocherry/pb-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(__dirname, '_worker-server.js');

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

const SERVER_PORTS = [17420, 17421, 17422];

/** @type {import('child_process').ChildProcess[]} */
let workers = [];

/**
 * Spawn a child process running a PGlite server on the given port.
 * Resolves when the server sends a 'ready' IPC message.
 */
function spawnServer(port, dataDir = 'memory://') {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_SCRIPT, [], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Server on port ${port} failed to start within 15s`));
    }, 15000);

    child.on('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timeout);
        resolve(child);
      }
      if (msg.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(msg.message));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server on port ${port} exited with code ${code}`));
      }
    });

    // Log stderr for debugging
    child.stderr.on('data', (data) => {
      console.error(`[server:${port}] ${data.toString().trim()}`);
    });
  });
}

/**
 * Spawn a server and expect it to FAIL.
 * Resolves with the error message if the server crashes or reports an error.
 * Rejects if the server unexpectedly starts successfully.
 */
function spawnServerExpectFail(port, dataDir) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_SCRIPT, [], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    let stderrOutput = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Server on port ${port} did not fail within 15s`));
    }, 15000);

    child.on('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new Error(`Server on port ${port} started successfully but was expected to fail`));
      }
      if (msg.type === 'error') {
        clearTimeout(timeout);
        resolve(msg.message);
      }
    });

    child.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Crashed — that's what we expected
        resolve(stderrOutput || `Exited with code ${code}`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve(err.message);
    });
  });
}

function makeCommitment(kp, items, opts = {}) {
  const params = {
    items,
    reveal_probability: opts.reveal_probability || 0.50,
    beacon: opts.beacon || { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
    committed_at: opts.committed_at || new Date().toISOString(),
  };
  return wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
}

async function req(port, method, path, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

describe('Multi-server PGlite E2E: 3 servers, full round-trip', () => {
  before(async () => {
    // Spawn all 3 server processes in parallel
    workers = await Promise.all(SERVER_PORTS.map(spawnServer));
  });

  after(() => {
    for (const w of workers) {
      w.kill('SIGTERM');
    }
    workers = [];
  });

  it('all 3 servers respond to health check', async () => {
    const results = await Promise.all(
      SERVER_PORTS.map((port) => req(port, 'GET', '/health')),
    );
    for (const res of results) {
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
    }
  });

  it('each server has a unique server identity', async () => {
    const infos = await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(port, 'GET', '/v1/server-info');
        assert.equal(res.status, 200);
        return res.json();
      }),
    );

    const serverKeys = infos.map((i) => i.server_key);

    // All keys should be valid did:key identifiers
    for (const key of serverKeys) {
      assert.ok(key.startsWith('did:key:z'), `Server key should be a did:key, got: ${key}`);
    }

    // All keys should be distinct (independent server processes)
    const unique = new Set(serverKeys);
    assert.equal(unique.size, 3, 'All 3 servers must have distinct identities');
  });

  it('full cycle: commit to 3 servers, get receipts, reveal to all, cross-verify', async () => {
    // ── 1. Generate client keypair ──
    const kp = wasm.generateKeypair();
    assert.ok(kp.did_key.startsWith('did:key:z'));

    // ── 2. Hash data items ──
    const dataItems = [
      JSON.stringify({ model: 'test-model', score: 0.847, task: 'mmlu' }),
      JSON.stringify({ model: 'test-model', score: 0.912, task: 'hellaswag' }),
      JSON.stringify({ model: 'test-model', score: 0.763, task: 'truthfulqa' }),
    ];
    const itemHashes = dataItems.map((d) =>
      wasm.hashBytes(new TextEncoder().encode(d)),
    );
    assert.equal(itemHashes.length, 3);

    // ── 3. Create signed commitment ──
    const commitment = makeCommitment(kp, itemHashes, { reveal_probability: 0.50 });
    assert.ok(commitment.commitment_hash);
    assert.equal(commitment.item_count, 3);

    // Verify locally before submitting
    const localValid = wasm.verifyCommitment(JSON.stringify(commitment));
    assert.ok(localValid, 'Commitment should be locally valid');

    // ── 4. Submit the SAME commitment to all 3 servers ──
    const receipts = await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(port, 'POST', '/v1/commitments', commitment);
        assert.equal(res.status, 201, `Server on port ${port} should accept commitment`);
        return res.json();
      }),
    );

    // ── 5. Verify each receipt ──
    const serverKeys = [];
    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];
      const port = SERVER_PORTS[i];

      // Commitment hash must be identical across all servers
      assert.equal(
        receipt.commitment_hash,
        commitment.commitment_hash,
        `Server ${port}: commitment_hash must match`,
      );

      // Each server signs with its own key
      assert.ok(receipt.server_key, `Server ${port}: must have server_key`);
      assert.ok(
        receipt.server_key.startsWith('did:key:z'),
        `Server ${port}: server_key must be did:key`,
      );
      assert.ok(receipt.server_signature, `Server ${port}: must have server_signature`);
      assert.ok(receipt.registered_at, `Server ${port}: must have registered_at`);
      assert.ok(receipt.selection, `Server ${port}: must have selection`);

      // Verify server signature is cryptographically valid
      const { server_signature, ...signedPayload } = receipt;
      const payloadBytes = new TextEncoder().encode(JSON.stringify(signedPayload));
      const sigValid = wasm.verifySignature(receipt.server_key, payloadBytes, server_signature);
      assert.ok(sigValid, `Server ${port}: server signature must be cryptographically valid`);

      serverKeys.push(receipt.server_key);
    }

    // All 3 servers must have different keys
    const uniqueKeys = new Set(serverKeys);
    assert.equal(uniqueKeys.size, 3, 'All 3 servers must sign with different keys');

    // ── 6. Verify selections from each server ──
    const selections = receipts.map((r) => r.selection);
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i];
      assert.ok(sel.beacon_output, `Server ${SERVER_PORTS[i]}: selection must have beacon_output`);
      assert.ok(sel.selected_items, `Server ${SERVER_PORTS[i]}: selection must have selected_items`);
      assert.ok(sel.selected_count >= 0, `Server ${SERVER_PORTS[i]}: selected_count must be >= 0`);
      assert.equal(
        sel.commitment_hash,
        commitment.commitment_hash,
        `Server ${SERVER_PORTS[i]}: selection commitment_hash must match`,
      );
    }

    // If all servers fetched the same drand round, selections must be deterministically identical
    const firstRound = selections[0].beacon_output.round;
    const allSameRound = selections.every((s) => s.beacon_output.round === firstRound);
    if (allSameRound) {
      const firstSelected = JSON.stringify(selections[0].selected_items.sort());
      for (let i = 1; i < selections.length; i++) {
        const thisSelected = JSON.stringify(selections[i].selected_items.sort());
        assert.equal(
          thisSelected,
          firstSelected,
          `Same beacon round (${firstRound}) must produce same selection`,
        );
      }
    }

    // ── 7. Create signed reveal and submit to all 3 servers ──
    // Use the union of selected items across all servers
    const allSelectedSet = new Set();
    for (const sel of selections) {
      for (const item of sel.selected_items) {
        allSelectedSet.add(item);
      }
    }
    const selectedItems = [...allSelectedSet];
    const voluntaryItems = commitment.items.filter((h) => !allSelectedSet.has(h));

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

    // Submit reveal to all 3 servers
    const revealResults = await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(
          port,
          'POST',
          `/v1/commitments/${commitment.commitment_hash}/reveals`,
          reveal,
        );
        assert.equal(res.status, 201, `Server ${port}: reveal should be accepted`);
        return res.json();
      }),
    );

    // Verify reveal responses
    for (let i = 0; i < revealResults.length; i++) {
      const result = revealResults[i];
      const port = SERVER_PORTS[i];

      assert.ok(result.reveal_id, `Server ${port}: reveal must have reveal_id`);
      assert.ok(result.registered_at, `Server ${port}: reveal must have registered_at`);
      assert.ok(result.server_key, `Server ${port}: reveal must have server_key`);
      assert.ok(result.server_signature, `Server ${port}: reveal must have server_signature`);

      // Verify reveal response signature
      const { server_signature: revSig, ...revPayload } = result;
      const revBytes = new TextEncoder().encode(JSON.stringify(revPayload));
      const revSigValid = wasm.verifySignature(result.server_key, revBytes, revSig);
      assert.ok(revSigValid, `Server ${port}: reveal server signature must be valid`);
    }

    // ── 8. Retrieve reveals from each server ──
    const revealRetrievals = await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(
          port,
          'GET',
          `/v1/commitments/${commitment.commitment_hash}/reveals`,
        );
        assert.equal(res.status, 200, `Server ${port}: GET reveals should return 200`);
        return res.json();
      }),
    );

    for (let i = 0; i < revealRetrievals.length; i++) {
      const body = revealRetrievals[i];
      const port = SERVER_PORTS[i];

      assert.equal(
        body.commitment_hash,
        commitment.commitment_hash,
        `Server ${port}: retrieved reveals must match commitment`,
      );
      assert.equal(body.reveals.length, 1, `Server ${port}: should have exactly 1 reveal`);
    }

    // ── 9. Cross-verify: retrieve commitment from each server ──
    const commitmentRetrievals = await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(
          port,
          'GET',
          `/v1/commitments/${commitment.commitment_hash}`,
        );
        assert.equal(res.status, 200, `Server ${port}: GET commitment should return 200`);
        return res.json();
      }),
    );

    for (let i = 0; i < commitmentRetrievals.length; i++) {
      const body = commitmentRetrievals[i];
      const port = SERVER_PORTS[i];

      assert.equal(
        body.commitment_hash,
        commitment.commitment_hash,
        `Server ${port}: commitment_hash must be consistent`,
      );
      assert.equal(
        body.commitment.signing_key,
        kp.did_key,
        `Server ${port}: commitment signing_key must match client key`,
      );
      assert.equal(
        body.commitment.item_count,
        3,
        `Server ${port}: must have 3 items`,
      );

      // Verify server signature on retrieved commitment
      const { server_signature: cSig, ...cPayload } = body;
      const cBytes = new TextEncoder().encode(JSON.stringify(cPayload));
      const cSigValid = wasm.verifySignature(body.server_key, cBytes, cSig);
      assert.ok(cSigValid, `Server ${port}: retrieved commitment server signature must be valid`);
    }

    // ── 10. All 3 servers signed with different keys across all operations ──
    const allKeys = new Set([
      ...receipts.map((r) => r.server_key),
      ...revealResults.map((r) => r.server_key),
      ...commitmentRetrievals.map((r) => r.server_key),
    ]);
    assert.equal(allKeys.size, 3, 'All operations across all servers used 3 distinct keys');
  });

  it('duplicate commitment rejected by each server independently', async () => {
    const kp = wasm.generateKeypair();
    const hash = wasm.hashBytes(new TextEncoder().encode('dup-test-multi'));
    const commitment = makeCommitment(kp, [hash]);

    // First submission: all accept
    await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(port, 'POST', '/v1/commitments', commitment);
        assert.equal(res.status, 201, `Server ${port}: first submission should return 201`);
      }),
    );

    // Second submission: all reject with 409
    await Promise.all(
      SERVER_PORTS.map(async (port) => {
        const res = await req(port, 'POST', '/v1/commitments', commitment);
        assert.equal(res.status, 409, `Server ${port}: duplicate should return 409`);
      }),
    );
  });

  it('servers are isolated: commitment on one is not visible on others', async () => {
    const kp = wasm.generateKeypair();
    const hash = wasm.hashBytes(new TextEncoder().encode('isolation-test'));
    const commitment = makeCommitment(kp, [hash]);

    // Submit ONLY to server 0
    const res = await req(SERVER_PORTS[0], 'POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);

    // Servers 1 and 2 should NOT have it
    for (const port of [SERVER_PORTS[1], SERVER_PORTS[2]]) {
      const getRes = await req(port, 'GET', `/v1/commitments/${commitment.commitment_hash}`);
      assert.equal(getRes.status, 404, `Server ${port}: should not have commitment from server 0`);
    }
  });
});

describe('PGlite shared data directory conflict', () => {
  let tmpDir;
  let firstServer;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pglite-conflict-'));
  });

  after(() => {
    if (firstServer) {
      firstServer.kill('SIGTERM');
      firstServer = null;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('second server fails to start when data directory is already locked', async () => {
    const sharedDir = join(tmpDir, 'pgdata');

    // Start first server — should succeed and acquire the lock
    firstServer = await spawnServer(17430, sharedDir);
    const healthRes = await req(17430, 'GET', '/health');
    assert.equal(healthRes.status, 200, 'First server must be healthy');

    // Attempt to start second server on the SAME data directory
    const errorMessage = await spawnServerExpectFail(17431, sharedDir);

    assert.ok(
      errorMessage.includes('already in use'),
      `Second server should fail with lock error, got: ${errorMessage.slice(0, 200)}`,
    );
  });
});
