import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

const refs = [
  codeRef('crates/pb-core/src/commitment.rs', 1, 40, 'Rust: Commitment struct & signing payload'),
  codeRef('packages/pb-wasm/src/lib.rs', 111, 154, 'WASM: createCommitment'),
  codeRef('crates/pb-core/src/canonical.rs', 1, 20, 'Rust: Canonical JSON serialization'),
];

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.itemHashes) return c.redirect('/steps/2');

  const commitment = session.commitment;

  let content;
  if (!commitment) {
    content = `
      <p>A <strong>commitment</strong> bundles your item hashes with a reveal probability and
      a reference to a randomness beacon. The whole thing is signed with your private key.</p>
      <h2>Parameters</h2>
      ${field('Items', `${session.itemHashes.length} SHA-256 hashes`)}
      ${field('Reveal Probability', '0.50 (50%)', false)}
      ${field('Beacon', 'drand quicknet (3-second period)', false)}
      ${note(`<strong>Reveal probability 50%</strong>: We use 0.50 for this demo so ~1-2 of our 3 items get selected.
      In production, 0.10 (10%) is typical for large batches.`)}
      <h2>What gets signed</h2>
      <p>The <strong>signing payload</strong> is canonical JSON of these fields (in this exact order):
      <code>spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key</code></p>
      <p>Fields <em>not</em> signed: <code>commitment_hash</code> (derived from the payload),
      <code>metadata</code>, <code>signature</code>.</p>
      ${button('Create & Sign Commitment')}
    `;
  } else {
    content = `
      <p>Commitment created and signed.</p>
      ${field('Commitment Hash', commitment.commitment_hash)}
      ${field('Spec Version', commitment.spec_version, false)}
      ${field('Item Count', commitment.item_count, false)}
      ${field('Reveal Probability', commitment.reveal_probability, false)}
      ${field('Signing Key', commitment.signing_key)}
      ${field('Signature', commitment.signature)}
      <h2>Full Commitment Object</h2>
      ${jsonBlock(commitment)}
      ${note('The <code>commitment_hash</code> is <code>SHA-256(signing_payload)</code>. It is the canonical identifier across all servers — deterministic, content-addressed.')}
      ${nextButton(4)}
    `;
  }

  return c.html(page({ title: 'Step 3: Create Commitment', stepNumber: 3, content, codeRefs: refs, session }));
});

route.post('/', (c) => {
  const session = c.get('session');
  const params = {
    items: session.itemHashes,
    reveal_probability: 0.50,
    beacon: { type: 'drand', chain_hash: DRAND_CHAIN_HASH },
    committed_at: new Date().toISOString(),
  };
  session.commitment = wasm.createCommitment(
    JSON.stringify(params),
    session.keypair.private_key_hex
  );
  session._completedStep = Math.max(session._completedStep || 0, 3);
  return c.redirect('/steps/3');
});

export default route;
