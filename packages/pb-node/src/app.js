/**
 * Hono application — portable across Node.js, Cloudflare Workers, Deno.
 */

import { Hono } from 'hono';
import { createSqliteStorage } from 'pb-storage/sqlite';
import { initServerKey } from './signing.js';
import { config } from './config.js';

import serverInfoRoute from './routes/server-info.js';
import commitmentsRoute from './routes/commitments.js';
import revealsRoute from './routes/reveals.js';
/**
 * Create a Hono app with the given storage backend.
 * Storage must already have server key initialized.
 */
export function createApp(storage) {
  const app = new Hono();

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
 * Returns a promise since server key init is async.
 */
export async function createDefaultApp() {
  const storage = createSqliteStorage(config.dbPath);
  await initServerKey(storage);
  return { app: createApp(storage), storage };
}
