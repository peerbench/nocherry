/**
 * Differential and property tests.
 *
 * 1. The pure-JavaScript implementation and the WebAssembly build of the Rust
 *    core agree on random inputs (not only on the spec vectors).
 * 2. Selection statistics: empirical inclusion frequencies match the reveal
 *    probability in both modes over many pseudo-random beacon values.
 * 3. The anchored registration window is exactly 6 s wide and both
 *    implementations place its edges at the same millisecond.
 * 4. Anchored receipts that break the registration rule do not verify.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as wasm from '@nocherry/pb-wasm';
import * as pure from '../src/pure-crypto.js';
import { verifyReceipt } from '../src/receipt.js';

const hex = (n: number) => randomBytes(n).toString('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Deterministic stand-in for beacon outputs: 32 pseudo-random bytes per index. */
const pseudoBeacon = (i: number) => sha256(`beacon-${i}`);

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

describe('Pure JS and WASM agree on random inputs', () => {
  it('hashBytes on 200 random buffers of 0 to 4096 bytes', () => {
    for (let i = 0; i < 200; i++) {
      const buf = randomBytes(Math.floor(Math.random() * 4097));
      assert.equal(pure.hashBytes(buf), wasm.hashBytes(buf));
    }
  });

  it('prngNext on 500 random seeds and indices', () => {
    for (let i = 0; i < 500; i++) {
      const seed = hex(32);
      const index = Math.floor(Math.random() * 2 ** 32);
      assert.equal(pure.prngNext(seed, index), wasm.prngNext(seed, BigInt(index)).toString());
    }
  });

  it('threshold on 1000 random probabilities and the edges', () => {
    const ps = [0, 1e-18, Number.MIN_VALUE, 0.1, 0.5, 1 - Number.EPSILON, 1, 1.5];
    for (let i = 0; i < 1000; i++) ps.push(Math.random());
    for (const p of ps) assert.equal(pure.threshold(p), wasm.threshold(p), `p=${p}`);
  });

  it('selectPerItem on 2000 random (randomness, commitment, item, p)', () => {
    let selected = 0;
    for (let i = 0; i < 2000; i++) {
      const r = hex(32), c = hex(32), h = hex(32), p = Math.random();
      const a = pure.selectPerItem(r, c, h, p);
      assert.equal(a, wasm.selectPerItem(r, c, h, p));
      if (a) selected++;
    }
    // p is uniform on (0,1), so about half of all draws are selected.
    assert.ok(selected > 800 && selected < 1200, `selected ${selected} of 2000`);
  });

  it('selectBatch on 300 random (items, randomness, count)', () => {
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(Math.random() * 60);
      const items = Array.from({ length: n }, () => hex(32));
      const count = Math.floor(Math.random() * (n + 1));
      const r = hex(32);
      assert.deepEqual(pure.selectBatch(items, r, count), wasm.selectBatch(JSON.stringify(items), r, count));
    }
  });

  it('commitment hash on 100 random commitments, with and without anchor_round', () => {
    const key = wasm.generateKeypair().private_key_hex;
    for (let i = 0; i < 100; i++) {
      const n = 1 + Math.floor(Math.random() * 20);
      const beacon: Record<string, unknown> = { type: 'drand', chain_hash: CHAIN };
      if (i % 2) beacon.anchor_round = 1 + Math.floor(Math.random() * 40_000_000);
      const params = {
        items: Array.from({ length: n }, () => hex(32)),
        reveal_probability: [0.1, 0.5, 1, 0.25, 0.01][i % 5],
        beacon,
        committed_at: new Date(Date.now() - Math.floor(Math.random() * 1e9)).toISOString(),
      };
      const c = wasm.createCommitment(JSON.stringify(params), key);
      const payload = pure.commitmentSigningPayload(c);
      assert.equal(pure.computeCommitmentHash(payload), c.commitment_hash);
      assert.ok(wasm.verifyCommitment(JSON.stringify(c)));
    }
  });

  it('drand round arithmetic on 1000 random instants', () => {
    for (let i = 0; i < 1000; i++) {
      const t = 1692803367 + Math.floor(Math.random() * 1e9);
      assert.equal(pure.drandTimeToRound(t), Number(wasm.drandTimeToRound(BigInt(t))));
      assert.equal(pure.drandNextRoundAfter(t), Number(wasm.drandNextRoundAfter(BigInt(t))));
      const r = pure.drandTimeToRound(t);
      assert.equal(pure.drandRoundTime(r), Number(wasm.drandRoundTime(BigInt(r))));
      // The first round strictly after t starts after t.
      assert.ok(pure.drandRoundTime(pure.drandNextRoundAfter(t)) > t);
      assert.ok(pure.drandRoundTime(pure.drandNextRoundAfter(t) - 1) <= t);
    }
  });

  it('checkAnchorRegistration on 2000 random (anchor, registered_at)', () => {
    for (let i = 0; i < 2000; i++) {
      const anchor = 1 + Math.floor(Math.random() * 40_000_000);
      const t = pure.drandRoundTime(anchor) * 1000 + Math.floor(Math.random() * 12000) - 3000;
      const a = pure.checkAnchorRegistration(anchor, t);
      const b = wasm.checkAnchorRegistration(BigInt(anchor), BigInt(t));
      assert.equal(a.ok, b.ok, `anchor=${anchor} t=${t}`);
      if (a.ok && b.ok) assert.equal(a.selection_round, Number(b.selection_round));
      if (!a.ok && !b.ok) assert.equal(a.code, b.code);
    }
  });
});

