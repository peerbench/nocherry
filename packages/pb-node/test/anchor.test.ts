/**
 * Anchored selection round (`beacon.anchor_round`, spec 8.1.1).
 *
 * The fixed-clock tests run local only: they inject `config.now` and seed the
 * beacon cache, so they need no network and no real waiting. The live tests
 * use the real clock and work in both local and remote mode.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from '@nocherry/pb-wasm';
import { createSqliteStorage } from '@nocherry/storage/sqlite';
import type { KyselyStorage } from '@nocherry/storage';
import { createApp, loadConfigFromEnv } from '../src/app.js';
import { initServerKey } from '../../../src/core/signing.js';
import { selectionRoundFor, checkAnchor } from '../../../src/core/beacon.js';
import { getApp, cleanup, isRemote } from './_setup.js';

type AppLike = { request(url: string, init?: RequestInit): Promise<Response> };

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const DELAY = 2;
const SAFETY_MARGIN_MS = 1000;
const CLOCK_SKEW_MS = 1000;

// A fixed round far in the past for the fixed-clock tests.
const R = 25892262;

const roundTimeMs = (round: number) => Number(wasm.drandRoundTime(BigInt(round))) * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const currentRound = () => Number(wasm.drandTimeToRound(BigInt(Math.floor(Date.now() / 1000))));

let itemSeq = 0;
function freshItems(n: number): string[] {
  return Array.from({ length: n }, () =>
    wasm.hashBytes(new TextEncoder().encode(`anchor-test-${Date.now()}-${itemSeq++}`)));
}

function makeCommitment(kp: any, items: string[], anchorRound?: number, p = 0.5) {
  const beacon: Record<string, unknown> = { type: 'drand', chain_hash: DRAND_CHAIN_HASH };
  if (anchorRound !== undefined) beacon.anchor_round = anchorRound;
  return wasm.createCommitment(JSON.stringify({
    items,
    reveal_probability: p,
    beacon,
    committed_at: new Date().toISOString(),
  }), kp.private_key_hex);
}

function post(app: AppLike, body: unknown) {
  return app.request('http://localhost/v1/commitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(app: AppLike, path: string) {
  return app.request(`http://localhost${path}`, { method: 'GET' });
}

function fakeBeacon(round: number) {
  return {
    type: 'drand',
    chain_hash: DRAND_CHAIN_HASH,
    round,
    randomness: wasm.hashBytes(new TextEncoder().encode(`fake-drand-round-${round}`)),
    signature: '00',
  };
}

describe('Constants exposed by the core', () => {
  it('ANCHOR_SELECTION_DELAY is 2 with a 1 s safety margin and skew allowance', () => {
    assert.equal(wasm.anchorSelectionDelay(), DELAY);
    assert.equal(wasm.anchorSelectionSafetyMarginMs(), SAFETY_MARGIN_MS);
    assert.equal(wasm.anchorClockSkewAllowanceMs(), CLOCK_SKEW_MS);
    assert.equal(Number(wasm.anchoredSelectionRound(BigInt(R))), R + DELAY);
  });
});

describe('Anchored selection round: fixed clock', { skip: isRemote ? 'needs an injected clock' : false }, () => {
  const storages: KyselyStorage[] = [];

  /** A server whose clock is frozen at `nowMs`, with rounds R-1..R+3 pre-cached. */
  async function serverAt(nowMs: number): Promise<AppLike> {
    const storage = createSqliteStorage(':memory:');
    storages.push(storage);
    await initServerKey(storage);
    for (let round = R - 1; round <= R + 3; round++) {
      await storage.cacheBeacon('drand', round, fakeBeacon(round));
    }
    return createApp(storage, { ...loadConfigFromEnv(), now: () => new Date(nowMs) });
  }

  after(async () => {
    for (const storage of storages) await storage.close();
  });

  it('selects with round anchor_round + 2', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(4), R);
    const app = await serverAt(roundTimeMs(R) + 1500);

    const res = await post(app, commitment);
    assert.equal(res.status, 201);
    const receipt = await res.json() as any;
    assert.equal(receipt.commitment.beacon.anchor_round, R);
    assert.equal(receipt.registered_at, iso(roundTimeMs(R) + 1500));
    assert.equal(receipt.selection.beacon_output.round, R + DELAY);
    assert.equal(receipt.arrival_beacon.round, R, 'arrival_beacon is still recorded');

    const checks = wasm.verifyReceiptAnchor(JSON.stringify(receipt));
    assert.deepEqual(checks.map((c: any) => [c.name, c.status]), [
      ['anchor_selection_round', 'pass'],
      ['anchor_registration_time', 'pass'],
    ]);
  });

  it('two servers on opposite sides of a drand tick use the same selection round', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(6), R);
    const tick = roundTimeMs(R + 1);
    const early = await serverAt(tick - 200);
    const late = await serverAt(tick + 200);

    const [resEarly, resLate] = await Promise.all([post(early, commitment), post(late, commitment)]);
    assert.equal(resEarly.status, 201);
    assert.equal(resLate.status, 201);
    const a = await resEarly.json() as any;
    const b = await resLate.json() as any;

    assert.equal(a.registered_at, iso(tick - 200));
    assert.equal(b.registered_at, iso(tick + 200));
    assert.notEqual(a.arrival_beacon.round, b.arrival_beacon.round, 'servers straddle the tick');

    assert.equal(a.selection.beacon_output.round, R + DELAY);
    assert.equal(b.selection.beacon_output.round, R + DELAY);
    assert.deepEqual(a.selection.selected_items, b.selection.selected_items);

    // The stored selection agrees on later lookups too.
    for (const app of [early, late]) {
      const sel = await (await get(app, `/v1/commitments/${commitment.commitment_hash}/selection`)).json() as any;
      assert.equal(sel.beacon_output.round, R + DELAY);
    }
  });

  it('without an anchor the same two servers disagree (unchanged behavior)', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(6));
    assert.equal('anchor_round' in commitment.beacon, false);
    const tick = roundTimeMs(R + 1);
    const early = await serverAt(tick - 200);
    const late = await serverAt(tick + 200);

    const a = await (await post(early, commitment)).json() as any;
    const b = await (await post(late, commitment)).json() as any;
    assert.equal(a.selection.beacon_output.round, R + 1);
    assert.equal(b.selection.beacon_output.round, R + 2);
  });

  it('rejects when the selection round is already available', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(3), R);

    for (const nowMs of [roundTimeMs(R + DELAY), roundTimeMs(R + DELAY) + 1, roundTimeMs(R + 40)]) {
      const app = await serverAt(nowMs);
      const res = await post(app, commitment);
      assert.equal(res.status, 400, `now=${iso(nowMs)}`);
      const body = await res.json() as any;
      assert.equal(body.error_code, 'anchor_selection_round_available');
      assert.equal(body.anchor_round, R);
      assert.equal(body.server_time, iso(nowMs));
      assert.ok(body.error.length > 0);

      const stored = await get(app, `/v1/commitments/${commitment.commitment_hash}`);
      assert.equal(stored.status, 404, 'a rejected commitment must not be registered');
    }
  });

  it('rejects inside the safety margin before the selection round', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(3), R);
    const selectionMs = roundTimeMs(R + DELAY);

    const tooLate = await post(await serverAt(selectionMs - SAFETY_MARGIN_MS), commitment);
    assert.equal(tooLate.status, 400);
    assert.equal((await tooLate.json() as any).error_code, 'anchor_selection_round_available');

    const inTime = await post(await serverAt(selectionMs - SAFETY_MARGIN_MS - 1), commitment);
    assert.equal(inTime.status, 201);
  });

  it('rejects an anchor round in the future', async () => {
    const kp = wasm.generateKeypair();

    for (const anchor of [R + 1, R + 2, R + 1000]) {
      const commitment = makeCommitment(kp, freshItems(3), anchor);
      const app = await serverAt(roundTimeMs(R) + 1500);
      const res = await post(app, commitment);
      assert.equal(res.status, 400, `anchor=${anchor}`);
      const body = await res.json() as any;
      assert.equal(body.error_code, 'anchor_round_in_future');

      const stored = await get(app, `/v1/commitments/${commitment.commitment_hash}`);
      assert.equal(stored.status, 404);
    }
  });

  it('tolerates a server clock slightly behind the anchor round', async () => {
    const kp = wasm.generateKeypair();
    const accepted = await post(await serverAt(roundTimeMs(R) - CLOCK_SKEW_MS), makeCommitment(kp, freshItems(3), R));
    assert.equal(accepted.status, 201);
    const rejected = await post(await serverAt(roundTimeMs(R) - CLOCK_SKEW_MS - 1), makeCommitment(kp, freshItems(3), R));
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as any).error_code, 'anchor_round_in_future');
  });

  it('rejects unusable anchor_round values', async () => {
    const kp = wasm.generateKeypair();
    const app = await serverAt(roundTimeMs(R) + 1500);

    // Signed with anchor_round = 0.
    const zero = await post(app, makeCommitment(kp, freshItems(2), 0));
    assert.equal(zero.status, 400);
    assert.equal((await zero.json() as any).error_code, 'anchor_round_invalid');

    // null is not "absent": the field must be omitted or a round number.
    const unanchored = makeCommitment(kp, freshItems(2));
    const withNull = { ...unanchored, beacon: { ...unanchored.beacon, anchor_round: null } };
    const resNull = await post(app, withNull);
    assert.equal(resNull.status, 400);
    assert.equal((await resNull.json() as any).error_code, 'anchor_round_invalid');

    // Wrong JSON types never pass signature verification.
    for (const bad of ['25892262', 1.5, -1]) {
      const c = makeCommitment(kp, freshItems(2), R);
      const res = await post(app, { ...c, beacon: { ...c.beacon, anchor_round: bad } });
      assert.equal(res.status, 400, `anchor_round=${JSON.stringify(bad)}`);
    }
  });

  it('anchor_round cannot be changed, stripped, or added after signing', async () => {
    const kp = wasm.generateKeypair();
    const app = await serverAt(roundTimeMs(R) + 1500);

    const anchored = makeCommitment(kp, freshItems(2), R - 1);
    const moved = await post(app, { ...anchored, beacon: { ...anchored.beacon, anchor_round: R } });
    assert.equal(moved.status, 400);
    assert.match((await moved.json() as any).error, /signature/i);

    const { anchor_round: _dropped, ...bareBeacon } = anchored.beacon;
    const stripped = await post(app, { ...anchored, beacon: bareBeacon });
    assert.equal(stripped.status, 400);

    const unanchored = makeCommitment(kp, freshItems(2));
    const added = await post(app, { ...unanchored, beacon: { ...unanchored.beacon, anchor_round: R } });
    assert.equal(added.status, 400);
  });

  it('a duplicate anchored commitment still returns 409 after the window closed', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(2), R);
    let nowMs = roundTimeMs(R) + 500;
    const storage = createSqliteStorage(':memory:');
    storages.push(storage);
    await initServerKey(storage);
    for (let round = R - 1; round <= R + 3; round++) await storage.cacheBeacon('drand', round, fakeBeacon(round));
    const app = createApp(storage, { ...loadConfigFromEnv(), now: () => new Date(nowMs) });

    assert.equal((await post(app, commitment)).status, 201);
    nowMs = roundTimeMs(R + 100);
    assert.equal((await post(app, commitment)).status, 409);

    const stored = await (await get(app, `/v1/commitments/${commitment.commitment_hash}`)).json() as any;
    assert.equal(stored.registered_at, iso(roundTimeMs(R) + 500));
    assert.equal(stored.selection.beacon_output.round, R + DELAY);
  });

  it('an app mounted without a config falls back to the system clock', async () => {
    const storage = createSqliteStorage(':memory:');
    storages.push(storage);
    await initServerKey(storage);
    const app = createApp(storage, undefined as any);

    const kp = wasm.generateKeypair();
    const res = await post(app, makeCommitment(kp, freshItems(2), R));
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.error_code, 'anchor_selection_round_available');
    assert.ok(Math.abs(Date.parse(body.server_time) - Date.now()) < 5000);
  });

  it('selectionRoundFor ignores registered_at when anchored', () => {
    const anchored = { type: 'drand', chain_hash: DRAND_CHAIN_HASH, anchor_round: R };
    const plain = { type: 'drand', chain_hash: DRAND_CHAIN_HASH };
    const before = iso(roundTimeMs(R + 1) - 1);
    const afterTick = iso(roundTimeMs(R + 1) + 1);

    assert.equal(selectionRoundFor(anchored, before), R + DELAY);
    assert.equal(selectionRoundFor(anchored, afterTick), R + DELAY);
    assert.equal(selectionRoundFor(plain, before), R + 1);
    assert.equal(selectionRoundFor(plain, afterTick), R + 2);
  });

  it('checkAnchor refuses non-drand beacons', () => {
    const result = checkAnchor({ type: 'nist', anchor_round: R }, iso(roundTimeMs(R)));
    assert.deepEqual([result.ok, (result as any).code], [false, 'anchor_round_invalid']);
  });
});

