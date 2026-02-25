/**
 * Server configuration for PGlite deployment.
 *
 * DATA_DIR controls where PGlite persists its Postgres data.
 * Set to a filesystem path (e.g. "./pgdata") for disk persistence,
 * or "memory://" for in-memory (no persistence across restarts).
 */

export const config = {
  port: parseInt(process.env.PORT || '7420', 10),
  dataDir: process.env.DATA_DIR || './pgdata',
  retention: process.env.RETENTION || '30d',
  operator: process.env.OPERATOR || 'Local Development (PGlite)',
  beaconTypes: ['drand'],
  specVersion: '0.2.0',
  version: '0.2.0',
  activityWindows: ['1h', '30d'],
  verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
};
