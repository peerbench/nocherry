/**
 * URL policy and size cap for server-side fetches of client-supplied URLs,
 * and the reveal route's enforcement of the beacon selection.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as wasm from '@nocherry/pb-wasm';
import { createApp, loadConfigFromEnv } from '../src/app.js';
import { initServerKey } from '../../../src/core/signing.js';
import { createSqliteStorage } from '@nocherry/storage/sqlite';
import type { KyselyStorage } from '@nocherry/storage';
import {
  assertPublicHttpsUrl, isNonPublicAddress, safeFetchBytes,
  UnsafeUrlError, ResponseTooLargeError,
} from '../../../src/core/safe-fetch.js';

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const publicLookup = async () => ['93.184.216.34'];

describe('safe fetch: URL policy', () => {
  it('rejects non-https, credentials, ports, IP literals, and internal names', () => {
    const bad = [
      'http://example.com/a',
      'file:///etc/passwd',
      'https://user:pw@example.com/a',
      'https://example.com:8443/a',
      'https://169.254.169.254/latest/meta-data/',
      'https://127.0.0.1/a',
      'https://[::1]/a',
      'https://2130706433/a',
      'https://localhost/a',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://intranet/a',
      'not a url',
    ];
    for (const url of bad) {
      assert.throws(() => assertPublicHttpsUrl(url), UnsafeUrlError, `should reject ${url}`);
    }
    assert.equal(assertPublicHttpsUrl('https://raw.githubusercontent.com/o/r/main/f').hostname, 'raw.githubusercontent.com');
  });

  it('classifies non-public addresses', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe']) {
      assert.equal(isNonPublicAddress(a), true, `${a} should be non-public`);
    }
    for (const a of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
      assert.equal(isNonPublicAddress(a), false, `${a} should be public`);
    }
  });

  it('rejects a public-looking hostname that resolves to a private address', async () => {
    let called = false;
    await assert.rejects(
      safeFetchBytes('https://rebind.example.com/a', {
        lookup: async () => ['169.254.169.254'],
        fetchImpl: (async () => { called = true; return new Response('x'); }) as typeof fetch,
      }),
      UnsafeUrlError,
    );
    assert.equal(called, false, 'must not connect');
  });

  it('re-validates redirect targets', async () => {
    let calls = 0;
    await assert.rejects(
      safeFetchBytes('https://example.com/a', {
        lookup: publicLookup,
        fetchImpl: (async () => {
          calls++;
          return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
        }) as typeof fetch,
      }),
      UnsafeUrlError,
    );
    assert.equal(calls, 1, 'must not follow the redirect');
  });

  it('returns the body for an allowed URL', async () => {
    const res = await safeFetchBytes('https://example.com/a', {
      lookup: publicLookup,
      fetchImpl: (async () => new Response('hello')) as typeof fetch,
    });
    assert.equal(res.ok, true);
    assert.equal(new TextDecoder().decode(res.data), 'hello');
  });
});

describe('safe fetch: size cap', () => {
  it('rejects by declared content-length without reading the body', async () => {
    await assert.rejects(
      safeFetchBytes('https://example.com/a', {
        maxBytes: 10, lookup: publicLookup,
        fetchImpl: (async () => new Response('x', { headers: { 'content-length': '1000000' } })) as typeof fetch,
      }),
      ResponseTooLargeError,
    );
  });

  it('stops reading a stream that exceeds the cap', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024)); },
    });
    await assert.rejects(
      safeFetchBytes('https://example.com/a', {
        maxBytes: 4096, lookup: publicLookup,
        fetchImpl: (async () => new Response(endless)) as typeof fetch,
      }),
      ResponseTooLargeError,
    );
    assert.ok(pulled < 20, `read ${pulled} chunks, expected to stop near the cap`);
  });
});

describe('reveal route: selection and URL policy enforced', () => {
  let storage: KyselyStorage;
  let app: ReturnType<typeof createApp>;

  before(async () => {
    storage = createSqliteStorage(':memory:');
    await initServerKey(storage);
    app = createApp(storage, loadConfigFromEnv()); // default policy: no unsafe URLs
  });
  after(async () => { await storage.close(); });

  async function post(path: string, body: unknown) {
    return app.request(`http://localhost${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  function signedReveal(kp: any, hash: string, selected: string[], voluntary: string[], extra: object = {}) {
    const payload = {
      spec_version: '0.2.0', commitment_hash: hash, selected_items: selected,
      voluntary_items: voluntary, revealed_at: new Date().toISOString(), signing_key: kp.did_key,
    };
    const signature = wasm.signMessage(kp.private_key_hex, new TextEncoder().encode(JSON.stringify(payload)));
    return { ...payload, signature, ...extra };
  }

  async function commit(n: number) {
    const kp = wasm.generateKeypair();
    const items = Array.from({ length: n }, (_, i) =>
      wasm.hashBytes(new TextEncoder().encode(`reveal-policy-${Date.now()}-${Math.random()}-${i}`)));
    const commitment = wasm.createCommitment(JSON.stringify({
      items, reveal_probability: 0.5,
      beacon: { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
      committed_at: new Date().toISOString(),
    }), kp.private_key_hex);
    const res = await post('/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const receipt: any = await res.json();
    return { kp, items, hash: commitment.commitment_hash as string, selected: receipt.selection.selected_items as string[] };
  }

  it('rejects a reveal that declares items the beacon did not select', async () => {
    const { kp, items, hash, selected } = await commit(8);
    const unselected = items.filter((i) => !selected.includes(i));
    assert.ok(unselected.length > 0, 'test needs at least one unselected item');
    const res = await post(`/v1/commitments/${hash}/reveals`, signedReveal(kp, hash, [unselected[0]], []));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, /does not match the beacon selection/);
  });

  it('rejects a reveal that omits selected items', async () => {
    const { kp, hash, selected } = await commit(8);
    if (selected.length === 0) return; // nothing to omit for this draw
    const res = await post(`/v1/commitments/${hash}/reveals`, signedReveal(kp, hash, selected.slice(1), []));
    assert.equal(res.status, 400);
  });

  it('accepts the exact selection but does not fetch a private URL', async () => {
    let { kp, hash, selected } = await commit(8);
    for (let tries = 0; selected.length === 0 && tries < 5; tries++) ({ kp, hash, selected } = await commit(8));
    assert.ok(selected.length > 0, 'test needs a non-empty selection');
    const fileUrls = Object.fromEntries(selected.map((h) => [h, 'http://169.254.169.254/latest/meta-data/']));
    const res = await post(`/v1/commitments/${hash}/reveals`, signedReveal(kp, hash, selected, [], { file_urls: fileUrls }));
    assert.equal(res.status, 201);
    const body: any = await res.json();
    assert.equal(body.data_verified, false);
    for (const item of body.verification.items) assert.equal(item.status, 'url_not_allowed');
  });
});
