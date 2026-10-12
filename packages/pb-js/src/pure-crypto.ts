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
  // Clamp like the Rust core: p >= 1 is u64::MAX (2^64 does not fit in a u64).
  if (p >= 1) return '18446744073709551615';
  if (!(p > 0)) return '0';
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

// ════════════════════════════════════════════════════════════════════════
// Object format 0.5.0 (Spec v0.5). Written from the specification text, not
// from the Rust code, so that the differential tests compare two readings.
// ════════════════════════════════════════════════════════════════════════

export const SPEC_VERSION_V5 = '0.5.0';
export const PPM = 1_000_000n;
const TWO_64 = 1n << 64n;

const TAG_ITEM = Buffer.from('NoCherry/0.5/item', 'ascii');
const TAG_SALT = Buffer.from('NoCherry/0.5/salt', 'ascii');
const TAG_PER_ITEM = Buffer.from('NoCherry/0.5/per-item', 'ascii');
const TAG_BATCH_SEED = Buffer.from('NoCherry/0.5/batch-seed', 'ascii');

const HEX64 = /^[0-9a-f]{64}$/;

function bytes32(hex: string, what: string): Buffer {
  if (!HEX64.test(hex)) throw new Error(`${what} must be 64 lowercase hex characters`);
  return Buffer.from(hex, 'hex');
}

