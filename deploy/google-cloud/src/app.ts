/**
 * Cloud Run Hono app factory.
 * Receives long-lived storage instance (container, not per-request).
 * Server key is initialized at startup, not per-request.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../../../src/core/types.ts'
import { getConfig } from './config.ts';
import { FirestoreStorage } from './storage/firestore.ts';

import serverInfoRoute from '../../../src/core/routes/server-info.ts';
import commitmentsRoute from '../../../src/core/routes/commitments.ts';
import revealsRoute from '../../../src/core/routes/reveals.ts';

export function createApp(storage: FirestoreStorage) {
  const app = new Hono<AppEnv>();
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
