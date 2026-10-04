/**
 * Pure JavaScript implementation of the core cryptographic primitives.
 * Uses only Node.js built-in `crypto` module — no WASM, no native addons.
 *
 * This exists for:
 *   1. Performance comparison against the WASM (Rust) implementation
 *   2. Environments where WASM is not available
 *   3. Reference implementation for spec compliance
 */

import { createHash, createHmac } from 'node:crypto';

// ── Hashing ──

export function hashBytes(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashManifest(entries: { name: string; type: string; hash: string }[]): string {
  const canonical = '[' + entries.map(e =>
    `{"name":${JSON.stringify(e.name)},"type":${JSON.stringify(e.type)},"hash":${JSON.stringify(e.hash)}}`
  ).join(',') + ']';
  return createHash('sha256').update(canonical).digest('hex');
}

// ── PRNG ──

export function prngNext(seedHex: string, index: number): string {
  const seed = Buffer.from(seedHex, 'hex');
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(index));
  const mac = createHmac('sha256', seed).update(indexBuf).digest();
  return mac.readBigUInt64LE(0).toString();
}

// ── Threshold ──

export function threshold(p: number): string {
  const TWO_64 = 18446744073709551616n;
  const result = BigInt(Math.floor(p * Number(TWO_64)));
  return result.toString();
}

// ── Per-Item Selection ──

export function selectPerItem(beaconRandomnessHex: string, commitmentHash: string, itemHash: string, revealProbability: number): boolean {
  const key = Buffer.from(beaconRandomnessHex, 'hex');
  const msg = commitmentHash + itemHash;
  const mac = createHmac('sha256', key).update(msg).digest();
  const value = mac.readBigUInt64LE(0);
  const thresh = BigInt(threshold(revealProbability));
  return value < thresh;
}

// ── Batch Selection (Fisher-Yates) ──

