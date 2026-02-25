/**
 * Server configuration — loaded from Deno environment or defaults.
 */

import type { Config } from "@core/types.ts";
import { BASE_CONFIG } from "@core/config.ts";

export function getConfig(): Config {
  return {
    ...BASE_CONFIG,
    retention: Deno.env.get("RETENTION") || "30d",
    operator: Deno.env.get("OPERATOR") || "Supabase Edge",
    verifyRevealData: Deno.env.get("VERIFY_REVEAL_DATA") !== "false",
  };
}
