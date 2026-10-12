/**
 * Kysely-based storage adapter — dialect-agnostic.
 * Works with both SQLite and Postgres via Kysely's query builder.
 *
 * All methods are async (returns Promises).
 */

import type { Kysely } from 'kysely';
import type { Database } from './types.js';

// SQLite returns JSON and timestamp columns as text. node-postgres parses JSONB
// into objects and TIMESTAMPTZ into Date before the row reaches us, so both
// shapes must be accepted.
function parseJson(val: unknown): any {
  return typeof val === 'string' ? JSON.parse(val) : val;
}
function toIsoString(val: unknown): string {
  return val instanceof Date ? val.toISOString() : (val as string);
}

/**
 * Stream columns of a commitment. Only a 0.5.0 commitment signs its stream
 * name, so only those take part in the (signing_key, stream_id, sequence)
 * uniqueness; a 0.2.0 commitment's unsigned stream_id is stored in the body only.
 */
export function streamColumns(commitment: Record<string, unknown>): { stream_id: string | null; sequence: number | null } {
  if (commitment.spec_version === '0.5.0' && typeof commitment.stream_id === 'string' && Number.isInteger(commitment.sequence)) {
    return { stream_id: commitment.stream_id, sequence: commitment.sequence as number };
  }
  return { stream_id: null, sequence: null };
}

export class KyselyStorage {
  db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  // ── Server identity ──

  async getServerIdentity() {
    const row = await this.db
      .selectFrom('server_identity')
      .select('value')
      .where('key', '=', 'keypair')
      .executeTakeFirst();
    return row ? parseJson(row.value) : null;
  }

  async setServerIdentity(keypair: { did_key: string; private_key_hex: string; public_key_hex: string }) {
    await this.db
      .insertInto('server_identity')
      .values({ key: 'keypair', value: JSON.stringify(keypair) })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(keypair) }))
      .execute();
  }

  // ── Commitments ──

  async putCommitment(id: string, commitment: { signing_key: string; [key: string]: unknown }, registeredAt: string) {
    const { stream_id, sequence } = streamColumns(commitment);
    await this.db
      .insertInto('commitments')
      .values({
        id,
        signing_key: commitment.signing_key,
        body: JSON.stringify(commitment),
        registered_at: registeredAt,
        stream_id,
        sequence,
      })
      .execute();
  }

  // ── Streams (spec v0.5 7.4, 12.2, 12.9) ──

  async findStreamCommitment(signingKey: string, streamId: string, sequence: number) {
    const row = await this.db
      .selectFrom('commitments')
      .select(['id', 'sequence', 'registered_at'])
      .where('signing_key', '=', signingKey)
      .where('stream_id', '=', streamId)
      .where('sequence', '=', sequence)
      .executeTakeFirst();
    if (!row) return null;
    return { sequence: Number(row.sequence), commitment_hash: row.id, registered_at: toIsoString(row.registered_at) };
  }

  async listStream(signingKey: string, streamId: string) {
    const rows = await this.db
      .selectFrom('commitments')
      .select(['id', 'sequence', 'registered_at'])
      .where('signing_key', '=', signingKey)
      .where('stream_id', '=', streamId)
      .orderBy('sequence', 'asc')
      .execute();
    return rows.map((r) => ({ sequence: Number(r.sequence), commitment_hash: r.id, registered_at: toIsoString(r.registered_at) }));
  }

  async getCommitment(id: string) {
    const row = await this.db
      .selectFrom('commitments')
      .select(['body', 'registered_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      commitment: parseJson(row.body),
      registered_at: toIsoString(row.registered_at),
    };
  }

  // ── Selections ──

  async putSelection(commitmentHash: string, selection: unknown, beaconRound: number) {
    await this.db
      .insertInto('selections')
      .values({
        commitment_hash: commitmentHash,
        beacon_round: beaconRound,
        body: JSON.stringify(selection),
        computed_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column('commitment_hash').doUpdateSet({
          beacon_round: beaconRound,
          body: JSON.stringify(selection),
          computed_at: new Date().toISOString(),
        })
      )
      .execute();
  }

  async getSelection(commitmentHash: string) {
    const row = await this.db
      .selectFrom('selections')
      .select('body')
      .where('commitment_hash', '=', commitmentHash)
      .executeTakeFirst();
    return row ? parseJson(row.body) : null;
  }

  // ── Reveals ──

  async putReveal(id: string, commitmentHash: string, reveal: unknown, registeredAt: string) {
    await this.db
      .insertInto('reveals')
      .values({
        id,
        commitment_hash: commitmentHash,
        body: JSON.stringify(reveal),
        registered_at: registeredAt,
      })
      .execute();
  }

  async getReveals(commitmentHash: string) {
    const rows = await this.db
      .selectFrom('reveals')
      .select(['body', 'registered_at'])
      .where('commitment_hash', '=', commitmentHash)
      .execute();
    return rows.map((r) => ({ ...parseJson(r.body), registered_at: toIsoString(r.registered_at) }));
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey: string, since: string) {
    const result = await this.db
      .selectFrom('commitments')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('signing_key', '=', signingKey)
      .where('registered_at', '>=', since)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async getSignerActivity(signingKey: string) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const [pastHour, pastMonth] = await Promise.all([
      this.countCommitmentsByKey(signingKey, oneHourAgo),
      this.countCommitmentsByKey(signingKey, thirtyDaysAgo),
    ]);

    return {
      commitments_past_hour: pastHour,
      commitments_past_month: pastMonth,
    };
  }

  // ── Beacon cache ──

  async getCachedBeacon(beaconType: string, round: number) {
    const row = await this.db
      .selectFrom('beacon_cache')
      .select('body')
      .where('beacon_type', '=', beaconType)
      .where('round_number', '=', round)
      .executeTakeFirst();
    return row ? parseJson(row.body) : null;
  }

  async cacheBeacon(beaconType: string, round: number, output: unknown) {
    await this.db
      .insertInto('beacon_cache')
      .values({
        beacon_type: beaconType,
        round_number: round,
        body: JSON.stringify(output),
        fetched_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(['beacon_type', 'round_number']).doUpdateSet({
          body: JSON.stringify(output),
          fetched_at: new Date().toISOString(),
        })
      )
      .execute();
  }

  // ── Retention ──

  async deleteOlderThan(cutoff: Date) {
    const cutoffStr = cutoff.toISOString();
    const result = await this.db
      .deleteFrom('commitments')
      .where('registered_at', '<', cutoffStr)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async close() {
    await this.db.destroy();
  }
}