export function selectBatch(items: string[], beaconRandomnessHex: string, count: number): string[] {
  if (count > items.length) {
    throw new Error(`count (${count}) exceeds items length (${items.length})`);
  }
  const pool = [...items];
  for (let i = 0; i < count; i++) {
    const range = BigInt(pool.length - i);
    const rng = BigInt(prngNext(beaconRandomnessHex, i));
    const j = i + Number(rng % range);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// ── Commitment Hash ──

export function computeCommitmentHash(signingPayload: string): string {
  return createHash('sha256').update(signingPayload).digest('hex');
}

// ── drand round/time ──

const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;

export function drandRoundTime(round: number): number {
  return DRAND_GENESIS + (Number(round) - 1) * DRAND_PERIOD;
}

export function drandTimeToRound(unixTime: number): number {
  return Math.floor((Number(unixTime) - DRAND_GENESIS) / DRAND_PERIOD) + 1;
}

export function drandNextRoundAfter(unixTime: number): number {
  const t = Number(unixTime);
  if (t < DRAND_GENESIS) return 1;
  const round = drandTimeToRound(t);
  const roundTime = drandRoundTime(round);
  return roundTime <= t ? round + 1 : round;
}

// ── Anchored selection round (spec 8.1.1) ──

/** Selection round = anchor_round + ANCHOR_SELECTION_DELAY. */
export const ANCHOR_SELECTION_DELAY = 2;
/** The selection round must lie at least this far after registered_at. */
export const ANCHOR_SELECTION_SAFETY_MARGIN_MS = 1000;
/** An anchor round may start at most this far after registered_at. */
export const ANCHOR_CLOCK_SKEW_ALLOWANCE_MS = 1000;

export type AnchorCheck =
  | { ok: true; selection_round: number }
  | { ok: false; code: string; message: string };

const ANCHOR_REJECTIONS = {
  anchor_round_invalid: 'beacon.anchor_round must be a positive integer round number',
  anchor_round_in_future: 'beacon.anchor_round has not been published yet',
  anchor_selection_round_available:
    'selection round (anchor_round + 2) is already available or too close; re-sign with a fresh anchor_round',
} as const;

function rejectAnchor(code: keyof typeof ANCHOR_REJECTIONS): AnchorCheck {
  return { ok: false, code, message: ANCHOR_REJECTIONS[code] };
}

function isUsableRound(round: unknown): round is number {
  return typeof round === 'number' && Number.isSafeInteger(round) && round >= 1
    && Number.isSafeInteger(round + ANCHOR_SELECTION_DELAY);
}

export function anchoredSelectionRound(anchorRound: number): number {
  if (!isUsableRound(anchorRound)) throw new Error(ANCHOR_REJECTIONS.anchor_round_invalid);
  return anchorRound + ANCHOR_SELECTION_DELAY;
}

/**
 * Registration rule for an anchored commitment: the anchor round is not in
 * the future and the selection round is not yet available at registeredAtMs.
 */
export function checkAnchorRegistration(anchorRound: number, registeredAtMs: number): AnchorCheck {
  if (!isUsableRound(anchorRound)) return rejectAnchor('anchor_round_invalid');
  const selectionRound = anchorRound + ANCHOR_SELECTION_DELAY;
  const anchorMs = drandRoundTime(anchorRound) * 1000;
  const selectionMs = drandRoundTime(selectionRound) * 1000;

  if (anchorMs > registeredAtMs + ANCHOR_CLOCK_SKEW_ALLOWANCE_MS) return rejectAnchor('anchor_round_in_future');
  if (selectionMs <= registeredAtMs + ANCHOR_SELECTION_SAFETY_MARGIN_MS) return rejectAnchor('anchor_selection_round_available');
  return { ok: true, selection_round: selectionRound };
}

// ── Commitment signing payload ──

/**
 * JSON number text for reveal_probability, matching the Rust core (ryu):
 * integers keep a trailing ".0", and exponent form starts below 1e-5.
 */
function formatProbability(p: number): string {
  if (!Number.isFinite(p)) throw new Error('reveal_probability must be finite');
  if (Number.isInteger(p)) return p.toFixed(1);
  const [mantissa, exp] = p.toExponential().split('e');
  const exponent = Number(exp);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const sign = negative ? '-' : '';
  const pointPos = exponent + 1; // digits before the decimal point
  if (pointPos > 0 && pointPos <= 16) {
    if (digits.length <= pointPos) return sign + digits.padEnd(pointPos, '0') + '.0';
    return sign + digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
  }
  if (pointPos <= 0 && pointPos > -5) return sign + '0.' + '0'.repeat(-pointPos) + digits;
  const fraction = digits.length > 1 ? '.' + digits.slice(1) : '';
  return sign + digits[0] + fraction + 'e' + exponent;
}

export interface BeaconRefLike {
  type: string;
  anchor_round?: number;
  chain_hash?: string;
  version?: string;
}

export interface SigningFields {
  spec_version: string;
  items: string[];
  item_count: number;
  reveal_probability: number;
  beacon: BeaconRefLike;
  committed_at: string;
  signing_key: string;
  identity?: string | null;
}

/**
 * Canonical signing payload of a commitment (spec 7.2). Optional fields
 * (beacon.anchor_round, beacon.chain_hash, beacon.version, identity) are
 * omitted when absent, never written as null.
 */
export function commitmentSigningPayload(c: SigningFields): string {
  const present = (v: unknown) => v !== undefined && v !== null;
  const beacon = [`"type":${JSON.stringify(c.beacon.type)}`];
  if (present(c.beacon.anchor_round)) {
    if (!Number.isSafeInteger(c.beacon.anchor_round) || c.beacon.anchor_round! < 0) {
      throw new Error('beacon.anchor_round must be a non-negative integer');
    }
    beacon.push(`"anchor_round":${c.beacon.anchor_round}`);
  }
  if (present(c.beacon.chain_hash)) beacon.push(`"chain_hash":${JSON.stringify(c.beacon.chain_hash)}`);
  if (present(c.beacon.version)) beacon.push(`"version":${JSON.stringify(c.beacon.version)}`);

  const fields = [
    `"spec_version":${JSON.stringify(c.spec_version)}`,
    `"items":[${c.items.map(i => JSON.stringify(i)).join(',')}]`,
    `"item_count":${c.item_count}`,
    `"reveal_probability":${formatProbability(c.reveal_probability)}`,
    `"beacon":{${beacon.join(',')}}`,
    `"committed_at":${JSON.stringify(c.committed_at)}`,
    `"signing_key":${JSON.stringify(c.signing_key)}`,
  ];
  if (present(c.identity)) fields.push(`"identity":${JSON.stringify(c.identity)}`);
  return `{${fields.join(',')}}`;
}

// ── Receipt anchor verification ──

export interface AnchorCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

/** Strict RFC 3339 timestamp to Unix milliseconds, or null. */
export function parseRfc3339Ms(s: string): number | null {
  const m = RFC3339.exec(s);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const millis = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  let offsetSecs = 0;
  if (m[8]) {
    const [oh, om] = [Number(m[9]), Number(m[10])];
    if (oh > 23 || om > 59) return null;
    offsetSecs = (oh * 3600 + om * 60) * (m[8] === '+' ? 1 : -1);
  }
  // Days since 1970-01-01 for a proleptic Gregorian date.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  return (days * 86400 + hour * 3600 + minute * 60 + second - offsetSecs) * 1000 + millis;
}

/**
 * Verifier checks for a server receipt ({ commitment, registered_at, selection }).
 * Returns [] when the commitment has no anchor_round or there is no selection
 * yet. Otherwise:
 *   anchor_selection_round   - selection used round anchor_round + 2
 *   anchor_registration_time - registered_at precedes that round's time
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyReceiptAnchor(receipt: any): AnchorCheckResult[] {
  const anchorRound = receipt?.commitment?.beacon?.anchor_round;
  const selection = receipt?.selection;
  if (anchorRound === undefined || anchorRound === null || selection === undefined || selection === null) return [];

  if (!isUsableRound(anchorRound)) {
    const detail = `anchor_round ${anchorRound} is not a usable round number`;
    return [
      { name: 'anchor_selection_round', status: 'fail', detail },
      { name: 'anchor_registration_time', status: 'fail', detail },
    ];
  }
  const expected = anchorRound + ANCHOR_SELECTION_DELAY;

  const rawRound = selection?.beacon_output?.round;
  const round = typeof rawRound === 'number' && Number.isSafeInteger(rawRound) && rawRound >= 0 ? rawRound : undefined;
  let roundCheck: AnchorCheckResult;
  if (round === expected) {
    roundCheck = { name: 'anchor_selection_round', status: 'pass' };
  } else if (round !== undefined) {
    roundCheck = {
      name: 'anchor_selection_round', status: 'fail',
      detail: `selection used beacon round ${round}, want anchor_round + ${ANCHOR_SELECTION_DELAY} = ${expected}`,
    };
  } else {
    roundCheck = {
      name: 'anchor_selection_round', status: 'fail',
      detail: `selection beacon output has no round, want ${expected}`,
    };
  }

  const registeredAt = receipt?.registered_at;
  let timeCheck: AnchorCheckResult;
  if (typeof registeredAt !== 'string') {
    timeCheck = { name: 'anchor_registration_time', status: 'skip', detail: 'registered_at not supplied' };
  } else {
    const registeredMs = parseRfc3339Ms(registeredAt);
    if (registeredMs === null) {
      timeCheck = { name: 'anchor_registration_time', status: 'fail', detail: `cannot parse registered_at: ${registeredAt}` };
    } else if (registeredMs < drandRoundTime(expected) * 1000) {
      timeCheck = { name: 'anchor_registration_time', status: 'pass' };
    } else {
      timeCheck = {
        name: 'anchor_registration_time', status: 'fail',
        detail: `registered_at ${registeredAt} does not precede selection round ${expected}`,
      };
    }
  }

  return [roundCheck, timeCheck];
}
