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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.itemHashes) return c.redirect('/steps/2');

  const commitment = session.commitment;

  let content;
  if (!commitment) {
    const itemCount = session.itemHashes.length;

    content = `
      <p>A <strong>commitment</strong> bundles your item hashes with a reveal probability and
      a reference to a randomness beacon. The whole thing is signed with your private key.</p>

      <form method="POST">
        <h2>Parameters</h2>
        ${field('Items', `${itemCount} SHA-256 hashes`)}

        <div style="margin:12px 0">
          <label style="font-size:0.9rem;font-weight:600;display:block;margin-bottom:4px">Reveal Probability</label>
          <div style="display:flex;align-items:center;gap:12px">
            <input type="range" name="reveal_probability" id="prob-slider"
              min="0.01" max="1.0" step="0.01" value="0.50"
              style="flex:1;accent-color:var(--accent)">
            <span id="prob-value" style="font-family:'SF Mono','Fira Code',monospace;font-size:0.95rem;min-width:4em;text-align:right">0.50</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-top:2px">
            <span>1%</span>
            <span>Expected: <strong id="prob-expected">${Math.max(1, Math.round(itemCount * 0.50))}</strong> of ${itemCount} items</span>
            <span>100%</span>
          </div>
        </div>

        <div style="margin:12px 0">
          <label style="font-size:0.9rem;font-weight:600;display:block;margin-bottom:4px">Beacon</label>
          <select name="beacon" style="padding:8px 12px;border-radius:4px;border:1px solid #ccc;font-size:0.9rem;width:100%">
            <option value="drand" selected>drand quicknet (3-second period, League of Entropy)</option>
          </select>
        </div>

        <div style="margin:12px 0">
          <label style="font-size:0.9rem;font-weight:600;display:block;margin-bottom:4px">Stream ID <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <input type="text" name="stream_id" placeholder="e.g. s_benchmark-2026-q1"
            style="width:100%;padding:8px 12px;border-radius:4px;border:1px solid #ccc;font-size:0.9rem;font-family:'SF Mono','Fira Code',monospace">
          <p style="font-size:0.8rem;color:var(--muted);margin-top:4px">Groups related commitments into a named stream. Not included in the signed payload.</p>
        </div>

        <div style="margin:12px 0">
          <label style="font-size:0.9rem;font-weight:600;display:block;margin-bottom:4px">Metadata <span style="font-weight:400;color:var(--muted)">(optional JSON)</span></label>
          <textarea name="metadata" rows="3" placeholder='{"description": "Q1 benchmark run", "model": "gpt-4o"}'
            style="width:100%;padding:8px 12px;border-radius:4px;border:1px solid #ccc;font-size:0.85rem;font-family:'SF Mono','Fira Code',monospace;resize:vertical"></textarea>
          <p style="font-size:0.8rem;color:var(--muted);margin-top:4px">Arbitrary key-value data stored with the commitment. Not included in the signed payload.</p>
        </div>

        ${note(`<strong>What gets signed:</strong> <code>spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key</code> — in that exact key order.<br>
        Fields <em>not</em> signed: <code>commitment_hash</code> (derived), <code>stream_id</code>, <code>metadata</code>, <code>signature</code>.`)}

        <button type="submit" class="btn">Create &amp; Sign Commitment</button>
      </form>

      <script>
      (function() {
        var slider = document.getElementById('prob-slider');
        var display = document.getElementById('prob-value');
        var expected = document.getElementById('prob-expected');
        var itemCount = ${itemCount};
        slider.addEventListener('input', function() {
          var p = parseFloat(slider.value);
          display.textContent = p.toFixed(2);
          expected.textContent = Math.max(1, Math.round(itemCount * p));
        });
      })();
      </script>
    `;
  } else {
    content = `
      <p>Commitment created and signed.</p>
      ${field('Commitment Hash', commitment.commitment_hash)}
      ${field('Spec Version', commitment.spec_version, false)}
      ${field('Item Count', commitment.item_count, false)}
      ${field('Reveal Probability', commitment.reveal_probability, false)}
      ${commitment.stream_id ? field('Stream ID', commitment.stream_id) : ''}
      ${field('Beacon', `${commitment.beacon.type} (${commitment.beacon.chain_hash ? commitment.beacon.chain_hash.substring(0, 16) + '...' : 'default'})`, false)}
      ${field('Signing Key', commitment.signing_key)}
      ${field('Signature', commitment.signature)}
      ${Object.keys(commitment.metadata || {}).length > 0 ? `
        <h2>Metadata</h2>
        ${jsonBlock(commitment.metadata)}
      ` : ''}
      <h2>Full Commitment Object</h2>
      ${jsonBlock(commitment)}
      ${note('The <code>commitment_hash</code> is <code>SHA-256(signing_payload)</code>. It is the canonical identifier across all servers — deterministic, content-addressed.')}
      <div style="display:flex;gap:12px;align-items:center;margin-top:16px">
        ${nextButton(4)}
        <form method="POST" action="/steps/3/reset" style="margin:0">
          <button type="submit" class="btn" style="background:var(--muted);margin-top:16px">Re-create</button>
        </form>
      </div>
    `;
  }

  return c.html(page({ title: 'Step 3: Create Commitment', stepNumber: 3, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();

  // Parse reveal probability
  let probability = parseFloat(body.reveal_probability);
  if (isNaN(probability) || probability <= 0 || probability > 1) {
    probability = 0.50;
  }

  // Parse beacon
  const beaconType = body.beacon || 'drand';
  let beacon;
  if (beaconType === 'drand') {
    beacon = { type: 'drand', chain_hash: DRAND_CHAIN_HASH };
  } else {
    beacon = { type: beaconType };
  }

  // Parse optional stream_id
  const streamId = (body.stream_id || '').trim() || undefined;

  // Parse optional metadata JSON
  let metadata = undefined;
  const metaRaw = (body.metadata || '').trim();
  if (metaRaw) {
    try {
      metadata = JSON.parse(metaRaw);
    } catch {
      // Ignore invalid JSON — commit without metadata
    }
  }

  const params = {
    items: session.itemHashes,
    reveal_probability: probability,
    beacon,
    committed_at: new Date().toISOString(),
  };
  if (streamId) params.stream_id = streamId;
  if (metadata) params.metadata = metadata;

  session.commitment = wasm.createCommitment(
    JSON.stringify(params),
    session.keypair.private_key_hex
  );
  session._completedStep = Math.max(session._completedStep || 0, 3);
  return c.redirect('/steps/3');
});

route.post('/reset', (c) => {
  const session = c.get('session');
  delete session.commitment;
  delete session.receipt;
  delete session.serverResults;
  delete session.selectedItems;
  delete session.reveal;
  delete session.revealResults;
  delete session.verificationResults;
  session._completedStep = Math.min(session._completedStep || 0, 2);
  return c.redirect('/steps/3');
});

export default route;