describe('Selection statistics', () => {
  it('per-item mode: inclusion frequency equals p (n = 2000 items, 50 beacon values, p = 0.1)', () => {
    const n = 2000, p = 0.1, rounds = 50;
    const items = Array.from({ length: n }, () => hex(32));
    const commitmentHash = hex(32);
    let selected = 0;
    for (let r = 0; r < rounds; r++) {
      const beacon = pseudoBeacon(r);
      for (const h of items) if (wasm.selectPerItem(beacon, commitmentHash, h, p)) selected++;
    }
    const trials = n * rounds;
    const freq = selected / trials;
    const sd = Math.sqrt(p * (1 - p) / trials); // 0.00095
    assert.ok(Math.abs(freq - p) < 5 * sd, `frequency ${freq} is more than 5 sd from ${p}`);
  });

  it('per-item mode: the selection depends on the commitment hash', () => {
    const items = Array.from({ length: 500 }, () => hex(32));
    const beacon = pseudoBeacon(1);
    const a = items.filter((h) => wasm.selectPerItem(beacon, hex(32), h, 0.5));
    const b = items.filter((h) => wasm.selectPerItem(beacon, hex(32), h, 0.5));
    assert.notDeepEqual(a, b);
  });

  it('batch mode: exactly m items, no duplicates, every position selected with frequency p (n = 200, 2000 beacon values)', () => {
    const n = 200, p = 0.1, rounds = 2000;
    const m = Math.ceil(p * n);
    const items = Array.from({ length: n }, () => hex(32));
    const ij = JSON.stringify(items);
    const counts = new Map(items.map((h) => [h, 0]));
    for (let r = 0; r < rounds; r++) {
      const sel: string[] = wasm.selectBatch(ij, pseudoBeacon(r), m);
      assert.equal(sel.length, m);
      assert.equal(new Set(sel).size, m);
      for (const h of sel) {
        assert.ok(counts.has(h), 'selected item is not a committed item');
        counts.set(h, counts.get(h)! + 1);
      }
    }
    const sd = Math.sqrt(rounds * p * (1 - p)); // 13.4
    for (const [h, c] of counts) {
      assert.ok(Math.abs(c - rounds * p) < 5 * sd, `item ${h} selected ${c} times, expected ${rounds * p}`);
    }
  });

  it('batch mode: the seed is the beacon output alone, so two commitments with the same n select the same positions (open issue, spec 8.3)', () => {
    // Pins the behaviour the paper describes as a weakness. Update when the seed is bound to the commitment.
    const a = Array.from({ length: 50 }, () => hex(32));
    const b = Array.from({ length: 50 }, () => hex(32));
    const beacon = pseudoBeacon(7);
    const pa = wasm.selectBatch(JSON.stringify(a), beacon, 5).map((h: string) => a.indexOf(h));
    const pb = wasm.selectBatch(JSON.stringify(b), beacon, 5).map((h: string) => b.indexOf(h));
    assert.deepEqual(pa, pb);
  });
});

describe('Anchored registration window', () => {
  const ANCHOR = 25892262;
  const tA = pure.drandRoundTime(ANCHOR) * 1000;

  it('is exactly 6000 ms wide and closes 1000 ms before the selection round, in both implementations', () => {
    let first: number | null = null, last: number | null = null;
    for (let t = tA - 2000; t <= tA + 8000; t++) {
      const a = pure.checkAnchorRegistration(ANCHOR, t).ok;
      assert.equal(a, wasm.checkAnchorRegistration(BigInt(ANCHOR), BigInt(t)).ok, `t = ${t}`);
      if (a) { if (first === null) first = t; last = t; }
    }
    assert.equal(first, tA - 1000);                     // T(a) - skew allowance
    assert.equal(last, tA + 2 * 3000 - 1000 - 1);       // last accepted ms before T(a+2) - margin
    assert.equal(last! - first! + 1, 6000);
  });

  it('rejects with the codes the spec names on each side of the window', () => {
    const early = pure.checkAnchorRegistration(ANCHOR, tA - 1001);
    assert.equal(early.ok, false);
    if (!early.ok) assert.equal(early.code, 'anchor_round_in_future');
    const late = pure.checkAnchorRegistration(ANCHOR, tA + 5000);
    assert.equal(late.ok, false);
    if (!late.ok) assert.equal(late.code, 'anchor_selection_round_available');
  });
});

