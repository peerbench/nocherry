/**
 * Deno WASM loader for pb-wasm.
 *
 * This module loads the WASM binary and re-exports all functions
 * with the same interface as the Node.js CJS build.
 *
 * The WASM binary is inlined as base64 in pb_wasm_bg.ts so that
 * Supabase Edge Functions can bundle it (they don't upload raw .wasm files).
 *
 * The WASM artifacts (pb_wasm_bg.wasm, pb_wasm.js) are copied here
 * by setup.sh after building with `wasm-pack --target web`.
 */

// @ts-types="./pb_wasm.d.ts"
import init, * as wasmExports from "./pb_wasm.js";
import { WASM_BASE64 } from "./pb_wasm_bg.ts";

let initialized = false;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Initialize the WASM module. Must be called once before using exports.
 */
export async function initWasm(): Promise<void> {
  if (initialized) return;

  const wasmBytes = base64ToBytes(WASM_BASE64);
  await init({ module_or_path: wasmBytes });
  initialized = true;
}

// Re-export all WASM functions
export const anchorClockSkewAllowanceMs = wasmExports.anchorClockSkewAllowanceMs;
export const anchorSelectionDelay = wasmExports.anchorSelectionDelay;
export const anchorSelectionSafetyMarginMs = wasmExports.anchorSelectionSafetyMarginMs;
export const anchoredSelectionRound = wasmExports.anchoredSelectionRound;
export const checkAnchorRegistration = wasmExports.checkAnchorRegistration;
export const createCommitment = wasmExports.createCommitment;
export const drandNextRoundAfter = wasmExports.drandNextRoundAfter;
export const drandRoundTime = wasmExports.drandRoundTime;
export const drandTimeToRound = wasmExports.drandTimeToRound;
export const encodeDIDKey = wasmExports.encodeDIDKey;
export const generateKeypair = wasmExports.generateKeypair;
export const hashBytes = wasmExports.hashBytes;
export const hashManifest = wasmExports.hashManifest;
export const prngNext = wasmExports.prngNext;
export const selectBatch = wasmExports.selectBatch;
export const selectPerItem = wasmExports.selectPerItem;
export const signMessage = wasmExports.signMessage;
export const threshold = wasmExports.threshold;
export const verifyCommitment = wasmExports.verifyCommitment;
export const verifyReceiptAnchor = wasmExports.verifyReceiptAnchor;
export const verifySignature = wasmExports.verifySignature;
