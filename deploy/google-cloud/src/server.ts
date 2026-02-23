/**
 * Cloud Run entry point.
 * Registers WASM, creates Firestore storage, initializes server key, starts Hono server.
 */

import { registerWasm } from '../../../src/core/wasm-registry.ts';
import * as wasm from './wasm/pb_wasm.js';

// Register WASM before anything else uses it
registerWasm(wasm as any);

import { serve } from '@hono/node-server';
import { FirestoreStorage } from './storage/firestore.ts';
import { getConfig } from './config.ts';
import { initServerKey } from '../../../src/core/signing.ts';
import { createApp } from './app.ts';

const config = getConfig();
const projectId = config.projectId;

if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT environment variable is required');
  process.exit(1);
}

const storage = new FirestoreStorage(projectId, config.firestoreDatabase || undefined);
await initServerKey(storage);

const app = createApp(storage);

const server = serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Commit-reveal server listening on http://localhost:${info.port}`);
  console.log(`  Operator: ${config.operator}`);
  console.log(`  Retention: ${config.retention}`);
  console.log(`  Project: ${projectId}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  storage.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down (SIGTERM)...');
  storage.close();
  process.exit(0);
});