/** Beacon randomness is 32 bytes of hex; case does not matter (it is not signed). */
function randomnessBytes(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('beacon randomness must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

const STREAM_ID = /^[A-Za-z0-9._-]{1,128}$/;

function be64(x: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(x);
  return b;
}

// ── Item commitments (Section 5) ──

/** `SHA-256(TAG_ITEM || salt || item_hash)`. */
export function itemCommitment(saltHex: string, itemHashHex: string): string {
  return createHash('sha256')
    .update(TAG_ITEM).update(bytes32(saltHex, 'salt')).update(bytes32(itemHashHex, 'item hash'))
    .digest('hex');
}

/** Recommended salt derivation `HMAC-SHA256(item_secret, TAG_SALT || item_hash)`. */
export function deriveItemSalt(itemSecretHex: string, itemHashHex: string): string {
  return createHmac('sha256', bytes32(itemSecretHex, 'item secret'))
    .update(TAG_SALT).update(bytes32(itemHashHex, 'item hash'))
    .digest('hex');
}

// ── Threshold and count (Sections 8.3, 8.4) ──

function checkPpm(ppm: number): bigint {
  if (!Number.isInteger(ppm) || ppm < 1 || ppm > 1_000_000) {
    throw new Error(`reveal_probability_ppm must be an integer in [1, 1000000], got ${ppm}`);
  }
  return BigInt(ppm);
}

/** `floor(ppm * 2^64 / 10^6)` as a decimal string; equals 2^64 for ppm = 10^6. */
export function thresholdPpm(ppm: number): string {
  return ((checkPpm(ppm) * TWO_64) / PPM).toString();
}

/** `ceil(ppm * n / 10^6)`. */
export function batchCount(ppm: number, n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`item count must be a non-negative integer, got ${n}`);
  return Number((checkPpm(ppm) * BigInt(n) + PPM - 1n) / PPM);
}

/** `2^64 - (2^64 mod range)` as a decimal string. */
export function rejectionLimit(range: number | bigint): string {
  const r = BigInt(range);
  if (r < 1n) throw new Error('range must be positive');
  return (TWO_64 - (TWO_64 % r)).toString();
}

// ── Per-item selection (Section 8.3) ──

/** Decision value `be_uint64(HMAC-SHA256(R, TAG_PER_ITEM || hc || c))` as a decimal string. */
export function perItemValueV5(beaconRandomnessHex: string, commitmentHash: string, item: string): string {
  const mac = createHmac('sha256', randomnessBytes(beaconRandomnessHex))
    .update(TAG_PER_ITEM).update(bytes32(commitmentHash, 'commitment_hash')).update(bytes32(item, 'item'))
    .digest();
  return mac.readBigUInt64BE(0).toString();
}

export function selectPerItemV5(beaconRandomnessHex: string, commitmentHash: string, item: string, ppm: number): boolean {
  const threshold = BigInt(thresholdPpm(ppm));
  return BigInt(perItemValueV5(beaconRandomnessHex, commitmentHash, item)) < threshold;
}

// ── Batch selection (Section 8.4) ──

export function batchSeedV5(beaconRandomnessHex: string, commitmentHash: string): string {
  return createHmac('sha256', randomnessBytes(beaconRandomnessHex))
    .update(TAG_BATCH_SEED).update(bytes32(commitmentHash, 'commitment_hash'))
    .digest('hex');
}

function drawV5(seed: Buffer, counter: bigint): bigint {
  return createHmac('sha256', seed).update(be64(counter)).digest().readBigUInt64BE(0);
}

export function selectBatchV5(items: string[], beaconRandomnessHex: string, commitmentHash: string, count: number): string[] {
  if (count > items.length) throw new Error(`count (${count}) exceeds items length (${items.length})`);
  const seed = Buffer.from(batchSeedV5(beaconRandomnessHex, commitmentHash), 'hex');
  const pool = [...items];
  let counter = 0n;
  for (let i = 0; i < count; i++) {
    const range = BigInt(pool.length - i);
    const limit = TWO_64 - (TWO_64 % range);
    let v: bigint;
    do {
      v = drawV5(seed, counter);
      counter += 1n;
    } while (v >= limit);
    const j = i + Number(v % range);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Selection in the commitment's signed mode. */
export function selectV5(mode: string, beaconRandomnessHex: string, commitmentHash: string, items: string[], ppm: number): string[] {
  if (mode === 'per_item') return items.filter((c) => selectPerItemV5(beaconRandomnessHex, commitmentHash, c, ppm));
  if (mode === 'batch') return selectBatchV5(items, beaconRandomnessHex, commitmentHash, batchCount(ppm, items.length));
  throw new Error(`unknown selection_mode: ${mode}`);
}

// ── Canonical metadata (Section 7.3) ──

const MAX_METADATA_BYTES = 4096;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** JSON string per Section 4; a lone surrogate is not valid input (JSON.stringify would escape it). */
function jsonString(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new Error('string contains a lone surrogate');
  return JSON.stringify(s);
}

function canonicalValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') return jsonString(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || Object.is(v, -0)) throw new Error(`metadata number ${v} is not an integer`);
    if (Math.abs(v) > Number.MAX_SAFE_INTEGER) throw new Error(`metadata integer ${v} exceeds 2^53 - 1`);
    return String(v);
  }
  if (typeof v === 'bigint') {
    if (v > MAX_SAFE || v < -MAX_SAFE) throw new Error(`metadata integer ${v} exceeds 2^53 - 1`);
    return v.toString();
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalValue).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // Sort by code point: compare code point arrays, not UTF-16 code units.
    const keys = Object.keys(obj).sort((a, b) => {
      const ca = Array.from(a), cb = Array.from(b);
      for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
        const d = ca[i].codePointAt(0)! - cb[i].codePointAt(0)!;
        if (d !== 0) return d;
      }
      return ca.length - cb.length;
    });
    return '{' + keys.map((k) => jsonString(k) + ':' + canonicalValue(obj[k])).join(',') + '}';
  }
  throw new Error(`metadata value of type ${typeof v} is not allowed`);
}

export function canonicalMetadata(metadata: unknown): string {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('metadata must be a JSON object');
  }
  const out = canonicalValue(metadata);
  const bytes = Buffer.byteLength(out, 'utf8');
  if (bytes > MAX_METADATA_BYTES) throw new Error(`metadata canonical form is ${bytes} bytes, limit ${MAX_METADATA_BYTES}`);
  return out;
}

// ── Commitment signing payload (Section 7.2) ──

export interface SigningFieldsV5 {
  spec_version: string;
  items: string[];
  item_count: number;
  reveal_probability_ppm: number;
  selection_mode: string;
  beacon: { type: string; anchor_round: number; chain_hash: string };
  stream_id?: string | null;
  sequence?: number | null;
  metadata: unknown;
  committed_at: string;
  signing_key: string;
  identity?: string | null;
}

