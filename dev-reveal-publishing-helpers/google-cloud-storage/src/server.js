/**
 * Cloud Run entry point for reveal publishing helper.
 * Initializes GCS bucket client, starts Hono server.
 */

import { serve } from '@hono/node-server';
import { Storage } from '@google-cloud/storage';
import { getConfig } from './config.js';
import { createApp } from './app.js';

const config = getConfig();

if (!config.gcsBucket) {
  console.error('GCS_BUCKET environment variable is required');
  process.exit(1);
}

const gcs = new Storage({ projectId: config.projectId || undefined });
const bucket = gcs.bucket(config.gcsBucket);

const app = createApp(bucket, config);

const server = serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Reveal publishing helper listening on http://localhost:${info.port}`);
  console.log(`  Bucket: ${config.gcsBucket}`);
  console.log(`  Max upload: ${config.maxUploadMb} MB`);
  console.log(`  Rate limit: ${config.rateLimitPerHour}/hour`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down (SIGTERM)...');
  process.exit(0);
});
