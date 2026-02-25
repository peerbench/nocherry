/**
 * Worker configuration — reads from Worker env bindings (c.env).
 */

import type { Config, WorkerEnv } from './types';
import { BASE_CONFIG } from './core/config.ts';

export function getConfig(env: WorkerEnv): Config {
  return {
    ...BASE_CONFIG,
    retention: env.RETENTION || '30d',
    operator: env.OPERATOR || 'Commit-Reveal',
    verifyRevealData: (env.VERIFY_REVEAL_DATA || 'true') !== 'false',
  };
}
