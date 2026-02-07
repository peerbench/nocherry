/**
 * Cloud Run entry point for reveal publishing helper.
 * Initializes GCS bucket client and SQLite database, starts Hono server.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { Storage } from '@google-cloud/storage';
import { getConfig } from './config.js';
import { createApp } from './app.js';
import { initDatabase } from './db.js';

const config = getConfig();

if (!config.gcsBucket) {
  console.error('GCS_BUCKET environment variable is required');
  process.exit(1);
}

// Initialize SQLite database
const dbDir = dirname(config.dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}
const db = initDatabase(config.dbPath);

const gcs = new Storage({ projectId: config.projectId || undefined });
const bucket = gcs.bucket(config.gcsBucket);

const app = createApp(bucket, config, db);

const server = serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Reveal publishing helper listening on http://localhost:${info.port}`);
  console.log(`  Bucket: ${config.gcsBucket}`);
  console.log(`  Database: ${config.dbPath}`);
  console.log(`  Max upload: ${config.maxUploadMb} MB`);
  console.log(`  Rate limit: ${config.rateLimitPerHour}/hour`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down (SIGTERM)...');
  db.close();
  process.exit(0);
});
