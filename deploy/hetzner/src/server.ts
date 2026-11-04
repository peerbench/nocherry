/**
 * forest-box (Hetzner) entry point — Postgres storage.
 * Same boot sequence as deploy/google-cloud/src/server.ts, minus Firestore.
 */

import { registerWasm } from '../../../src/core/wasm-registry.ts';
import * as wasm from '@nocherry/pb-wasm';

// Register WASM before anything else uses it.
registerWasm(wasm as any);

import { serve } from '@hono/node-server';
import { createPostgresStorage } from '@nocherry/storage/postgres';
import { getConfig } from './config.ts';
import { initServerKey } from '../../../src/core/signing.ts';
import { createApp } from './app.ts';

const config = getConfig();

// applySchema: the schema is created idempotently on boot, so a fresh database needs no
// separate migration step. Set NOCHERRY_APPLY_SCHEMA=false once data is migrated by hand.
const storage = await createPostgresStorage(config.databaseUrl, {}, {
  applySchema: process.env.NOCHERRY_APPLY_SCHEMA !== 'false',
});
await initServerKey(storage);

const app = createApp(storage);

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Commit-reveal server listening on http://localhost:${info.port}`);
    console.log(`  Operator: ${config.operator}`);
    console.log(`  Retention: ${config.retention}`);
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`Shutting down (${signal})...`);
    server.close();
    void storage.close().finally(() => process.exit(0));
  });
}
