/**
 * Cloud Run Hono app factory.
 * Receives long-lived storage instance (container, not per-request).
 * Server key is initialized at startup, not per-request.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../../../src/core/types.ts'
import { getConfig } from './config.ts';
import { FirestoreStorage } from './storage/firestore.ts';
import { mountRoutes } from '../../../src/core/app.ts';

export function createApp(storage: FirestoreStorage) {
  const app = new Hono<AppEnv>();
  const config = getConfig();

  // Middleware: inject storage and config
  app.use('*', async (c, next) => {
    c.set('storage', storage);
    c.set('config', config);
    await next();
  });

  return mountRoutes(app);
}
