/**
 * Hono application — portable across Node.js, Cloudflare Workers, Deno.
 */

import { Hono } from 'hono';
import type { KyselyStorage } from 'pb-storage';
import { createSqliteStorage } from 'pb-storage/sqlite';
import * as wasm from 'pb-wasm';
import { registerWasm } from '../../../src/core/wasm-registry.ts'
import { initServerKey } from '../../../src/core/signing.ts'
export { initServerKey }
import type { AppEnv } from '../../../src/core/types.ts'
import { mountRoutes } from '../../../src/core/app.ts';
import { config } from './config.js';

registerWasm(wasm);

/**
 * Create a Hono app with the given storage backend.
 * Storage must already have server key initialized.
 */
export function createApp(storage: KyselyStorage) {
  const app = new Hono<AppEnv>();

  // Inject storage and config into every request context
  app.use('*', async (c, next) => {
    c.set('storage', storage);
    c.set('config', config);
    await next();
  });

  return mountRoutes(app);
}

/**
 * Create a default app with SQLite storage.
 * Returns a promise since server key init is async.
 */
export async function createDefaultApp() {
  const storage = createSqliteStorage(config.dbPath);
  await initServerKey(storage);
  return { app: createApp(storage), storage };
}
