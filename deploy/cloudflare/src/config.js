/**
 * Worker configuration — reads from Worker env bindings (c.env).
 */

export function getConfig(env) {
  return {
    retention: env.RETENTION || '30d',
    operator: env.OPERATOR || 'PeerBench',
    beaconTypes: ['drand'],
    specVersion: '0.2.0',
    version: '0.2.0',
    batchThreshold: 20,
    activityWindows: ['1h', '30d'],
    verifyRevealData: (env.VERIFY_REVEAL_DATA || 'true') !== 'false',
  };
}
