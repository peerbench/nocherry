/**
 * Adversarial / attack tests for the commit-reveal HTTP API.
 *
 * Tests various ways a malicious client could try to break the server:
 * injection attacks, protocol violations, boundary conditions, forgeries.
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

async function req(method, path, body, headers = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return app.request(`http://localhost${path}`, init);
}

describe('Attack Tests — Server API', () => {
  before(async () => {
    app = await getApp();
  });

  after(async () => {
    await cleanup();
  });

  // ══════════════════════════════════════════════════════════════════
  // 1. MALFORMED INPUT ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects non-JSON body', async () => {
    const res = await app.request('http://localhost/v1/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json{{{',
    });
    // Should return 400 (bad request) not 500 (internal server error)
    assert.ok(res.status >= 400 && res.status < 500,
      `Expected 4xx, got ${res.status}`);
  });

  it('rejects empty body', async () => {
    const res = await app.request('http://localhost/v1/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    assert.ok(res.status >= 400 && res.status < 500);
  });

  it('rejects null body', async () => {
    const res = await req('POST', '/v1/commitments', null);
    assert.ok(res.status >= 400 && res.status < 500,
      `Expected 4xx for null body, got ${res.status}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. MISSING/INVALID FIELD ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects commitment missing each required field individually', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('missing-field-test'));
    const valid = makeCommitment(kp, [itemHash]);

    const requiredFields = [
      'spec_version', 'commitment_hash', 'items', 'item_count',
      'reveal_probability', 'beacon', 'committed_at', 'signing_key', 'signature'
    ];

    for (const field of requiredFields) {
      const tampered = { ...valid };
      delete tampered[field];
      const res = await req('POST', '/v1/commitments', tampered);
      assert.equal(res.status, 400,
        `Missing ${field} should return 400, got ${res.status}`);
    }
  });

  it('rejects wrong types for numeric fields', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('type-test'));
    const valid = makeCommitment(kp, [itemHash]);

    // String instead of number for reveal_probability
    const tampered = { ...valid, reveal_probability: 'not-a-number' };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. INJECTION ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('handles SQL injection in commitment hash path', async () => {
    const sqlPayload = "'; DROP TABLE commitments; --";
    const res = await req('GET', `/v1/commitments/${encodeURIComponent(sqlPayload)}`);
    // Should return 4xx — exact code varies by platform (404 local, 403 Supabase gateway)
    assert.ok(res.status >= 400 && res.status < 500,
      `Expected 4xx for SQL injection, got ${res.status}`);
  });

  it('handles SQL injection in reveal path', async () => {
    const sqlPayload = "' OR '1'='1";
    const res = await req('GET',
      `/v1/commitments/${encodeURIComponent(sqlPayload)}/reveals`);
    assert.ok(res.status >= 400 && res.status < 500,
      `Expected 4xx for SQL injection, got ${res.status}`);
  });

  it('handles very long commitment hash', async () => {
    const longHash = 'a'.repeat(10000);
    const res = await req('GET', `/v1/commitments/${longHash}`);
    // Should not succeed — exact error varies by platform
    // (404 local/Cloudflare, 500 GCP Firestore with very long keys)
    assert.ok(res.status >= 400,
      `Expected error status for 10k-char hash, got ${res.status}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. SIGNATURE BYPASS ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects commitment with tampered items but original signature', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('original'));
    const valid = makeCommitment(kp, [itemHash]);

    // Replace item with a different hash but keep signature
    const evilHash = wasm.hashBytes(new TextEncoder().encode('evil'));
    const tampered = {
      ...valid,
      items: [evilHash],
    };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects commitment with modified probability but original signature', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('prob-test'));
    const valid = makeCommitment(kp, [itemHash], { reveal_probability: 0.50 });

    // Lower probability to avoid revealing items
    const tampered = { ...valid, reveal_probability: 0.01 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects commitment with forged commitment_hash', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('hash-forge'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = {
      ...valid,
      commitment_hash: '0'.repeat(64),
    };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects commitment with empty signature', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('empty-sig'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, signature: '' };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects commitment with all-zeros signature', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('zero-sig'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, signature: '00'.repeat(64) };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects commitment signed by key A claiming key B', async () => {
    const kp_a = wasm.generateKeypair();
    const kp_b = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('key-swap'));
    const valid = makeCommitment(kp_a, [itemHash]);

    // Replace signing_key with B's key
    const tampered = { ...valid, signing_key: kp_b.did_key };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. ITEM VALIDATION ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects items array with non-strings', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('type-item'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, items: [42, null, true], item_count: 3 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects uppercase hex item hashes', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('upper-hex'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = {
      ...valid,
      items: ['A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'],
      item_count: 1,
    };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400,
      'Uppercase hex should be rejected by the regex /^[0-9a-f]{64}$/');
  });

  it('rejects duplicate items', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('dup-item'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = {
      ...valid,
      items: [itemHash, itemHash],
      item_count: 2,
    };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects item_count mismatch', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('count-mismatch'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, item_count: 999 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. PROBABILITY BOUNDARY ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects probability = 0', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('p-zero'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, reveal_probability: 0 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects negative probability', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('p-neg'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, reveal_probability: -0.5 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  it('rejects probability > 1', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('p-over'));
    const valid = makeCommitment(kp, [itemHash]);

    const tampered = { ...valid, reveal_probability: 1.5 };
    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. REVEAL ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects reveal for nonexistent commitment', async () => {
    const kp = wasm.generateKeypair();
    const fakeHash = '0'.repeat(64);
    const res = await req('POST', `/v1/commitments/${fakeHash}/reveals`, {
      spec_version: '0.2.0',
      commitment_hash: fakeHash,
      selected_items: [],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
      signature: '00'.repeat(64),
    });
    assert.equal(res.status, 404);
  });

  it('rejects reveal with mismatched commitment_hash in body vs URL', async () => {
    // First create a valid commitment
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('reveal-mismatch'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const res = await req('POST',
      `/v1/commitments/${commitment.commitment_hash}/reveals`, {
        spec_version: '0.2.0',
        commitment_hash: 'f'.repeat(64), // Different from URL
        selected_items: [],
        voluntary_items: [],
        revealed_at: new Date().toISOString(),
        signing_key: kp.did_key,
        signature: '00'.repeat(64),
      });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('does not match'));
  });

  it('rejects reveal with items not in original commitment', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('reveal-extra'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const fakeItem = wasm.hashBytes(new TextEncoder().encode('not-committed'));

    // Build a properly signed reveal with the fake item
    const revealPayload = JSON.stringify({
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      selected_items: [fakeItem],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
    });
    const sig = wasm.signMessage(kp.private_key_hex, new TextEncoder().encode(revealPayload));

    const revealBody = {
      ...JSON.parse(revealPayload),
      signature: sig,
    };

    const res = await req('POST',
      `/v1/commitments/${commitment.commitment_hash}/reveals`, revealBody);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('not in original commitment'));
  });

  it('rejects reveal with forged signature', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('reveal-forge'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const res = await req('POST',
      `/v1/commitments/${commitment.commitment_hash}/reveals`, {
        spec_version: '0.2.0',
        commitment_hash: commitment.commitment_hash,
        selected_items: [itemHash],
        voluntary_items: [],
        revealed_at: new Date().toISOString(),
        signing_key: kp.did_key,
        signature: '00'.repeat(64), // Forged
      });
    assert.equal(res.status, 400);
  });

  it('rejects reveal signed by wrong key', async () => {
    const kp = wasm.generateKeypair();
    const kp_evil = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('reveal-wrong-key'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    // Sign with evil key but claim to be the commitment signer
    const revealPayload = JSON.stringify({
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      selected_items: [itemHash],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key, // Claim to be kp
    });
    const sig = wasm.signMessage(kp_evil.private_key_hex, new TextEncoder().encode(revealPayload));

    const revealBody = {
      ...JSON.parse(revealPayload),
      signature: sig,
    };

    const res = await req('POST',
      `/v1/commitments/${commitment.commitment_hash}/reveals`, revealBody);
    assert.equal(res.status, 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 8. REPLAY / DUPLICATE ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects duplicate commitment submission', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('replay-test'));
    const commitment = makeCommitment(kp, [itemHash]);

    const res1 = await req('POST', '/v1/commitments', commitment);
    assert.equal(res1.status, 201);

    const res2 = await req('POST', '/v1/commitments', commitment);
    assert.equal(res2.status, 409, 'Duplicate commitment must return 409 Conflict');
  });

  // ══════════════════════════════════════════════════════════════════
  // 9. PATH TRAVERSAL ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('handles path traversal in commitment hash', async () => {
    const res = await req('GET', '/v1/commitments/../../etc/passwd');
    assert.ok(res.status === 404 || res.status === 400);
  });

  it('handles null bytes in paths', async () => {
    const res = await req('GET', '/v1/commitments/%00' + '0'.repeat(63));
    assert.ok(res.status >= 400);
  });

  // ══════════════════════════════════════════════════════════════════
  // 10. LARGE PAYLOAD ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('handles commitment with many items', async () => {
    // 100 items is reasonable, server should handle it
    const kp = wasm.generateKeypair();
    const items = [];
    for (let i = 0; i < 100; i++) {
      items.push(wasm.hashBytes(new TextEncoder().encode(`large-payload-${i}`)));
    }
    const commitment = makeCommitment(kp, items);
    const res = await req('POST', '/v1/commitments', commitment);
    // Should either succeed (201) or fail gracefully (4xx), never crash (5xx)
    assert.ok(res.status < 500, `Server should not crash with 100 items, got ${res.status}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // 11. CONTENT-TYPE ATTACKS
  // ══════════════════════════════════════════════════════════════════

  it('rejects non-JSON content type', async () => {
    const res = await app.request('http://localhost/v1/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"foo": "bar"}',
    });
    // Hono may still parse it depending on configuration
    // At minimum, the payload validation should reject it (missing fields)
    assert.ok(res.status >= 400 && res.status < 500);
  });

  // ══════════════════════════════════════════════════════════════════
  // 12. REVEAL MISSING REQUIRED FIELDS
  // ══════════════════════════════════════════════════════════════════

  it('rejects reveal missing each required field', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('reveal-fields'));
    const commitment = makeCommitment(kp, [itemHash]);
    await req('POST', '/v1/commitments', commitment);

    const baseReveal = {
      spec_version: '0.2.0',
      commitment_hash: commitment.commitment_hash,
      selected_items: [],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
      signature: '00'.repeat(64),
    };

    const requiredFields = [
      'spec_version', 'commitment_hash', 'selected_items',
      'voluntary_items', 'revealed_at', 'signing_key', 'signature'
    ];

    for (const field of requiredFields) {
      const tampered = { ...baseReveal };
      delete tampered[field];
      const res = await req('POST',
        `/v1/commitments/${commitment.commitment_hash}/reveals`, tampered);
      assert.equal(res.status, 400,
        `Missing ${field} in reveal should return 400, got ${res.status}`);
    }
  });
});
