/**
 * Server configuration.
 *
 * Standalone server: call `loadConfigFromEnv()` at boot.
 * Embedded consumer (e.g. pbfed sub-app mount): build a `PbNodeConfig`
 * inline and pass to `createApp()` directly — no env-var dependency.
 */

import type { Config } from '../../../src/core/types.ts';
import { BASE_CONFIG } from '../../../src/core/config.ts';

export interface PbNodeConfig extends Config {
  port: number;
  dbPath: string;
}

export function loadConfigFromEnv(): PbNodeConfig {
  return {
    ...BASE_CONFIG,
    port: parseInt(process.env.PORT || '7420', 10),
    dbPath: process.env.DB_PATH || ':memory:',
    retention: process.env.RETENTION || '30d',
    operator: process.env.OPERATOR || 'Local Development',
    verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
  };
}
