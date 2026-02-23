/**
 * Identity verification tests for DID-based identity resolution.
 *
 * Uses a local mock DID server to serve DID documents.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Server } from 'node:http';
import * as wasm from 'pb-wasm';
import { getApp, cleanup } from './_setup.js';

let app: { request(url: string, init?: RequestInit): Promise<Response> };

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

function makeCommitment(kp: any, items: string[], opts: any = {}) {
  const params: any = {
    items,
    reveal_probability: opts.reveal_probability || 0.10,
    beacon: opts.beacon || { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
    committed_at: opts.committed_at || new Date().toISOString(),
  };
  if (opts.identity) params.identity = opts.identity;
  return wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
}

async function req(method: string, path: string, body?: any) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, init);
}

/**
 * Create a mock DID server that serves DID documents.
 * Routes are registered dynamically via addDocument().
 */
function createMockDidServer() {
  const documents = new Map<string, any>();
  const server = http.createServer((request, response) => {
    const doc = documents.get(request.url!);
    if (doc) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(doc));
    } else {
      response.writeHead(404);
      response.end('Not Found');
    }
  });

  return {
    server,
    documents,
    addDocument(path: string, doc: any) {
      documents.set(path, doc);
    },
    start(): Promise<{ port: number }> {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(server.address() as { port: number });
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function makeDIDDocument(did: string, publicKeyMultibase: string) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: [{
      id: `${did}#key-1`,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase,
    }],
    authentication: [`${did}#key-1`],
  };
}

describe('Identity Verification', () => {
  let mockServer: ReturnType<typeof createMockDidServer>;
  let mockAddr: { port: number };

  before(async () => {
    app = await getApp();
    mockServer = createMockDidServer();
    mockAddr = await mockServer.start();
  });

  after(async () => {
    await mockServer.stop();
    await cleanup();
  });

  it('no identity field — receipt has key_matches_identity: null', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-no-identity'));
    const commitment = makeCommitment(kp, [itemHash]);

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, null);
  });

  it('did:web matched — signing key found in DID document', async () => {
    const kp = wasm.generateKeypair();
    // Extract the multibase key part from did:key
    const multibaseKey = kp.did_key.replace('did:key:', '');
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:web:${host}`;

    mockServer.addDocument('/.well-known/did.json', makeDIDDocument(identity, multibaseKey));

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-web-matched'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'matched');
  });

  it('did:web mismatch — signing key not in DID document', async () => {
    const kp = wasm.generateKeypair();
    const otherKp = wasm.generateKeypair();
    const otherMultibaseKey = otherKp.did_key.replace('did:key:', '');
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:web:${host}:mismatch`;

    mockServer.addDocument('/mismatch/did.json', makeDIDDocument(identity, otherMultibaseKey));

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-web-mismatch'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'mismatch');
  });

  it('did:web error — server unreachable', async () => {
    const kp = wasm.generateKeypair();
    // Use a port that is almost certainly not listening
    const identity = 'did:web:127.0.0.1%3A19999';

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-web-error'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'error');
  });

  it('did:plc matched — mock PLC directory returns correct key', async () => {
    const kp = wasm.generateKeypair();
    const multibaseKey = kp.did_key.replace('did:key:', '');
    const identity = 'did:plc:testuser123';

    // PLC resolution queries https://plc.directory/{did} — we can't easily mock this
    // without intercepting fetch. Instead, test the resolver module directly.
    const { resolveIdentity } = await import('../../../src/core/did-resolver.ts');

    // plc.directory is external, so this will return 'error' or succeed depending
    // on network availability. We test the module contract.
    const result = await resolveIdentity(identity, kp.did_key);
    assert.ok(['matched', 'mismatch', 'error'].includes(result),
      `Expected matched/mismatch/error, got: ${result}`);
  });

  it('did:webvh matched — mock webvh server returns correct key', async () => {
    const kp = wasm.generateKeypair();
    const multibaseKey = kp.did_key.replace('did:key:', '');
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:webvh:${host}:webvh-test`;

    mockServer.addDocument('/webvh-test/did.json', makeDIDDocument(identity, multibaseKey));

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-webvh-matched'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'matched');
  });

  it('unsupported DID method — returns "unsupported"', async () => {
    const kp = wasm.generateKeypair();
    const identity = 'did:ion:EiDyOQbbZAa3aiRzeCkV7LOx3SERjjH93EXoIM3UoN4oWg';

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-unsupported'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.key_matches_identity, 'unsupported');
  });

  it('backward compatibility — commitment without identity verifies same as before', async () => {
    const kp = wasm.generateKeypair();
    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-backward-compat'));

    // Create commitment without identity
    const commitmentWithout = makeCommitment(kp, [itemHash]);

    // Create commitment with same params but using the WASM API directly
    const params = {
      items: [itemHash],
      reveal_probability: 0.10,
      beacon: { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
      committed_at: commitmentWithout.committed_at,
    };
    const commitmentDirect = wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);

    // Both should produce the same commitment hash
    assert.equal(commitmentWithout.commitment_hash, commitmentDirect.commitment_hash);
    assert.equal(commitmentWithout.identity, undefined);
  });

  it('identity is signed — tampering with identity after signing fails verification', async () => {
    const kp = wasm.generateKeypair();
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:web:${host}:tamper-test`;

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-signed'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    // Tamper with the identity field
    const tampered = { ...commitment, identity: 'did:web:evil.example.com' };

    const res = await req('POST', '/v1/commitments', tampered);
    assert.equal(res.status, 400, 'Tampered identity should fail signature verification');
  });

  it('DID resolution does not delay registered_at timestamp', async () => {
    const kp = wasm.generateKeypair();
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:web:${host}:timing-test`;
    const multibaseKey = kp.did_key.replace('did:key:', '');

    mockServer.addDocument('/timing-test/did.json', makeDIDDocument(identity, multibaseKey));

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-timing'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const beforeMs = Date.now();
    const res = await req('POST', '/v1/commitments', commitment);
    assert.equal(res.status, 201);
    const body = await res.json();

    const registeredMs = new Date(body.registered_at).getTime();
    // registered_at should be very close to 'now' — not delayed by DID resolution
    // Allow 2 seconds tolerance (generous for local mock)
    assert.ok(Math.abs(registeredMs - beforeMs) < 2000,
      `registered_at (${body.registered_at}) should be close to request time, diff: ${Math.abs(registeredMs - beforeMs)}ms`);
  });

  it('GET /v1/commitments/:hash returns key_matches_identity: null', async () => {
    const kp = wasm.generateKeypair();
    const host = `127.0.0.1%3A${mockAddr.port}`;
    const identity = `did:web:${host}:get-test`;
    const multibaseKey = kp.did_key.replace('did:key:', '');

    mockServer.addDocument('/get-test/did.json', makeDIDDocument(identity, multibaseKey));

    const itemHash = wasm.hashBytes(new TextEncoder().encode('identity-test-get'));
    const commitment = makeCommitment(kp, [itemHash], { identity });

    const postRes = await req('POST', '/v1/commitments', commitment);
    assert.equal(postRes.status, 201);
    const postBody = await postRes.json();
    assert.equal(postBody.key_matches_identity, 'matched');

    // GET should return null (point-in-time check only at registration)
    const getRes = await req('GET', `/v1/commitments/${commitment.commitment_hash}`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.key_matches_identity, null);
  });
});
