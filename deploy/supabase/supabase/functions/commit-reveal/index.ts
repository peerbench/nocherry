/**
 * Supabase Edge Function entry point.
 *
 * Top-level await:
 *   1. Initialize WASM module and register with core
 *   2. Connect to Postgres via SUPABASE_DB_URL
 *   3. Initialize/load server signing key
 *   4. Start Deno.serve with Hono app
 */

import * as wasmExports from "./wasm/mod.ts";
import { initWasm } from "./wasm/mod.ts";
import { registerWasm } from "@core/wasm-registry.ts";
import { createPostgresStorage } from "./storage/postgres.ts";
import { initServerKey } from "@core/signing.ts";
import { createApp } from "./app.ts";

// 1. Init WASM and register with core
await initWasm();
registerWasm(wasmExports as any);

// 2. Connect to Postgres
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL environment variable is required");
}
const storage = createPostgresStorage(dbUrl);

// 3. Init server key
await initServerKey(storage);

// 4. Create app and serve
const app = createApp(storage);

Deno.serve(app.fetch);
