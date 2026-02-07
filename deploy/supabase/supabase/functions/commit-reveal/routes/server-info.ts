/**
 * GET /v1/server-info
 */

import { Hono, type Context } from "npm:hono@^4.6.0";
import { config } from "../config.ts";
import { getServerKey } from "../signing.ts";

const route = new Hono();

route.get("/", (c: Context) => {
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
