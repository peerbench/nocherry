/**
 * beacon.anchor_round (spec 8.1.1): test vectors, pure-JS / WASM parity,
 * and the client's create / submit / retry behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from '@nocherry/pb-wasm';
import * as pure from '../src/pure-crypto.js';
import {
  ANCHOR_SELECTION_DELAY,
  anchorIsFresh,
  clockDrandRound,
  createAnchoredCommitment,
  fetchCurrentDrandRound,
  isAnchorRejection,
  reanchorCommitment,
  submitCommitment,
  verifyReceiptAnchor,
} from '../src/anchor.js';

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
// RFC 8032 section 7.1 test 1 secret key.
const TEST_KEY = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const ANCHOR = 25892262;

const VECTOR_PARAMS = {
  items: [
    '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
    '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2',
  ],
  reveal_probability: 0.10,
  beacon: { type: 'drand', chain_hash: CHAIN },
  committed_at: '2026-02-06T14:30:00Z',
};

// Spec 13.6: produced by the implementation before anchor_round existed.
const VECTOR = {
  payload: '{"spec_version":"0.2.0","items":["2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8","32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"],"item_count":2,"reveal_probability":0.1,"beacon":{"type":"drand","chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}',
  hash: '39b23208e0f65e4e2e5c0cd52e7eacb26047aaf9b4d89bb1280c3b78a21b33ac',
  signature: '5516f721b6f71554c8bacc6b3458a2427db9fd4d2367a0722e6fa2e08366e1c59cc1aba2cec6563a61a80026a58b155746951b3e74fb662a3891dde4994aaa07',
};

// Spec 13.7: the same commitment with anchor_round = 25892262.
const ANCHORED_VECTOR = {
  payload: VECTOR.payload.replace('"beacon":{"type":"drand",', '"beacon":{"type":"drand","anchor_round":25892262,'),
  hash: 'd3e6d24523acbbae6c586378da650bbcf2b3419974a938e7fa3aeb5051d9a59b',
  signature: 'f52fd33cdedd906ba795aa06fe13e7b944bac5506d058846eae8407cbfa2c9dc452695f57c06035f8175bda4809a4bb2a96893de6b8ec48dc641984a570f5e07',
};

const roundTimeMs = (round: number) => Number(wasm.drandRoundTime(BigInt(round))) * 1000;

function create(params: Record<string, unknown>, key = TEST_KEY) {
  return wasm.createCommitment(JSON.stringify(params), key);
}

function anchoredParams(anchorRound: number) {
  return { ...VECTOR_PARAMS, beacon: { ...VECTOR_PARAMS.beacon, anchor_round: anchorRound } };
}

// ── Test vectors ──

describe('Commitment test vectors', () => {
  it('13.6: commitment without anchor_round keeps its hash and signature', () => {
    const c = create(VECTOR_PARAMS);
    assert.equal(c.commitment_hash, VECTOR.hash);
    assert.equal(c.signature, VECTOR.signature);
    assert.equal('anchor_round' in c.beacon, false);
    assert.equal(JSON.stringify(c).includes('anchor_round'), false);
    assert.equal(wasm.verifyCommitment(JSON.stringify(c)), true);
    assert.equal(wasm.hashBytes(new TextEncoder().encode(VECTOR.payload)), VECTOR.hash);
  });

  it('13.7: commitment with anchor_round', () => {
    const c = create(anchoredParams(ANCHOR));
    assert.equal(c.beacon.anchor_round, ANCHOR);
    assert.equal(c.commitment_hash, ANCHORED_VECTOR.hash);
    assert.equal(c.signature, ANCHORED_VECTOR.signature);
    assert.equal(wasm.verifyCommitment(JSON.stringify(c)), true);
    assert.equal(wasm.hashBytes(new TextEncoder().encode(ANCHORED_VECTOR.payload)), ANCHORED_VECTOR.hash);
    assert.equal(wasm.verifySignature(c.signing_key, new TextEncoder().encode(ANCHORED_VECTOR.payload), c.signature), true);
  });

  it('anchor_round is covered by the signature', () => {
    const c = create(anchoredParams(ANCHOR));
    const moved = { ...c, beacon: { ...c.beacon, anchor_round: ANCHOR + 1 } };
    assert.equal(wasm.verifyCommitment(JSON.stringify(moved)), false);
    const { anchor_round: _gone, ...bare } = c.beacon;
    assert.equal(wasm.verifyCommitment(JSON.stringify({ ...c, beacon: bare })), false);
  });
});

// ── Pure JS mirrors WASM ──

describe('Pure JS matches WASM for anchored commitments', () => {
  it('constants', () => {
    assert.equal(pure.ANCHOR_SELECTION_DELAY, 2);
    assert.equal(pure.ANCHOR_SELECTION_DELAY, wasm.anchorSelectionDelay());
    assert.equal(pure.ANCHOR_SELECTION_SAFETY_MARGIN_MS, wasm.anchorSelectionSafetyMarginMs());
    assert.equal(pure.ANCHOR_CLOCK_SKEW_ALLOWANCE_MS, wasm.anchorClockSkewAllowanceMs());
    assert.equal(ANCHOR_SELECTION_DELAY, 2);
  });

  it('anchoredSelectionRound', () => {
    for (const round of [1, 2, ANCHOR, 2 ** 40]) {
      assert.equal(pure.anchoredSelectionRound(round), Number(wasm.anchoredSelectionRound(BigInt(round))));
      assert.equal(pure.anchoredSelectionRound(round), round + 2);
    }
    assert.throws(() => pure.anchoredSelectionRound(0));
    assert.throws(() => wasm.anchoredSelectionRound(0n));
  });

  it('signing payload and commitment hash, without and with anchor_round', () => {
    assert.equal(pure.commitmentSigningPayload(create(VECTOR_PARAMS)), VECTOR.payload);
    assert.equal(pure.commitmentSigningPayload(create(anchoredParams(ANCHOR))), ANCHORED_VECTOR.payload);

    const kp = wasm.generateKeypair();
    const variants: Record<string, unknown>[] = [
      VECTOR_PARAMS,
      anchoredParams(ANCHOR),
      anchoredParams(1),
      anchoredParams(2 ** 50),
      { ...anchoredParams(ANCHOR), identity: 'did:web:alice.example.com' },
      { ...VECTOR_PARAMS, identity: 'did:web:alice.example.com' },
      { ...anchoredParams(ANCHOR), beacon: { type: 'drand', anchor_round: ANCHOR } },
      { ...VECTOR_PARAMS, beacon: { type: 'nist', version: '2.0' } },
      { ...anchoredParams(ANCHOR), committed_at: 'quote " backslash \\ tab \t unicode é' },
    ];
    for (const params of variants) {
      const c = create(params, kp.private_key_hex);
      const payload = pure.commitmentSigningPayload(c);
      assert.equal(pure.computeCommitmentHash(payload), c.commitment_hash, JSON.stringify(params));
      assert.equal(wasm.verifySignature(c.signing_key, new TextEncoder().encode(payload), c.signature), true);
      assert.equal(payload.includes('anchor_round'), 'anchor_round' in (params.beacon as object));
      assert.equal(payload.includes('null'), false);
    }
  });

  it('signing payload for every reveal_probability notation', () => {
    for (const p of [1, 0.5, 0.1, 0.25, 0.123456789, 0.3333333333333333, 0.001, 0.0001, 0.00001, 0.000012,
      0.000001, 0.0000012, 1e-7, 1.5e-10, 5e-324]) {
      const c = create({ ...anchoredParams(ANCHOR), reveal_probability: p });
      assert.equal(pure.computeCommitmentHash(pure.commitmentSigningPayload(c)), c.commitment_hash, `p=${p}`);
    }
  });

  it('checkAnchorRegistration at every boundary', () => {
    const t = roundTimeMs;
    const cases: [number, number][] = [
      [ANCHOR, t(ANCHOR)],
      [ANCHOR, t(ANCHOR) + 2999],
      [ANCHOR, t(ANCHOR + 1) - 200],
      [ANCHOR, t(ANCHOR + 1) + 200],
      [ANCHOR, t(ANCHOR + 2) - 1001],
      [ANCHOR, t(ANCHOR + 2) - 1000],
      [ANCHOR, t(ANCHOR + 2) - 1],
      [ANCHOR, t(ANCHOR + 2)],
      [ANCHOR, t(ANCHOR + 500)],
      [ANCHOR, t(ANCHOR) - 1000],
      [ANCHOR, t(ANCHOR) - 1001],
      [ANCHOR + 100, t(ANCHOR)],
      [0, t(ANCHOR)],
      [1, t(1)],
    ];
    const outcomes = new Set<string>();
    for (const [round, nowMs] of cases) {
      const viaWasm = wasm.checkAnchorRegistration(BigInt(round), BigInt(nowMs));
      const viaPure = pure.checkAnchorRegistration(round, nowMs);
      assert.deepEqual(viaPure, viaWasm, `round=${round} now=${nowMs}`);
      outcomes.add(viaPure.ok ? 'ok' : viaPure.code);
    }
    assert.deepEqual([...outcomes].sort(), [
      'anchor_round_in_future', 'anchor_round_invalid', 'anchor_selection_round_available', 'ok',
    ]);
  });

  it('verifyReceiptAnchor', () => {
    const anchored = create(anchoredParams(ANCHOR));
    const plain = create(VECTOR_PARAMS);
    const iso = (ms: number) => new Date(ms).toISOString();
    const selection = (round: unknown) => ({ beacon_output: { type: 'drand', round, randomness: '00', signature: '00' } });
    const good = iso(roundTimeMs(ANCHOR) + 1500);

    const receipts: [string, unknown, [string, string][]][] = [
      ['valid', { commitment: anchored, registered_at: good, selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'pass']]],
      ['round = anchor + 1', { commitment: anchored, registered_at: good, selection: selection(ANCHOR + 1) },
        [['anchor_selection_round', 'fail'], ['anchor_registration_time', 'pass']]],
      ['round = anchor + 3', { commitment: anchored, registered_at: good, selection: selection(ANCHOR + 3) },
        [['anchor_selection_round', 'fail'], ['anchor_registration_time', 'pass']]],
      ['round missing', { commitment: anchored, registered_at: good, selection: selection(undefined) },
        [['anchor_selection_round', 'fail'], ['anchor_registration_time', 'pass']]],
      ['registered at the selection round', { commitment: anchored, registered_at: iso(roundTimeMs(ANCHOR + 2)), selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'fail']]],
      ['registered 1 ms before the selection round', { commitment: anchored, registered_at: iso(roundTimeMs(ANCHOR + 2) - 1), selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'pass']]],
      ['registered long after', { commitment: anchored, registered_at: iso(roundTimeMs(ANCHOR + 900)), selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'fail']]],
      // Round 25892262 starts at 2026-02-07T16:02:30Z, the selection round at 16:02:36Z.
      ['offset timestamp after the selection round', { commitment: anchored, registered_at: '2026-02-07T18:02:40.500+02:00', selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'fail']]],
      ['offset timestamp before the selection round', { commitment: anchored, registered_at: '2026-02-07T11:02:31-05:00', selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'pass']]],
      ['unparseable registered_at', { commitment: anchored, registered_at: '2026-02-06', selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'fail']]],
      ['no registered_at', { commitment: anchored, selection: selection(ANCHOR + 2) },
        [['anchor_selection_round', 'pass'], ['anchor_registration_time', 'skip']]],
      ['no selection yet', { commitment: anchored, registered_at: good, selection: null }, []],
      ['no anchor', { commitment: plain, registered_at: good, selection: selection(ANCHOR + 2) }, []],
      ['anchor 0', { commitment: create(anchoredParams(0)), registered_at: good, selection: selection(2) },
        [['anchor_selection_round', 'fail'], ['anchor_registration_time', 'fail']]],
    ];

    for (const [label, receipt, expected] of receipts) {
      const viaWasm = wasm.verifyReceiptAnchor(JSON.stringify(receipt));
      const viaPure = pure.verifyReceiptAnchor(receipt);
      assert.deepEqual(viaPure, viaWasm, label);
      assert.deepEqual(viaPure.map(c => [c.name, c.status]), expected, label);
      assert.deepEqual(verifyReceiptAnchor(receipt), viaWasm, label);
    }
  });
});

// ── Client: create ──

describe('createAnchoredCommitment', () => {
  it('sets anchor_round to the current round by default', async () => {
    const c = await createAnchoredCommitment(VECTOR_PARAMS, TEST_KEY, { currentRound: async () => ANCHOR });
    assert.equal(c.beacon.anchor_round, ANCHOR);
    assert.equal(c.commitment_hash, ANCHORED_VECTOR.hash);
    assert.equal(wasm.verifyCommitment(JSON.stringify(c)), true);
  });

  it('anchor: false gives the commitment the old client produced', async () => {
    let asked = false;
    const c = await createAnchoredCommitment(VECTOR_PARAMS, TEST_KEY, {
      anchor: false,
      currentRound: async () => { asked = true; return ANCHOR; },
    });
    assert.equal(asked, false);
    assert.equal('anchor_round' in c.beacon, false);
    assert.equal(c.commitment_hash, VECTOR.hash);
    assert.equal(c.signature, VECTOR.signature);
  });

  it('keeps an anchor the caller supplied and never anchors other beacon types', async () => {
    const explicit = await createAnchoredCommitment(anchoredParams(7), TEST_KEY, { currentRound: async () => ANCHOR });
    assert.equal(explicit.beacon.anchor_round, 7);
    const nist = await createAnchoredCommitment(
      { ...VECTOR_PARAMS, beacon: { type: 'nist', version: '2.0' } }, TEST_KEY, { currentRound: async () => ANCHOR });
    assert.equal('anchor_round' in nist.beacon, false);
  });

  it('reanchorCommitment keeps the content and replaces anchor and signature', async () => {
    const stale = create({ ...anchoredParams(ANCHOR), identity: 'did:web:alice.example.com', stream_id: 's_1', metadata: { k: 'v' } });
    const fresh = await reanchorCommitment(stale, TEST_KEY, { currentRound: async () => ANCHOR + 50 });
    assert.equal(fresh.beacon.anchor_round, ANCHOR + 50);
    assert.equal(fresh.beacon.chain_hash, CHAIN);
    assert.deepEqual(fresh.items, stale.items);
    assert.equal(fresh.reveal_probability, stale.reveal_probability);
    assert.equal(fresh.identity, stale.identity);
    assert.equal(fresh.stream_id, stale.stream_id);
    assert.deepEqual(fresh.metadata, stale.metadata);
    assert.equal(fresh.signing_key, stale.signing_key);
    assert.notEqual(fresh.commitment_hash, stale.commitment_hash);
    assert.equal(wasm.verifyCommitment(JSON.stringify(fresh)), true);
  });
});

describe('fetchCurrentDrandRound', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('asks the relay for the latest round', async () => {
    const urls: string[] = [];
    const round = await fetchCurrentDrandRound({
      relays: ['https://relay.test/'],
      fetch: async (url) => { urls.push(url); return json({ round: ANCHOR, randomness: 'ab' }); },
      now: () => roundTimeMs(ANCHOR) + 1300,
    });
    assert.equal(round, ANCHOR);
    assert.deepEqual(urls, [`https://relay.test/${CHAIN}/public/latest`]);
  });

  it('takes the clock round when the relay is behind, and the relay round when the clock is behind', async () => {
    // Relay still serves round ANCHOR although ANCHOR + 1 is scheduled already.
    const lagging = await fetchCurrentDrandRound({
      relays: ['https://relay.test'],
      fetch: async () => json({ round: ANCHOR }),
      now: () => roundTimeMs(ANCHOR + 1) + 200,
    });
    assert.equal(lagging, ANCHOR + 1);
    // Clock runs slow: the relay already serves ANCHOR + 1.
    const slowClock = await fetchCurrentDrandRound({
      relays: ['https://relay.test'],
      fetch: async () => json({ round: ANCHOR + 1 }),
      now: () => roundTimeMs(ANCHOR) + 2900,
    });
    assert.equal(slowClock, ANCHOR + 1);
  });

  it('moves on to the next relay, then falls back to the clock', async () => {
    const second = await fetchCurrentDrandRound({
      relays: ['https://down.test', 'https://up.test'],
      fetch: async (url) => {
        if (url.startsWith('https://down.test')) throw new Error('unreachable');
        return json({ round: ANCHOR });
      },
      now: () => roundTimeMs(ANCHOR) + 1300,
    });
    assert.equal(second, ANCHOR);

    const nowMs = roundTimeMs(ANCHOR + 9) + 1200;
    const fallback = await fetchCurrentDrandRound({
      relays: ['https://a.test', 'https://b.test'],
      fetch: async (url) => (url.startsWith('https://a.test') ? json({ error: 'x' }, 500) : json({ round: 'nope' })),
      now: () => nowMs,
    });
    assert.equal(fallback, ANCHOR + 9);
    assert.equal(clockDrandRound(nowMs), ANCHOR + 9);
  });
});

// ── Client: submit with retry ──

describe('submitCommitment', () => {
  /** A server that applies the registration rule with its own fixed clock. */
  function fakeServer(nowMs: () => number) {
    const posts: any[] = [];
    const registered = new Set<string>();
    const handle = (body: any): Response => {
      posts.push(body);
      const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });
      if (!wasm.verifyCommitment(JSON.stringify(body))) return reply(400, { error: 'Invalid commitment signature' });
      if (registered.has(body.commitment_hash)) return reply(409, { error: 'Commitment already exists' });
      const registeredAt = new Date(nowMs()).toISOString();
      let round: number;
      if (body.beacon.anchor_round !== undefined) {
        const check = wasm.checkAnchorRegistration(BigInt(body.beacon.anchor_round), BigInt(nowMs()));
        if (!check.ok) return reply(400, { error: check.message, error_code: check.code, anchor_round: body.beacon.anchor_round, server_time: registeredAt });
        round = check.selection_round;
      } else {
        round = Number(wasm.drandNextRoundAfter(BigInt(Math.floor(nowMs() / 1000))));
      }
      registered.add(body.commitment_hash);
      return reply(201, { commitment: body, commitment_hash: body.commitment_hash, registered_at: registeredAt, selection: { beacon_output: { round } } });
    };
    return { posts, handle };
  }

  function harness(serverClocks: Record<string, () => number>) {
    const servers = Object.keys(serverClocks).map(name => ({ name, url: `https://${name}.test` }));
    const backends = Object.fromEntries(Object.entries(serverClocks).map(([name, clock]) => [name, fakeServer(clock)]));
    const doFetch = async (url: string, init?: RequestInit) => {
      const name = new URL(url).hostname.replace('.test', '');
      return backends[name].handle(JSON.parse(init!.body as string));
    };
    return { servers, backends, doFetch };
  }

  it('sends a fresh anchored commitment once, and all servers agree on the round', async () => {
    const tick = roundTimeMs(ANCHOR + 1);
    const { servers, backends, doFetch } = harness({ early: () => tick - 200, late: () => tick + 200 });
    const commitment = create(anchoredParams(ANCHOR));
    let resigned = 0;

    const outcome = await submitCommitment(servers, commitment, {
      fetch: doFetch,
      now: () => tick - 300,
      reanchor: async (c) => { resigned++; return c; },
    });

    assert.equal(resigned, 0);
    assert.equal(outcome.reanchored, 0);
    assert.equal(outcome.commitment.commitment_hash, commitment.commitment_hash);
    assert.deepEqual(outcome.results.map(r => r.status), [201, 201]);
    assert.deepEqual(outcome.results.map(r => r.body.selection.beacon_output.round), [ANCHOR + 2, ANCHOR + 2]);
    assert.equal(backends.early.posts.length, 1);
    assert.equal(backends.late.posts.length, 1);
  });

  it('re-signs a stale anchor before sending, without using up the retry', async () => {
    const nowMs = roundTimeMs(ANCHOR + 400) + 100;
    const { servers, backends, doFetch } = harness({ a: () => nowMs });
    const stale = create(anchoredParams(ANCHOR));
    assert.equal(anchorIsFresh(stale, nowMs), false);

    const outcome = await submitCommitment(servers, stale, {
      fetch: doFetch,
      now: () => nowMs,
      reanchor: (c) => reanchorCommitment(c, TEST_KEY, { currentRound: async () => ANCHOR + 400 }),
    });

    assert.equal(outcome.reanchored, 1);
    assert.equal(backends.a.posts.length, 1, 'the stale commitment is never sent');
    assert.equal(backends.a.posts[0].beacon.anchor_round, ANCHOR + 400);
    assert.equal(outcome.results[0].status, 201);
    assert.equal(outcome.commitment.beacon.anchor_round, ANCHOR + 400);
    assert.equal(outcome.results[0].body.selection.beacon_output.round, ANCHOR + 402);
  });

  it('retries exactly once with a fresh anchor when the server rejects it', async () => {
    // The client clock is behind: it believes the anchor is fresh, the server does not.
    const serverNow = roundTimeMs(ANCHOR + 2) + 500;
    const { servers, backends, doFetch } = harness({ a: () => serverNow });
    const commitment = create(anchoredParams(ANCHOR));

    const outcome = await submitCommitment(servers, commitment, {
      fetch: doFetch,
      now: () => roundTimeMs(ANCHOR) + 500,
      reanchor: (c) => reanchorCommitment(c, TEST_KEY, { currentRound: async () => ANCHOR + 2 }),
    });

    assert.equal(outcome.reanchored, 1);
    assert.equal(backends.a.posts.length, 2);
    assert.equal(backends.a.posts[0].beacon.anchor_round, ANCHOR);
    assert.equal(backends.a.posts[1].beacon.anchor_round, ANCHOR + 2);
    assert.equal(outcome.results[0].status, 201);
    assert.equal(outcome.results[0].body.selection.beacon_output.round, ANCHOR + 4);
  });

  it('gives up after one retry', async () => {
    const serverNow = roundTimeMs(ANCHOR + 50);
    const { servers, backends, doFetch } = harness({ a: () => serverNow });
    let resigned = 0;

    const outcome = await submitCommitment(servers, create(anchoredParams(ANCHOR)), {
      fetch: doFetch,
      now: () => roundTimeMs(ANCHOR) + 500,
      // A broken round source keeps producing stale anchors.
      reanchor: (c) => { resigned++; return reanchorCommitment(c, TEST_KEY, { currentRound: async () => ANCHOR + 1 }); },
    });

    assert.equal(resigned, 1);
    assert.equal(backends.a.posts.length, 2);
    assert.equal(outcome.results[0].status, 400);
    assert.equal(outcome.results[0].body.error_code, 'anchor_selection_round_available');
    assert.equal(isAnchorRejection(outcome.results[0]), true);
  });

  it('does not re-sign once any server has accepted the commitment', async () => {
    const { servers, backends, doFetch } = harness({
      ontime: () => roundTimeMs(ANCHOR) + 500,
      toolate: () => roundTimeMs(ANCHOR + 2) + 500,
    });
    let resigned = 0;

    const outcome = await submitCommitment(servers, create(anchoredParams(ANCHOR)), {
      fetch: doFetch,
      now: () => roundTimeMs(ANCHOR) + 500,
      reanchor: async (c) => { resigned++; return c; },
    });

    assert.equal(resigned, 0);
    assert.deepEqual(outcome.results.map(r => r.status), [201, 400]);
    assert.equal(isAnchorRejection(outcome.results[1]), true);
    assert.equal(backends.ontime.posts.length, 1);
    assert.equal(backends.toolate.posts.length, 1);
  });

  it('does not retry on other errors, and never re-signs a commitment without an anchor', async () => {
    const nowMs = roundTimeMs(ANCHOR) + 500;
    const { servers, backends, doFetch } = harness({ a: () => nowMs });
    let resigned = 0;
    const reanchor = async (c: any) => { resigned++; return c; };

    const tampered = { ...create(anchoredParams(ANCHOR)), reveal_probability: 0.9 };
    const bad = await submitCommitment(servers, tampered, { fetch: doFetch, now: () => nowMs, reanchor });
    assert.equal(bad.results[0].status, 400);
    assert.equal(isAnchorRejection(bad.results[0]), false);
    assert.equal(backends.a.posts.length, 1);

    const plain = create(VECTOR_PARAMS);
    const ok = await submitCommitment(servers, plain, { fetch: doFetch, now: () => roundTimeMs(ANCHOR + 9000), reanchor });
    assert.equal(ok.results[0].status, 201);
    assert.equal(ok.commitment.commitment_hash, VECTOR.hash);
    assert.equal(ok.reanchored, 0);
    assert.equal(resigned, 0);
  });

  it('reports a network failure as status 0', async () => {
    const outcome = await submitCommitment([{ name: 'down', url: 'https://down.test' }], create(VECTOR_PARAMS), {
      fetch: async () => { throw new Error('connection refused'); },
    });
    assert.deepEqual([outcome.results[0].status, outcome.results[0].error], [0, 'connection refused']);
  });

  it('without a reanchor callback an anchor rejection is final', async () => {
    const { servers, backends, doFetch } = harness({ a: () => roundTimeMs(ANCHOR + 50) });
    const outcome = await submitCommitment(servers, create(anchoredParams(ANCHOR)), { fetch: doFetch });
    assert.equal(outcome.results[0].status, 400);
    assert.equal(backends.a.posts.length, 1);
  });
});
