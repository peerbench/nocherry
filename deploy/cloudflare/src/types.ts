/**
 * Cloudflare-specific type definitions.
 * Core types (Config, Keypair, StorageInterface) live in src/core/types.ts.
 */

import type { Config, StorageInterface } from './core/types.ts'

export type { Config, Keypair } from './core/types.ts'

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
    storage: StorageInterface;
    config: Config;
  };
};
