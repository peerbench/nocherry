import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wasm = require('./pb_wasm.cjs');

export const {
  anchorClockSkewAllowanceMs,
  anchorSelectionDelay,
  anchorSelectionSafetyMarginMs,
  anchoredSelectionRound,
  checkAnchorRegistration,
  createCommitment,
  drandNextRoundAfter,
  drandRoundTime,
  drandTimeToRound,
  encodeDIDKey,
  generateKeypair,
  hashBytes,
  hashManifest,
  prngNext,
  selectBatch,
  selectPerItem,
  signMessage,
  threshold,
  verifyCommitment,
  verifyReceiptAnchor,
  verifySignature,
} = wasm;
