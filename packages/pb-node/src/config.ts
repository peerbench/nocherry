/**
 * Server configuration — loaded from environment or defaults.
 */

interface Config {
  port: number;
  dbPath: string;
  retention: string;
  operator: string;
  beaconTypes: string[];
  specVersion: string;
  version: string;
  batchThreshold: number;
  activityWindows: string[];
  verifyRevealData: boolean;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '7420', 10),
  dbPath: process.env.DB_PATH || ':memory:',
  retention: process.env.RETENTION || '30d',
  operator: process.env.OPERATOR || 'Local Development',
  beaconTypes: ['drand'],
  specVersion: '0.2.0',
  version: '0.2.0',
  batchThreshold: 1,
  activityWindows: ['1h', '30d'],
  verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
};
