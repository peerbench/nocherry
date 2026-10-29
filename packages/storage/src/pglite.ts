/**
 * PGlite dialect factory for KyselyStorage.
 * Uses @electric-sql/pglite (WASM Postgres) under the hood.
 *
 * PGlite runs a full Postgres instance in-process via WebAssembly,
 * persisted to disk via Node.js filesystem or in-memory.
 */

import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely';
import { KyselyStorage } from './storage.js';
import type { Database } from './types.js';

export interface PGliteInstance {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows?: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

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
  commitment_hash TEXT PRIMARY KEY REFERENCES commitments(id) ON DELETE CASCADE,
  beacon_round INTEGER,
  body TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reveals (
  id TEXT PRIMARY KEY,
  commitment_hash TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS stream_index (
  signing_key TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  commitment_hash TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (signing_key, stream_id, sequence)
);
`;

class PGliteConnection implements DatabaseConnection {
  private pglite: PGliteInstance;

  constructor(pglite: PGliteInstance) {
    this.pglite = pglite;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.pglite.query<R>(
      compiledQuery.sql,
      compiledQuery.parameters,
    );
    return {
      rows: result.rows ?? [],
      numAffectedRows: BigInt(result.affectedRows ?? 0),
      numChangedRows: BigInt(result.affectedRows ?? 0),
    };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite does not support streaming queries');
  }
}

class PGliteDriver implements Driver {
  private pglite: PGliteInstance;

  constructor(pglite: PGliteInstance) {
    this.pglite = pglite;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.pglite);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'BEGIN', parameters: [], query: {} as any });
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'COMMIT', parameters: [], query: {} as any });
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'ROLLBACK', parameters: [], query: {} as any });
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    await this.pglite.close();
  }
}

class PGliteDialect implements Dialect {
  private pglite: PGliteInstance;

  constructor(pglite: PGliteInstance) {
    this.pglite = pglite;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new PGliteDriver(this.pglite);
  }

  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

/**
 * Create a KyselyStorage backed by PGlite.
 */
export async function createPgliteStorage(pgliteInstance: PGliteInstance): Promise<KyselyStorage> {
  await pgliteInstance.exec(SCHEMA_SQL);

  const db = new Kysely<Database>({
    dialect: new PGliteDialect(pgliteInstance),
  });

  return new KyselyStorage(db);
}
