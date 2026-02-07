/**
 * Worker Hono app factory for reveal publishing.
 * Injects R2 bucket and D1 database per request.
 */

import { Hono } from 'hono';
import { getConfig } from './config.js';

import uploadRoute from './routes/upload.js';
import dataRoute from './routes/data.js';
import authRoute from './routes/auth.js';

export function createApp() {
  const app = new Hono();

  // Middleware: inject config and env bindings
  app.use('*', async (c, next) => {
    c.set('config', getConfig(c.env));
    await next();
  });

  // Health check — probe R2 accessibility
  app.get('/health', async (c) => {
    try {
      await c.env.DATA_BUCKET.list({ limit: 1 });
      return c.json({ status: 'ok', storage: 'r2' });
    } catch (err) {
      return c.json({ status: 'degraded', error: err.message }, 503);
    }
  });

  // Routes
  app.route('/auth', authRoute);
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
