/**
 * Worker Hono app factory.
 * Creates D1Storage per-request and lazy-inits the server key.
 */

import { Hono } from 'hono';
import type { AppEnv } from './types';
import { D1Storage } from './storage/d1';
import { getConfig } from './config';
import { initServerKey } from './signing';

import serverInfoRoute from './routes/server-info';
import commitmentsRoute from './routes/commitments';
import revealsRoute from './routes/reveals';

export function createApp() {
  const app = new Hono<AppEnv>();

  // Middleware: inject storage, config, and ensure server key is initialized
  app.use('*', async (c, next) => {
    const storage = new D1Storage(c.env.DB);
    const config = getConfig(c.env);
    c.set('storage', storage);
    c.set('config', config);
    await initServerKey(storage);
    await next();
  });

  // Health check
  app.get('/health', (c) => {
    const config = c.get('config');
    return c.json({ status: 'ok', version: config.version });
  });

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
