/* tslint:disable */
/* eslint-disable */

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

export function verifySignature(did_key: string, message: Uint8Array, signature_hex: string): boolean;
