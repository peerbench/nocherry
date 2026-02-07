/**
 * Kysely-based storage adapter — dialect-agnostic.
 * Works with both SQLite and Postgres via Kysely's query builder.
 *
 * All methods are async (returns Promises).
 */

export class KyselyStorage {
  /** @param {import('kysely').Kysely<import('./types.js').Database>} db */
  constructor(db) {
    this.db = db;
  }

  // ── Server identity ──

  async getServerIdentity() {
    const row = await this.db
      .selectFrom('server_identity')
      .select('value')
      .where('key', '=', 'keypair')
      .executeTakeFirst();
    return row ? JSON.parse(row.value) : null;
  }

  async setServerIdentity(keypair) {
    await this.db
      .insertInto('server_identity')
      .values({ key: 'keypair', value: JSON.stringify(keypair) })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(keypair) }))
      .execute();
  }

  // ── Commitments ──

  async putCommitment(id, commitment, registeredAt) {
    await this.db
      .insertInto('commitments')
      .values({
        id,
        signing_key: commitment.signing_key,
        body: JSON.stringify(commitment),
        registered_at: registeredAt,
      })
      .execute();
  }

  async getCommitment(id) {
    const row = await this.db
      .selectFrom('commitments')
      .select(['body', 'registered_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      commitment: JSON.parse(row.body),
      registered_at: row.registered_at,
    };
  }

  // ── Selections ──

  async putSelection(commitmentHash, selection, beaconRound) {
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

  async getSelection(commitmentHash) {
    const row = await this.db
      .selectFrom('selections')
      .select('body')
      .where('commitment_hash', '=', commitmentHash)
      .executeTakeFirst();
    return row ? JSON.parse(row.body) : null;
  }

  // ── Reveals ──

  async putReveal(id, commitmentHash, reveal, registeredAt) {
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

  async getReveals(commitmentHash) {
    const rows = await this.db
      .selectFrom('reveals')
      .select(['body', 'registered_at'])
      .where('commitment_hash', '=', commitmentHash)
      .execute();
    return rows.map((r) => ({ ...JSON.parse(r.body), registered_at: r.registered_at }));
  }

  // ── Mirrors ──

  async putMirror(id, commitmentHash, mirror, serverRegisteredAt) {
    await this.db
      .insertInto('mirrors')
      .values({
        id,
        commitment_hash: commitmentHash,
        url: mirror.url,
        provider: mirror.provider,
        signing_key: mirror.signing_key,
        body: JSON.stringify(mirror),
        server_registered_at: serverRegisteredAt,
      })
      .execute();
  }

  async getMirrors(commitmentHash) {
    const rows = await this.db
      .selectFrom('mirrors')
      .select(['id', 'url', 'provider', 'signing_key', 'body', 'server_registered_at'])
      .where('commitment_hash', '=', commitmentHash)
      .execute();
    return rows.map((r) => ({
      mirror_id: r.id,
      url: r.url,
      provider: r.provider,
      signing_key: r.signing_key,
      registered_at: JSON.parse(r.body).registered_at,
      server_registered_at: r.server_registered_at,
    }));
  }

  async mirrorExists(commitmentHash, url) {
    const row = await this.db
      .selectFrom('mirrors')
      .select('id')
      .where('commitment_hash', '=', commitmentHash)
      .where('url', '=', url)
      .executeTakeFirst();
    return !!row;
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey, since) {
    const result = await this.db
      .selectFrom('commitments')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('signing_key', '=', signingKey)
      .where('registered_at', '>=', since)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async getSignerActivity(signingKey) {
    const now = new Date();
    const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

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

  async getCachedBeacon(beaconType, round) {
    const row = await this.db
      .selectFrom('beacon_cache')
      .select('body')
      .where('beacon_type', '=', beaconType)
      .where('round_number', '=', round)
      .executeTakeFirst();
    return row ? JSON.parse(row.body) : null;
  }

  async cacheBeacon(beaconType, round, output) {
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

  async deleteOlderThan(cutoff) {
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
