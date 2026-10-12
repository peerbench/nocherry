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

/** Commitments with more items than this use batch selection (spec 8.4). */
export const PER_ITEM_SELECTION_THRESHOLD = 1;

function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})+$/.test(hex)) throw new Error('not a hex string');
  return Uint8Array.from(hex.match(/.{2}/g)!, (b) => parseInt(b, 16));
}

/**
 * Cheap sanity check of a relay response: quicknet randomness is
 * SHA-256(signature). The BLS signature itself is checked by verifiers,
 * not by the server.
 */
function assertRandomnessMatchesSignature(randomness: unknown, signature: unknown): void {
  if (typeof randomness !== 'string' || typeof signature !== 'string') {
    throw new Error('drand relay response lacks randomness or signature');
  }
  if (getWasm().hashBytes(hexToBytes(signature)) !== randomness.toLowerCase()) {
    throw new Error('drand relay returned randomness that is not SHA-256(signature)');
  }
}

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
      if (data.round !== round) {
        lastErr = new Error(`drand relay returned round ${data.round}, want ${round}`);
        continue;
      }
      assertRandomnessMatchesSignature(data.randomness, data.signature);
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

export interface BeaconRef {
  type: string;
  anchor_round?: number;
}

export type AnchorCheck =
  | { ok: true; selection_round: number }
  | { ok: false; code: string; message: string };

/** True when the commitment's beacon reference carries an `anchor_round`. */
export function hasAnchorRound(beacon: BeaconRef): boolean {
  return beacon != null && typeof beacon === 'object' && beacon.anchor_round !== undefined;
}

/**
 * Registration rule for an anchored commitment (spec 8.1.1). The anchor round
 * must not be in the future, and the selection round (anchor_round + 2) must
 * not be available yet at `registeredAt`. A late commitment is rejected, never
 * selected with randomness that is already public.
 */
export function checkAnchor(beacon: BeaconRef, registeredAt: string): AnchorCheck {
  const anchorRound = beacon.anchor_round;
  if (typeof anchorRound !== 'number' || !Number.isSafeInteger(anchorRound) || anchorRound < 1) {
    return { ok: false, code: 'anchor_round_invalid', message: 'beacon.anchor_round must be a positive integer round number' };
  }
  if (beacon.type !== 'drand') {
    return { ok: false, code: 'anchor_round_invalid', message: `beacon.anchor_round is not supported for beacon type: ${beacon.type}` };
  }
  const registeredMs = new Date(registeredAt).getTime();
  return getWasm().checkAnchorRegistration(BigInt(anchorRound), BigInt(registeredMs));
}

/**
 * Beacon round used for selection: `anchor_round + 2` when the commitment
 * is anchored, otherwise the first round strictly after `registeredAt`.
 */
export function selectionRoundFor(beacon: BeaconRef, registeredAt: string): number {
  const wasm = getWasm();
  if (hasAnchorRound(beacon)) {
    return Number(wasm.anchoredSelectionRound(BigInt(beacon.anchor_round!)));
  }
  const regUnix = Math.floor(new Date(registeredAt).getTime() / 1000);
  return Number(wasm.drandNextRoundAfter(BigInt(regUnix)));
}

export async function getBeaconOutput(storage: StorageInterface, beacon: BeaconRef, registeredAt: string, maxWaitMs: number = 15000) {
  if (beacon.type !== 'drand') {
    throw new Error(`Unsupported beacon type: ${beacon.type}`);
  }

  const neededRound = selectionRoundFor(beacon, registeredAt);

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

  if (itemCount > PER_ITEM_SELECTION_THRESHOLD) {
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
