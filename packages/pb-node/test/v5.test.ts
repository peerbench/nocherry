/**
 * Server behavior for object format 0.5.0 (spec v0.5 Sections 12.1 to 12.3,
 * 12.9): both formats accepted, the signed selection mode honored, one
 * commitment per (signing_key, stream_id, sequence), stream listings, and
 * reveals with openings. Local only: the tests inject a fixed clock and seed
 * the beacon cache with fake rounds, so they need no network.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as wasm from '@nocherry/pb-wasm';
import { createSqliteStorage } from '@nocherry/storage/sqlite';
import type { KyselyStorage } from '@nocherry/storage';
import { createApp, loadConfigFromEnv } from '../src/app.js';
import { initServerKey } from '../../../src/core/signing.js';
import type { Config } from '../../../src/core/types.js';
import { isRemote } from './_setup.js';

type AppLike = { request(url: string, init?: RequestInit): Promise<Response> };

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const R = 25892262;
const roundTimeMs = (round: number) => Number(wasm.drandRoundTime(BigInt(round))) * 1000;

function fakeBeacon(round: number) {
  return {
    type: 'drand', chain_hash: CHAIN, round,
    randomness: wasm.hashBytes(new TextEncoder().encode(`fake-drand-round-${round}`)),
    signature: '00',
  };
}

let seq = 0;
function fixture(n: number) {
  const data = Array.from({ length: n }, () => new TextEncoder().encode(`v5-server-test-${Date.now()}-${seq++}\n`));
  const hashes = data.map((d) => wasm.hashBytes(d));
  const secret = wasm.generateItemSecret();
  const { items, salts } = wasm.commitItems(secret, JSON.stringify(hashes));
  return { data, hashes, salts, items: items as string[] };
}

function makeV5(kp: any, items: string[], opts: Record<string, unknown> = {}) {
  return wasm.createCommitment(JSON.stringify({
    spec_version: '0.5.0', items, reveal_probability_ppm: 500000, selection_mode: 'batch',
    beacon: { type: 'drand', anchor_round: R, chain_hash: CHAIN }, metadata: {},
    committed_at: '2026-02-07T16:02:30Z', ...opts,
  }), kp.private_key_hex);
}

const post = (app: AppLike, path: string, body: unknown) => app.request(`http://localhost${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const get = (app: AppLike, path: string) => app.request(`http://localhost${path}`, { method: 'GET' });

describe('0.5.0 on the server', { skip: isRemote ? 'needs an injected clock' : false }, () => {
  const storages: KyselyStorage[] = [];
  const servers: Server[] = [];

  /** A server frozen at `nowMs` with rounds R-1..R+3 cached. */
  async function serverAt(nowMs = roundTimeMs(R) + 1500, extra: Partial<Config> = {}): Promise<AppLike> {
    const storage = createSqliteStorage(':memory:');
    storages.push(storage);
    await initServerKey(storage);
    for (let round = R - 1; round <= R + 3; round++) await storage.cacheBeacon('drand', round, fakeBeacon(round));
    return createApp(storage, { ...loadConfigFromEnv(), now: () => new Date(nowMs), allowUnsafeRevealUrls: true, ...extra });
  }

  after(async () => {
    for (const storage of storages) await storage.close();
    for (const s of servers) s.close();
  });

  it('server-info lists both formats and the 0.5.0 limits', async () => {
    const app = await serverAt();
    const info = await (await get(app, '/v1/server-info')).json() as any;
    assert.deepEqual(info.spec_versions_accepted, ['0.2.0', '0.5.0']);
    assert.equal(info.max_items, 100000);
    assert.equal(info.max_metadata_bytes, 4096);
    assert.equal(info.spec_version, '0.2.0');
  });

  it('registers a 0.5.0 commitment and selects in the signed mode with round anchor + 2', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const f = fixture(6);
    for (const mode of ['batch', 'per_item']) {
      const commitment = makeV5(kp, f.items, { selection_mode: mode, reveal_probability_ppm: 500000, committed_at: `2026-02-07T16:02:3${mode.length % 10}Z` });
      const res = await post(app, '/v1/commitments', commitment);
      const text = await res.text();
      assert.equal(res.status, 201, text);
      const receipt = JSON.parse(text);
      assert.equal(receipt.selection.selection_mode, mode);
      assert.equal(receipt.selection.reveal_probability_ppm, 500000);
      assert.equal(receipt.selection.reveal_probability, undefined);
      assert.equal(receipt.selection.beacon_output.round, R + 2);
      const expected = wasm.computeSelectionRecord(JSON.stringify(commitment), JSON.stringify(fakeBeacon(R + 2)), 'x');
      assert.deepEqual(receipt.selection.selected_items, expected.selected_items);
      if (mode === 'batch') assert.equal(receipt.selection.selected_items.length, 3);
      assert.equal(receipt.stream_activity, undefined, 'no stream, no stream_activity');
      // The receipt survives a round trip through the GET endpoint.
      const again = await (await get(app, `/v1/commitments/${commitment.commitment_hash}`)).json() as any;
      assert.deepEqual(again.selection.selected_items, expected.selected_items);
    }
  });

  it('a 0.2.0 commitment is still accepted on the same server', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const f = fixture(3);
    const legacy = wasm.createCommitment(JSON.stringify({
      items: f.hashes, reveal_probability: 0.5, beacon: { type: 'drand', anchor_round: R, chain_hash: CHAIN }, committed_at: '2026-02-07T16:02:30Z',
    }), kp.private_key_hex);
    const res = await post(app, '/v1/commitments', legacy);
    const text = await res.text();
    assert.equal(res.status, 201, text);
    const receipt = JSON.parse(text);
    assert.equal(receipt.selection.reveal_probability, 0.5);
    assert.equal(receipt.selection.selection_mode, 'batch');
  });

  it('rejects unknown spec_versions and malformed 0.5.0 commitments with 400', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const f = fixture(3);
    const good = makeV5(kp, f.items);
    const unknown = await post(app, '/v1/commitments', { ...good, spec_version: '0.3.0' });
    assert.equal(unknown.status, 400);
    assert.equal(((await unknown.json()) as any).error_code, 'spec_version_unsupported');

    const cases: [string, Record<string, unknown>][] = [
      ['no anchor', { beacon: { type: 'drand', chain_hash: CHAIN } }],
      ['ppm 0', { reveal_probability_ppm: 0 }],
      ['ppm too large', { reveal_probability_ppm: 1000001 }],
      ['float probability', { reveal_probability: 0.5 }],
      ['bad mode', { selection_mode: 'auto' }],
      ['stream without sequence', { stream_id: 'x' }],
      ['metadata float', { metadata: { p: 0.5 } }],
      ['metadata missing', { metadata: undefined }],
    ];
    for (const [name, change] of cases) {
      const res = await post(app, '/v1/commitments', { ...good, ...change });
      assert.equal(res.status, 400, name);
      const body = (await res.json()) as any;
      assert.ok(body.error, name);
      assert.notEqual(body.error_code, 'spec_version_unsupported', name);
    }
    // The signature check still catches a well-formed commitment with a changed signed field.
    const res = await post(app, '/v1/commitments', { ...good, reveal_probability_ppm: 400000 });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, /signature/i);
  });

  it('refuses more items than max_items', async () => {
    const app = await serverAt(roundTimeMs(R) + 1500, { maxItems: 4 });
    const kp = wasm.generateKeypair();
    const res = await post(app, '/v1/commitments', makeV5(kp, fixture(5).items));
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.error_code, 'too_many_items');
    assert.equal(body.max_items, 4);
    assert.equal((await post(app, '/v1/commitments', makeV5(kp, fixture(4).items))).status, 201);
  });

  it('registers at most one commitment per (signing_key, stream_id, sequence)', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const other = wasm.generateKeypair();
    const first = makeV5(kp, fixture(3).items, { stream_id: 'law-bench', sequence: 1 });
    const res1 = await post(app, '/v1/commitments', first);
    const text1 = await res1.text();
    assert.equal(res1.status, 201, text1);
    const receipt1 = JSON.parse(text1);
    assert.deepEqual(receipt1.stream_activity, { commitments: 1, highest_sequence: 1 });

    // A grinding attempt: other items, same name.
    const second = makeV5(kp, fixture(3).items, { stream_id: 'law-bench', sequence: 1 });
    assert.notEqual(second.commitment_hash, first.commitment_hash);
    const res2 = await post(app, '/v1/commitments', second);
    assert.equal(res2.status, 409);
    const body2 = (await res2.json()) as any;
    assert.equal(body2.error_code, 'stream_sequence_taken');
    assert.equal(body2.existing_commitment_hash, first.commitment_hash);
    assert.equal(body2.existing_registered_at, receipt1.registered_at);
    assert.equal(await app.request(`http://localhost/v1/commitments/${second.commitment_hash}`).then((r) => r.status), 404, 'the second attempt is not stored');

    // The same commitment again is the ordinary duplicate.
    const res1b = await post(app, '/v1/commitments', first);
    assert.equal(res1b.status, 409);
    assert.equal(((await res1b.json()) as any).error_code, 'commitment_exists');

    // Another sequence, another stream, and another key are all fine.
    const res3 = await post(app, '/v1/commitments', makeV5(kp, fixture(3).items, { stream_id: 'law-bench', sequence: 2 }));
    assert.equal(res3.status, 201);
    assert.deepEqual(((await res3.json()) as any).stream_activity, { commitments: 2, highest_sequence: 2 });
    assert.equal((await post(app, '/v1/commitments', makeV5(kp, fixture(3).items, { stream_id: 'other', sequence: 1 }))).status, 201);
    assert.equal((await post(app, '/v1/commitments', makeV5(other, fixture(3).items, { stream_id: 'law-bench', sequence: 1 }))).status, 201);

    // A gap is registered and visible in the listing.
    const res5 = await post(app, '/v1/commitments', makeV5(kp, fixture(3).items, { stream_id: 'law-bench', sequence: 5 }));
    assert.equal(res5.status, 201);
    assert.deepEqual(((await res5.json()) as any).stream_activity, { commitments: 3, highest_sequence: 5 });

    const listing = await (await get(app, `/v1/streams/${encodeURIComponent(kp.did_key)}/law-bench`)).json() as any;
    assert.equal(listing.signing_key, kp.did_key);
    assert.equal(listing.stream_id, 'law-bench');
    assert.deepEqual(listing.commitments.map((e: any) => e.sequence), [1, 2, 5]);
    assert.equal(listing.commitments[0].commitment_hash, first.commitment_hash);
    assert.equal(listing.commitments[0].registered_at, receipt1.registered_at);
    assert.ok(listing.server_key.startsWith('did:key:z'));
    const { server_signature, ...signed } = listing;
    assert.ok(wasm.verifySignature(listing.server_key, new TextEncoder().encode(JSON.stringify(signed)), server_signature));

    const empty = await (await get(app, `/v1/streams/${encodeURIComponent(other.did_key)}/nothing-here`)).json() as any;
    assert.deepEqual(empty.commitments, []);
    assert.equal((await get(app, '/v1/streams/not-a-did/x')).status, 400);
  });

  it('a 0.2.0 commitment with an unsigned stream_id does not take part in stream uniqueness', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const legacy = wasm.createCommitment(JSON.stringify({
      items: fixture(2).hashes, reveal_probability: 0.5, stream_id: 'law-bench',
      beacon: { type: 'drand', anchor_round: R, chain_hash: CHAIN }, committed_at: '2026-02-07T16:02:30Z',
    }), kp.private_key_hex);
    assert.equal((await post(app, '/v1/commitments', legacy)).status, 201);
    const listing = await (await get(app, `/v1/streams/${encodeURIComponent(kp.did_key)}/law-bench`)).json() as any;
    assert.deepEqual(listing.commitments, []);
    assert.equal((await post(app, '/v1/commitments', makeV5(kp, fixture(2).items, { stream_id: 'law-bench', sequence: 0 }))).status, 201);
  });

  it('accepts a 0.5.0 reveal with openings and verifies published data against the opened hashes', async () => {
    const app = await serverAt();
    const kp = wasm.generateKeypair();
    const f = fixture(4);
    const commitment = makeV5(kp, f.items);
    const receipt = (await (await post(app, '/v1/commitments', commitment)).json()) as any;
    const selected: string[] = receipt.selection.selected_items;
    assert.equal(selected.length, 2);

    // Serve the selected files over plain HTTP on the loopback interface.
    const files = new Map(selected.map((c) => [`/${c}`, f.data[f.items.indexOf(c)]]));
    const server = createServer((req, res) => {
      const body = files.get(req.url ?? '');
      if (!body) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(Buffer.from(body));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const file_urls = Object.fromEntries(selected.map((c) => [c, `${base}/${c}`]));

    const openings = selected.map((c) => ({ item: c, salt: f.salts[f.items.indexOf(c)], hash: f.hashes[f.items.indexOf(c)] }));
    const reveal = wasm.createReveal(JSON.stringify({
      spec_version: '0.5.0', commitment_hash: commitment.commitment_hash, selected_items: selected, voluntary_items: [], openings,
      revealed_at: '2026-02-08T10:00:00Z',
    }), kp.private_key_hex);

    // A 0.2.0-style reveal and a reveal with a bad opening are refused.
    const legacyPayload = { spec_version: '0.2.0', commitment_hash: commitment.commitment_hash, selected_items: selected, voluntary_items: [], revealed_at: '2026-02-08T10:00:00Z', signing_key: kp.did_key };
    const legacy = { ...legacyPayload, signature: wasm.signMessage(kp.private_key_hex, new TextEncoder().encode(JSON.stringify(legacyPayload))) };
    const resLegacy = await post(app, `/v1/commitments/${commitment.commitment_hash}/reveals`, legacy);
    assert.equal(resLegacy.status, 400);
    assert.equal(((await resLegacy.json()) as any).error_code, 'reveal_format');
    const bad = JSON.parse(JSON.stringify(reveal));
    bad.openings[0].salt = '00'.repeat(32);
    const resBad = await post(app, `/v1/commitments/${commitment.commitment_hash}/reveals`, bad);
    assert.equal(resBad.status, 400);
    assert.equal(((await resBad.json()) as any).error_code, 'reveal_invalid');

    const res = await post(app, `/v1/commitments/${commitment.commitment_hash}/reveals`, { ...reveal, file_urls });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    const body = JSON.parse(text);
    assert.equal(body.data_verified, true, JSON.stringify(body.verification));
    assert.equal(body.verification.verified_items, 2);
    assert.deepEqual(body.verification.items.map((i: any) => i.status), ['match', 'match']);

    // verify-publication compares with the opened hash as well.
    const pub = await (await post(app, `/v1/commitments/${commitment.commitment_hash}/verify-publication`, { file_urls })).json() as any;
    assert.equal(pub.all_match, true, JSON.stringify(pub.items));
    // An unrevealed item cannot be checked: nothing has opened it.
    const unselected = f.items.find((c) => !selected.includes(c))!;
    const pub2 = await (await post(app, `/v1/commitments/${commitment.commitment_hash}/verify-publication`, { file_urls: { [unselected]: `${base}/${unselected}` } })).json() as any;
    assert.equal(pub2.items[0].status, 'not_opened');

    const stored = await (await get(app, `/v1/commitments/${commitment.commitment_hash}/reveals`)).json() as any;
    assert.equal(stored.reveals.length, 1);
    assert.equal(stored.reveals[0].openings.length, 2);
  });
});
