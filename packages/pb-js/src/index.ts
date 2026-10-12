/**
 * Commit-Reveal SDK — JS convenience wrapper over pb-wasm.
 *
 * Re-exports all WASM functions with JS-friendly signatures
 * and adds higher-level helpers (multi-server submit, etc).
 */

import * as wasm from '@nocherry/pb-wasm';

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
export const anchoredSelectionRound = wasm.anchoredSelectionRound;
export const checkAnchorRegistration = wasm.checkAnchorRegistration;

// Object format 0.5.0 (spec v0.5)
export const itemCommitment = wasm.itemCommitment;
export const deriveItemSalt = wasm.deriveItemSalt;
export const generateItemSecret = wasm.generateItemSecret;
export const commitItems = wasm.commitItems;
export const canonicalMetadata = wasm.canonicalMetadata;
export const thresholdPpm = wasm.thresholdPpm;
export const batchCount = wasm.batchCount;
export const selectPerItemV5 = wasm.selectPerItemV5;
export const selectBatchV5 = wasm.selectBatchV5;
export const computeSelectionRecord = wasm.computeSelectionRecord;
export const createReveal = wasm.createReveal;
export const validateCommitment = wasm.validateCommitment;
export const verifyRevealObject = wasm.verifyRevealObject;
export const commitmentSigningPayload = wasm.commitmentSigningPayload;
export const revealSigningPayload = wasm.revealSigningPayload;
export const supportedSpecVersions = wasm.supportedSpecVersions;
export {
  FORMAT_LEGACY, FORMAT_V5, FORMATS, DEFAULT_FORMAT, SECRET_FILE,
  parseFormat, probabilityToPpm, planCommitment, planReveal, manifestKey, describeProbability,
} from './format.js';
export type { Format, CommitOptions, CommitPlan, RevealInput, ManifestEntry } from './format.js';

/**
 * Hash a string (UTF-8 encoded).
 */
export function hashString(s: string): string {
  return wasm.hashBytes(new TextEncoder().encode(s));
}

// Offline receipt verification
export { verifyReceipt, verifyReveal } from './receipt.js';
export type { ReceiptCheck, ReceiptVerification, RevealVerification } from './receipt.js';

// Anchored selection round: create, submit with retry, verify receipts
export {
  ANCHOR_SELECTION_DELAY,
  ANCHOR_ERROR_CODES,
  fetchCurrentDrandRound,
  clockDrandRound,
  createAnchoredCommitment,
  reanchorCommitment,
  hasAnchor,
  anchorIsFresh,
  isAnchorRejection,
  submitCommitment,
  verifyReceiptAnchor,
} from './anchor.js';
export type {
  AnchorOptions,
  CurrentRoundOptions,
  SubmitTarget,
  SubmitResult,
  SubmitOutcome,
  SubmitOptions,
  ReceiptAnchorCheck,
} from './anchor.js';

// Server registry
export { loadRegistry, getServers, resolveServer } from './registry.js';
