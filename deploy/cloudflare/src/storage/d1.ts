/**
 * D1 storage adapter for Cloudflare Workers.
 * Async mirror of the KyselyStorage interface — uses D1's prepare/bind API.
 */

import type { Keypair } from '../types';

export class D1Storage {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ── Server identity ──

  async getServerIdentity(): Promise<Keypair | null> {
    const row = await this.db
      .prepare('SELECT value FROM server_identity WHERE key = ?')
      .bind('keypair')
      .first<{ value: string }>();
    return row ? JSON.parse(row.value) : null;
  }

  async setServerIdentity(keypair: Keypair): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO server_identity (key, value) VALUES (?, ?)')
      .bind('keypair', JSON.stringify(keypair))
      .run();
  }

  // ── Commitments ──

  async putCommitment(id: string, commitment: any, registeredAt: string): Promise<void> {
    // Only a 0.5.0 commitment signs its stream name (spec v0.5 12.2).
    const inStream = commitment.spec_version === '0.5.0' && typeof commitment.stream_id === 'string' && Number.isInteger(commitment.sequence);
    await this.db
      .prepare('INSERT INTO commitments (id, signing_key, body, registered_at, stream_id, sequence) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, commitment.signing_key, JSON.stringify(commitment), registeredAt,
        inStream ? commitment.stream_id : null, inStream ? commitment.sequence : null)
      .run();
  }

  // ── Streams (spec v0.5 12.2, 12.9) ──

  async findStreamCommitment(signingKey: string, streamId: string, sequence: number) {
    const row = await this.db
      .prepare('SELECT id, sequence, registered_at FROM commitments WHERE signing_key = ? AND stream_id = ? AND sequence = ?')
      .bind(signingKey, streamId, sequence)
      .first<{ id: string; sequence: number; registered_at: string }>();
    return row ? { sequence: Number(row.sequence), commitment_hash: row.id, registered_at: row.registered_at } : null;
  }

  async listStream(signingKey: string, streamId: string) {
    const { results } = await this.db
      .prepare('SELECT id, sequence, registered_at FROM commitments WHERE signing_key = ? AND stream_id = ? ORDER BY sequence ASC')
      .bind(signingKey, streamId)
      .all<{ id: string; sequence: number; registered_at: string }>();
    return results.map((r) => ({ sequence: Number(r.sequence), commitment_hash: r.id, registered_at: r.registered_at }));
  }

  async getCommitment(id: string): Promise<{ commitment: any; registered_at: string } | null> {
    const row = await this.db
      .prepare('SELECT body, registered_at FROM commitments WHERE id = ?')
      .bind(id)
      .first<{ body: string; registered_at: string }>();
    if (!row) return null;
    return {
      commitment: JSON.parse(row.body),
      registered_at: row.registered_at,
    };
  }

  // ── Selections ──

  async putSelection(commitmentHash: string, selection: any, beaconRound: number): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO selections (commitment_hash, beacon_round, body, computed_at) VALUES (?, ?, ?, ?)')
      .bind(commitmentHash, beaconRound, JSON.stringify(selection), new Date().toISOString())
      .run();
  }

  async getSelection(commitmentHash: string): Promise<any> {
    const row = await this.db
      .prepare('SELECT body FROM selections WHERE commitment_hash = ?')
      .bind(commitmentHash)
      .first<{ body: string }>();
    return row ? JSON.parse(row.body) : null;
  }

  // ── Reveals ──

  async putReveal(id: string, commitmentHash: string, reveal: any, registeredAt: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO reveals (id, commitment_hash, body, registered_at) VALUES (?, ?, ?, ?)')
      .bind(id, commitmentHash, JSON.stringify(reveal), registeredAt)
      .run();
  }

  async getReveals(commitmentHash: string): Promise<any[]> {
    const { results } = await this.db
      .prepare('SELECT body, registered_at FROM reveals WHERE commitment_hash = ?')
      .bind(commitmentHash)
      .all<{ body: string; registered_at: string }>();
    return results.map((r) => ({ ...JSON.parse(r.body), registered_at: r.registered_at }));
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey: string, since: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM commitments WHERE signing_key = ? AND registered_at >= ?')
      .bind(signingKey, since)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async getSignerActivity(signingKey: string): Promise<{ commitments_past_hour: number; commitments_past_month: number }> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

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
      commitments_past_hour: Number((results[0].results[0] as any)?.count ?? 0),
      commitments_past_month: Number((results[1].results[0] as any)?.count ?? 0),
    };
  }

  // ── Beacon cache ──

  async getCachedBeacon(beaconType: string, round: number): Promise<any> {
    const row = await this.db
      .prepare('SELECT body FROM beacon_cache WHERE beacon_type = ? AND round_number = ?')
      .bind(beaconType, round)
      .first<{ body: string }>();
    return row ? JSON.parse(row.body) : null;
  }

  async cacheBeacon(beaconType: string, round: number, output: any): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO beacon_cache (beacon_type, round_number, body, fetched_at) VALUES (?, ?, ?, ?)')
      .bind(beaconType, round, JSON.stringify(output), new Date().toISOString())
      .run();
  }

  // ── Retention ──

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM commitments WHERE registered_at < ?')
      .bind(cutoff.toISOString())
      .run();
    return result.meta.changes;
  }
}
