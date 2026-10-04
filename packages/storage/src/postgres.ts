/**
 * Postgres dialect factory for KyselyStorage.
 * Uses the 'pg' (node-postgres) driver under the hood.
 *
 * Schema applied idempotently on connect when applySchema=true (default).
 * Set applySchema=false when migrations are managed externally
 * (e.g. Supabase CLI, Drizzle, Flyway).
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { KyselyStorage } from './storage.js';
import type { Database } from './types.js';

// Idempotent (IF NOT EXISTS). Mirrors deploy/supabase/supabase/migrations/00001_init.sql.
// Kept inline so embedded consumers do not need to ship a migration runner alongside
// the library — see Decision 2026-05-07: nocherry mounts as a Hono sub-app inside pbfed.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  signing_key TEXT NOT NULL,
  body JSONB NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commitments_signing_key ON commitments(signing_key);
CREATE INDEX IF NOT EXISTS idx_commitments_registered_at ON commitments(registered_at);

CREATE TABLE IF NOT EXISTS selections (
  commitment_hash TEXT PRIMARY KEY REFERENCES commitments(id) ON DELETE CASCADE,
  beacon_round INTEGER,
  body JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reveals (
  id TEXT PRIMARY KEY,
  commitment_hash TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  body JSONB NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reveals_commitment_hash ON reveals(commitment_hash);

CREATE TABLE IF NOT EXISTS server_identity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beacon_cache (
  beacon_type TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  body JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (beacon_type, round_number)
);
`;

export interface CreatePostgresStorageOptions {
  /**
   * Apply idempotent schema on connect. Default `true`.
   * Set `false` when an external migration tool owns the schema.
   */
  applySchema?: boolean;
}

export async function createPostgresStorage(
  connectionString: string,
  poolOptions: pg.PoolConfig = {},
  options: CreatePostgresStorageOptions = {},
): Promise<KyselyStorage> {
  const { applySchema = true } = options;

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ...poolOptions,
  });

  // An idle client that errors (server restart, network drop) emits on the pool.
  // Without a listener Node treats it as an unhandled 'error' event and exits.
  pool.on('error', (err) => {
    console.error('[storage] idle postgres client error:', err.message);
  });

  if (applySchema) {
    await pool.query(SCHEMA_SQL);
  }

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return new KyselyStorage(db);
}
