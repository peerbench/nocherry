/**
 * Worker Hono app factory.
 * Creates D1Storage per-request and lazy-inits the server key.
 */

import { Hono } from 'hono';
import type { AppEnv } from './types';
import { D1Storage } from './storage/d1';
import { getConfig } from './config';
import { initServerKey } from './core/signing.ts';
import { mountRoutes } from './core/app.ts';

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

  return mountRoutes(app);
}
