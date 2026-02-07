/**
 * GET /v1/server-info
 * Reads config from c.get('config') instead of module-level import.
 */

import { Hono } from 'hono';
import { getServerKey } from '../signing.js';

const route = new Hono();

route.get('/', (c) => {
  const config = c.get('config');
  return c.json({
    operator: config.operator,
    server_key: getServerKey(),
    retention: config.retention,
    signer_activity_windows: config.activityWindows,
    beacon_types: config.beaconTypes,
    spec_version: config.specVersion,
  });
});

export default route;