describe('Adversarial anchored receipts', () => {
  // RFC 8032 section 7.1 test keys.
  const COMMITTER_KEY = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
  const SERVER_KEY = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
  // Real quicknet rounds 25892263 (16:02:33Z), 25892264 (16:02:36Z), 25892265 (16:02:39Z) on 2026-02-07.
  const ROUNDS: Record<number, { randomness: string; signature: string }> = {
    25892263: { randomness: 'cb5e3ee37912e328e8497cef8e845e7ea5e12f23e679e993bc63427a8dbfecf5', signature: '89d9074bd1ad018acd9b85fd99dba90b784fc9b62632f3b762cf7078c417e4c72895804e372e1a8cb201eb2c9e60a51d' },
    25892264: { randomness: '5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108', signature: '8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8' },
    25892265: { randomness: '981853163a6078ace4ab02d83913000181990ec0042b7de1752c31bb25fcd4c0', signature: 'a1b4b3885bbeaf23047dfd38ed5b64a9141e96de4f8de30b16be4fff9ff8a0eb6682a7cf95c26e9a035b1630728258d7' },
  };
  const ANCHOR = 25892262;
  const ITEMS = Array.from({ length: 5 }, (_, i) => sha256(`item-${i}`));

  function receipt(selectionRound: number, registeredAt: string) {
    const commitment = wasm.createCommitment(JSON.stringify({
      items: ITEMS, reveal_probability: 0.4,
      beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN }, committed_at: '2026-02-07T16:02:30Z',
    }), COMMITTER_KEY);
    const out = { type: 'drand', chain_hash: CHAIN, round: selectionRound, ...ROUNDS[selectionRound] };
    const selected = wasm.selectBatch(JSON.stringify(ITEMS), out.randomness, 2);
    const serverKey = wasm.createCommitment(JSON.stringify({ items: ITEMS, reveal_probability: 0.4, committed_at: '2026-02-07T16:02:30Z' }), SERVER_KEY).signing_key;
    const body = {
      commitment, commitment_hash: commitment.commitment_hash, registered_at: registeredAt, arrival_beacon: null,
      selection: {
        commitment_hash: commitment.commitment_hash, beacon_output: out, selection_mode: 'batch', reveal_probability: 0.4,
        selected_items: selected, selected_count: selected.length, total_count: ITEMS.length, computed_at: '2026-02-07T16:02:40Z',
      },
      signer_activity: { last_hour: 1, last_month: 1 }, key_matches_identity: null, server_key: serverKey,
    };
    const server_signature = wasm.signMessage(SERVER_KEY, new TextEncoder().encode(JSON.stringify(body)));
    return JSON.parse(JSON.stringify({ ...body, server_signature }));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusOf = (result: any, name: string) => result.checks.find((c: any) => c.name === name)?.status ?? 'absent';

  it('a correct anchored receipt verifies', () => {
    const r = verifyReceipt(receipt(ANCHOR + 2, '2026-02-07T16:02:34.321Z'));
    assert.equal(r.status, 'verified', JSON.stringify(r.checks));
  });

  it('a server that selected with round a+1, whose output was public at registration, is rejected', () => {
    const r = verifyReceipt(receipt(ANCHOR + 1, '2026-02-07T16:02:34.321Z'));
    assert.notEqual(r.status, 'verified');
    assert.equal(statusOf(r, 'anchor_selection_round'), 'fail');
  });

  it('a server that selected with round a+3 is rejected even though the output is genuine', () => {
    const r = verifyReceipt(receipt(ANCHOR + 3, '2026-02-07T16:02:34.321Z'));
    assert.notEqual(r.status, 'verified');
    assert.equal(statusOf(r, 'anchor_selection_round'), 'fail');
  });

  it('a server that registered at or after the selection round time is rejected', () => {
    for (const t of ['2026-02-07T16:02:36.000Z', '2026-02-07T16:02:36.001Z', '2026-02-07T16:03:00Z']) {
      const r = verifyReceipt(receipt(ANCHOR + 2, t));
      assert.notEqual(r.status, 'verified', t);
      assert.equal(statusOf(r, 'anchor_registration_time'), 'fail', t);
    }
  });

  it('a registration inside the 1 s safety margin passes the verifier: the margin protects against slow clocks, it is not part of the proof', () => {
    // Documented behaviour (spec 10.5 step 2a): the verifier checks registered_at < round_time(a+2).
    const r = verifyReceipt(receipt(ANCHOR + 2, '2026-02-07T16:02:35.999Z'));
    assert.equal(statusOf(r, 'anchor_registration_time'), 'pass');
  });
});