export function commitmentSigningPayloadV5(c: SigningFieldsV5): string {
  const present = (v: unknown) => v !== undefined && v !== null;
  if (c.spec_version !== SPEC_VERSION_V5) throw new Error(`spec_version must be ${SPEC_VERSION_V5}`);
  if (!Number.isSafeInteger(c.beacon.anchor_round) || c.beacon.anchor_round < 1) throw new Error('beacon.anchor_round is required');
  const fields = [
    `"spec_version":${JSON.stringify(c.spec_version)}`,
    `"items":[${c.items.map((i) => JSON.stringify(i)).join(',')}]`,
    `"item_count":${c.item_count}`,
    `"reveal_probability_ppm":${Number(checkPpm(c.reveal_probability_ppm))}`,
    `"selection_mode":${JSON.stringify(c.selection_mode)}`,
    `"beacon":{"type":${JSON.stringify(c.beacon.type)},"anchor_round":${c.beacon.anchor_round},"chain_hash":${JSON.stringify(c.beacon.chain_hash)}}`,
  ];
  if (present(c.stream_id)) {
    if (!STREAM_ID.test(c.stream_id!)) throw new Error('stream_id must be 1 to 128 characters from [A-Za-z0-9._-]');
    fields.push(`"stream_id":${JSON.stringify(c.stream_id)}`);
  }
  if (present(c.sequence)) {
    if (!Number.isSafeInteger(c.sequence) || c.sequence! < 0) throw new Error('sequence must be a non-negative safe integer');
    fields.push(`"sequence":${c.sequence}`);
  }
  fields.push(`"metadata":${canonicalMetadata(c.metadata)}`);
  fields.push(`"committed_at":${JSON.stringify(c.committed_at)}`);
  fields.push(`"signing_key":${JSON.stringify(c.signing_key)}`);
  if (present(c.identity)) fields.push(`"identity":${JSON.stringify(c.identity)}`);
  return `{${fields.join(',')}}`;
}

// ── Reveal signing payload (Section 10.4) ──

export interface OpeningV5 { item: string; salt: string; hash: string }

export interface RevealFieldsV5 {
  spec_version: string;
  commitment_hash: string;
  selected_items: string[];
  voluntary_items: string[];
  openings: OpeningV5[];
  revealed_at: string;
  signing_key: string;
}

export function revealSigningPayloadV5(r: RevealFieldsV5): string {
  if (r.spec_version !== SPEC_VERSION_V5) throw new Error(`spec_version must be ${SPEC_VERSION_V5}`);
  const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(',')}]`;
  const openings = r.openings.map((o) =>
    `{"item":${JSON.stringify(o.item)},"salt":${JSON.stringify(o.salt)},"hash":${JSON.stringify(o.hash)}}`).join(',');
  return `{"spec_version":${JSON.stringify(r.spec_version)},"commitment_hash":${JSON.stringify(r.commitment_hash)},` +
    `"selected_items":${list(r.selected_items)},"voluntary_items":${list(r.voluntary_items)},"openings":[${openings}],` +
    `"revealed_at":${JSON.stringify(r.revealed_at)},"signing_key":${JSON.stringify(r.signing_key)}}`;
}

/** Each revealed item has an opening, in order, that recomputes to it. */
export function verifyOpeningsV5(r: RevealFieldsV5): void {
  const revealed = [...r.selected_items, ...r.voluntary_items];
  if (new Set(revealed).size !== revealed.length) throw new Error('an item is listed twice in the reveal');
  if (r.openings.length !== revealed.length) throw new Error(`${r.openings.length} openings for ${revealed.length} revealed items`);
  r.openings.forEach((o, i) => {
    if (o.item !== revealed[i]) throw new Error(`opening for ${o.item} is out of order, expected ${revealed[i]}`);
    if (itemCommitment(o.salt, o.hash) !== o.item) throw new Error(`opening does not match item commitment ${o.item}`);
  });
}
