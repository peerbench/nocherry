/**
 * Cloud Run Hono app factory for reveal publishing.
 * Receives long-lived GCS bucket client.
 */

import { Hono } from 'hono';

import uploadRoute from './routes/upload.js';
import dataRoute from './routes/data.js';
import authRoute from './routes/auth.js';

export function createApp(bucket, config, db) {
  const app = new Hono();

  // Middleware: inject bucket, config, and db
  app.use('*', async (c, next) => {
    c.set('bucket', bucket);
    c.set('config', config);
    c.set('db', db);
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
  app.route('/auth', authRoute);
  app.route('/v1', uploadRoute);
  app.route('/v1/data', dataRoute);

  // Cleanup expired anonymous uploads (called by Cloud Scheduler)
  app.get('/internal/cleanup', async (c) => {
    // Only allow from internal callers (Cloud Scheduler sends this header)
    const callerHeader = c.req.header('X-CloudScheduler') || c.req.header('X-Appengine-Cron');
    if (!callerHeader) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const expired = db.prepare(
      "SELECT commitment_hash FROM upload_logs WHERE is_anon = 1 AND expires_at < datetime('now')"
    ).all();

    let deleted = 0;
    for (const row of expired) {
      const [files] = await bucket.getFiles({ prefix: `${row.commitment_hash}/` });
      for (const file of files) {
        await file.delete().catch(() => {});
      }
      db.prepare(
        'DELETE FROM upload_logs WHERE commitment_hash = ? AND is_anon = 1'
      ).run(row.commitment_hash);
      deleted++;
    }

    return c.json({ status: 'ok', deleted });
  });

  // 404 fallback
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
