/**
 * GET /v1/server-info
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.ts'
import { getServerKey } from '../signing.ts'
import { getWasm } from '../wasm-registry.ts'
import { PER_ITEM_SELECTION_THRESHOLD } from '../beacon.ts'
import { DEFAULT_MAX_ITEMS, MAX_METADATA_BYTES, SPEC_VERSIONS_ACCEPTED } from '../config.ts'

const route = new Hono<AppEnv>();

route.get('/', (c) => {
  const config = c.get('config');
  return c.json({
    operator: config.operator,
    server_key: getServerKey(),
    retention: config.retention,
    signer_activity_windows: config.activityWindows,
    beacon_types: config.beaconTypes,
    // Present on servers that honor beacon.anchor_round (spec 8.1.1).
    anchor_selection_delay: getWasm().anchorSelectionDelay(),
    // 0.2.0 only: commitments with more items than this use batch selection (spec v0.4 8.4).
    selection_threshold: PER_ITEM_SELECTION_THRESHOLD,
    // Object formats accepted by POST /v1/commitments (spec v0.5 12.1).
    spec_versions_accepted: SPEC_VERSIONS_ACCEPTED,
    max_items: config.maxItems ?? DEFAULT_MAX_ITEMS,
    max_metadata_bytes: MAX_METADATA_BYTES,
    spec_version: config.specVersion,
    version: config.version,
  });
});

export default route;
