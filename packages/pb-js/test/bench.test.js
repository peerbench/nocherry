/**
 * Performance benchmark: WASM (Rust) vs Pure JS implementations.
 * Runs the same spec test vectors through both and measures timing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from 'pb-wasm';
import * as pure from '../src/pure-crypto.js';

const ITERATIONS = 10000;

function bench(label, fn) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();
  // Measure
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = (elapsed / ITERATIONS * 1000).toFixed(2);
  console.log(`  ${label}: ${elapsed.toFixed(1)}ms total, ${perOp}μs/op (${ITERATIONS} iterations)`);
  return elapsed;
}

// ── Correctness: verify pure JS matches WASM ──

describe('Pure JS correctness (matches WASM)', () => {
  it('hashBytes matches', () => {
    const data = new TextEncoder().encode('hello');
    assert.equal(pure.hashBytes(data), wasm.hashBytes(data));
  });

  it('hashManifest matches', () => {
    const entries = [
      { name: 'hello.txt', type: 'file', hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }
    ];
    const manifest = JSON.stringify(entries);
    assert.equal(pure.hashManifest(entries), wasm.hashManifest(manifest));
  });

  it('prngNext matches spec vectors', () => {
    const seed = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    assert.equal(pure.prngNext(seed, 0), '4342266150297190795');
    assert.equal(pure.prngNext(seed, 1), '8132706735728758093');
    assert.equal(pure.prngNext(seed, 2), '772158504366922665');
  });

  it('threshold matches', () => {
    assert.equal(pure.threshold(0.10), wasm.threshold(0.10));
  });

  it('selectPerItem matches', () => {
    const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
    const commitmentHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const itemHash1 = '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2';
    const itemHash2 = '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8';

    assert.equal(
      pure.selectPerItem(beaconRandomness, commitmentHash, itemHash1, 0.10),
      wasm.selectPerItem(beaconRandomness, commitmentHash, itemHash1, 0.10)
    );
    assert.equal(
      pure.selectPerItem(beaconRandomness, commitmentHash, itemHash2, 0.10),
      wasm.selectPerItem(beaconRandomness, commitmentHash, itemHash2, 0.10)
    );
  });

  it('selectBatch matches', () => {
    const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
    const items = [
      '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
      '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2',
      '6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da',
      '4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030',
      '57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b',
    ];
    const wasmResult = wasm.selectBatch(JSON.stringify(items), beaconRandomness, 2);
    const pureResult = pure.selectBatch(items, beaconRandomness, 2);
    assert.deepEqual(pureResult, wasmResult);
  });

  it('drand round/time matches', () => {
    assert.equal(pure.drandRoundTime(1), Number(wasm.drandRoundTime(BigInt(1))));
    assert.equal(pure.drandRoundTime(2), Number(wasm.drandRoundTime(BigInt(2))));
    assert.equal(pure.drandTimeToRound(1692803367), Number(wasm.drandTimeToRound(BigInt(1692803367))));
    assert.equal(pure.drandNextRoundAfter(1692803367), Number(wasm.drandNextRoundAfter(BigInt(1692803367))));
  });
});

// ── Performance Benchmarks ──

describe('Performance: WASM vs Pure JS', () => {
  it('hashBytes', () => {
    const data = new TextEncoder().encode('hello world this is a test of hashing performance');
    console.log('\n  hashBytes (50 bytes):');
    const wasmTime = bench('  WASM', () => wasm.hashBytes(data));
    const jsTime = bench('  JS  ', () => pure.hashBytes(data));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });

  it('prngNext', () => {
    const seed = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    console.log('\n  prngNext:');
    const wasmTime = bench('  WASM', () => wasm.prngNext(seed, BigInt(42)));
    const jsTime = bench('  JS  ', () => pure.prngNext(seed, 42));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });

  it('selectPerItem', () => {
    const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
    const commitmentHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const itemHash = '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2';
    console.log('\n  selectPerItem:');
    const wasmTime = bench('  WASM', () => wasm.selectPerItem(beaconRandomness, commitmentHash, itemHash, 0.10));
    const jsTime = bench('  JS  ', () => pure.selectPerItem(beaconRandomness, commitmentHash, itemHash, 0.10));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });

  it('selectBatch (5 items, pick 2)', () => {
    const beaconRandomness = 'f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6';
    const items = [
      '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
      '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2',
      '6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da',
      '4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030',
      '57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b',
    ];
    const itemsJson = JSON.stringify(items);
    console.log('\n  selectBatch (5 items, pick 2):');
    const wasmTime = bench('  WASM', () => wasm.selectBatch(itemsJson, beaconRandomness, 2));
    const jsTime = bench('  JS  ', () => pure.selectBatch(items, beaconRandomness, 2));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });

  it('hashBytes (1 KiB)', () => {
    const data = new Uint8Array(1024).fill(0x42);
    console.log('\n  hashBytes (1 KiB):');
    const wasmTime = bench('  WASM', () => wasm.hashBytes(data));
    const jsTime = bench('  JS  ', () => pure.hashBytes(Buffer.from(data)));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });

  it('hashBytes (64 KiB)', () => {
    const data = new Uint8Array(65536).fill(0x42);
    console.log('\n  hashBytes (64 KiB):');
    const wasmTime = bench('  WASM', () => wasm.hashBytes(data));
    const jsTime = bench('  JS  ', () => pure.hashBytes(Buffer.from(data)));
    console.log(`  Ratio: JS is ${(jsTime / wasmTime).toFixed(2)}x vs WASM`);
  });
});
