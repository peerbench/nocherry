/**
 * Beacon fetching — reactive (on-demand) with caching.
 * Currently supports drand quicknet.
 */

import * as wasm from 'pb-wasm';

const DRAND_QUICKNET_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const DRAND_RELAYS = [
  `https://api.drand.sh/${DRAND_QUICKNET_CHAIN}/public`,
  `https://drand.cloudflare.com/${DRAND_QUICKNET_CHAIN}/public`,
];

/**
 * Fetch a drand round from a relay. Tries each relay in order.
 */
async function fetchDrandRound(round) {
  let lastErr;
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
        type: 'drand',
        chain_hash: DRAND_QUICKNET_CHAIN,
        round: data.round,
        randomness: data.randomness,
        signature: data.signature,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All drand relays failed');
}

/**
 * Get the beacon output for a commitment.
 * Computes the needed round, checks cache, fetches if needed.
 * Will retry for up to `maxWaitMs` if the round hasn't been emitted yet.
 */
export async function getBeaconOutput(storage, beacon, registeredAt, maxWaitMs = 15000) {
  if (beacon.type !== 'drand') {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  // Compute the first round after registered_at
  const regUnix = Math.floor(new Date(registeredAt).getTime() / 1000);
  const neededRound = Number(wasm.drandNextRoundAfter(BigInt(regUnix)));

  // Check cache
  const cached = await storage.getCachedBeacon('drand', neededRound);
  if (cached) return cached;

  // Fetch with retry
  const deadline = Date.now() + maxWaitMs;
  let delay = 500;
  while (true) {
    try {
      const output = await fetchDrandRound(neededRound);
      await storage.cacheBeacon('drand', neededRound, output);
      return output;
    } catch (e) {
      if (Date.now() + delay > deadline) {
        throw new Error(`Beacon round ${neededRound} not available: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
  }
}

/**
 * Get the most recent beacon round at a given timestamp (the "arrival" beacon).
 * This is the round whose randomness was already public when the event occurred.
 */
export async function getArrivalBeacon(storage, beacon, timestamp) {
  if (beacon.type !== 'drand') {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const tsUnix = Math.floor(new Date(timestamp).getTime() / 1000);
  const nextRound = Number(wasm.drandNextRoundAfter(BigInt(tsUnix)));
  const currentRound = nextRound - 1;

  if (currentRound < 1) return null;

  // Check cache
  const cached = await storage.getCachedBeacon('drand', currentRound);
  if (cached) return cached;

  // This round is in the past, so it should be immediately available
  try {
    const output = await fetchDrandRound(currentRound);
    await storage.cacheBeacon('drand', currentRound, output);
    return output;
  } catch {
    return null; // Non-critical — don't fail the request
  }
}

/**
 * Compute selection for a commitment given a beacon output.
 */
export function computeSelection(commitment, beaconOutput) {
  const items = commitment.items;
  const randomness = beaconOutput.randomness;
  const commitHash = commitment.commitment_hash;
  const p = commitment.reveal_probability;
  const itemCount = items.length;

  let selectedItems;
  let selectionMode;

  if (itemCount > 20) {
    // Batch selection via Fisher-Yates
    const count = Math.ceil(p * itemCount);
    selectedItems = wasm.selectBatch(JSON.stringify(items), randomness, count);
    selectionMode = 'batch';
  } else {
    // Per-item selection
    selectedItems = items.filter(itemHash =>
      wasm.selectPerItem(randomness, commitHash, itemHash, p)
    );
    selectionMode = 'per_item';
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
