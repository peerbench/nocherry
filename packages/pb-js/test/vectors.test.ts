/**
 * Spec test vectors — run through WASM to verify cross-language correctness.
 *
 * These are the same test vectors from:
 *   - Commit-Reveal Spec Section 10 (PRNG, per-item selection, batch selection)
 *   - Hashing Spec Section 7 (file hashes, directory hashes)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from '@nocherry/pb-wasm';

// ── Hashing Spec Section 7.1: File Hashes ──

describe('Hashing spec test vectors', () => {
  it('empty file hash', () => {
    const hash = wasm.hashBytes(new Uint8Array(0));
    assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hello\\n hash (6 bytes)', () => {
    const hash = wasm.hashBytes(new TextEncoder().encode('hello\n'));
    assert.equal(hash, '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
  });

  it('hello hash (5 bytes, no newline)', () => {
    const hash = wasm.hashBytes(new TextEncoder().encode('hello'));
    assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

// ── Hashing Spec Section 7.2: Directory Hashes ──

describe('Directory hash test vectors', () => {
  it('single file directory', () => {
    const manifest = JSON.stringify([
      {"name":"hello.txt","type":"file","hash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}
    ]);
    const hash = wasm.hashManifest(manifest);
    assert.equal(hash, '10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f');
  });

  it('empty directory', () => {
    const hash = wasm.hashManifest('[]');
    assert.equal(hash, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  });

  it('nested directory', () => {
    // Step 1: log.txt hash
    const logHash = wasm.hashBytes(new TextEncoder().encode('log\n'));
    assert.equal(logHash, '9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857');

    // Step 2: data/ manifest
    const dataManifest = JSON.stringify([
      {"name":"log.txt","type":"file","hash":logHash}
    ]);
    const dataHash = wasm.hashManifest(dataManifest);
    assert.equal(dataHash, '3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80');

    // Step 3: readme.txt hash
    const readmeHash = wasm.hashBytes(new TextEncoder().encode('readme'));
    assert.equal(readmeHash, '711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe');

    // Step 4: testdir/ manifest
    const rootManifest = JSON.stringify([
      {"name":"data","type":"dir","hash":dataHash},
      {"name":"readme.txt","type":"file","hash":readmeHash}
    ]);
    const rootHash = wasm.hashManifest(rootManifest);
    assert.equal(rootHash, '28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94');
  });
});

// ── Commit-Reveal Spec Section 10.1: PRNG ──

describe('PRNG spec test vectors', () => {
  const seed = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('index 0', () => {
    const val = wasm.prngNext(seed, BigInt(0));
    assert.equal(val, '4342266150297190795');
  });

  it('index 1', () => {
    const val = wasm.prngNext(seed, BigInt(1));
    assert.equal(val, '8132706735728758093');
  });

  it('index 2', () => {
    const val = wasm.prngNext(seed, BigInt(2));
    assert.equal(val, '772158504366922665');
  });
});

// ── Commit-Reveal Spec Section 10.2: Per-Item Selection ──

describe('Per-item selection spec test vectors', () => {
  const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
  const commitmentHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

  it('threshold(0.10) = 1844674407370955264', () => {
    assert.equal(wasm.threshold(0.10), '1844674407370955264');
  });

  it('item IS selected', () => {
    const itemHash = '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2';
    const selected = wasm.selectPerItem(beaconRandomness, commitmentHash, itemHash, 0.10);
    assert.equal(selected, true);
  });

  it('item is NOT selected', () => {
    const itemHash = '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8';
    const selected = wasm.selectPerItem(beaconRandomness, commitmentHash, itemHash, 0.10);
    assert.equal(selected, false);
  });
});

// ── Commit-Reveal Spec Section 10.3: Batch Selection ──

describe('Batch selection spec test vectors', () => {
  const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
  const items = [
    '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
    '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2',
    '6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da',
    '4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030',
    '57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b',
  ];

  it('selects correct 2 items via Fisher-Yates', () => {
    const selected = wasm.selectBatch(JSON.stringify(items), beaconRandomness, 2);
    assert.deepEqual(selected, [
      '57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b',
      '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
    ]);
  });
});

// ── Signing roundtrip ──

describe('Signing', () => {
  it('generate, sign, verify roundtrip', () => {
    const kp = wasm.generateKeypair();
    assert.ok(kp.did_key.startsWith('did:key:z'));

    const message = new TextEncoder().encode('test message');
    const sig = wasm.signMessage(kp.private_key_hex, message);
    assert.equal(sig.length, 128); // 64 bytes = 128 hex chars

    const valid = wasm.verifySignature(kp.did_key, message, sig);
    assert.equal(valid, true);

    // Wrong message
    const wrong = wasm.verifySignature(kp.did_key, new TextEncoder().encode('wrong'), sig);
    assert.equal(wrong, false);
  });

  it('did:key encode roundtrip', () => {
    const kp = wasm.generateKeypair();
    const didKey = wasm.encodeDIDKey(kp.public_key_hex);
    assert.equal(didKey, kp.did_key);
  });
});

// ── Commitment creation and verification ──

describe('Commitment', () => {
  it('create and verify', () => {
    const kp = wasm.generateKeypair();
    const params = {
      items: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
      reveal_probability: 0.10,
      beacon: { type: 'drand', chain_hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971' },
      committed_at: '2026-02-06T14:30:00Z',
    };
    const commitment = wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
    assert.equal(commitment.spec_version, '0.2.0');
    assert.equal(commitment.item_count, 1);
    assert.equal(commitment.commitment_hash.length, 64);
    assert.ok(commitment.signature.length > 0);

    // Verify
    const valid = wasm.verifyCommitment(JSON.stringify(commitment));
    assert.equal(valid, true);
  });
});

// ── drand beacon ──

describe('drand beacon', () => {
  const GENESIS = 1692803367;

  it('round 1 is genesis', () => {
    assert.equal(Number(wasm.drandRoundTime(BigInt(1))), GENESIS);
  });

  it('round 2 is genesis + 3', () => {
    assert.equal(Number(wasm.drandRoundTime(BigInt(2))), GENESIS + 3);
  });

  it('time to round at genesis', () => {
    assert.equal(Number(wasm.drandTimeToRound(BigInt(GENESIS))), 1);
  });

  it('next round after genesis', () => {
    assert.equal(Number(wasm.drandNextRoundAfter(BigInt(GENESIS))), 2);
  });
});
