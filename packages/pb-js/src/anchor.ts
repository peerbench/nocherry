/**
 * Client side of the anchored selection round (spec 8.1.1).
 *
 * A commitment names the current, already public drand round as
 * `beacon.anchor_round`. Every server then selects with round
 * `anchor_round + ANCHOR_SELECTION_DELAY`, so servers that register the
 * commitment on opposite sides of a drand tick still agree.
 *
 * The anchor is only valid for a few seconds: a server rejects the commitment
 * once the selection round is about to be published. Submission therefore
 * re-signs with a fresh anchor when needed and retries once.
 */

import * as wasm from '@nocherry/pb-wasm';

export const DRAND_QUICKNET_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const DRAND_RELAYS = ['https://api.drand.sh', 'https://drand.cloudflare.com'];

/** Selection round = anchor_round + ANCHOR_SELECTION_DELAY. */
export const ANCHOR_SELECTION_DELAY: number = wasm.anchorSelectionDelay();

/** `error_code` values a server returns when it refuses an anchor. */
export const ANCHOR_ERROR_CODES = [
  'anchor_round_invalid',
  'anchor_round_in_future',
  'anchor_selection_round_available',
] as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Commitment = Record<string, any>;

export interface CurrentRoundOptions {
  relays?: string[];
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Clock used for the fallback when no relay answers. */
  now?: () => number;
}

/** Current drand round derived from the local clock. */
export function clockDrandRound(nowMs: number = Date.now()): number {
  return Number(wasm.drandTimeToRound(BigInt(Math.floor(nowMs / 1000))));
}

/**
 * Current drand quicknet round to anchor to: the later of the relay's latest
 * published round and the round the local clock says is current.
 *
 * Relays serve a round about a second after its scheduled time and are at
 * times one or two rounds behind, which shortens or kills the registration
 * window (measured 2026-10-12: the relay's latest round was the current one in
 * about 60 percent of fetches). The server checks the anchor against the
 * beacon schedule, not against a fetched output, so a round whose scheduled
 * time has passed is a valid anchor even before a relay serves it. The relay
 * still protects a client whose clock runs slow. Falls back to the clock alone
 * when no relay answers.
 */
