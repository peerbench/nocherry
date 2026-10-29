/**
 * Node.js HTTP server entry point — PGlite deployment.
 *
 * Runs a commit-reveal server backed by PGlite (WASM Postgres).
 * Data is persisted to disk at DATA_DIR (default: ./pgdata).
 */

import { serve } from '@hono/node-server';
import { createPgliteApp } from './app.js';
import { config } from './config.js';

const { app, storage } = await createPgliteApp();

const server = serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Commit-reveal server (PGlite) listening on http://localhost:${info.port}`);
  console.log(`  Operator: ${config.operator}`);
  console.log(`  Retention: ${config.retention}`);
  console.log(`  Data dir: ${config.dataDir}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  storage.close();
  process.exit(0);
});
