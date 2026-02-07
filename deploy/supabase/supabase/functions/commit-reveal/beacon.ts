/**
 * Beacon fetching — reactive (on-demand) with caching.
 * Currently supports drand quicknet.
 */

import * as wasm from "./wasm/mod.ts";
import type { KyselyStorage } from "./storage/postgres.ts";

const DRAND_QUICKNET_CHAIN =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const DRAND_RELAYS = [
  `https://api.drand.sh/${DRAND_QUICKNET_CHAIN}/public`,
  `https://drand.cloudflare.com/${DRAND_QUICKNET_CHAIN}/public`,
];

interface BeaconOutput {
  type: string;
  chain_hash: string;
  round: number;
  randomness: string;
  signature: string;
  [key: string]: unknown;
}

/**
 * Fetch a drand round from a relay. Tries each relay in order.
 */
async function fetchDrandRound(round: number): Promise<BeaconOutput> {
  let lastErr: Error | undefined;
  for (const baseUrl of DRAND_RELAYS) {
    try {
      const url = `${baseUrl}/${round}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        lastErr = new Error(`drand relay ${resp.status}: ${resp.statusText}`);
        continue;
      }
      const data = await resp.json();
      return {
        type: "drand",
        chain_hash: DRAND_QUICKNET_CHAIN,
        round: data.round,
        randomness: data.randomness,
        signature: data.signature,
      };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr || new Error("All drand relays failed");
}

/**
 * Get the beacon output for a commitment.
 */
export async function getBeaconOutput(
  storage: KyselyStorage,
  beacon: { type: string },
  registeredAt: string,
  maxWaitMs = 15000,
): Promise<BeaconOutput> {
  if (beacon.type !== "drand") {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const regUnix = Math.floor(new Date(registeredAt).getTime() / 1000);
  const neededRound = Number(wasm.drandNextRoundAfter(BigInt(regUnix)));

  const cached = await storage.getCachedBeacon("drand", neededRound);
  if (cached) return cached as BeaconOutput;

  const deadline = Date.now() + maxWaitMs;
  let delay = 500;
  while (true) {
    try {
      const output = await fetchDrandRound(neededRound);
      await storage.cacheBeacon("drand", neededRound, output);
      return output;
    } catch (e) {
      if (Date.now() + delay > deadline) {
        throw new Error(
          `Beacon round ${neededRound} not available: ${(e as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
  }
}

/**
 * Get the most recent beacon round at a given timestamp (the "arrival" beacon).
 */
export async function getArrivalBeacon(
  storage: KyselyStorage,
  beacon: { type: string },
  timestamp: string,
): Promise<BeaconOutput | null> {
  if (beacon.type !== "drand") {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const tsUnix = Math.floor(new Date(timestamp).getTime() / 1000);
  const nextRound = Number(wasm.drandNextRoundAfter(BigInt(tsUnix)));
  const currentRound = nextRound - 1;

  if (currentRound < 1) return null;

  const cached = await storage.getCachedBeacon("drand", currentRound);
  if (cached) return cached as BeaconOutput;

  try {
    const output = await fetchDrandRound(currentRound);
    await storage.cacheBeacon("drand", currentRound, output);
    return output;
  } catch {
    return null;
  }
}

/**
 * Compute selection for a commitment given a beacon output.
 */
export function computeSelection(
  commitment: Record<string, unknown>,
  beaconOutput: BeaconOutput,
) {
  const items = commitment.items as string[];
  const randomness = beaconOutput.randomness;
  const commitHash = commitment.commitment_hash as string;
  const p = commitment.reveal_probability as number;
  const itemCount = items.length;

  let selectedItems: string[];
  let selectionMode: string;

  if (itemCount >= 20) {
    const count = Math.ceil(p * itemCount);
    selectedItems = wasm.selectBatch(
      JSON.stringify(items),
      randomness,
      count,
    );
    selectionMode = "batch";
  } else {
    selectedItems = items.filter((itemHash) =>
      wasm.selectPerItem(randomness, commitHash, itemHash, p)
    );
    selectionMode = "per_item";
  }

  return {
    commitment_hash: commitHash,
    beacon_output: beaconOutput,
    selection_mode: selectionMode,
    reveal_probability: p,
    selected_items: selectedItems,
    selected_count: selectedItems.length,
    total_count: itemCount,
    computed_at: new Date().toISOString(),
  };
}