export async function fetchCurrentDrandRound(opts: CurrentRoundOptions = {}): Promise<number> {
  const doFetch = opts.fetch ?? fetch;
  const fromClock = clockDrandRound(opts.now?.());
  for (const relay of opts.relays ?? DRAND_RELAYS) {
    try {
      const res = await doFetch(`${relay.replace(/\/$/, '')}/${DRAND_QUICKNET_CHAIN_HASH}/public/latest`, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
      if (!res.ok) continue;
      const round = ((await res.json()) as { round?: unknown }).round;
      if (typeof round === 'number' && Number.isSafeInteger(round) && round >= 1) return Math.max(round, fromClock);
    } catch {
      // try the next relay
    }
  }
  return fromClock;
}

export interface AnchorOptions {
  /** Set `beacon.anchor_round` (default true). Pass false for a commitment without an anchor. */
  anchor?: boolean;
  /** Source of the current round. Defaults to `fetchCurrentDrandRound`. */
  currentRound?: () => Promise<number>;
}

/**
 * Create a signed commitment. For drand commitments `beacon.anchor_round` is
 * set to the current round unless `opts.anchor` is false or the caller
 * already supplied one.
 */
export async function createAnchoredCommitment(
  params: Commitment,
  privateKeyHex: string,
  opts: AnchorOptions = {},
): Promise<Commitment> {
  const beacon = { ...(params.beacon ?? { type: 'drand', chain_hash: DRAND_QUICKNET_CHAIN_HASH }) };
  if (opts.anchor === false) {
    delete beacon.anchor_round;
  } else if (beacon.type === 'drand' && (beacon.anchor_round === undefined || beacon.anchor_round === null)) {
    beacon.anchor_round = await (opts.currentRound ?? fetchCurrentDrandRound)();
  }
  return wasm.createCommitment(JSON.stringify({ ...params, beacon }), privateKeyHex);
}

/** Re-sign a commitment over the same items with a fresh anchor round and `committed_at`. */
export async function reanchorCommitment(
  commitment: Commitment,
  privateKeyHex: string,
  opts: Pick<AnchorOptions, 'currentRound'> = {},
): Promise<Commitment> {
  const { anchor_round: _stale, ...beacon } = commitment.beacon;
  const params: Commitment = {
    items: commitment.items,
    reveal_probability: commitment.reveal_probability,
    beacon,
    committed_at: new Date().toISOString(),
  };
  for (const key of ['metadata', 'stream_id', 'identity']) {
    if (commitment[key] !== undefined && commitment[key] !== null) params[key] = commitment[key];
  }
  return createAnchoredCommitment(params, privateKeyHex, { anchor: true, currentRound: opts.currentRound });
}

export function hasAnchor(commitment: Commitment): boolean {
  return commitment?.beacon?.anchor_round !== undefined;
}

/** True if a server would still accept this anchor at `nowMs`, judged by the local clock. */
export function anchorIsFresh(commitment: Commitment, nowMs: number = Date.now()): boolean {
  const round = commitment?.beacon?.anchor_round;
  if (typeof round !== 'number' || !Number.isSafeInteger(round) || round < 1) return false;
  return wasm.checkAnchorRegistration(BigInt(round), BigInt(Math.floor(nowMs))).ok === true;
}

export interface SubmitTarget {
  name?: string | null;
  url: string;
}

export interface SubmitResult<S extends SubmitTarget = SubmitTarget> {
  server: S;
  /** HTTP status, or 0 when the request itself failed. */
  status: number;
  /** Parsed JSON body, or the raw text when it is not JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  error?: string;
}

export interface SubmitOutcome<S extends SubmitTarget = SubmitTarget> {
  /** The commitment that was actually sent last. Differs from the input after a re-anchor. */
  commitment: Commitment;
  results: SubmitResult<S>[];
  /** Number of times the commitment was re-signed with a fresh anchor. */
  reanchored: number;
}

export interface SubmitOptions {
  /**
   * Re-sign with a fresh anchor. Without it an anchored commitment is sent
   * as is and an anchor rejection is final.
   */
  reanchor?: (commitment: Commitment) => Promise<Commitment>;
  fetch?: FetchLike;
  now?: () => number;
}

/** True if a server refused the commitment because of its anchor round. */
export function isAnchorRejection(result: Pick<SubmitResult, 'status' | 'body'>): boolean {
  return result.status === 400
    && (ANCHOR_ERROR_CODES as readonly string[]).includes(result.body?.error_code);
}

async function postToAll<S extends SubmitTarget>(servers: S[], commitment: Commitment, doFetch: FetchLike): Promise<SubmitResult<S>[]> {
  return Promise.all(servers.map(async (server): Promise<SubmitResult<S>> => {
    try {
      const res = await doFetch(`${server.url.replace(/\/$/, '')}/v1/commitments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitment),
      });
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep text */ }
      return { server, status: res.status, body };
    } catch (e: unknown) {
      return { server, status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
    }
  }));
}

/**
 * Submit a commitment to all servers in parallel.
 *
 * With `opts.reanchor`, an anchored commitment is re-signed before sending
 * when its anchor is already stale by the local clock, and re-signed and
 * resent once more if the servers reject the anchor. The retry only happens
 * when no server accepted the commitment: once one server has registered it,
 * re-signing would create a different commitment.
 */
export async function submitCommitment<S extends SubmitTarget>(
  servers: S[],
  commitment: Commitment,
  opts: SubmitOptions = {},
): Promise<SubmitOutcome<S>> {
  const doFetch = opts.fetch ?? fetch;
  const canReanchor = opts.reanchor !== undefined && hasAnchor(commitment);
  let current = commitment;
  let reanchored = 0;

  if (canReanchor && !anchorIsFresh(current, opts.now?.())) {
    current = await opts.reanchor!(current);
    reanchored++;
  }

  let results = await postToAll(servers, current, doFetch);

  const accepted = results.some(r => r.status === 201 || r.status === 409);
  if (canReanchor && !accepted && results.some(isAnchorRejection)) {
    current = await opts.reanchor!(current);
    reanchored++;
    results = await postToAll(servers, current, doFetch);
  }

  return { commitment: current, results, reanchored };
}

export interface ReceiptAnchorCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

/**
 * Verifier checks for a server receipt of an anchored commitment:
 * the selection used round `anchor_round + 2`, and `registered_at` precedes
 * that round. Empty for commitments without an anchor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyReceiptAnchor(receipt: any): ReceiptAnchorCheck[] {
  return wasm.verifyReceiptAnchor(JSON.stringify(receipt));
}
