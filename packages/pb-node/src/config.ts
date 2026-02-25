/**
 * Server configuration — loaded from environment or defaults.
 */

import type { Config } from '../../../src/core/types.ts';
import { BASE_CONFIG } from '../../../src/core/config.ts';

interface PbNodeConfig extends Config {
  port: number;
  dbPath: string;
}

export const config: PbNodeConfig = {
  ...BASE_CONFIG,
  port: parseInt(process.env.PORT || '7420', 10),
  dbPath: process.env.DB_PATH || ':memory:',
  retention: process.env.RETENTION || '30d',
  operator: process.env.OPERATOR || 'Local Development',
  verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
};
