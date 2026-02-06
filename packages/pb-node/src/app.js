/**
 * Hono application — portable across Node.js, Cloudflare Workers, Deno.
 */

import { Hono } from 'hono';
import { SQLiteStorage } from './storage/sqlite.js';
import { initServerKey } from './signing.js';
import { config } from './config.js';

import serverInfoRoute from './routes/server-info.js';
import commitmentsRoute from './routes/commitments.js';
import revealsRoute from './routes/reveals.js';

/**
 * Create a Hono app with the given storage backend.
 */
export function createApp(storage) {
  const app = new Hono();

  // Initialize server signing key
  initServerKey(storage);

  // Inject storage into every request context
  app.use('*', async (c, next) => {
    c.set('storage', storage);
    await next();
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

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

/**
 * Create a default app with SQLite storage.
 */
export function createDefaultApp() {
  const storage = new SQLiteStorage(config.dbPath);
  return { app: createApp(storage), storage };
}
