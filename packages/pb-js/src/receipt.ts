/**
 * Offline verification of server receipts (spec 10.5, steps 1 to 3).
 */

import * as wasm from '@nocherry/pb-wasm';

export interface ReceiptCheck {
  name: string;
  /** `skip`: could not be run, result is at most partial. `warn`: noted, result unchanged. */
  status: 'pass' | 'fail' | 'skip' | 'warn';
  detail?: string;
}

export interface ReceiptVerification {
  status: 'verified' | 'failed' | 'partial';
  checks: ReceiptCheck[];
}

/** The server signs the JSON of the receipt without `server_signature`, keys in receipt order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkServerSignature(receipt: any): ReceiptCheck {
  const name = 'server_signature';
  if (!receipt.server_key || !receipt.server_signature) {
    return { name, status: 'skip', detail: 'receipt carries no server signature' };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { server_signature, ...signed } = receipt;
  try {
    const payload = new TextEncoder().encode(JSON.stringify(signed));
    return wasm.verifySignature(receipt.server_key, payload, server_signature)
      ? { name, status: 'pass' }
      : { name, status: 'fail', detail: 'signature does not match the receipt' };
  } catch (e: unknown) {
    return { name, status: 'fail', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Verify a server receipt `{ commitment, registered_at, selection, ... }` without
 * contacting a server: commitment signature, drand beacon output (randomness and
 * BLS signature), selection round timing, recomputed selection, server signature.
 * A receipt without a selection, or with a check that could not be run, is
 * `partial`, never `verified`. A receipt that cannot be parsed is `failed`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyReceipt(receipt: any): ReceiptVerification {
  let core: ReceiptVerification;
  try {
    core = wasm.verifyReceipt(JSON.stringify(receipt));
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { status: 'failed', checks: [{ name: 'receipt_parse', status: 'fail', detail }] };
  }
  const checks: ReceiptCheck[] = [...core.checks];
  if (receipt.commitment_hash !== undefined && receipt.commitment_hash !== receipt.commitment?.commitment_hash) {
    checks.push({ name: 'receipt_commitment_hash', status: 'fail', detail: 'receipt names another commitment than it contains' });
  }
  if (!receipt.selection) {
    checks.push({ name: 'selection_present', status: 'skip', detail: 'receipt has no selection' });
  }
  checks.push(checkServerSignature(receipt));

  let status: ReceiptVerification['status'] = core.status;
  if (checks.some((c) => c.status === 'fail')) status = 'failed';
  else if (status === 'verified' && checks.some((c) => c.status === 'skip')) status = 'partial';
  return { status, checks };
}
