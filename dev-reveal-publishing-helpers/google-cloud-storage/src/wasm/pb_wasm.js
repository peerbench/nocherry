import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wasm = require('./pb_wasm.cjs');

export const {
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
  verifySignature,
} = wasm;
