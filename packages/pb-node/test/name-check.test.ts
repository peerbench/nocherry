/**
 * Relying-party name check (spec v0.5 Section 14.5) against real server
 * routes. Three in-memory servers stand in for the required set. The
 * committer registers, or fails to register, commitments under one name, and
 * the relying party asks the servers directly instead of trusting the
 * committer's account. Local only: the servers run on an injected clock with
 * cached fake beacon rounds.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from '@nocherry/pb-wasm';
import { createSqliteStorage } from '@nocherry/storage/sqlite';
import type { KyselyStorage } from '@nocherry/storage';
import { createApp, loadConfigFromEnv } from '../src/app.js';
import { initServerKey, getServerKey } from '../../../src/core/signing.js';
import { checkName, type NameServer, type StreamName } from '../../pb-js/src/name-check.js';
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
function items(n: number): string[] {
  const hashes = Array.from({ length: n }, () => wasm.hashBytes(new TextEncoder().encode(`name-check-${Date.now()}-${seq++}\n`)));
  return wasm.commitItems(wasm.generateItemSecret(), JSON.stringify(hashes)).items as string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function commitment(kp: any, name: Omit<StreamName, 'signing_key'>) {
  return wasm.createCommitment(JSON.stringify({
    spec_version: '0.5.0', items: items(6), reveal_probability_ppm: 500000, selection_mode: 'batch',
    beacon: { type: 'drand', anchor_round: R, chain_hash: CHAIN }, metadata: {},
    committed_at: '2026-02-07T16:02:30Z', ...name,
  }), kp.private_key_hex);
}

describe('relying-party name check', { skip: isRemote ? 'needs an injected clock' : false }, () => {
  const storages: KyselyStorage[] = [];
  after(async () => { for (const s of storages) await s.close(); });

  /** Three servers, a fetch that routes by host, and the relying party's server list. */
  async function setup(opts: { down?: string[]; tamper?: (host: string, path: string, body: any) => any } = {}) {
    const apps: Record<string, AppLike> = {};
    for (const host of ['s1', 's2', 's3']) {
      const storage = createSqliteStorage(':memory:');
      storages.push(storage);
      await initServerKey(storage);
      for (let round = R - 1; round <= R + 3; round++) await storage.cacheBeacon('drand', round, fakeBeacon(round));
      apps[host] = createApp(storage, { ...loadConfigFromEnv(), now: () => new Date(roundTimeMs(R) + 1500) });
    }
    const fetchImpl = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (opts.down?.includes(url.hostname)) throw new Error(`connect ECONNREFUSED ${url.hostname}`);
      const res = await apps[url.hostname].request(`http://localhost${url.pathname}`, { method: 'GET' });
      if (!opts.tamper) return res;
      const body = opts.tamper(url.hostname, url.pathname, await res.json());
      return new Response(JSON.stringify(body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const required: NameServer[] = Object.keys(apps).map((host) => ({ name: host, url: `http://${host}`, server_key: getServerKey() }));
    const register = async (host: string, body: unknown) => {
      const res = await apps[host].request('http://localhost/v1/commitments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(res.status, 201, await res.text());
    };
    return { fetchImpl, required, register };
  }

  const kp = wasm.generateKeypair();
  const nameOf = (sequence: number): StreamName => ({ signing_key: kp.did_key, stream_id: 'law-bench', sequence });

  it('binds the name to the registered commitment even if the committer never forwards a receipt', async () => {
    const { fetchImpl, required, register } = await setup();
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 0 });
    for (const host of ['s1', 's2', 's3']) await register(host, a);
    // The committer saw the draw and withholds every receipt. The relying party asks the servers.
    const result = await checkName(nameOf(0), required, { fetch: fetchImpl });
    assert.equal(result.status, 'bound', result.detail);
    assert.deepEqual(result.commitment_hashes, [a.commitment_hash]);
    assert.deepEqual(result.servers.map((s) => s.status), ['registered', 'registered', 'registered']);
  });

  it('binds the name when only one required server registered, so "the others timed out" is not a way out', async () => {
    const { fetchImpl, required, register } = await setup();
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 1 });
    await register('s2', a);
    const result = await checkName(nameOf(1), required, { fetch: fetchImpl });
    assert.equal(result.status, 'bound', result.detail);
    assert.deepEqual(result.commitment_hashes, [a.commitment_hash]);
    assert.deepEqual(result.servers.map((s) => s.status), ['empty', 'registered', 'empty']);
  });

  it('reports a conflict when the committer splits two commitments under one name across servers', async () => {
    const { fetchImpl, required, register } = await setup();
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 2 });
    const b = commitment(kp, { stream_id: 'law-bench', sequence: 2 });
    await register('s1', a);
    await register('s2', b);
    const result = await checkName(nameOf(2), required, { fetch: fetchImpl });
    assert.equal(result.status, 'conflict', result.detail);
    assert.deepEqual(result.commitment_hashes, [a.commitment_hash, b.commitment_hash].sort());
  });

  it('reports the name unused only when every required server answered with nothing under it', async () => {
    const { fetchImpl, required } = await setup();
    const result = await checkName(nameOf(3), required, { fetch: fetchImpl });
    assert.equal(result.status, 'unused', result.detail);
    assert.deepEqual(result.commitment_hashes, []);
  });

  it('is inconclusive, not unused, when a required server cannot be reached', async () => {
    const { fetchImpl, required } = await setup({ down: ['s3'] });
    const result = await checkName(nameOf(4), required, { fetch: fetchImpl });
    assert.equal(result.status, 'inconclusive', result.detail);
    assert.equal(result.servers[2].status, 'unreachable');
  });

  it('still binds when one server is down, as long as another listed the commitment', async () => {
    const { fetchImpl, required, register } = await setup({ down: ['s1'] });
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 5 });
    await register('s3', a);
    const result = await checkName(nameOf(5), required, { fetch: fetchImpl });
    assert.equal(result.status, 'bound', result.detail);
    assert.deepEqual(result.commitment_hashes, [a.commitment_hash]);
  });

  it('ignores a hash a server lists without a commitment signed by the key, so a server cannot frame the committer', async () => {
    const forged = 'ab'.repeat(32);
    const { fetchImpl, required, register } = await setup({
      // s3 swaps in a hash that no commitment signed by the key stands behind.
      // The tampered listing no longer matches its signature.
      tamper: (host, path, body) => (host === 's3' && path.startsWith('/v1/streams/') ? { ...body, commitments: [{ sequence: 6, commitment_hash: forged, registered_at: '2026-02-07T16:02:31Z' }] } : body),
    });
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 6 });
    await register('s1', a);
    const result = await checkName(nameOf(6), required, { fetch: fetchImpl });
    assert.equal(result.status, 'bound', result.detail);
    assert.deepEqual(result.commitment_hashes, [a.commitment_hash]);
    assert.equal(result.servers[2].status, 'invalid');
  });

  it('treats a correctly signed listing entry without a matching commitment body as unbacked', async () => {
    const { fetchImpl, required, register } = await setup({
      // s1 registered the commitment but no longer serves its body (for example after retention).
      tamper: (host, path, body) => (host === 's1' && path.startsWith('/v1/commitments/') ? { error: 'Commitment not found' } : body),
    });
    const a = commitment(kp, { stream_id: 'law-bench', sequence: 7 });
    await register('s1', a);
    const result = await checkName(nameOf(7), required, { fetch: fetchImpl });
    assert.equal(result.status, 'inconclusive', result.detail);
    assert.equal(result.servers[0].status, 'unbacked');
    assert.equal(result.servers[0].commitment_hash, a.commitment_hash);
  });

  it('rejects a listing signed by a key other than the required server key', async () => {
    const { fetchImpl, required } = await setup();
    const other = wasm.generateKeypair();
    const result = await checkName(nameOf(8), [{ ...required[0], server_key: other.did_key }, required[1], required[2]], { fetch: fetchImpl });
    assert.equal(result.status, 'inconclusive', result.detail);
    assert.equal(result.servers[0].status, 'invalid');
  });
});
