/**
 * Receipt verification for reveal uploads.
 * Validates commitment signature, receipt structure, and file hash matching.
 */

import * as wasm from './wasm/pb_wasm.js';

/**
 * Verify an upload receipt and match file hashes.
 * @param {object} receipt - Full server receipt JSON
 * @param {Array<{name: string, hash: string}>} fileHashes - Hashed uploaded files
 * @returns {{ commitmentHash: string, signingKey: string }} Verified metadata
 * @throws {Error} On verification failure
 */
export function verifyUpload(receipt, fileHashes) {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('Invalid receipt: must be a JSON object');
  }

  const { commitment } = receipt;
  if (!commitment || typeof commitment !== 'object') {
    throw new Error('Invalid receipt: missing commitment');
  }

  if (!receipt.server_key || !receipt.server_signature) {
    throw new Error('Invalid receipt: missing server_key or server_signature');
  }

  // Verify commitment signature (Ed25519)
  const commitmentJson = JSON.stringify(commitment);
  const valid = wasm.verifyCommitment(commitmentJson);
  if (!valid) {
    throw new Error('Commitment signature verification failed');
  }

  // Extract commitment hash and items
  const commitmentHash = commitment.commitment_hash;
  if (!commitmentHash) {
    throw new Error('Invalid commitment: missing commitment_hash');
  }

  const committedItems = commitment.items;
  if (!Array.isArray(committedItems) || committedItems.length === 0) {
    throw new Error('Invalid commitment: missing or empty items');
  }

  // Build set of committed hashes for lookup
  const committedHashSet = new Set(committedItems.map(item => item.hash));

  // Verify each uploaded file hash is in the commitment
  for (const { name, hash } of fileHashes) {
    if (!committedHashSet.has(hash)) {
      throw new Error(`File "${name}" hash ${hash} not found in commitment items`);
    }
  }

  return {
    commitmentHash,
    signingKey: commitment.signing_key,
  };
}
