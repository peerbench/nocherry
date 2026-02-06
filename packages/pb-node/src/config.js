/**
 * Server configuration — loaded from environment or defaults.
 */

export const config = {
  port: parseInt(process.env.PORT || '7420', 10),
  dbPath: process.env.DB_PATH || ':memory:',
  retention: process.env.RETENTION || '30d',
  operator: process.env.OPERATOR || 'Local Development',
  beaconTypes: ['drand'],
  specVersion: '0.2.0',
  batchThreshold: 20,
  activityWindows: ['1h', '30d'],
};
