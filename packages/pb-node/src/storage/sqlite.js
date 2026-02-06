/**
 * SQLite storage adapter using better-sqlite3.
 */

import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  signing_key TEXT NOT NULL,
  body JSON NOT NULL,
  registered_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commitments_signing_key ON commitments(signing_key);
CREATE INDEX IF NOT EXISTS idx_commitments_registered_at ON commitments(registered_at);

CREATE TABLE IF NOT EXISTS selections (
  commitment_hash TEXT PRIMARY KEY REFERENCES commitments(id),
  beacon_round INTEGER,
  body JSON NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reveals (
  id TEXT PRIMARY KEY,
  commitment_hash TEXT NOT NULL REFERENCES commitments(id),
  body JSON NOT NULL,
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
  body JSON NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (beacon_type, round_number)
);
`;

export class SQLiteStorage {
  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  // ── Server identity ──

  getServerIdentity() {
    const row = this.db.prepare('SELECT value FROM server_identity WHERE key = ?').get('keypair');
    return row ? JSON.parse(row.value) : null;
  }

  setServerIdentity(keypair) {
    this.db.prepare(
      'INSERT OR REPLACE INTO server_identity (key, value) VALUES (?, ?)'
    ).run('keypair', JSON.stringify(keypair));
  }

  // ── Commitments ──

  putCommitment(id, commitment, registeredAt) {
    this.db.prepare(
      'INSERT INTO commitments (id, signing_key, body, registered_at) VALUES (?, ?, ?, ?)'
    ).run(id, commitment.signing_key, JSON.stringify(commitment), registeredAt);
  }

  getCommitment(id) {
    const row = this.db.prepare('SELECT body, registered_at FROM commitments WHERE id = ?').get(id);
    if (!row) return null;
    return {
      commitment: JSON.parse(row.body),
      registered_at: row.registered_at,
    };
  }

  // ── Selections ──

  putSelection(commitmentHash, selection, beaconRound) {
    this.db.prepare(
      'INSERT OR REPLACE INTO selections (commitment_hash, beacon_round, body, computed_at) VALUES (?, ?, ?, ?)'
    ).run(commitmentHash, beaconRound, JSON.stringify(selection), new Date().toISOString());
  }

  getSelection(commitmentHash) {
    const row = this.db.prepare('SELECT body FROM selections WHERE commitment_hash = ?').get(commitmentHash);
    return row ? JSON.parse(row.body) : null;
  }

  // ── Reveals ──

  putReveal(id, commitmentHash, reveal, registeredAt) {
    this.db.prepare(
      'INSERT INTO reveals (id, commitment_hash, body, registered_at) VALUES (?, ?, ?, ?)'
    ).run(id, commitmentHash, JSON.stringify(reveal), registeredAt);
  }

  getReveals(commitmentHash) {
    const rows = this.db.prepare('SELECT body, registered_at FROM reveals WHERE commitment_hash = ?').all(commitmentHash);
    return rows.map(r => ({ ...JSON.parse(r.body), registered_at: r.registered_at }));
  }

  // ── Anti-spam / Activity ──

  countCommitmentsByKey(signingKey, since) {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM commitments WHERE signing_key = ? AND registered_at >= ?'
    ).get(signingKey, since);
    return row.count;
  }

  getSignerActivity(signingKey) {
    const now = new Date();
    const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

    return {
      commitments_past_hour: this.countCommitmentsByKey(signingKey, oneHourAgo),
      commitments_past_month: this.countCommitmentsByKey(signingKey, thirtyDaysAgo),
    };
  }

  // ── Beacon cache ──

  getCachedBeacon(beaconType, round) {
    const row = this.db.prepare(
      'SELECT body FROM beacon_cache WHERE beacon_type = ? AND round_number = ?'
    ).get(beaconType, round);
    return row ? JSON.parse(row.body) : null;
  }

  cacheBeacon(beaconType, round, output) {
    this.db.prepare(
      'INSERT OR REPLACE INTO beacon_cache (beacon_type, round_number, body, fetched_at) VALUES (?, ?, ?, ?)'
    ).run(beaconType, round, JSON.stringify(output), new Date().toISOString());
  }

  // ── Retention ──

  deleteOlderThan(cutoff) {
    const cutoffStr = cutoff.toISOString();
    const result = this.db.prepare(
      'DELETE FROM commitments WHERE registered_at < ?'
    ).run(cutoffStr);
    return result.changes;
  }

  close() {
    this.db.close();
  }
}
