/**
 * Node.js HTTP server entry point.
 */

import { serve } from '@hono/node-server';
import { createDefaultApp } from './app.js';

const { app, storage, config } = await createDefaultApp();

serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Commit-reveal server listening on http://localhost:${info.port}`);
  console.log(`  Operator: ${config.operator}`);
  console.log(`  Retention: ${config.retention}`);
  console.log(`  DB: ${config.dbPath}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  storage.close();
  process.exit(0);
});
