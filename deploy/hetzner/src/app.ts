/**
 * Hono app factory for the forest-box deployment.
 * Mirrors deploy/google-cloud/src/app.ts; storage is a KyselyStorage on Postgres.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../../../src/core/types.ts';
import type { KyselyStorage } from '@nocherry/storage';
import { getConfig } from './config.ts';
import { mountRoutes } from '../../../src/core/app.ts';

export function createApp(storage: KyselyStorage) {
  const app = new Hono<AppEnv>();
  const config = getConfig();

  app.use('*', async (c, next) => {
    c.set('storage', storage);
    c.set('config', config);
    await next();
  });

  return mountRoutes(app);
}
