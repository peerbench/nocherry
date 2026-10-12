/**
 * Shared configuration defaults across all deployments.
 * Each deployment spreads these and adds platform-specific values.
 */

import type { Config } from './types.ts';

/** Object formats every deployment accepts (spec v0.5 12.1). */
export const SPEC_VERSIONS_ACCEPTED = ['0.2.0', '0.5.0'] as const;

/** Largest item_count accepted unless the deployment sets `maxItems`. */
export const DEFAULT_MAX_ITEMS = 100_000;

/** Upper bound on canonical metadata, fixed by spec v0.5 7.3. */
export const MAX_METADATA_BYTES = 4096;

/** Base config values identical across all deployment targets. */
export const BASE_CONFIG: Pick<Config, 'beaconTypes' | 'specVersion' | 'version' | 'activityWindows'> = {
  beaconTypes: ['drand'],
  specVersion: '0.2.0',
  version: '0.2.0',
  activityWindows: ['1h', '30d'],
};
