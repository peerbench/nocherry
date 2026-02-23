/**
 * Worker configuration — reads from Worker env bindings (c.env).
 */

import type { Config, WorkerEnv } from './types';

export function getConfig(env: WorkerEnv): Config {
  return {
    retention: env.RETENTION || '30d',
    operator: env.OPERATOR || 'Commit-Reveal',
    beaconTypes: ['drand'],
    specVersion: '0.2.0',
    version: '0.2.0',
    batchThreshold: 1,
    activityWindows: ['1h', '30d'],
    verifyRevealData: (env.VERIFY_REVEAL_DATA || 'true') !== 'false',
  };
}
