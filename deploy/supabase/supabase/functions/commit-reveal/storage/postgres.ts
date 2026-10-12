/**
 * Postgres storage adapter using Kysely.
 * Inlined from pb-storage for Deno Edge Function compatibility.
 *
 * All methods are async (returns Promises).
 */

import { Kysely, PostgresDialect } from "npm:kysely@^0.27.0";
import pg from "npm:pg@^8.13.0";
import type { Keypair } from "@core/types.ts";

interface Database {
  commitments: {
    id: string;
    signing_key: string;
    body: string;
    registered_at: string;
    created_at?: string;
  };
  stream_index: {
    signing_key: string;
    stream_id: string;
    sequence: number;
    commitment_hash: string;
    registered_at: string;
  };
  selections: {
    commitment_hash: string;
    beacon_round: number;
    body: string;
    computed_at: string;
  };
  reveals: {
    id: string;
    commitment_hash: string;
    body: string;
    registered_at: string;
  };
  server_identity: {
    key: string;
    value: string;
  };
  beacon_cache: {
    beacon_type: string;
    round_number: number;
    body: string;
    fetched_at: string;
  };
}

// Helper: pg returns JSONB as objects and TIMESTAMPTZ as Date.
// Normalize to match our internal expectations (plain objects, ISO strings).
function parseJson(val: unknown): Record<string, unknown> {
  if (typeof val === "string") return JSON.parse(val);
  return val as Record<string, unknown>;
}
function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return val as string;
}

export class KyselyStorage {
  private db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  // ── Server identity ──

  async getServerIdentity(): Promise<Keypair | null> {
    const row = await this.db
      .selectFrom("server_identity")
      .select("value")
      .where("key", "=", "keypair")
      .executeTakeFirst();
    return row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
  }

  async setServerIdentity(keypair: Keypair) {
    await this.db
      .insertInto("server_identity")
      .values({ key: "keypair", value: JSON.stringify(keypair) })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({ value: JSON.stringify(keypair) })
      )
      .execute();
  }

  // ── Commitments ──

  async putCommitment(
    id: string,
    commitment: Record<string, unknown>,
    registeredAt: string,
  ) {
    const row = {
      id,
      signing_key: commitment.signing_key as string,
      body: JSON.stringify(commitment),
      registered_at: registeredAt,
    };
    // Only a 0.5.0 commitment signs its stream name (spec v0.5 12.2). The
    // name is taken in the same transaction as the commitment is stored.
    const inStream = commitment.spec_version === "0.5.0" &&
      typeof commitment.stream_id === "string" && Number.isInteger(commitment.sequence);
    if (!inStream) {
      await this.db.insertInto("commitments").values(row).execute();
      return;
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto("commitments").values(row).execute();
      await trx.insertInto("stream_index").values({
        signing_key: commitment.signing_key as string,
        stream_id: commitment.stream_id as string,
        sequence: commitment.sequence as number,
        commitment_hash: id,
        registered_at: registeredAt,
      }).execute();
    });
  }

  // ── Streams (spec v0.5 12.2, 12.9) ──

  async findStreamCommitment(signingKey: string, streamId: string, sequence: number) {
    const row = await this.db
      .selectFrom("stream_index")
      .select(["commitment_hash", "sequence", "registered_at"])
      .where("signing_key", "=", signingKey)
      .where("stream_id", "=", streamId)
      .where("sequence", "=", sequence)
      .executeTakeFirst();
    if (!row) return null;
    return { sequence: Number(row.sequence), commitment_hash: row.commitment_hash, registered_at: toIsoString(row.registered_at) };
  }

  async listStream(signingKey: string, streamId: string) {
    const rows = await this.db
      .selectFrom("stream_index")
      .select(["commitment_hash", "sequence", "registered_at"])
      .where("signing_key", "=", signingKey)
      .where("stream_id", "=", streamId)
      .orderBy("sequence", "asc")
      .execute();
    return rows.map((r) => ({ sequence: Number(r.sequence), commitment_hash: r.commitment_hash, registered_at: toIsoString(r.registered_at) }));
  }

  async listStreams(signingKey: string) {
    const rows = await this.db
      .selectFrom("stream_index")
      .select((eb) => ["stream_id", eb.fn.countAll().as("commitments"), eb.fn.max("sequence").as("highest_sequence")])
      .where("signing_key", "=", signingKey)
      .groupBy("stream_id")
      .orderBy("stream_id", "asc")
      .execute();
    return rows.map((r) => ({ stream_id: r.stream_id, commitments: Number(r.commitments), highest_sequence: Number(r.highest_sequence) }));
  }

  async getCommitment(id: string) {
    const row = await this.db
      .selectFrom("commitments")
      .select(["body", "registered_at"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      commitment: parseJson(row.body),
      registered_at: toIsoString(row.registered_at),
    };
  }

  // ── Selections ──

  async putSelection(
    commitmentHash: string,
    selection: Record<string, unknown>,
    beaconRound: number,
  ) {
    await this.db
      .insertInto("selections")
      .values({
        commitment_hash: commitmentHash,
        beacon_round: beaconRound,
        body: JSON.stringify(selection),
        computed_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column("commitment_hash").doUpdateSet({
          beacon_round: beaconRound,
          body: JSON.stringify(selection),
          computed_at: new Date().toISOString(),
        })
      )
      .execute();
  }

  async getSelection(commitmentHash: string) {
    const row = await this.db
      .selectFrom("selections")
      .select("body")
      .where("commitment_hash", "=", commitmentHash)
      .executeTakeFirst();
    return row ? parseJson(row.body) : null;
  }

  // ── Reveals ──

  async putReveal(
    id: string,
    commitmentHash: string,
    reveal: Record<string, unknown>,
    registeredAt: string,
  ) {
    await this.db
      .insertInto("reveals")
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
      .selectFrom("reveals")
      .select(["body", "registered_at"])
      .where("commitment_hash", "=", commitmentHash)
      .execute();
    return rows.map((r) => ({
      ...parseJson(r.body),
      registered_at: toIsoString(r.registered_at),
    }));
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey: string, since: string) {
    const result = await this.db
      .selectFrom("commitments")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("signing_key", "=", signingKey)
      .where("registered_at", ">=", since)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async getSignerActivity(signingKey: string) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(
      now.getTime() - 30 * 24 * 3600 * 1000,
    ).toISOString();

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
      .selectFrom("beacon_cache")
      .select("body")
      .where("beacon_type", "=", beaconType)
      .where("round_number", "=", round)
      .executeTakeFirst();
    return row ? parseJson(row.body) : null;
  }

  async cacheBeacon(
    beaconType: string,
    round: number,
    output: Record<string, unknown>,
  ) {
    await this.db
      .insertInto("beacon_cache")
      .values({
        beacon_type: beaconType,
        round_number: round,
        body: JSON.stringify(output),
        fetched_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(["beacon_type", "round_number"]).doUpdateSet({
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
      .deleteFrom("commitments")
      .where("registered_at", "<", cutoffStr)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async close() {
    await this.db.destroy();
  }
}

/**
 * Create a KyselyStorage backed by Postgres.
 */
export function createPostgresStorage(
  connectionString: string,
): KyselyStorage {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return new KyselyStorage(db);
}
