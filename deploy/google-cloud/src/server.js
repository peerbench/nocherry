/**
 * Cloud Run entry point.
 * Creates Firestore storage, initializes server key, starts Hono server.
 */

import { serve } from '@hono/node-server';
import { FirestoreStorage } from './storage/firestore.js';
import { getConfig } from './config.js';
import { initServerKey } from './signing.js';
import { createApp } from './app.js';

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
