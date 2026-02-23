/**
 * Shared type definitions for the Supabase Edge Function.
 */

import type { KyselyStorage } from "./storage/postgres.ts";

// Hono env — middleware-injected variables (no CF-style Bindings in Supabase)
export type AppEnv = {
  Variables: {
    storage: KyselyStorage;
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
