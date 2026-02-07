/**
 * Server configuration — loaded from Deno environment or defaults.
 */

export const config = {
  retention: Deno.env.get("RETENTION") || "30d",
  operator: Deno.env.get("OPERATOR") || "Supabase Edge",
  beaconTypes: ["drand"],
  specVersion: "0.2.0",
  version: "0.2.0",
  batchThreshold: 20,
  activityWindows: ["1h", "30d"],
  verifyRevealData: Deno.env.get("VERIFY_REVEAL_DATA") !== "false",
};
