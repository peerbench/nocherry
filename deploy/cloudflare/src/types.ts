/**
 * Shared type definitions for the Cloudflare worker.
 */

import type { D1Storage } from './storage/d1';

// Cloudflare Worker env bindings
export interface WorkerEnv {
  DB: D1Database;
  OPERATOR: string;
  RETENTION: string;
  VERIFY_REVEAL_DATA?: string;
}

// Hono env — bindings + middleware-injected variables
export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: {
    storage: D1Storage;
    config: Config;
  };
};

export interface Config {
  retention: string;
  operator: string;
  beaconTypes: string[];
  specVersion: string;
  version: string;
  batchThreshold: number;
  activityWindows: string[];
  verifyRevealData: boolean;
}

export interface Keypair {
  did_key: string;
  private_key_hex: string;
  public_key_hex: string;
}
