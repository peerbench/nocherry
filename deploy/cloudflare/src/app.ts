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

// Fixed test keypair for DID identity verification testing.
// Private key is in deploy/supabase/test-live.ts — NOT a secret, only used for tests.
const TEST_DID_DOCUMENT = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: 'did:web:commit-reveal.orgtopus.workers.dev',
  verificationMethod: [{
    id: 'did:web:commit-reveal.orgtopus.workers.dev#key-1',
    type: 'Ed25519VerificationKey2020',
    controller: 'did:web:commit-reveal.orgtopus.workers.dev',
    publicKeyMultibase: 'z6MkfCH4zUChzYzAufNRaf2BWBgup8bLUMn3fYofxZfbehRg',
  }],
  authentication: ['did:web:commit-reveal.orgtopus.workers.dev#key-1'],
};

export function createApp() {
  const app = new Hono<AppEnv>();

  // Serve DID document for identity verification testing
  app.get('/.well-known/did.json', (c) => c.json(TEST_DID_DOCUMENT));

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
