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
  /** 0.5.0 commitments in a stream; unique with signing_key and sequence. */
  stream_id: string | null;
  sequence: number | null;
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
  selections: SelectionsTable;
  reveals: RevealsTable;
  server_identity: ServerIdentityTable;
  beacon_cache: BeaconCacheTable;
}
