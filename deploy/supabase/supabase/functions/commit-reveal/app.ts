/**
 * Hono app factory for the commit-reveal Edge Function.
 */

import { Hono, type Context } from "npm:hono@^4.6.0";
import type { KyselyStorage } from "./storage/postgres.ts";

import serverInfoRoute from "./routes/server-info.ts";
import commitmentsRoute from "./routes/commitments.ts";
import revealsRoute from "./routes/reveals.ts";

/**
 * Create a Hono app with the given storage backend.
 * Server key must already be initialized before calling this.
 */
export function createApp(storage: KyselyStorage): Hono {
  const app = new Hono({ strict: false }).basePath("/commit-reveal");

  // Inject storage into every request context
  app.use("*", async (c: Context, next: () => Promise<void>) => {
    c.set("storage", storage);
    await next();
  });

  // Health check
  app.get("/health", (c: Context) => c.json({ status: "ok" }));

  // Routes
  app.route("/v1/server-info", serverInfoRoute);
  app.route("/v1/commitments", commitmentsRoute);
  app.route("/v1/commitments", revealsRoute);

  // 404 fallback
  app.notFound((c: Context) => c.json({ error: "Not found" }, 404));

  // Error handler
  app.onError((err: Error, c: Context) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
