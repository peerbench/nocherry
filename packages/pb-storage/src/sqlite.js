/**
 * SQLite dialect factory for KyselyStorage.
 * Uses better-sqlite3 under the hood.
 */

import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { KyselyStorage } from './storage.js';

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

/**
 * Create a KyselyStorage backed by SQLite.
 * @param {string} dbPath - Path to SQLite file, or ':memory:' for in-memory.
 * @returns {KyselyStorage}
 */
export function createSqliteStorage(dbPath = ':memory:') {
  const sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.exec(SCHEMA_SQL);

  const db = new Kysely({
    dialect: new SqliteDialect({ database: sqliteDb }),
  });

  return new KyselyStorage(db);
}
