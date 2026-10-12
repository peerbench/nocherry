/**
 * Kysely table type definitions for the commit-reveal schema.
 *
 * Tables:
 *   commitments   - submitted commitments
 *   selections    - beacon-based selection results
 *   reveals       - reveal submissions
 *   server_identity - server keypair storage
 *   beacon_cache  - cached beacon outputs
 */

import type { Generated } from 'kysely';

export interface CommitmentsTable {
  id: string;
  signing_key: string;
  body: string;
  registered_at: string;
  created_at: Generated<string>;
}

/**
 * One row per (signing_key, stream_id, sequence) of a 0.5.0 commitment
 * (spec v0.5 12.2). Not tied to the commitments row by a foreign key: the
 * row outlives the retention of the commitment body, so a name stays taken.
 */
export interface StreamIndexTable {
  signing_key: string;
  stream_id: string;
  sequence: number;
  commitment_hash: string;
  registered_at: string;
}

export interface SelectionsTable {
  commitment_hash: string;
  beacon_round: number;
  body: string;
  computed_at: string;
}

export interface RevealsTable {
  id: string;
  commitment_hash: string;
  body: string;
  registered_at: string;
}

export interface ServerIdentityTable {
  key: string;
  value: string;
}

export interface BeaconCacheTable {
  beacon_type: string;
  round_number: number;
  body: string;
  fetched_at: string;
}

export interface Database {
  commitments: CommitmentsTable;
  stream_index: StreamIndexTable;
  selections: SelectionsTable;
  reveals: RevealsTable;
  server_identity: ServerIdentityTable;
  beacon_cache: BeaconCacheTable;
}
