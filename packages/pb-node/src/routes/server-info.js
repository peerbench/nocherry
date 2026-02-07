/**
 * GET /v1/server-info
 */

import { Hono } from 'hono';
import { config } from '../config.js';
import { getServerKey } from '../signing.js';

const route = new Hono();

route.get('/', (c) => {
  return c.json({
    operator: config.operator,
    server_key: getServerKey(),
    retention: config.retention,
    signer_activity_windows: config.activityWindows,
    beacon_types: config.beaconTypes,
    spec_version: config.specVersion,
    version: config.version,
  });
});

export default route;
