/**
 * Object format 0.5.0 (Spec v0.5).
 *
 * 1. Spec test vectors 13.9 to 13.16, through the WASM build of the Rust core
 *    and through the pure-JavaScript implementation.
 * 2. Differential tests on random inputs between the two implementations.
 * 3. Selection statistics with integer probabilities.
 * 4. Adversarial receipts and reveals: every attack the new fields close has
 *    a test that fails without the fix.
 * 5. A single-field mutation sweep over a complete 0.5.0 receipt.
 * 6. Both formats side by side in one verifier.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as wasm from '@nocherry/pb-wasm';
import * as pure from '../src/pure-crypto.js';
import { verifyReceipt, verifyReveal } from '../src/receipt.js';

const hex = (n: number) => randomBytes(n).toString('hex');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const pseudoBeacon = (i: number) => sha256(`beacon-${i}`);

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
// RFC 8032 section 7.1 tests 1 and 2 secret keys.
const COMMITTER_KEY = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SERVER_KEY = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
const COMMITTER_DID = 'did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw';

// Real quicknet rounds 25892263 to 25892265 (2026-02-07T16:02:33Z, 36Z, 39Z).
const ROUNDS: Record<number, { randomness: string; signature: string }> = {
  25892263: { randomness: 'cb5e3ee37912e328e8497cef8e845e7ea5e12f23e679e993bc63427a8dbfecf5', signature: '89d9074bd1ad018acd9b85fd99dba90b784fc9b62632f3b762cf7078c417e4c72895804e372e1a8cb201eb2c9e60a51d' },
  25892264: { randomness: '5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108', signature: '8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8' },
  25892265: { randomness: '981853163a6078ace4ab02d83913000181990ec0042b7de1752c31bb25fcd4c0', signature: 'a1b4b3885bbeaf23047dfd38ed5b64a9141e96de4f8de30b16be4fff9ff8a0eb6682a7cf95c26e9a035b1630728258d7' },
};
const ANCHOR = 25892262;
const R = ROUNDS[ANCHOR + 2].randomness;
const beaconOutput = (round: number) => ({ type: 'drand', chain_hash: CHAIN, round, ...ROUNDS[round] });

// ── Spec 13.9 ──
const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const VECTOR_ITEMS: [string, string, string][] = [
  ['2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8', 'e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b', '2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf'],
  ['32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2', '6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323', 'da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a'],
  ['6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da', 'b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533', '5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d'],
  ['4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030', '7d5ffda6bb923cb45d11e7a4aba3cbd7bdf13d44e8542177f976b4c0a5c951ca', '47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e'],
  ['57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b', 'a03fb4699c682592c28bb330257a09222fc4f864a3e49474fa940319b20a5b4e', '7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c'],
];
const ITEMS = VECTOR_ITEMS.map((v) => v[2]);
const HC_A = 'a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826';
const HC_B = 'd92fb2774202942e3a838d7c8cbb00d6e4de3b46af0a6ac67f74db7529627efa';
const METADATA_INPUT = JSON.parse('{"b": 1, "a": "x", "nested": {"z": [true, null], "y": "é\\n"}}');

const PAYLOAD_A = '{"spec_version":"0.5.0","items":["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a","5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d","47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e","7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c"],"item_count":5,"reveal_probability_ppm":400000,"selection_mode":"batch","beacon":{"type":"drand","anchor_round":25892262,"chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"stream_id":"bench-2026","sequence":7,"metadata":{"a":"x","b":1,"nested":{"y":"é\\n","z":[true,null]}},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}';

function vectorA() {
  return wasm.createCommitment(JSON.stringify({
    spec_version: '0.5.0', items: ITEMS, reveal_probability_ppm: 400000, selection_mode: 'batch',
    beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN },
    stream_id: 'bench-2026', sequence: 7, metadata: METADATA_INPUT, committed_at: '2026-02-06T14:30:00Z',
  }), COMMITTER_KEY);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusOf = (result: any, name: string) => result.checks.find((c: any) => c.name === name)?.status ?? 'absent';

describe('0.5.0 spec vectors: item commitments (13.9)', () => {
  for (const [h, salt, c] of VECTOR_ITEMS) {
    it(`item ${h}`, () => {
      assert.equal(wasm.deriveItemSalt(SECRET, h), salt);
      assert.equal(pure.deriveItemSalt(SECRET, h), salt);
      assert.equal(wasm.itemCommitment(salt, h), c);
      assert.equal(pure.itemCommitment(salt, h), c);
    });
  }
  it('commitItems derives all five at once', () => {
    const { items, salts } = wasm.commitItems(SECRET, JSON.stringify(VECTOR_ITEMS.map((v) => v[0])));
    assert.deepEqual(items, ITEMS);
    assert.deepEqual(salts, VECTOR_ITEMS.map((v) => v[1]));
  });
});

describe('0.5.0 spec vectors: threshold, count, rejection limits (13.10)', () => {
  const thresholds: [number, string][] = [
    [1, '18446744073709'], [70000, '1291272085159668613'], [100000, '1844674407370955161'],
    [500000, '9223372036854775808'], [999999, '18446725626965477906'], [1000000, '18446744073709551616'],
  ];
  for (const [ppm, want] of thresholds) {
    it(`threshold(${ppm})`, () => {
      assert.equal(wasm.thresholdPpm(ppm), want);
      assert.equal(pure.thresholdPpm(ppm), want);
    });
  }
  const counts: [number, number, number][] = [
    [70000, 100, 7], [100000, 17, 2], [100000, 2, 1], [1, 1, 1], [1, 1000000, 1], [1000000, 5, 5], [333333, 3, 1], [500000, 1, 1],
  ];
  for (const [ppm, n, want] of counts) {
    it(`batchCount(${ppm}, ${n}) = ${want}`, () => {
      assert.equal(wasm.batchCount(ppm, n), want);
      assert.equal(pure.batchCount(ppm, n), want);
    });
  }
  it('0.07 * 100 in doubles gives 8, in integers 7', () => {
    assert.equal(Math.ceil(0.07 * 100), 8);
    assert.equal(pure.batchCount(70000, 100), 7);
  });
  const limits: [bigint, string][] = [
    [1n, '18446744073709551616'], [2n, '18446744073709551616'], [3n, '18446744073709551615'], [5n, '18446744073709551615'],
    [7n, '18446744073709551614'], [10n, '18446744073709551610'], [1000n, '18446744073709551000'],
    [1n << 32n, '18446744073709551616'], [(1n << 64n) - 1n, '18446744073709551615'],
  ];
  for (const [range, want] of limits) {
    it(`rejectionLimit(${range})`, () => {
      assert.equal(wasm.rejectionLimit(range), want);
      assert.equal(pure.rejectionLimit(range), want);
    });
  }
  it('rejects ppm outside [1, 1000000] in both implementations', () => {
    for (const bad of [0, 1000001, -1, 0.5, 100000.5]) {
      assert.throws(() => pure.thresholdPpm(bad), undefined, `pure ${bad}`);
      assert.throws(() => pure.batchCount(bad, 10), undefined, `pure count ${bad}`);
    }
    assert.throws(() => wasm.thresholdPpm(0));
    assert.throws(() => wasm.thresholdPpm(1000001));
    assert.throws(() => wasm.batchCount(0, 10));
  });
});

describe('0.5.0 spec vectors: metadata (13.11)', () => {
  const canonical = '{"a":"x","b":1,"nested":{"y":"é\\n","z":[true,null]}}';
  it('canonicalizes in both implementations', () => {
    assert.equal(wasm.canonicalMetadata(JSON.stringify(METADATA_INPUT)), canonical);
    assert.equal(pure.canonicalMetadata(METADATA_INPUT), canonical);
  });
  it('rejects non-integers, big integers and non-objects', () => {
    for (const bad of ['{"a":1.5}', '{"a":9007199254740992}', '[1]', '"x"', 'null']) {
      assert.throws(() => wasm.canonicalMetadata(bad), undefined, `wasm ${bad}`);
      assert.throws(() => pure.canonicalMetadata(JSON.parse(bad)), undefined, `pure ${bad}`);
    }
    // Spec 7.3: a parser that keeps the number text rejects "1e2" and "1.0";
    // JSON.parse cannot tell them from 100 and 1 and canonicalizes to those.
    assert.throws(() => wasm.canonicalMetadata('{"a":1e2}'));
    assert.throws(() => wasm.canonicalMetadata('{"a":1.0}'));
    assert.equal(pure.canonicalMetadata(JSON.parse('{"a":1e2}')), '{"a":100}');
    assert.equal(wasm.canonicalMetadata('{"a":100}'), '{"a":100}');
    assert.throws(() => pure.canonicalMetadata({ a: -0 }));
    assert.throws(() => pure.canonicalMetadata({ a: 'x'.repeat(4096) }));
    assert.throws(() => wasm.canonicalMetadata(JSON.stringify({ a: 'x'.repeat(4096) })));
  });
  it('rejects a lone surrogate in both implementations', () => {
    assert.throws(() => pure.canonicalMetadata({ a: 'x\ud800' }));
    assert.throws(() => wasm.canonicalMetadata('{"a":"x\\ud800"}'));
  });

  it('sorts keys by code point in both implementations', () => {
    const input = { 'b': 1, 'B': 2, 'a': 3, 'ä': 4, 'aa': 5, '_': 6, '\u{1F600}': 7, '�': 8 };
    const want = '{"B":2,"_":6,"a":3,"aa":5,"b":1,"ä":4,"�":8,"\u{1F600}":7}';
    assert.equal(pure.canonicalMetadata(input), want);
    assert.equal(wasm.canonicalMetadata(JSON.stringify(input)), want);
  });
});

describe('0.5.0 spec vectors: commitments A and B (13.12, 13.14)', () => {
  it('commitment A: payload, hash, signature', () => {
    const c = vectorA();
    assert.equal(wasm.commitmentSigningPayload(JSON.stringify(c)), PAYLOAD_A);
    assert.equal(pure.commitmentSigningPayloadV5(c), PAYLOAD_A);
    assert.equal(pure.computeCommitmentHash(PAYLOAD_A), HC_A);
    assert.equal(c.commitment_hash, HC_A);
    assert.equal(c.signature, 'a399931bbae7c576b95cff32710726f2151043afaa462fe48e83d1a3454da7158851f10097707b0acbe0bfe03094346ccdddab9fdedf2c45177051c6e410880c');
    assert.equal(c.spec_version, '0.5.0');
    assert.equal(c.reveal_probability, undefined);
    assert.equal(c.signing_key, COMMITTER_DID);
    assert.ok(wasm.verifyCommitment(JSON.stringify(c)));
    assert.deepEqual(wasm.validateCommitment(JSON.stringify(c)), { ok: true });
  });

  it('commitment B: hash and signature', () => {
    const c = wasm.createCommitment(JSON.stringify({
      spec_version: '0.5.0', items: ITEMS.slice(0, 2), reveal_probability_ppm: 100000, selection_mode: 'per_item',
      beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN }, committed_at: '2026-02-06T14:30:00Z',
    }), COMMITTER_KEY);
    assert.equal(c.commitment_hash, HC_B);
    assert.equal(c.signature, '60d2b1c846fd95e9bb2b48db87d19e88cee9373ac0306a429b07e359fd6a0531592d4834f9cf0bbff22c411af18c968884223fbdff3fa3cf4ef46af947b5230c');
    assert.equal(pure.computeCommitmentHash(pure.commitmentSigningPayloadV5(c)), HC_B);
  });

  it('the plain item hashes do not appear anywhere in commitment A', () => {
    const json = JSON.stringify(vectorA());
    for (const [h, salt] of VECTOR_ITEMS) {
      assert.ok(!json.includes(h), `plain hash ${h} leaks`);
      assert.ok(!json.includes(salt), `salt ${salt} leaks`);
    }
  });

  it('metadata null values survive the WASM boundary and JSON.stringify', () => {
    const c = wasm.createCommitment(JSON.stringify({
      spec_version: '0.5.0', items: ITEMS, reveal_probability_ppm: 400000, selection_mode: 'batch',
      beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN },
      metadata: { none: null, list: [null, 1] }, committed_at: '2026-02-06T14:30:00Z',
    }), COMMITTER_KEY);
    assert.equal(c.metadata.none, null);
    assert.deepEqual(c.metadata.list, [null, 1]);
    const text = JSON.stringify(c);
    assert.ok(text.includes('"none":null'));
    assert.ok(wasm.verifyCommitment(text), 'a commitment written to disk and read back must verify');
  });

  it('createCommitment without spec_version still produces 0.2.0 (compatibility)', () => {
    const c = wasm.createCommitment(JSON.stringify({ items: ITEMS, reveal_probability: 0.4, committed_at: '2026-02-06T14:30:00Z' }), COMMITTER_KEY);
    assert.equal(c.spec_version, '0.2.0');
    assert.equal(c.reveal_probability, 0.4);
  });

  it('createCommitment refuses malformed 0.5.0 params', () => {
    const base = { spec_version: '0.5.0', items: ITEMS, reveal_probability_ppm: 400000, selection_mode: 'batch', beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN }, committed_at: '2026-02-06T14:30:00Z' };
    const bad: Record<string, unknown>[] = [
      { beacon: { type: 'drand', chain_hash: CHAIN } },
      { reveal_probability_ppm: 0 }, { reveal_probability_ppm: 1000001 }, { reveal_probability_ppm: 0.5 },
      { selection_mode: 'auto' }, { stream_id: 'x' }, { sequence: 1 }, { stream_id: 'x', sequence: -1 },
      { metadata: { p: 0.5 } }, { items: [...ITEMS, ITEMS[0]] }, { items: [ITEMS[0].toUpperCase()] }, { spec_version: '0.3.0' },
    ];
    for (const change of bad) {
      assert.throws(() => wasm.createCommitment(JSON.stringify({ ...base, ...change }), COMMITTER_KEY), undefined, JSON.stringify(change));
    }
  });
});

describe('0.5.0 spec vectors: selection (13.13, 13.14)', () => {
  it('batch selection of commitment A with round 25892264', () => {
    assert.equal(pure.batchSeedV5(R, HC_A), '9e38917f1c3657cca52685846e670bdf0ab59f8b9f6b9522cafc69f311fb42e6');
    const want = [ITEMS[0], ITEMS[1]];
    assert.deepEqual(wasm.selectBatchV5(JSON.stringify(ITEMS), R, HC_A, 2), want);
    assert.deepEqual(pure.selectBatchV5(ITEMS, R, HC_A, 2), want);
    assert.deepEqual(pure.selectV5('batch', R, HC_A, ITEMS, 400000), want);
  });
  it('batch selection of commitment A with round 25892265 (illustration)', () => {
    const r = ROUNDS[25892265].randomness;
    assert.equal(pure.batchSeedV5(r, HC_A), '65b8d9782a88951e6c60d0bd038949bdf0293c0386b92bcd28a0205288704fce');
    assert.deepEqual(wasm.selectBatchV5(JSON.stringify(ITEMS), r, HC_A, 2), [ITEMS[0], ITEMS[3]]);
    assert.deepEqual(pure.selectBatchV5(ITEMS, r, HC_A, 2), [ITEMS[0], ITEMS[3]]);
    assert.deepEqual(pure.selectBatchV5(ITEMS, r, HC_A, 5), [ITEMS[0], ITEMS[3], ITEMS[2], ITEMS[1], ITEMS[4]]);
  });
  it('per-item selection of commitment B', () => {
    assert.equal(pure.perItemValueV5(R, HC_B, ITEMS[0]), '232048498111607027');
    assert.equal(pure.perItemValueV5(R, HC_B, ITEMS[1]), '3269488891099752383');
    assert.equal(wasm.selectPerItemV5(R, HC_B, ITEMS[0], 100000), true);
    assert.equal(wasm.selectPerItemV5(R, HC_B, ITEMS[1], 100000), false);
    assert.equal(pure.selectPerItemV5(R, HC_B, ITEMS[0], 100000), true);
    assert.equal(pure.selectPerItemV5(R, HC_B, ITEMS[1], 100000), false);
  });
  it('ppm 1000000 selects every item in both modes and both implementations', () => {
    assert.deepEqual(pure.selectV5('per_item', R, HC_A, ITEMS, 1000000), ITEMS);
    assert.equal(ITEMS.every((c) => wasm.selectPerItemV5(R, HC_A, c, 1000000)), true);
    assert.deepEqual([...pure.selectV5('batch', R, HC_A, ITEMS, 1000000)].sort(), [...ITEMS].sort());
    assert.deepEqual(wasm.selectBatchV5(JSON.stringify(ITEMS), R, HC_A, 5), pure.selectBatchV5(ITEMS, R, HC_A, 5));
  });
  it('computeSelectionRecord uses the signed mode and carries ppm', () => {
    const c = vectorA();
    const rec = wasm.computeSelectionRecord(JSON.stringify(c), JSON.stringify(beaconOutput(ANCHOR + 2)), '2026-02-07T16:02:37Z');
    assert.equal(rec.selection_mode, 'batch');
    assert.equal(rec.reveal_probability_ppm, 400000);
    assert.equal(rec.reveal_probability, undefined);
    assert.deepEqual(rec.selected_items, [ITEMS[0], ITEMS[1]]);
    assert.equal(rec.selected_count, 2);
    assert.equal(rec.total_count, 5);
  });
});

describe('0.5.0 spec vectors: reveal (13.15)', () => {
  const openings = [0, 1, 2].map((i) => ({ item: ITEMS[i], salt: VECTOR_ITEMS[i][1], hash: VECTOR_ITEMS[i][0] }));
  const params = {
    spec_version: '0.5.0', commitment_hash: HC_A, selected_items: [ITEMS[0], ITEMS[1]], voluntary_items: [ITEMS[2]],
    openings: [...openings].reverse(), revealed_at: '2026-02-07T10:00:00Z', data_url: 'https://example.com/r',
  };
  const PAYLOAD = '{"spec_version":"0.5.0","commitment_hash":"a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826","selected_items":["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"],"voluntary_items":["5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d"],"openings":[{"item":"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","salt":"e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b","hash":"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"},{"item":"da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a","salt":"6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323","hash":"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"},{"item":"5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d","salt":"b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533","hash":"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da"}],"revealed_at":"2026-02-07T10:00:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}';

  it('payload and signature', () => {
    const r = wasm.createReveal(JSON.stringify(params), COMMITTER_KEY);
    assert.equal(wasm.revealSigningPayload(JSON.stringify(r)), PAYLOAD);
    assert.equal(pure.revealSigningPayloadV5(r), PAYLOAD);
    assert.equal(r.signature, 'e145fb61ab8b828c773806c1bdf6731c9b82cd2b63bbcf85ff2933dca40400fc36aa8e3bee7d719e129ba45289af0a2d2873c5a0a89d00244139592c3e920c0e');
    assert.deepEqual(r.openings, openings, 'openings are reordered to follow the item lists');
    assert.deepEqual(wasm.verifyRevealObject(JSON.stringify(r)), { ok: true });
    pure.verifyOpeningsV5(r);
  });
  it('pure JS rejects a bad opening, a missing opening, and a duplicate item', () => {
    const r = wasm.createReveal(JSON.stringify(params), COMMITTER_KEY);
    assert.throws(() => pure.verifyOpeningsV5({ ...r, openings: [{ ...r.openings[0], salt: '00'.repeat(32) }, ...r.openings.slice(1)] }));
    assert.throws(() => pure.verifyOpeningsV5({ ...r, openings: r.openings.slice(1) }));
    assert.throws(() => pure.verifyOpeningsV5({ ...r, voluntary_items: [ITEMS[0]] }));
    assert.throws(() => pure.verifyOpeningsV5({ ...r, openings: [r.openings[1], r.openings[0], r.openings[2]] }));
  });
});

describe('0.5.0 differential: pure JS and WASM agree on random inputs', () => {
  it('itemCommitment and deriveItemSalt on 300 random inputs', () => {
    for (let i = 0; i < 300; i++) {
      const salt = hex(32), h = hex(32), secret = hex(32);
      assert.equal(pure.itemCommitment(salt, h), wasm.itemCommitment(salt, h));
      assert.equal(pure.deriveItemSalt(secret, h), wasm.deriveItemSalt(secret, h));
    }
  });
  it('thresholdPpm and batchCount on every ppm boundary and 1000 random values', () => {
    const ppms = [1, 2, 999999, 1000000, 500000, 333333, 666667];
    for (let i = 0; i < 1000; i++) ppms.push(1 + Math.floor(Math.random() * 1_000_000));
    for (const ppm of ppms) {
      assert.equal(pure.thresholdPpm(ppm), wasm.thresholdPpm(ppm), `threshold ${ppm}`);
      const n = Math.floor(Math.random() * 100_000);
      assert.equal(pure.batchCount(ppm, n), wasm.batchCount(ppm, n), `count ${ppm} ${n}`);
    }
  });
  it('selectPerItemV5 on 3000 random (randomness, commitment, item, ppm)', () => {
    let selected = 0;
    for (let i = 0; i < 3000; i++) {
      const r = hex(32), hc = hex(32), c = hex(32), ppm = 1 + Math.floor(Math.random() * 1_000_000);
      const a = pure.selectPerItemV5(r, hc, c, ppm);
      assert.equal(a, wasm.selectPerItemV5(r, hc, c, ppm), `i=${i}`);
      if (a) selected++;
    }
    assert.ok(selected > 1300 && selected < 1700, `selected ${selected} of 3000 at uniform ppm`);
  });
  it('selectBatchV5 on 300 random (items, randomness, commitment, count)', () => {
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(Math.random() * 60);
      const items = Array.from({ length: n }, () => hex(32));
      const count = Math.floor(Math.random() * (n + 1));
      const r = hex(32), hc = hex(32);
      assert.deepEqual(pure.selectBatchV5(items, r, hc, count), wasm.selectBatchV5(JSON.stringify(items), r, hc, count));
    }
  });
  it('pure JS rejects malformed randomness and stream ids instead of truncating', () => {
    assert.throws(() => pure.selectPerItemV5('zz', HC_A, ITEMS[0], 100000));
    assert.throws(() => pure.selectBatchV5(ITEMS, R.slice(0, 62), HC_A, 1));
    assert.throws(() => pure.commitmentSigningPayloadV5({ ...vectorA(), stream_id: 'a/b', sequence: 1 }));
    assert.throws(() => pure.commitmentSigningPayloadV5({ ...vectorA(), stream_id: 'a b', sequence: 1 }));
  });

  it('rejectionLimit on 500 random ranges', () => {
    for (let i = 0; i < 500; i++) {
      const range = BigInt('0x' + hex(8)) % ((1n << 64n) - 1n) + 1n;
      assert.equal(pure.rejectionLimit(range), wasm.rejectionLimit(range));
    }
  });
  it('canonicalMetadata on 200 random nested objects', () => {
    const randomKey = () => ['a', 'b', 'Z', '_', 'ä', '\u{1F600}', 'key' + hex(2), '', ' ', '"q', '\\'][Math.floor(Math.random() * 11)];
    const randomValue = (depth: number): unknown => {
      const k = Math.floor(Math.random() * (depth > 2 ? 5 : 7));
      switch (k) {
        case 0: return null;
        case 1: return Math.random() < 0.5;
        case 2: return Math.floor(Math.random() * 2e6) - 1e6;
        case 3: return hex(Math.floor(Math.random() * 8)) + ['', '\n', '"', '\\', '\u0001', 'é', ' '][Math.floor(Math.random() * 7)];
        case 4: return Number.MAX_SAFE_INTEGER * (Math.random() < 0.5 ? 1 : -1);
        case 5: return Array.from({ length: Math.floor(Math.random() * 4) }, () => randomValue(depth + 1));
        default: return randomObject(depth + 1);
      }
    };
    const randomObject = (depth: number): Record<string, unknown> => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(Math.random() * 5); i++) o[randomKey()] = randomValue(depth);
      return o;
    };
    for (let i = 0; i < 200; i++) {
      const m = randomObject(0);
      const a = pure.canonicalMetadata(m);
      assert.equal(a, wasm.canonicalMetadata(JSON.stringify(m)));
      // Canonical form is a fixed point.
      assert.equal(pure.canonicalMetadata(JSON.parse(a)), a);
    }
  });
  it('commitment hash on 100 random 0.5.0 commitments', () => {
    const key = wasm.generateKeypair().private_key_hex;
    for (let i = 0; i < 100; i++) {
      const n = 1 + Math.floor(Math.random() * 20);
      const secret = hex(32);
      const { items } = wasm.commitItems(secret, JSON.stringify(Array.from({ length: n }, () => hex(32))));
      const params: Record<string, unknown> = {
        spec_version: '0.5.0', items,
        reveal_probability_ppm: 1 + Math.floor(Math.random() * 1_000_000),
        selection_mode: i % 2 ? 'batch' : 'per_item',
        beacon: { type: 'drand', anchor_round: 1 + Math.floor(Math.random() * 40_000_000), chain_hash: CHAIN },
        metadata: i % 3 ? { run: i, tags: ['x', null], note: 'é\n' } : {},
        committed_at: new Date(Date.now() - Math.floor(Math.random() * 1e9)).toISOString(),
      };
      if (i % 4 === 0) { params.stream_id = `stream-${i}`; params.sequence = i; }
      if (i % 5 === 0) params.identity = 'did:web:example.com';
      const c = wasm.createCommitment(JSON.stringify(params), key);
      const payload = pure.commitmentSigningPayloadV5(c);
      assert.equal(payload, wasm.commitmentSigningPayload(JSON.stringify(c)));
      assert.equal(pure.computeCommitmentHash(payload), c.commitment_hash);
      assert.ok(wasm.verifyCommitment(JSON.stringify(c)));
      // Selection agrees in the signed mode.
      const r = pseudoBeacon(i);
      assert.deepEqual(
        pure.selectV5(c.selection_mode, r, c.commitment_hash, c.items, c.reveal_probability_ppm),
        wasm.computeSelectionRecord(JSON.stringify(c), JSON.stringify({ type: 'drand', chain_hash: CHAIN, round: 1, randomness: r, signature: '00' }), 'now').selected_items,
      );
    }
  });
});

describe('0.5.0 selection statistics', () => {
  it('per-item mode: inclusion frequency equals ppm / 10^6 (n = 2000, 50 beacon values, ppm = 100000)', () => {
    const n = 2000, ppm = 100000, rounds = 50, p = ppm / 1e6;
    const items = Array.from({ length: n }, () => hex(32));
    const hc = hex(32);
    let selected = 0;
    for (let r = 0; r < rounds; r++) {
      const beacon = pseudoBeacon(r);
      for (const c of items) if (wasm.selectPerItemV5(beacon, hc, c, ppm)) selected++;
    }
    const trials = n * rounds, freq = selected / trials, sd = Math.sqrt(p * (1 - p) / trials);
    assert.ok(Math.abs(freq - p) < 5 * sd, `frequency ${freq} is more than 5 sd from ${p}`);
  });
  it('per-item mode at ppm 1: 100000 trials select at most a handful', () => {
    const hc = hex(32);
    let selected = 0;
    for (let i = 0; i < 100000; i++) if (pure.selectPerItemV5(pseudoBeacon(i % 50), hc, sha256(`i${i}`), 1)) selected++;
    assert.ok(selected <= 3, `selected ${selected} of 100000 at ppm 1 (expected 0.1)`);
  });
  it('batch mode: exactly m items, no duplicates, every position selected with frequency p (n = 200, 2000 beacon values)', () => {
    const n = 200, ppm = 100000, rounds = 2000, p = 0.1;
    const m = wasm.batchCount(ppm, n);
    assert.equal(m, 20);
    const items = Array.from({ length: n }, () => hex(32));
    const ij = JSON.stringify(items);
    const hc = hex(32);
    const counts = new Map(items.map((h) => [h, 0]));
    for (let r = 0; r < rounds; r++) {
      const sel: string[] = wasm.selectBatchV5(ij, pseudoBeacon(r), hc, m);
      assert.equal(sel.length, m);
      assert.equal(new Set(sel).size, m);
      for (const h of sel) counts.set(h, counts.get(h)! + 1);
    }
    const sd = Math.sqrt(rounds * p * (1 - p));
    for (const [h, c] of counts) assert.ok(Math.abs(c - rounds * p) < 5 * sd, `item ${h} selected ${c} times, expected ${rounds * p}`);
  });
  it('batch mode: two commitments with the same n and the same round select different positions (closes 0.2.0 weakness 2)', () => {
    const a = Array.from({ length: 50 }, () => hex(32));
    const b = Array.from({ length: 50 }, () => hex(32));
    const beacon = pseudoBeacon(7);
    let same = 0;
    for (let t = 0; t < 20; t++) {
      const pa = wasm.selectBatchV5(JSON.stringify(a), beacon, sha256(`c${t}a`), 5).map((h: string) => a.indexOf(h));
      const pb = wasm.selectBatchV5(JSON.stringify(b), beacon, sha256(`c${t}b`), 5).map((h: string) => b.indexOf(h));
      if (JSON.stringify(pa) === JSON.stringify(pb)) same++;
    }
    assert.equal(same, 0, 'positions must depend on the commitment hash');
  });
  it('batch mode: reordering the items does not move the selection predictably', () => {
    // In 0.2.0 the shuffle picked positions independent of the commitment, so a
    // committer could compute which permutation of its items would hide a bad one.
    // In 0.5.0 the permutation changes the commitment hash and with it the shuffle.
    const items = Array.from({ length: 30 }, () => hex(32));
    const beacon = pseudoBeacon(3);
    const key = wasm.generateKeypair().private_key_hex;
    const commit = (xs: string[]) => wasm.createCommitment(JSON.stringify({
      spec_version: '0.5.0', items: xs, reveal_probability_ppm: 100000, selection_mode: 'batch',
      beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN }, committed_at: '2026-02-06T14:30:00Z',
    }), key);
    const c1 = commit(items);
    const c2 = commit([...items].reverse());
    const s1 = pure.selectV5('batch', beacon, c1.commitment_hash, c1.items, 100000).map((h) => items.indexOf(h)).sort();
    const s2 = pure.selectV5('batch', beacon, c2.commitment_hash, c2.items, 100000).map((h) => items.indexOf(h)).sort();
    assert.notDeepEqual(s1, s2);
  });
});

// ── Receipts and reveals of a 0.5.0 commitment, as a server would issue them ──

interface Fixture { secret: string; data: Uint8Array[]; hashes: string[]; salts: string[]; items: string[] }

function fixture(n = 5): Fixture {
  const secret = sha256('fixture secret');
  const data = Array.from({ length: n }, (_, i) => new TextEncoder().encode(`question ${i}\n`));
  const hashes = data.map((d) => sha256(d));
  const { items, salts } = wasm.commitItems(secret, JSON.stringify(hashes));
  return { secret, data, hashes, salts, items };
}

const serverDid = () => wasm.createCommitment(JSON.stringify({ items: ITEMS, reveal_probability: 0.5, committed_at: '2026-02-06T14:30:00Z' }), SERVER_KEY).signing_key;

function signReceipt(body: Record<string, unknown>) {
  const withKey = { ...body, server_key: serverDid() };
  const server_signature = wasm.signMessage(SERVER_KEY, new TextEncoder().encode(JSON.stringify(withKey)));
  return JSON.parse(JSON.stringify({ ...withKey, server_signature }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReceipt(f: Fixture, opts: { mode?: string; ppm?: number; round?: number; registeredAt?: string; stream?: boolean } = {}): any {
  const commitment = wasm.createCommitment(JSON.stringify({
    spec_version: '0.5.0', items: f.items, reveal_probability_ppm: opts.ppm ?? 400000, selection_mode: opts.mode ?? 'batch',
    beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN },
    ...(opts.stream === false ? {} : { stream_id: 'law-bench', sequence: 3 }),
    metadata: { set: 'law-2026' }, committed_at: '2026-02-07T16:02:30Z',
  }), COMMITTER_KEY);
  const out = beaconOutput(opts.round ?? ANCHOR + 2);
  const selection = wasm.computeSelectionRecord(JSON.stringify(commitment), JSON.stringify(out), '2026-02-07T16:02:37.100Z');
  return signReceipt({
    commitment, commitment_hash: commitment.commitment_hash, registered_at: opts.registeredAt ?? '2026-02-07T16:02:31.500Z',
    arrival_beacon: null, selection,
    signer_activity: { commitments_past_hour: 1, commitments_past_month: 1 },
    stream_activity: { commitments: 1, highest_sequence: 3 },
    key_matches_identity: null,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReveal(f: Fixture, commitmentHash: string, selected: string[], voluntary: string[] = [], key = COMMITTER_KEY): any {
  const openings = [...selected, ...voluntary].map((item) => {
    const i = f.items.indexOf(item);
    return { item, salt: f.salts[i], hash: f.hashes[i] };
  });
  return wasm.createReveal(JSON.stringify({
    spec_version: '0.5.0', commitment_hash: commitmentHash, selected_items: selected, voluntary_items: voluntary, openings,
    revealed_at: '2026-02-08T10:00:00Z',
  }), key);
}

const dataFor = (f: Fixture, items: string[]) => Object.fromEntries(items.map((c) => [c, f.data[f.items.indexOf(c)]]));

describe('0.5.0 receipts: adversarial', () => {
  const f = fixture();

  it('a correct batch-mode receipt verifies with the 0.5.0 check list', () => {
    const r = verifyReceipt(makeReceipt(f));
    assert.equal(r.status, 'verified', JSON.stringify(r.checks));
    assert.deepEqual(r.checks.map((c) => [c.name, c.status]), [
      ['commitment_wellformed', 'pass'], ['commitment_signature', 'pass'],
      ['beacon_randomness', 'pass'], ['beacon_authentic', 'pass'],
      ['anchor_selection_round', 'pass'], ['anchor_registration_time', 'pass'],
      ['selection_mode', 'pass'], ['selection_correct', 'pass'], ['server_signature', 'pass'],
    ]);
  });

  it('a correct per-item receipt verifies', () => {
    const r = verifyReceipt(makeReceipt(f, { mode: 'per_item', ppm: 500000 }));
    assert.equal(r.status, 'verified', JSON.stringify(r.checks));
  });

  it('a record that misstates the signed probability fails selection_mode', () => {
    const receipt = makeReceipt(f);
    receipt.selection.reveal_probability_ppm = 1000000;
    delete receipt.server_signature;
    const r = verifyReceipt(receipt);
    assert.equal(statusOf(r, 'selection_mode'), 'fail');
    assert.equal(statusOf(r, 'selection_correct'), 'pass');
    assert.equal(r.status, 'failed');
  });

  it('weakness 1: a server that selects in the other mode is rejected, not warned about', () => {
    const receipt = makeReceipt(f);
    const { commitment, selection } = receipt;
    // The server recomputes in per-item mode and signs that.
    const other = pure.selectV5('per_item', selection.beacon_output.randomness, commitment.commitment_hash, commitment.items, commitment.reveal_probability_ppm);
    const { server_signature: _s, server_key: _k, ...body } = receipt;
    body.selection = { ...selection, selection_mode: 'per_item', selected_items: other, selected_count: other.length };
    const forged = signReceipt(body);
    const r = verifyReceipt(forged);
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'selection_mode'), 'fail');
    assert.equal(statusOf(r, 'selection_correct'), 'fail');
    assert.equal(statusOf(r, 'server_signature'), 'pass', 'the server did sign it');
    assert.equal(statusOf(r, 'selection_mode_default'), 'absent');
  });

  it('weakness 2: a selection computed with the unbound 0.2.0 shuffle is rejected', () => {
    const receipt = makeReceipt(f);
    const { commitment, selection } = receipt;
    const unbound = wasm.selectBatch(JSON.stringify(commitment.items), selection.beacon_output.randomness, 2);
    assert.notDeepEqual(unbound, selection.selected_items);
    receipt.selection.selected_items = unbound;
    delete receipt.server_signature;
    const r = verifyReceipt(receipt);
    assert.equal(statusOf(r, 'selection_correct'), 'fail');
  });

  it('weakness 4: stream_id, sequence and metadata cannot be changed or stripped after signing', () => {
    for (const [name, mutate] of [
      ['stream_id', (c: any) => { c.stream_id = 'other-bench'; }],
      ['sequence', (c: any) => { c.sequence = 4; }],
      ['metadata', (c: any) => { c.metadata = { set: 'law-2025' }; }],
      ['metadata emptied', (c: any) => { c.metadata = {}; }],
      ['stream stripped', (c: any) => { delete c.stream_id; delete c.sequence; }],
      ['sequence stripped', (c: any) => { delete c.sequence; }],
    ] as [string, (c: any) => void][]) {
      const receipt = makeReceipt(f);
      mutate(receipt.commitment);
      delete receipt.server_signature;
      const r = verifyReceipt(receipt);
      assert.equal(r.status, 'failed', name);
      assert.ok(statusOf(r, 'commitment_signature') === 'fail' || statusOf(r, 'commitment_wellformed') === 'fail', name);
    }
  });

  it('metadata key order in the JSON does not matter; the canonical form is signed', () => {
    const receipt = makeReceipt(f);
    receipt.commitment.metadata = JSON.parse('{"set":"law-2026"}');
    const reordered = JSON.parse(JSON.stringify(receipt).replace('{"set":"law-2026"}', '{"set":"law-2026"}'));
    assert.equal(verifyReceipt(reordered).status, 'verified');
    // A client with a richer object: order differs, bytes differ, verification holds.
    const rich = makeReceipt(f);
    rich.commitment.metadata = { set: 'law-2026' };
    assert.equal(verifyReceipt(rich).status, 'verified');
  });

  it('weakness 6: a 0.5.0 commitment without an anchor is malformed', () => {
    const receipt = makeReceipt(f);
    delete receipt.commitment.beacon.anchor_round;
    delete receipt.server_signature;
    const r = verifyReceipt(receipt);
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'commitment_wellformed'), 'fail');
  });

  it('a round other than anchor + 2 and a late registration are rejected', () => {
    let r = verifyReceipt(makeReceipt(f, { round: ANCHOR + 1 }));
    assert.equal(statusOf(r, 'anchor_selection_round'), 'fail');
    r = verifyReceipt(makeReceipt(f, { round: ANCHOR + 3 }));
    assert.equal(statusOf(r, 'anchor_selection_round'), 'fail');
    r = verifyReceipt(makeReceipt(f, { registeredAt: '2026-02-07T16:02:36.000Z' }));
    assert.equal(statusOf(r, 'anchor_registration_time'), 'fail');
    assert.equal(r.status, 'failed');
  });

  it('forged randomness and a forged beacon signature are rejected', () => {
    const receipt = makeReceipt(f);
    receipt.selection.beacon_output.randomness = '00'.repeat(32);
    delete receipt.server_signature;
    assert.equal(statusOf(verifyReceipt(receipt), 'beacon_randomness'), 'fail');
    const forged = makeReceipt(f);
    forged.selection.beacon_output.signature = 'ab'.repeat(48);
    forged.selection.beacon_output.randomness = sha256(Buffer.from('ab'.repeat(48), 'hex'));
    delete forged.server_signature;
    assert.equal(statusOf(verifyReceipt(forged), 'beacon_authentic'), 'fail');
  });

  it('malformed values fail commitment_wellformed instead of throwing', () => {
    for (const [name, mutate] of [
      ['ppm 0', (c: any) => { c.reveal_probability_ppm = 0; }],
      ['ppm too large', (c: any) => { c.reveal_probability_ppm = 1000001; }],
      ['ppm float', (c: any) => { c.reveal_probability_ppm = 400000.5; }],
      ['float probability added', (c: any) => { c.reveal_probability = 0.4; }],
      ['mode', (c: any) => { c.selection_mode = 'auto'; }],
      ['items uppercase', (c: any) => { c.items[0] = c.items[0].toUpperCase(); }],
      ['items duplicate', (c: any) => { c.items[1] = c.items[0]; }],
      ['item_count', (c: any) => { c.item_count = 4; }],
      ['metadata float', (c: any) => { c.metadata = { x: 1.5 }; }],
      ['metadata array', (c: any) => { c.metadata = [1]; }],
      ['stream too long', (c: any) => { c.stream_id = 'x'.repeat(129); }],
      ['stream control char', (c: any) => { c.stream_id = 'a\nb'; }],
      ['stream slash', (c: any) => { c.stream_id = 'bench/2026'; }],
      ['stream space', (c: any) => { c.stream_id = 'bench 2026'; }],
      ['stream non-ascii', (c: any) => { c.stream_id = 'b\u00e4nk'; }],
      ['uppercase signature', (c: any) => { c.signature = c.signature.toUpperCase(); }],
      ['sequence negative', (c: any) => { c.sequence = -1; }],
      ['sequence float', (c: any) => { c.sequence = 1.5; }],
      ['other chain', (c: any) => { c.beacon.chain_hash = '00'.repeat(32); }],
      ['anchor 0', (c: any) => { c.beacon.anchor_round = 0; }],
      ['version 0.3.0', (c: any) => { c.spec_version = '0.3.0'; }],
    ] as [string, (c: any) => void][]) {
      const receipt = makeReceipt(f);
      mutate(receipt.commitment);
      delete receipt.server_signature;
      const r = verifyReceipt(receipt);
      assert.equal(r.status, 'failed', name);
    }
  });

  it('a receipt changed after the server signed it is rejected', () => {
    const receipt = makeReceipt(f);
    receipt.stream_activity.commitments = 9;
    const r = verifyReceipt(receipt);
    assert.equal(statusOf(r, 'server_signature'), 'fail');
  });
});

describe('0.5.0 reveals: adversarial', () => {
  const f = fixture();
  const receipt = makeReceipt(f);
  const hash = receipt.commitment_hash as string;
  const selected: string[] = receipt.selection.selected_items;
  const unselected = f.items.filter((c) => !selected.includes(c));

  it('a complete reveal bundle verifies', () => {
    const r = verifyReveal(receipt, makeReveal(f, hash, selected, [unselected[0]]), dataFor(f, [...selected, unselected[0]]));
    assert.equal(r.status, 'verified', JSON.stringify(r.checks));
    assert.deepEqual([r.items_checked, r.items_passed, r.items_failed, r.items_missing], [3, 3, 0, 0]);
    for (const name of ['reveal_signature', 'reveal_matches_commitment', 'item_openings', 'data_integrity', 'completeness']) {
      assert.equal(statusOf(r, name), 'pass', name);
    }
  });

  it('weakness 3: before reveal, a guessed item cannot be tested against the commitment', () => {
    // 0.2.0: hash the guess and look for it. 0.5.0: the commitment lists only salted commitments.
    const guess = sha256(f.data[0]);
    assert.ok(!receipt.commitment.items.includes(guess));
    assert.ok(!JSON.stringify(receipt).includes(guess));
    // After the reveal only the revealed items' hashes appear.
    const reveal = makeReveal(f, hash, selected);
    const published = JSON.stringify(reveal);
    for (const c of unselected) assert.ok(!published.includes(f.hashes[f.items.indexOf(c)]), 'unrevealed item hash leaks');
  });

  it('an opening with a wrong salt fails item_openings even when the data matches the opened hash', () => {
    const reveal = makeReveal(f, hash, selected);
    reveal.openings[0].salt = '11'.repeat(32);
    reveal.signature = wasm.signMessage(COMMITTER_KEY, new TextEncoder().encode(pure.revealSigningPayloadV5(reveal)));
    const r = verifyReveal(receipt, reveal, dataFor(f, selected));
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'reveal_signature'), 'pass');
    assert.equal(statusOf(r, 'item_openings'), 'fail');
  });

  it('substituting another file (with its own valid hash) for a selected item fails item_openings', () => {
    const reveal = makeReveal(f, hash, selected);
    const other = f.items.indexOf(unselected[0]);
    reveal.openings[0] = { item: selected[0], salt: f.salts[other], hash: f.hashes[other] };
    reveal.signature = wasm.signMessage(COMMITTER_KEY, new TextEncoder().encode(pure.revealSigningPayloadV5(reveal)));
    const data = dataFor(f, selected);
    data[selected[0]] = f.data[other];
    const r = verifyReveal(receipt, reveal, data);
    assert.equal(statusOf(r, 'item_openings'), 'fail');
    assert.equal(r.status, 'failed');
  });

  it('changed data fails data_integrity; missing data and missing items are partial', () => {
    const data = dataFor(f, selected);
    data[selected[0]] = new TextEncoder().encode('something else');
    let r = verifyReveal(receipt, makeReveal(f, hash, selected), data);
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'data_integrity'), 'fail');
    r = verifyReveal(receipt, makeReveal(f, hash, selected), dataFor(f, [selected[0]]));
    assert.equal(r.status, 'partial');
    assert.equal(r.items_missing, 1);
    r = verifyReveal(receipt, makeReveal(f, hash, [selected[0]]), dataFor(f, [selected[0]]));
    assert.equal(r.status, 'partial');
    assert.equal(statusOf(r, 'completeness'), 'fail');
  });

  it('an unselected item presented as selected, or an uncommitted item, fails reveal_matches_commitment', () => {
    let r = verifyReveal(receipt, makeReveal(f, hash, [...selected, unselected[0]]), dataFor(f, [...selected, unselected[0]]));
    assert.equal(statusOf(r, 'reveal_matches_commitment'), 'fail');
    const bytes = new TextEncoder().encode('never committed');
    const h = sha256(bytes), salt = '22'.repeat(32), extra = wasm.itemCommitment(salt, h);
    const openings = [...selected.map((c) => ({ item: c, salt: f.salts[f.items.indexOf(c)], hash: f.hashes[f.items.indexOf(c)] })), { item: extra, salt, hash: h }];
    const reveal = wasm.createReveal(JSON.stringify({
      spec_version: '0.5.0', commitment_hash: hash, selected_items: selected, voluntary_items: [extra], openings, revealed_at: '2026-02-08T10:00:00Z',
    }), COMMITTER_KEY);
    r = verifyReveal(receipt, reveal, { ...dataFor(f, selected), [extra]: bytes });
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'reveal_matches_commitment'), 'fail');
    assert.equal(statusOf(r, 'item_openings'), 'pass');
  });

  it('a 0.2.0-style reveal without openings does not verify a 0.5.0 commitment', () => {
    const payload = { spec_version: '0.2.0', commitment_hash: hash, selected_items: selected, voluntary_items: [], revealed_at: '2026-02-08T10:00:00Z', signing_key: COMMITTER_DID };
    const signature = wasm.signMessage(COMMITTER_KEY, new TextEncoder().encode(JSON.stringify(payload)));
    const r = verifyReveal(receipt, { ...payload, signature }, dataFor(f, selected));
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'item_openings'), 'fail');
  });

  it('a reveal signed by another key still verifies when its openings are right', () => {
    const r = verifyReveal(receipt, makeReveal(f, hash, selected, [], SERVER_KEY), dataFor(f, selected));
    assert.equal(r.status, 'verified');
  });
});

describe('0.5.0 receipt: single-field mutation sweep', () => {
  it('no single-field mutation of a complete receipt still verifies', () => {
    const f = fixture();
    const original = makeReceipt(f);
    assert.equal(verifyReceipt(original).status, 'verified');
    const mutate = (v: unknown): unknown => {
      if (typeof v === 'string') return v.length === 0 ? 'x' : v.slice(0, -1) + (v[v.length - 1] === '0' ? '1' : '0');
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'boolean') return !v;
      return 'mutated';
    };
    let mutations = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, path: (string | number)[]) => {
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value !== null && typeof value === 'object') { walk(value, [...path, key]); continue; }
        const copy = structuredClone(original);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let target: any = copy;
        for (const step of path) target = target[step];
        target[key] = mutate(value);
        mutations++;
        assert.notEqual(verifyReceipt(copy).status, 'verified', `mutated ${[...path, key].join('.')} still verifies`);
      }
    };
    walk(original, []);
    assert.ok(mutations > 40, `only ${mutations} mutations`);
  });

  it('no single-field mutation of a complete reveal still verifies', () => {
    const f = fixture();
    const receipt = makeReceipt(f);
    const selected: string[] = receipt.selection.selected_items;
    const original = makeReveal(f, receipt.commitment_hash, selected);
    const data = dataFor(f, selected);
    assert.equal(verifyReveal(receipt, original, data).status, 'verified');
    let mutations = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, path: (string | number)[]) => {
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value !== null && typeof value === 'object') { walk(value, [...path, key]); continue; }
        const copy = structuredClone(original);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let target: any = copy;
        for (const step of path) target = target[step];
        target[key] = typeof value === 'string' ? value.slice(0, -1) + (value[value.length - 1] === '0' ? '1' : '0') : 'mutated';
        mutations++;
        assert.notEqual(verifyReveal(receipt, copy, data).status, 'verified', `mutated ${[...path, key].join('.')} still verifies`);
      }
    };
    walk(original, []);
    assert.ok(mutations >= 12, `only ${mutations} mutations`);
  });
});

describe('both formats in one verifier', () => {
  it('a 0.2.0 receipt still reports the 0.2.0 checks and a 0.5.0 receipt the 0.5.0 checks', () => {
    const f = fixture();
    const v5 = verifyReceipt(makeReceipt(f));
    assert.equal(statusOf(v5, 'commitment_wellformed'), 'pass');
    assert.equal(statusOf(v5, 'selection_mode_default'), 'absent');

    const legacy = wasm.createCommitment(JSON.stringify({
      items: f.hashes, reveal_probability: 0.5, beacon: { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN }, committed_at: '2026-02-07T16:02:30Z',
    }), COMMITTER_KEY);
    assert.equal(legacy.spec_version, '0.2.0');
    const selection = wasm.computeSelectionRecord(JSON.stringify(legacy), JSON.stringify(beaconOutput(ANCHOR + 2)), 'now');
    assert.equal(selection.reveal_probability, 0.5);
    assert.equal(selection.reveal_probability_ppm, undefined);
    assert.deepEqual(selection.selected_items, wasm.selectBatch(JSON.stringify(f.hashes), R, 3), 'legacy shuffle unchanged');
    const receipt = signReceipt({
      commitment: legacy, commitment_hash: legacy.commitment_hash, registered_at: '2026-02-07T16:02:31.500Z', arrival_beacon: null, selection,
      signer_activity: { commitments_past_hour: 1, commitments_past_month: 1 }, key_matches_identity: null,
    });
    const v2 = verifyReceipt(receipt);
    assert.equal(v2.status, 'verified', JSON.stringify(v2.checks));
    assert.equal(statusOf(v2, 'selection_mode_default'), 'pass');
    assert.equal(statusOf(v2, 'commitment_wellformed'), 'absent');
  });

  it('an unknown spec_version fails with the spec_version check', () => {
    const f = fixture();
    const receipt = makeReceipt(f);
    receipt.commitment.spec_version = '0.4.0';
    delete receipt.server_signature;
    const r = verifyReceipt(receipt);
    assert.equal(r.status, 'failed');
    assert.equal(statusOf(r, 'spec_version'), 'fail');
  });
});
