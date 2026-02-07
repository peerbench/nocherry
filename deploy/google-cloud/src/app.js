/**
 * Cloud Run Hono app factory.
 * Receives long-lived storage instance (container, not per-request).
 * Server key is initialized at startup, not per-request.
 */

import { Hono } from 'hono';
import { getConfig } from './config.js';

import serverInfoRoute from './routes/server-info.js';
import commitmentsRoute from './routes/commitments.js';
import revealsRoute from './routes/reveals.js';

export function createApp(storage) {
  const app = new Hono();
  const config = getConfig();

  // Middleware: inject storage and config
  app.use('*', async (c, next) => {
    c.set('storage', storage);
    c.set('config', config);
    await next();
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', version: config.version }));

  // Routes
  app.route('/v1/server-info', serverInfoRoute);
  app.route('/v1/commitments', commitmentsRoute);
  app.route('/v1/commitments', revealsRoute);

  // 404 fallback
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
