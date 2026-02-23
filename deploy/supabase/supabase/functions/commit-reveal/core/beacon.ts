/**
 * Beacon fetching — reactive (on-demand) with caching.
 * Currently supports drand quicknet.
 */

import type { StorageInterface } from './types.ts'
import { getWasm } from './wasm-registry.ts'

const DRAND_QUICKNET_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const DRAND_RELAYS = [
  `https://api.drand.sh/${DRAND_QUICKNET_CHAIN}/public`,
  `https://drand.cloudflare.com/${DRAND_QUICKNET_CHAIN}/public`,
];

async function fetchDrandRound(round: number) {
  let lastErr: unknown;
  for (const baseUrl of DRAND_RELAYS) {
    try {
      const url = `${baseUrl}/${round}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        lastErr = new Error(`drand relay ${resp.status}: ${resp.statusText}`);
        continue;
      }
      const data: any = await resp.json();
      return {
        type: 'drand',
        chain_hash: DRAND_QUICKNET_CHAIN,
        round: data.round as number,
        randomness: data.randomness as string,
        signature: data.signature as string,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All drand relays failed');
}

export async function getBeaconOutput(storage: StorageInterface, beacon: { type: string }, registeredAt: string, maxWaitMs: number = 15000) {
  if (beacon.type !== 'drand') {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const wasm = getWasm();
  const regUnix = Math.floor(new Date(registeredAt).getTime() / 1000);
  const neededRound = Number(wasm.drandNextRoundAfter(BigInt(regUnix)));

  const cached = await storage.getCachedBeacon('drand', neededRound);
  if (cached) return cached;

  const deadline = Date.now() + maxWaitMs;
  let delay = 500;
  while (true) {
    try {
      const output = await fetchDrandRound(neededRound);
      await storage.cacheBeacon('drand', neededRound, output);
      return output;
    } catch (e: any) {
      if (Date.now() + delay > deadline) {
        throw new Error(`Beacon round ${neededRound} not available: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
  }
}

export async function getArrivalBeacon(storage: StorageInterface, beacon: { type: string }, timestamp: string) {
  if (beacon.type !== 'drand') {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const wasm = getWasm();
  const tsUnix = Math.floor(new Date(timestamp).getTime() / 1000);
  const nextRound = Number(wasm.drandNextRoundAfter(BigInt(tsUnix)));
  const currentRound = nextRound - 1;

  if (currentRound < 1) return null;

  const cached = await storage.getCachedBeacon('drand', currentRound);
  if (cached) return cached;

  try {
    const output = await fetchDrandRound(currentRound);
    await storage.cacheBeacon('drand', currentRound, output);
    return output;
  } catch {
    return null;
  }
}

export function computeSelection(commitment: any, beaconOutput: any) {
  const wasm = getWasm();
  const items: string[] = commitment.items;
  const randomness: string = beaconOutput.randomness;
  const commitHash: string = commitment.commitment_hash;
  const p: number = commitment.reveal_probability;
  const itemCount = items.length;

  let selectedItems: string[];
  let selectionMode: string;

  if (itemCount > 20) {
    const count = Math.ceil(p * itemCount);
    selectedItems = wasm.selectBatch(JSON.stringify(items), randomness, count);
    selectionMode = 'batch';
  } else {
    selectedItems = items.filter((itemHash: string) =>
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
