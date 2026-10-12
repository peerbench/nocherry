/**
 * GET /v1/server-info
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.ts'
import { getServerKey } from '../signing.ts'
import { getWasm } from '../wasm-registry.ts'
import { PER_ITEM_SELECTION_THRESHOLD } from '../beacon.ts'

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
    // Commitments with more items than this use batch selection (spec 8.4).
    selection_threshold: PER_ITEM_SELECTION_THRESHOLD,
    spec_version: config.specVersion,
    version: config.version,
  });
});

export default route;
