/**
 * Shared configuration defaults across all deployments.
 * Each deployment spreads these and adds platform-specific values.
 */

import type { Config } from './types.ts';

/** Base config values identical across all deployment targets. */
export const BASE_CONFIG: Pick<Config, 'beaconTypes' | 'specVersion' | 'version' | 'batchThreshold' | 'activityWindows'> = {
  beaconTypes: ['drand'],
  specVersion: '0.2.0',
  version: '0.2.0',
  batchThreshold: 1,
  activityWindows: ['1h', '30d'],
};
