/**
 * Pure JavaScript implementation of the core cryptographic primitives.
 * Uses only Node.js built-in `crypto` module — no WASM, no native addons.
 *
 * This exists for:
 *   1. Performance comparison against the WASM (Rust) implementation
 *   2. Environments where WASM is not available
 *   3. Reference implementation for spec compliance
 */

import { createHash, createHmac } from 'node:crypto';

// ── Hashing ──

export function hashBytes(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashManifest(entries: { name: string; type: string; hash: string }[]): string {
  const canonical = '[' + entries.map(e =>
    `{"name":${JSON.stringify(e.name)},"type":${JSON.stringify(e.type)},"hash":${JSON.stringify(e.hash)}}`
  ).join(',') + ']';
  return createHash('sha256').update(canonical).digest('hex');
}

// ── PRNG ──

export function prngNext(seedHex: string, index: number): string {
  const seed = Buffer.from(seedHex, 'hex');
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(index));
  const mac = createHmac('sha256', seed).update(indexBuf).digest();
  return mac.readBigUInt64LE(0).toString();
}

// ── Threshold ──

export function threshold(p: number): string {
  const TWO_64 = 18446744073709551616n;
  const result = BigInt(Math.floor(p * Number(TWO_64)));
  return result.toString();
}

// ── Per-Item Selection ──

export function selectPerItem(beaconRandomnessHex: string, commitmentHash: string, itemHash: string, revealProbability: number): boolean {
  const key = Buffer.from(beaconRandomnessHex, 'hex');
  const msg = commitmentHash + itemHash;
  const mac = createHmac('sha256', key).update(msg).digest();
  const value = mac.readBigUInt64LE(0);
  const thresh = BigInt(threshold(revealProbability));
  return value < thresh;
}

// ── Batch Selection (Fisher-Yates) ──

export function selectBatch(items: string[], beaconRandomnessHex: string, count: number): string[] {
  if (count > items.length) {
    throw new Error(`count (${count}) exceeds items length (${items.length})`);
  }
  const pool = [...items];
  for (let i = 0; i < count; i++) {
    const range = BigInt(pool.length - i);
    const rng = BigInt(prngNext(beaconRandomnessHex, i));
    const j = i + Number(rng % range);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// ── Commitment Hash ──

export function computeCommitmentHash(signingPayload: string): string {
  return createHash('sha256').update(signingPayload).digest('hex');
}

// ── drand round/time ──

const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;

export function drandRoundTime(round: number): number {
  return DRAND_GENESIS + (Number(round) - 1) * DRAND_PERIOD;
}

export function drandTimeToRound(unixTime: number): number {
  return Math.floor((Number(unixTime) - DRAND_GENESIS) / DRAND_PERIOD) + 1;
}

export function drandNextRoundAfter(unixTime: number): number {
  const t = Number(unixTime);
  if (t < DRAND_GENESIS) return 1;
  const round = drandTimeToRound(t);
  const roundTime = drandRoundTime(round);
  return roundTime <= t ? round + 1 : round;
}
