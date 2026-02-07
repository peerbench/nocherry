/**
 * Kysely table type definitions for the commit-reveal schema.
 *
 * These serve as documentation — actual type enforcement happens via JSDoc
 * in the storage class. The DB interface is used by Kysely for query building.
 *
 * Tables:
 *   commitments   - submitted commitments
 *   selections    - beacon-based selection results
 *   reveals       - reveal submissions
 *   server_identity - server keypair storage
 *   beacon_cache  - cached beacon outputs
 *
 * @typedef {{
 *   commitments: CommitmentsTable,
 *   selections: SelectionsTable,
 *   reveals: RevealsTable,
 *   mirrors: MirrorsTable,
 *   server_identity: ServerIdentityTable,
 *   beacon_cache: BeaconCacheTable,
 * }} Database
 *
 * @typedef {{
 *   id: string,
 *   signing_key: string,
 *   body: string,
 *   registered_at: string,
 *   created_at: string,
 * }} CommitmentsTable
 *
 * @typedef {{
 *   commitment_hash: string,
 *   beacon_round: number,
 *   body: string,
 *   computed_at: string,
 * }} SelectionsTable
 *
 * @typedef {{
 *   id: string,
 *   commitment_hash: string,
 *   body: string,
 *   registered_at: string,
 * }} RevealsTable
 *
 * @typedef {{
 *   key: string,
 *   value: string,
 * }} ServerIdentityTable
 *
 * @typedef {{
 *   beacon_type: string,
 *   round_number: number,
 *   body: string,
 *   fetched_at: string,
 * }} BeaconCacheTable
 *
 * @typedef {{
 *   id: string,
 *   commitment_hash: string,
 *   url: string,
 *   provider: string,
 *   signing_key: string,
 *   body: string,
 *   server_registered_at: string,
 * }} MirrorsTable
 */

export {};
