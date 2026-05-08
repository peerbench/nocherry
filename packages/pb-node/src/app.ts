/**
 * Hono application — portable across Node.js, Cloudflare Workers, Deno.
 *
 * Config is now an explicit argument so embedded consumers (e.g. a sub-app
 * mounted inside a larger Hono server) can pass their own config without
 * relying on this package's process.env reads.
 */

import { Hono } from 'hono';
import type { KyselyStorage } from '@nocherry/storage';
import { createSqliteStorage } from '@nocherry/storage/sqlite';
import * as wasm from '@nocherry/pb-wasm';
import { registerWasm } from '../../../src/core/wasm-registry.js'
import { initServerKey } from '../../../src/core/signing.js'
export { initServerKey }
import type { AppEnv, Config } from '../../../src/core/types.js'
import { mountRoutes } from '../../../src/core/app.js';
import { loadConfigFromEnv, type PbNodeConfig } from './config.js';
export { loadConfigFromEnv, type PbNodeConfig }

registerWasm(wasm);

/**
 * Create a Hono app with the given storage backend and config.
 * Storage must already have server key initialized via `initServerKey`.
 */
export function createApp(storage: KyselyStorage, config: Config) {
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
 * Create a default app with SQLite storage and env-driven config.
 * Standalone-server convenience — embedded consumers should call
 * `createApp` directly with their own storage and config.
 */
export async function createDefaultApp() {
  const config = loadConfigFromEnv();
  const storage = createSqliteStorage(config.dbPath);
  await initServerKey(storage);
  return { app: createApp(storage, config), storage, config };
}
