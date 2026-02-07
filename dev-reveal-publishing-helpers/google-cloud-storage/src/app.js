/**
 * Cloud Run Hono app factory for reveal publishing.
 * Receives long-lived GCS bucket client.
 */

import { Hono } from 'hono';

import uploadRoute from './routes/upload.js';
import dataRoute from './routes/data.js';

export function createApp(bucket, config) {
  const app = new Hono();

  // Middleware: inject bucket and config
  app.use('*', async (c, next) => {
    c.set('bucket', bucket);
    c.set('config', config);
    await next();
  });

  // Health check — probe GCS accessibility
  app.get('/health', async (c) => {
    try {
      await bucket.getMetadata();
      return c.json({ status: 'ok', storage: 'gcs' });
    } catch (err) {
      return c.json({ status: 'degraded', error: err.message }, 503);
    }
  });

  // Routes
  app.route('/v1', uploadRoute);
  app.route('/v1/data', dataRoute);

  // 404 fallback
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