describe('Anchored selection round: live', () => {
  let app: AppLike;

  before(async () => {
    app = await getApp();
  });

  after(async () => {
    await cleanup();
  });

  it('accepts a commitment anchored to the current round and selects with round + 2', async () => {
    const kp = wasm.generateKeypair();
    const anchor = currentRound();
    const commitment = makeCommitment(kp, freshItems(4), anchor);

    const res = await post(app, commitment);
    assert.equal(res.status, 201);
    const receipt = await res.json() as any;
    assert.equal(receipt.selection.beacon_output.round, anchor + DELAY);
    assert.ok(Date.parse(receipt.registered_at) < roundTimeMs(anchor + DELAY));

    const checks = wasm.verifyReceiptAnchor(JSON.stringify(receipt));
    assert.ok(checks.length === 2 && checks.every((c: any) => c.status === 'pass'), JSON.stringify(checks));
  });

  it('rejects a stale anchor whose selection round is already public', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(2), currentRound() - 10);
    const res = await post(app, commitment);
    assert.equal(res.status, 400);
    assert.equal((await res.json() as any).error_code, 'anchor_selection_round_available');
    assert.equal((await get(app, `/v1/commitments/${commitment.commitment_hash}`)).status, 404);
  });

  it('rejects a future anchor', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(2), currentRound() + 100);
    const res = await post(app, commitment);
    assert.equal(res.status, 400);
    assert.equal((await res.json() as any).error_code, 'anchor_round_in_future');
  });

  it('a commitment without anchor_round is accepted as before', async () => {
    const kp = wasm.generateKeypair();
    const commitment = makeCommitment(kp, freshItems(2));
    const res = await post(app, commitment);
    assert.equal(res.status, 201);
    const receipt = await res.json() as any;
    assert.equal('anchor_round' in receipt.commitment.beacon, false);
    const regUnix = Math.floor(Date.parse(receipt.registered_at) / 1000);
    assert.equal(receipt.selection.beacon_output.round, Number(wasm.drandNextRoundAfter(BigInt(regUnix))));
    assert.deepEqual(wasm.verifyReceiptAnchor(JSON.stringify(receipt)), []);
  });
});
