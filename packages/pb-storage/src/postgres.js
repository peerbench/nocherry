/**
 * Postgres dialect factory for KyselyStorage.
 * Uses the 'pg' (node-postgres) driver under the hood.
 *
 * Schema is managed via Supabase migrations, not applied here.
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { KyselyStorage } from './storage.js';

/**
 * Create a KyselyStorage backed by Postgres.
 * @param {string} connectionString - Postgres connection URL.
 * @param {object} [poolOptions] - Additional pg.Pool options.
 * @returns {KyselyStorage}
 */
export function createPostgresStorage(connectionString, poolOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ...poolOptions,
  });

  const db = new Kysely({
    dialect: new PostgresDialect({ pool }),
  });

  return new KyselyStorage(db);
}
