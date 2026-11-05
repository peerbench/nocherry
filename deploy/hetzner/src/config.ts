/**
 * forest-box (Hetzner) configuration: Postgres instead of Firestore, so no GCP project
 * or Firestore database id. Everything else mirrors deploy/google-cloud/src/config.ts.
 */

import type { Config } from '../../../src/core/types.ts';
import { BASE_CONFIG } from '../../../src/core/config.ts';

export interface HetznerConfig extends Config {
  port: number;
  databaseUrl: string;
}

export function getConfig(): HetznerConfig {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  return {
    ...BASE_CONFIG,
    port: parseInt(process.env.PORT || '8080', 10),
    databaseUrl,
    retention: process.env.RETENTION || '30d',
    operator: process.env.OPERATOR || 'Commit-Reveal',
    verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
  };
}

export type { HetznerConfig };
