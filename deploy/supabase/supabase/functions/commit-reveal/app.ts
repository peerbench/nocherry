/**
 * Hono app factory for the commit-reveal Edge Function.
 * Injects storage and config into every request context.
 */

import { Hono } from "npm:hono@^4.6.0";
import type { AppEnv } from "./types.ts";
import type { KyselyStorage } from "./storage/postgres.ts";
import { getConfig } from "./config.ts";

import serverInfoRoute from "./routes/server-info.ts";
import commitmentsRoute from "./routes/commitments.ts";
import revealsRoute from "./routes/reveals.ts";

/**
 * Create a Hono app with the given storage backend.
 * Server key must already be initialized before calling this.
 */
export function createApp(storage: KyselyStorage) {
  const app = new Hono<AppEnv>({ strict: false }).basePath("/commit-reveal");

  // Inject storage and config into every request context
  app.use("*", async (c, next) => {
    c.set("storage", storage);
    c.set("config", getConfig());
    await next();
  });

  // Health check
  app.get("/health", (c) => {
    const config = c.get("config");
    return c.json({ status: "ok", version: config.version });
  });

  // Routes
  app.route("/v1/server-info", serverInfoRoute);
  app.route("/v1/commitments", commitmentsRoute);
  app.route("/v1/commitments", revealsRoute);

  // 404 fallback
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Error handler
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
