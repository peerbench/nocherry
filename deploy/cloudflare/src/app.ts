/**
 * Worker Hono app factory.
 * Creates D1Storage per-request and lazy-inits the server key.
 */

import { Hono } from 'hono';
import type { AppEnv } from './types';
import { D1Storage } from './storage/d1';
import { getConfig } from './config';
import { initServerKey } from './core/signing.ts';
import { mountRoutes } from './core/app.ts';

// Public test identity for DID match testing. Its private key is published in
// deploy/supabase/test-did-match.ts on purpose, so anyone can sign as it.
// Served under a path-based did:web so it never claims the bare domain identity.
const TEST_DID = 'did:web:commit-reveal.orgtopus.workers.dev:test-identity';
const TEST_DID_DOCUMENT = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: TEST_DID,
  verificationMethod: [{
    id: `${TEST_DID}#key-1`,
    type: 'Ed25519VerificationKey2020',
    controller: TEST_DID,
    publicKeyMultibase: 'z6MkfCH4zUChzYzAufNRaf2BWBgup8bLUMn3fYofxZfbehRg',
  }],
  authentication: [`${TEST_DID}#key-1`],
};

export function createApp() {
  const app = new Hono<AppEnv>();

  // Serve the public test identity's DID document (resolves TEST_DID)
  app.get('/test-identity/did.json', (c) => c.json(TEST_DID_DOCUMENT));

  // Middleware: inject storage, config, and ensure server key is initialized
  app.use('*', async (c, next) => {
    const storage = new D1Storage(c.env.DB);
    const config = getConfig(c.env);
    c.set('storage', storage);
    c.set('config', config);
    await initServerKey(storage);
    await next();
  });

  return mountRoutes(app);
}
