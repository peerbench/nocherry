/**
 * SQLite dialect factory for KyselyStorage.
 * Uses better-sqlite3 under the hood.
 */

import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { KyselyStorage } from './storage.js';
import type { Database as DB } from './types.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  signing_key TEXT NOT NULL,
  body TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commitments_signing_key ON commitments(signing_key);
CREATE INDEX IF NOT EXISTS idx_commitments_registered_at ON commitments(registered_at);

CREATE TABLE IF NOT EXISTS selections (
  commitment_hash TEXT PRIMARY KEY REFERENCES commitments(id),
  beacon_round INTEGER,
  body TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reveals (
  id TEXT PRIMARY KEY,
  commitment_hash TEXT NOT NULL REFERENCES commitments(id),
  body TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reveals_commitment_hash ON reveals(commitment_hash);

CREATE TABLE IF NOT EXISTS server_identity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beacon_cache (
  beacon_type TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (beacon_type, round_number)
);

`;

// Stream columns (spec v0.5 12.2). Added separately so that a database created
// before 0.5.0 is migrated in place; SQLite has no ADD COLUMN IF NOT EXISTS.
const STREAM_COLUMNS: [string, string][] = [
  ['stream_id', 'ALTER TABLE commitments ADD COLUMN stream_id TEXT'],
  ['sequence', 'ALTER TABLE commitments ADD COLUMN sequence INTEGER'],
];
const STREAM_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_stream
  ON commitments(signing_key, stream_id, sequence);
`;

export function createSqliteStorage(dbPath: string = ':memory:'): KyselyStorage {
  const sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.exec(SCHEMA_SQL);
  const columns = new Set((sqliteDb.pragma('table_info(commitments)') as { name: string }[]).map((c) => c.name));
  for (const [name, ddl] of STREAM_COLUMNS) {
    if (!columns.has(name)) sqliteDb.exec(ddl);
  }
  sqliteDb.exec(STREAM_INDEX_SQL);

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqliteDb }),
  });

  return new KyselyStorage(db);
}
