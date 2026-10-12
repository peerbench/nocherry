/**
 * Offline receipt verification (spec 10.5): beacon authenticity, selection
 * round timing, recomputed selection and server signature.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as wasm from '@nocherry/pb-wasm';
import { verifyReceipt } from '../src/receipt.js';

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
// RFC 8032 section 7.1 tests 1 and 2 secret keys.
const COMMITTER_KEY = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SERVER_KEY = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';

// Real quicknet rounds from https://api.drand.sh/<chain>/public/<round>.
// Round 25892264 is scheduled at 2026-02-07T16:02:36Z.
const ROUND = 25892264;
const BEACON = {
  type: 'drand',
  chain_hash: CHAIN,
  round: ROUND,
  randomness: '5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108',
  signature: '8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8',
};
const NEXT_ROUND_SIGNATURE = 'a1b4b3885bbeaf23047dfd38ed5b64a9141e96de4f8de30b16be4fff9ff8a0eb6682a7cf95c26e9a035b1630728258d7';

const ITEMS = [
  '2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8',
  '32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2',
];

function serverDid(): string {
  // did:key of SERVER_KEY, derived by signing nothing: read it from a throwaway commitment.
  return wasm.createCommitment(JSON.stringify({
    items: ITEMS, reveal_probability: 0.5, beacon: { type: 'drand', chain_hash: CHAIN },
    committed_at: '2026-02-06T14:30:00Z',
  }), SERVER_KEY).signing_key;
}

/** A receipt as the server builds it (src/core/routes/commitments.ts, signing.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReceipt(opts: { anchorRound?: number; registeredAt?: string; beacon?: any; noSelection?: boolean } = {}) {
  const beaconRef = opts.anchorRound === undefined
    ? { type: 'drand', chain_hash: CHAIN }
    : { type: 'drand', anchor_round: opts.anchorRound, chain_hash: CHAIN };
  const commitment = wasm.createCommitment(JSON.stringify({
    items: ITEMS, reveal_probability: 0.5, beacon: beaconRef, committed_at: '2026-02-06T14:30:00Z',
  }), COMMITTER_KEY);
  const beacon = opts.beacon ?? BEACON;
  const selected = wasm.selectBatch(JSON.stringify(ITEMS), beacon.randomness, 1);
  const body = {
    commitment,
    commitment_hash: commitment.commitment_hash,
    registered_at: opts.registeredAt ?? '2026-02-07T16:02:34.321Z',
    arrival_beacon: null,
    selection: opts.noSelection ? null : {
      commitment_hash: commitment.commitment_hash,
      beacon_output: beacon,
      selection_mode: 'batch',
      reveal_probability: 0.5,
      selected_items: selected,
      selected_count: selected.length,
      total_count: ITEMS.length,
      computed_at: '2026-02-07T16:02:36.200Z',
    },
    signer_activity: { last_hour: 1, last_month: 1 },
    key_matches_identity: null,
    server_key: serverDid(),
  };
  const server_signature = wasm.signMessage(SERVER_KEY, new TextEncoder().encode(JSON.stringify(body)));
  // Round-trip through JSON, as a receipt read from disk.
  return JSON.parse(JSON.stringify({ ...body, server_signature }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusOf = (result: any, name: string) => result.checks.find((c: any) => c.name === name)?.status ?? 'absent';

describe('verifyReceipt', () => {
  it('verifies a genuine unanchored receipt', () => {
    const result = verifyReceipt(makeReceipt());
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.checks.map((c) => [c.name, c.status]), [
      ['commitment_signature', 'pass'],
      ['beacon_randomness', 'pass'],
      ['beacon_authentic', 'pass'],
      ['beacon_after_registration', 'pass'],
      ['selection_mode_default', 'pass'],
      ['selection_correct', 'pass'],
      ['server_signature', 'pass'],
    ]);
  });

  it('verifies a genuine anchored receipt', () => {
    const result = verifyReceipt(makeReceipt({ anchorRound: ROUND - 2, registeredAt: '2026-02-07T16:02:31.500Z' }));
    assert.equal(result.status, 'verified');
    assert.equal(statusOf(result, 'beacon_authentic'), 'pass');
    assert.equal(statusOf(result, 'anchor_selection_round'), 'pass');
    assert.equal(statusOf(result, 'anchor_registration_time'), 'pass');
  });

  it('rejects randomness chosen by the server', () => {
    const result = verifyReceipt(makeReceipt({ beacon: { ...BEACON, randomness: '00'.repeat(32) } }));
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'beacon_randomness'), 'fail');
    assert.equal(statusOf(result, 'server_signature'), 'pass');
  });

  it('rejects a signature the beacon never produced', () => {
    const signature = 'ab'.repeat(48);
    const randomness = wasm.hashBytes(Uint8Array.from(Buffer.from(signature, 'hex')));
    const result = verifyReceipt(makeReceipt({ beacon: { ...BEACON, signature, randomness } }));
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'beacon_randomness'), 'pass');
    assert.equal(statusOf(result, 'beacon_authentic'), 'fail');
  });

  it('rejects a genuine output of another round', () => {
    const randomness = wasm.hashBytes(Uint8Array.from(Buffer.from(NEXT_ROUND_SIGNATURE, 'hex')));
    const result = verifyReceipt(makeReceipt({ beacon: { ...BEACON, signature: NEXT_ROUND_SIGNATURE, randomness } }));
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'beacon_authentic'), 'fail');
  });

  it('rejects a round that was public at registration', () => {
    const result = verifyReceipt(makeReceipt({ registeredAt: '2026-02-07T16:02:36.000Z' }));
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'beacon_after_registration'), 'fail');
  });

  it('rejects a round later than the first one after registration', () => {
    const result = verifyReceipt(makeReceipt({ registeredAt: '2026-02-07T16:02:32.434Z' }));
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'beacon_after_registration'), 'fail');
  });

  it('rejects a receipt changed after the server signed it', () => {
    const receipt = makeReceipt();
    receipt.signer_activity.last_month = 0;
    const result = verifyReceipt(receipt);
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'server_signature'), 'fail');
  });

  it('rejects a selection that does not follow from the beacon output', () => {
    const receipt = makeReceipt();
    receipt.selection.selected_items = ITEMS.filter((h) => !receipt.selection.selected_items.includes(h));
    const result = verifyReceipt(receipt);
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'selection_correct'), 'fail');
  });

  it('is partial without a selection or without a server signature', () => {
    assert.equal(verifyReceipt(makeReceipt({ noSelection: true })).status, 'partial');
    const unsigned = makeReceipt();
    delete unsigned.server_signature;
    const result = verifyReceipt(unsigned);
    assert.equal(result.status, 'partial');
    assert.equal(statusOf(result, 'server_signature'), 'skip');
  });
});

describe('verifyReceipt on malformed input', () => {
  const cases: [string, (r: any) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['selection_mode missing', (r) => { delete r.selection.selection_mode; }],
    ['negative round', (r) => { r.selection.beacon_output.round = -1; }],
    ['round beyond u64', (r) => { r.selection.beacon_output.round = 1e30; }],
    ['round as string', (r) => { r.selection.beacon_output.round = String(ROUND); }],
    ['commitment missing', (r) => { delete r.commitment; }],
    ['items not an array', (r) => { r.commitment.items = 'all of them'; }],
  ];
  for (const [name, corrupt] of cases) {
    it(`reports failed instead of throwing: ${name}`, () => {
      const receipt = makeReceipt();
      corrupt(receipt);
      const result = verifyReceipt(receipt);
      assert.equal(result.status, 'failed');
    });
  }

  it('rejects a receipt whose commitment_hash names another commitment', () => {
    const receipt = makeReceipt();
    receipt.commitment_hash = '00'.repeat(32);
    const result = verifyReceipt(receipt);
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'receipt_commitment_hash'), 'fail');
  });

  it('rejects a selection record of another commitment', () => {
    const receipt = makeReceipt();
    receipt.selection.commitment_hash = '00'.repeat(32);
    const result = verifyReceipt(receipt);
    assert.equal(result.status, 'failed');
    assert.equal(statusOf(result, 'selection_correct'), 'fail');
  });
});

// Receipts issued by the three production servers for one commitment on 2026-02-07.
describe('verifyReceipt on production receipts', () => {
  const file = join(import.meta.dirname, 'fixtures', 'production-receipts-2026-02-07.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipts: any[] = JSON.parse(readFileSync(file, 'utf-8')).receipts.map((r: any) => r.receipt);

  it('verifies all three', () => {
    assert.equal(receipts.length, 3);
    for (const receipt of receipts) {
      const result = verifyReceipt(receipt);
      assert.equal(result.status, 'verified', JSON.stringify(result.checks));
      assert.equal(statusOf(result, 'beacon_authentic'), 'pass');
      assert.equal(statusOf(result, 'server_signature'), 'pass');
    }
  });

  it('notes that the servers used per-item selection for five items', () => {
    assert.equal(statusOf(verifyReceipt(receipts[0]), 'selection_mode_default'), 'warn');
  });

  it('flags the mode when the other candidate selection is presented', () => {
    const receipt = structuredClone(receipts[0]);
    const { items, reveal_probability: p } = receipt.commitment;
    receipt.selection.selection_mode = 'batch';
    receipt.selection.selected_items = wasm.selectBatch(
      JSON.stringify(items), receipt.selection.beacon_output.randomness, Math.ceil(p * items.length));
    delete receipt.server_signature; // a server presenting this would sign it
    const result = verifyReceipt(receipt);
    assert.equal(statusOf(result, 'selection_correct'), 'pass');
    assert.equal(statusOf(result, 'selection_mode_default'), 'pass');
    assert.notDeepEqual(receipt.selection.selected_items, receipts[0].selection.selected_items);
  });

  // Every leaf value of every receipt is changed in turn; none may still verify.
  it('no single-field mutation still verifies', () => {
    const mutate = (v: unknown): unknown => {
      if (typeof v === 'string') {
        if (v.length === 0) return 'x';
        const last = v[v.length - 1];
        return v.slice(0, -1) + (last === '0' ? '1' : '0');
      }
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'boolean') return !v;
      return 'mutated';
    };
    let mutations = 0;
    for (const original of receipts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walk = (node: any, path: (string | number)[]) => {
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (value !== null && typeof value === 'object') { walk(value, [...path, key]); continue; }
          const copy = structuredClone(original);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let target: any = copy;
          for (const step of path) target = target[step];
          target[key] = mutate(value);
          mutations++;
          const result = verifyReceipt(copy);
          assert.notEqual(result.status, 'verified', `mutated ${[...path, key].join('.')} still verifies`);
        }
      };
      walk(original, []);
    }
    assert.ok(mutations > 100, `only ${mutations} mutations`);
  });
});

describe('pb-js verify <receipt>', () => {
  const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');
  const dir = mkdtempSync(join(tmpdir(), 'pb-receipt-test-'));
  const run = (file: string) => execFileSync('npx', ['tsx', CLI, 'verify', file], { encoding: 'utf-8', timeout: 30000 });

  it('prints the checks of a genuine receipt and exits 0', () => {
    const file = join(dir, 'receipt.json');
    writeFileSync(file, JSON.stringify(makeReceipt(), null, 2));
    const out = run(file);
    assert.match(out, /VERIFIED/);
    assert.match(out, /pass beacon_authentic/);
  });

  it('exits 1 for server-receipts.json with a forged receipt', () => {
    const file = join(dir, 'server-receipts.json');
    writeFileSync(file, JSON.stringify({ receipts: [
      { server_name: 'good', receipt: makeReceipt() },
      { server_name: 'forged', receipt: makeReceipt({ beacon: { ...BEACON, randomness: '00'.repeat(32) } }) },
    ] }));
    assert.throws(() => run(file), (e: unknown) => {
      const err = e as { status?: number; stdout?: string };
      return err.status === 1 && /Receipt good: VERIFIED/.test(err.stdout ?? '') && /Receipt forged: FAILED/.test(err.stdout ?? '');
    });
  });
});
