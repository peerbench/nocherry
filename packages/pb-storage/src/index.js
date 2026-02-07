/**
 * pb-storage — shared storage layer for the commit-reveal protocol.
 *
 * Uses Kysely for dialect-agnostic query building.
 * Supports SQLite (via better-sqlite3) and Postgres (via pg).
 */

export { KyselyStorage } from './storage.js';
