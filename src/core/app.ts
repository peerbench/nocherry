/**
 * Shared Hono route mounting for all deployment targets.
 *
 * Platform-specific middleware (storage + config injection) must be
 * registered on the app BEFORE calling mountRoutes().
 */

import { Hono } from 'hono';
import type { AppEnv } from './types.ts';

import serverInfoRoute from './routes/server-info.ts';
import commitmentsRoute from './routes/commitments.ts';
import revealsRoute from './routes/reveals.ts';
import streamsRoute from './routes/streams.ts';

/**
 * Mount shared routes, health check, 404 fallback, and error handler.
 * Returns the same app instance for chaining.
 */
export function mountRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get('/health', (c) => {
    const config = c.get('config');
    return c.json({ status: 'ok', version: config.version });
  });

  app.route('/v1/server-info', serverInfoRoute);
  app.route('/v1/commitments', commitmentsRoute);
  app.route('/v1/commitments', revealsRoute);
  app.route('/v1/streams', streamsRoute);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
