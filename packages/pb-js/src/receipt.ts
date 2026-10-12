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
  return withReceiptChecks(receipt, () => wasm.verifyReceipt(JSON.stringify(receipt)));
}

export interface RevealVerification extends ReceiptVerification {
  items_checked: number;
  items_passed: number;
  items_failed: number;
  items_missing: number;
}

/**
 * Verify a receipt together with a signed reveal and the revealed data
 * (spec 10.5, all steps). `data` maps each revealed item hash to the bytes of
 * that item; an item without an entry counts as missing data. On top of
 * `verifyReceipt` this checks the reveal signature, that the reveal names
 * this commitment and only committed items, that only selected items are
 * listed as selected, that each item's bytes hash to its item hash, and that
 * every selected item is revealed. Missing data or missing selected items
 * give `partial`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyReveal(receipt: any, reveal: any, data: Record<string, Uint8Array>): RevealVerification {
  const computed: Record<string, string> = {};
  for (const [itemHash, bytes] of Object.entries(data)) computed[itemHash] = wasm.hashBytes(bytes);
  const counts = { items_checked: 0, items_passed: 0, items_failed: 0, items_missing: 0 };
  const result = withReceiptChecks(receipt, () => {
    const core = wasm.verifyReveal(JSON.stringify(receipt), JSON.stringify(reveal), JSON.stringify(computed));
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = core[key];
    return core;
  });
  return { ...result, ...counts };
}

/** Run the core verification and add the checks that need the receipt as the server sent it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withReceiptChecks(receipt: any, runCore: () => ReceiptVerification): ReceiptVerification {
  let core: ReceiptVerification;
  try {
    core = runCore();
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { status: 'failed', checks: [{ name: 'receipt_parse', status: 'fail', detail }] };
  }
  const added: ReceiptCheck[] = [];
  if (receipt.commitment_hash !== undefined && receipt.commitment_hash !== receipt.commitment?.commitment_hash) {
    added.push({ name: 'receipt_commitment_hash', status: 'fail', detail: 'receipt names another commitment than it contains' });
  }
  if (!receipt.selection) {
    added.push({ name: 'selection_present', status: 'skip', detail: 'receipt has no selection' });
  }
  added.push(checkServerSignature(receipt));

  let status: ReceiptVerification['status'] = core.status;
  if (added.some((c) => c.status === 'fail')) status = 'failed';
  else if (status === 'verified' && added.some((c) => c.status === 'skip')) status = 'partial';
  return { status, checks: [...core.checks, ...added] };
}
