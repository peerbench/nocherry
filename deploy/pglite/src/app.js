/**
 * Hono application factory — PGlite deployment.
 *
 * Reuses the same route handlers and signing logic from pb-node,
 * but swaps in PGlite as the storage backend.
 */

import { PGlite } from '@electric-sql/pglite';
import { createPgliteStorage } from 'pb-storage/pglite';
import { createApp, initServerKey } from '../../../packages/pb-node/dist/app.js';
import { config } from './config.js';

/**
 * Create the app with PGlite-backed storage.
 * @returns {Promise<{ app: import('hono').Hono, storage: import('pb-storage').KyselyStorage }>}
 */
export async function createPgliteApp() {
  const pglite = new PGlite(config.dataDir);
  await pglite.waitReady;

  const storage = await createPgliteStorage(pglite);
  await initServerKey(storage);
  return { app: createApp(storage), storage };
}
