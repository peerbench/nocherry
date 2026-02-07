/**
 * D1 storage adapter for Cloudflare Workers.
 * Async mirror of the KyselyStorage interface — uses D1's prepare/bind API.
 */

export class D1Storage {
  /** @param {D1Database} db */
  constructor(db) {
    this.db = db;
  }

  // ── Server identity ──

  async getServerIdentity() {
    const row = await this.db
      .prepare('SELECT value FROM server_identity WHERE key = ?')
      .bind('keypair')
      .first();
    return row ? JSON.parse(row.value) : null;
  }

  async setServerIdentity(keypair) {
    await this.db
      .prepare('INSERT OR REPLACE INTO server_identity (key, value) VALUES (?, ?)')
      .bind('keypair', JSON.stringify(keypair))
      .run();
  }

  // ── Commitments ──

  async putCommitment(id, commitment, registeredAt) {
    await this.db
      .prepare('INSERT INTO commitments (id, signing_key, body, registered_at) VALUES (?, ?, ?, ?)')
      .bind(id, commitment.signing_key, JSON.stringify(commitment), registeredAt)
      .run();
  }

  async getCommitment(id) {
    const row = await this.db
      .prepare('SELECT body, registered_at FROM commitments WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return null;
    return {
      commitment: JSON.parse(row.body),
      registered_at: row.registered_at,
    };
  }

  // ── Selections ──

  async putSelection(commitmentHash, selection, beaconRound) {
    await this.db
      .prepare('INSERT OR REPLACE INTO selections (commitment_hash, beacon_round, body, computed_at) VALUES (?, ?, ?, ?)')
      .bind(commitmentHash, beaconRound, JSON.stringify(selection), new Date().toISOString())
      .run();
  }

  async getSelection(commitmentHash) {
    const row = await this.db
      .prepare('SELECT body FROM selections WHERE commitment_hash = ?')
      .bind(commitmentHash)
      .first();
    return row ? JSON.parse(row.body) : null;
  }

  // ── Reveals ──

  async putReveal(id, commitmentHash, reveal, registeredAt) {
    await this.db
      .prepare('INSERT INTO reveals (id, commitment_hash, body, registered_at) VALUES (?, ?, ?, ?)')
      .bind(id, commitmentHash, JSON.stringify(reveal), registeredAt)
      .run();
  }

  async getReveals(commitmentHash) {
    const { results } = await this.db
      .prepare('SELECT body, registered_at FROM reveals WHERE commitment_hash = ?')
      .bind(commitmentHash)
      .all();
    return results.map((r) => ({ ...JSON.parse(r.body), registered_at: r.registered_at }));
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey, since) {
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM commitments WHERE signing_key = ? AND registered_at >= ?')
      .bind(signingKey, since)
      .first();
    return Number(row?.count ?? 0);
  }

  async getSignerActivity(signingKey) {
    const now = new Date();
    const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

    // Use D1 batch for single round-trip
    const results = await this.db.batch([
      this.db
        .prepare('SELECT COUNT(*) as count FROM commitments WHERE signing_key = ? AND registered_at >= ?')
        .bind(signingKey, oneHourAgo),
      this.db
        .prepare('SELECT COUNT(*) as count FROM commitments WHERE signing_key = ? AND registered_at >= ?')
        .bind(signingKey, thirtyDaysAgo),
    ]);

    return {
      commitments_past_hour: Number(results[0].results[0]?.count ?? 0),
      commitments_past_month: Number(results[1].results[0]?.count ?? 0),
    };
  }

  // ── Beacon cache ──

  async getCachedBeacon(beaconType, round) {
    const row = await this.db
      .prepare('SELECT body FROM beacon_cache WHERE beacon_type = ? AND round_number = ?')
      .bind(beaconType, round)
      .first();
    return row ? JSON.parse(row.body) : null;
  }

  async cacheBeacon(beaconType, round, output) {
    await this.db
      .prepare('INSERT OR REPLACE INTO beacon_cache (beacon_type, round_number, body, fetched_at) VALUES (?, ?, ?, ?)')
      .bind(beaconType, round, JSON.stringify(output), new Date().toISOString())
      .run();
  }

  // ── Retention ──

  async deleteOlderThan(cutoff) {
    const result = await this.db
      .prepare('DELETE FROM commitments WHERE registered_at < ?')
      .bind(cutoff.toISOString())
      .run();
    return result.meta.changes;
  }
}
