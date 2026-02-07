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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly createCommitment: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly drandNextRoundAfter: (a: bigint) => bigint;
    readonly drandRoundTime: (a: bigint) => bigint;
    readonly drandTimeToRound: (a: bigint) => bigint;
    readonly encodeDIDKey: (a: number, b: number) => [number, number, number, number];
    readonly generateKeypair: () => [number, number, number];
    readonly hashBytes: (a: number, b: number) => [number, number];
    readonly hashManifest: (a: number, b: number) => [number, number, number, number];
    readonly prngNext: (a: number, b: number, c: bigint) => [number, number, number];
    readonly selectBatch: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly selectPerItem: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly signMessage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly threshold: (a: number) => [number, number];
    readonly verifyCommitment: (a: number, b: number) => [number, number, number];
    readonly verifySignature: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
