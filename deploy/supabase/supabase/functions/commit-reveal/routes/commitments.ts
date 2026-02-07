/**
 * Commitment routes:
 *   POST /v1/commitments
 *   GET  /v1/commitments/:hash
 *   GET  /v1/commitments/:hash/selection
 */

import { Hono, type Context } from "npm:hono@^4.6.0";
import * as wasm from "../wasm/mod.ts";
import {
  getBeaconOutput,
  getArrivalBeacon,
  computeSelection,
} from "../beacon.ts";
import { signResponse } from "../signing.ts";
import type { KyselyStorage } from "../storage/postgres.ts";

const route = new Hono();

/**
 * POST /v1/commitments — submit a new commitment.
 */
route.post("/", async (c: Context) => {
  const storage = c.get("storage") as KyselyStorage;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  // Validate required fields
  const required = [
    "spec_version",
    "commitment_hash",
    "items",
    "item_count",
    "reveal_probability",
    "beacon",
    "committed_at",
    "signing_key",
    "signature",
  ];
  for (const field of required) {
    if (body[field] === undefined) {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  // Validate items
  const items = body.items as unknown[];
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "items must be a non-empty array" }, 400);
  }
  if (items.length !== body.item_count) {
    return c.json({ error: "item_count does not match items.length" }, 400);
  }
  for (const item of items) {
    if (typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) {
      return c.json({ error: `Invalid item hash: ${item}` }, 400);
    }
  }
  if (new Set(items).size !== items.length) {
    return c.json({ error: "Duplicate items" }, 400);
  }

  // Validate reveal_probability
  const p = body.reveal_probability as number;
  if (typeof p !== "number" || p <= 0 || p > 1) {
    return c.json({ error: "reveal_probability must be in (0, 1]" }, 400);
  }

  // Verify user's signature
  try {
    const valid = wasm.verifyCommitment(JSON.stringify(body));
    if (!valid) {
      return c.json({ error: "Invalid commitment signature" }, 400);
    }
  } catch (e) {
    return c.json(
      { error: `Signature verification failed: ${(e as Error).message}` },
      400,
    );
  }

  // Check for duplicate
  const existing = await storage.getCommitment(
    body.commitment_hash as string,
  );
  if (existing) {
    return c.json({ error: "Commitment already exists" }, 409);
  }

  // Record server-side timestamp
  const registeredAt = new Date().toISOString();

  // Store commitment
  await storage.putCommitment(
    body.commitment_hash as string,
    body,
    registeredAt,
  );

  // Fetch arrival beacon
  let arrivalBeacon = null;
  try {
    arrivalBeacon = await getArrivalBeacon(
      storage,
      body.beacon as { type: string },
      registeredAt,
    );
  } catch {
    // Non-critical
  }

  // Fetch beacon and compute selection
  let selection = null;
  try {
    const beaconOutput = await getBeaconOutput(
      storage,
      body.beacon as { type: string },
      registeredAt,
    );
    selection = computeSelection(body, beaconOutput);
    await storage.putSelection(
      body.commitment_hash as string,
      selection,
      beaconOutput.round,
    );
  } catch {
    // Beacon fetch failed — still record the commitment
    selection = null;
  }

  // Get signer activity
  const signerActivity = await storage.getSignerActivity(
    body.signing_key as string,
  );

  // Build and sign the response
  const receipt = signResponse({
    commitment: body,
    commitment_hash: body.commitment_hash as string,
    registered_at: registeredAt,
    arrival_beacon: arrivalBeacon,
    selection,
    signer_activity: signerActivity,
  });

  return c.json(receipt, 201);
});

/**
 * GET /v1/commitments/:hash — retrieve a stored commitment receipt.
 */
route.get("/:hash", async (c: Context) => {
  const storage = c.get("storage") as KyselyStorage;
  const hash = c.req.param("hash");

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: "Commitment not found" }, 404);
  }

  const selection = await storage.getSelection(hash);
  const signerActivity = await storage.getSignerActivity(
    record.commitment.signing_key,
  );

  let arrivalBeacon = null;
  try {
    arrivalBeacon = await getArrivalBeacon(
      storage,
      record.commitment.beacon,
      record.registered_at,
    );
  } catch {
    // Non-critical
  }

  const receipt = signResponse({
    commitment: record.commitment,
    commitment_hash: hash,
    registered_at: record.registered_at,
    arrival_beacon: arrivalBeacon,
    selection,
    signer_activity: signerActivity,
  });

  return c.json(receipt);
});

/**
 * GET /v1/commitments/:hash/selection — get selection record.
 */
route.get("/:hash/selection", async (c: Context) => {
  const storage = c.get("storage") as KyselyStorage;
  const hash = c.req.param("hash");

  const record = await storage.getCommitment(hash);
  if (!record) {
    return c.json({ error: "Commitment not found" }, 404);
  }

  // Check cache first
  let selection = await storage.getSelection(hash);
  if (selection) {
    return c.json(signResponse(selection));
  }

  // Compute on demand
  try {
    const beaconOutput = await getBeaconOutput(
      storage,
      record.commitment.beacon,
      record.registered_at,
    );
    selection = computeSelection(record.commitment, beaconOutput);
    await storage.putSelection(hash, selection, beaconOutput.round);
    return c.json(signResponse(selection));
  } catch (e) {
    return c.json(
      { error: `Selection not available: ${(e as Error).message}` },
      503,
    );
  }
});

export default route;
