/**
 * Postgres dialect factory for KyselyStorage.
 * Uses the 'pg' (node-postgres) driver under the hood.
 *
 * Schema is managed via Supabase migrations, not applied here.
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { KyselyStorage } from './storage.js';
import type { Database } from './types.js';

export function createPostgresStorage(connectionString: string, poolOptions: pg.PoolConfig = {}): KyselyStorage {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ...poolOptions,
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return new KyselyStorage(db);
}
