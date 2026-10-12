/* tslint:disable */
/* eslint-disable */

/**
 * `ANCHOR_CLOCK_SKEW_ALLOWANCE_MS`.
 */
export function anchorClockSkewAllowanceMs(): number;

/**
 * `ANCHOR_SELECTION_DELAY`: selection round = anchor_round + this value.
 */
export function anchorSelectionDelay(): number;

/**
 * `ANCHOR_SELECTION_SAFETY_MARGIN_MS`.
 */
export function anchorSelectionSafetyMarginMs(): number;

/**
 * Selection round for an anchored commitment.
 */
export function anchoredSelectionRound(anchor_round: bigint): bigint;

/**
 * `ceil(ppm * n / 10^6)`.
 */
export function batchCount(ppm: number, item_count: number): number;

/**
 * Canonical metadata serialization (Spec v0.5 Section 7.3), or an error.
 */
export function canonicalMetadata(metadata_json: string): string;

/**
 * Registration rule for an anchored commitment.
 * Returns `{ ok: true, selection_round }` or `{ ok: false, code, message }`.
 */
export function checkAnchorRegistration(anchor_round: bigint, registered_at_ms: bigint): any;

/**
 * Item commitments and salts for plain item hashes under one secret.
 * Returns `{ items: [...], salts: [...] }` in input order.
 */
export function commitItems(item_secret_hex: string, item_hashes_json: string): any;

/**
 * Canonical signing payload of a commitment in either format, as a string.
 */
export function commitmentSigningPayload(commitment_json: string): string;

/**
 * Selection record for a commitment of either format and a beacon output
 * (Spec v0.5 Section 8.5). Servers call this instead of choosing a mode.
 */
export function computeSelectionRecord(commitment_json: string, beacon_output_json: string, computed_at: string): any;

/**
 * Create a signed commitment. `params.spec_version` selects the format:
 * `"0.2.0"` (default) takes `reveal_probability` and an optional anchor;
 * `"0.5.0"` takes item commitments, `reveal_probability_ppm`,
 * `selection_mode`, `beacon.anchor_round` (required), and optional
 * `stream_id`, `sequence`, `metadata`, `identity`.
 */
export function createCommitment(params_json: string, private_key_hex: string): any;

/**
 * Create a signed reveal. `params.spec_version` selects the format; a 0.5.0
 * reveal takes `openings: [{ item, salt, hash }]` for every revealed item.
 */
export function createReveal(params_json: string, private_key_hex: string): any;

/**
 * Recommended salt derivation `HMAC-SHA256(item_secret, TAG_SALT || item_hash)`.
 */
export function deriveItemSalt(item_secret_hex: string, item_hash_hex: string): string;

export function drandNextRoundAfter(unix_time: bigint): bigint;

export function drandRoundTime(round: bigint): bigint;

export function drandTimeToRound(unix_time: bigint): bigint;

export function encodeDIDKey(public_key_hex: string): string;

/**
 * A fresh 32-byte item secret, hex.
 */
export function generateItemSecret(): string;

export function generateKeypair(): any;

export function hashBytes(data: Uint8Array): string;

export function hashManifest(manifest_json: string): string;

/**
 * `SHA-256(TAG_ITEM || salt || item_hash)`, hex in and out.
 */
export function itemCommitment(salt_hex: string, item_hash_hex: string): string;

export function prngNext(seed_hex: string, index: bigint): any;

/**
 * `2^64 - (2^64 mod range)` as a decimal string.
 */
export function rejectionLimit(range: bigint): string;

/**
 * Canonical signing payload of a reveal in either format, as a string.
 */
export function revealSigningPayload(reveal_json: string): string;

export function selectBatch(items_json: string, beacon_randomness_hex: string, count: number): any;

/**
 * 0.5.0 batch selection of `count` items with the commitment-bound seed.
 */
export function selectBatchV5(items_json: string, beacon_randomness_hex: string, commitment_hash: string, count: number): any;

export function selectPerItem(beacon_randomness_hex: string, commitment_hash: string, item_hash: string, reveal_probability: number): boolean;

/**
 * 0.5.0 per-item selection of one item commitment.
 */
export function selectPerItemV5(beacon_randomness_hex: string, commitment_hash: string, item: string, ppm: number): boolean;

export function signMessage(private_key_hex: string, message: Uint8Array): string;

/**
 * Object formats this build can verify.
 */
export function supportedSpecVersions(): any;

export function threshold(p: number): string;

/**
 * `floor(ppm * 2^64 / 10^6)` as a decimal string (it can be 2^64).
 */
export function thresholdPpm(ppm: number): string;

/**
 * Well-formedness of a 0.5.0 commitment (Spec v0.5 Section 7.5).
 * Returns `{ ok: true }` or `{ ok: false, error }`. Does not check the signature.
 */
export function validateCommitment(commitment_json: string): any;

export function verifyCommitment(commitment_json: string): boolean;

/**
 * Offline verification of a server receipt (`{ commitment, registered_at, selection }`):
 * commitment signature, beacon authenticity, selection round timing and the
 * recomputed selection (Spec Section 10.5, steps 1 to 3). Returns
 * `{ status, checks: [{ name, status, detail? }], ... }`.
 */
export function verifyReceipt(receipt_json: string): any;

/**
 * Verifier checks for a server receipt (`{ commitment, registered_at, selection }`).
 * Returns `[]` when the commitment has no `anchor_round` or the receipt has
 * no selection yet, otherwise the `anchor_selection_round` and
 * `anchor_registration_time` checks as `{ name, status, detail? }`.
 */
export function verifyReceiptAnchor(receipt_json: string): any;

/**
 * Offline verification of a receipt together with a reveal and the revealed
 * data (Spec Section 10.5, steps 1 to 6). `computed_hashes_json` is an object
 * mapping each revealed item hash to the hash the caller computed from the
 * data it holds; an item without an entry counts as missing data.
 */
export function verifyReveal(receipt_json: string, reveal_json: string, computed_hashes_json: string): any;

/**
 * Signature and, for 0.5.0, structure and openings of a reveal.
 * Returns `{ ok: true }` or `{ ok: false, error }`.
 */
export function verifyRevealObject(reveal_json: string): any;

export function verifySignature(did_key: string, message: Uint8Array, signature_hex: string): boolean;
