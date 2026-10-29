/**
 * Standalone PGlite server worker — spawned as a child process.
 *
 * Each process gets its own module scope, so each server gets
 * its own Ed25519 signing keypair (the module-level singleton
 * in signing.js is per-process).
 *
 * Usage:  PORT=17420 DATA_DIR=memory:// node test/_worker-server.js
 *
 * IPC messages sent to parent:
 *   { type: 'ready', port }  — server is listening
 *   { type: 'error', message } — startup failed (e.g. lock conflict)
 */

import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteStorage } from '@nocherry/storage/pglite';
import { createApp, initServerKey } from '../../../packages/pb-node/dist/app.js';

const port = parseInt(process.env.PORT || '17420', 10);
const dataDir = process.env.DATA_DIR || 'memory://';

try {
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;

  const storage = await createPgliteStorage(pglite);
  await initServerKey(storage);
  const app = createApp(storage);

  const server = serve({ fetch: app.fetch, port }, () => {
    // Signal parent that we're ready
    if (process.send) {
      process.send({ type: 'ready', port });
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await storage.close();
    server.close();
    process.exit(0);
  });
} catch (err) {
  if (process.send) {
    process.send({ type: 'error', message: err.message });
  }
  process.exit(1);
}
