/**
 * SQLite database initialization for auth and upload logging.
 * Uses better-sqlite3 for synchronous, fast local storage.
 */

import Database from 'better-sqlite3';

export function initDatabase(dbPath) {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commitment_hash TEXT NOT NULL,
      signing_key TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_upload_logs_signing_key ON upload_logs(signing_key);
    CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_upload_logs_key_time ON upload_logs(signing_key, created_at);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      signing_key TEXT NOT NULL UNIQUE,
      linked_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_user_keys_user_id ON user_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
  `);

  return db;
}
