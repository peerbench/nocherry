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
 * Registration rule for an anchored commitment.
 * Returns `{ ok: true, selection_round }` or `{ ok: false, code, message }`.
 */
export function checkAnchorRegistration(anchor_round: bigint, registered_at_ms: bigint): any;

export function createCommitment(params_json: string, private_key_hex: string): any;

export function drandNextRoundAfter(unix_time: bigint): bigint;

export function drandRoundTime(round: bigint): bigint;

export function drandTimeToRound(unix_time: bigint): bigint;

export function encodeDIDKey(public_key_hex: string): string;

export function generateKeypair(): any;

export function hashBytes(data: Uint8Array): string;

export function hashManifest(manifest_json: string): string;

export function prngNext(seed_hex: string, index: bigint): any;

export function selectBatch(items_json: string, beacon_randomness_hex: string, count: number): any;

export function selectPerItem(beacon_randomness_hex: string, commitment_hash: string, item_hash: string, reveal_probability: number): boolean;

export function signMessage(private_key_hex: string, message: Uint8Array): string;

export function threshold(p: number): string;

export function verifyCommitment(commitment_json: string): boolean;

/**
 * Verifier checks for a server receipt (`{ commitment, registered_at, selection }`).
 * Returns `[]` when the commitment has no `anchor_round` or the receipt has
 * no selection yet, otherwise the `anchor_selection_round` and
 * `anchor_registration_time` checks as `{ name, status, detail? }`.
 */
export function verifyReceiptAnchor(receipt_json: string): any;

export function verifySignature(did_key: string, message: Uint8Array, signature_hex: string): boolean;
