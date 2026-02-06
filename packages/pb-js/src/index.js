/**
 * @peerbench/sdk — JS convenience wrapper over pb-wasm.
 *
 * Re-exports all WASM functions with JS-friendly signatures
 * and adds higher-level helpers (multi-server submit, etc).
 */

import * as wasm from 'pb-wasm';

// Re-export core functions
export const hashBytes = wasm.hashBytes;
export const hashManifest = wasm.hashManifest;
export const generateKeypair = wasm.generateKeypair;
export const signMessage = wasm.signMessage;
export const verifySignature = wasm.verifySignature;
export const encodeDIDKey = wasm.encodeDIDKey;
export const prngNext = wasm.prngNext;
export const selectPerItem = wasm.selectPerItem;
export const selectBatch = wasm.selectBatch;
export const threshold = wasm.threshold;
export const createCommitment = wasm.createCommitment;
export const verifyCommitment = wasm.verifyCommitment;
export const drandRoundTime = wasm.drandRoundTime;
export const drandTimeToRound = wasm.drandTimeToRound;
export const drandNextRoundAfter = wasm.drandNextRoundAfter;

/**
 * Hash a string (UTF-8 encoded).
 */
export function hashString(s) {
  return wasm.hashBytes(new TextEncoder().encode(s));
}
