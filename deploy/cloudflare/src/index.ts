/**
 * Cloudflare Worker entry point.
 * Registers the platform-specific WASM module before creating the Hono app.
 */

import { registerWasm } from './core/wasm-registry.ts'
import * as wasm from './wasm/pb_wasm.js'
import { createApp } from './app';

registerWasm(wasm as any);

const app = createApp();

export default {
  fetch: app.fetch,
};
