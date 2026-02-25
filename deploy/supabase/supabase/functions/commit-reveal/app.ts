/**
 * Hono app factory for the commit-reveal Edge Function.
 * Injects storage and config into every request context.
 */

import { Hono } from "hono";
import type { AppEnv, StorageInterface } from "@core/types.ts";
import { getConfig } from "./config.ts";
import { mountRoutes } from "@core/app.ts";

/**
 * Create a Hono app with the given storage backend.
 * Server key must already be initialized before calling this.
 */
export function createApp(storage: StorageInterface) {
  const app = new Hono<AppEnv>({ strict: false }).basePath("/commit-reveal");

  // Inject storage and config into every request context
  app.use("*", async (c, next) => {
    c.set("storage", storage);
    c.set("config", getConfig());
    await next();
  });

  return mountRoutes(app);
}
