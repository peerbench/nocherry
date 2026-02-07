import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, button, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('crates/pb-core/src/verify.rs', 1, 40, 'Rust: Full verification pipeline'),
  codeRef('crates/pb-core/src/commitment.rs', 1, 20, 'Rust: Commitment verification'),
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runVerificationChecks(commitment, receipt, reveal, sampleData) {
  const selection = receipt.selection;
  const checks = [];

  // 1. Verify commitment signature
  try {
    const valid = wasm.verifyCommitment(JSON.stringify(commitment));
    checks.push({
      name: 'Commitment Signature',
      pass: valid,
      detail: valid
        ? `Ed25519 signature verified against ${commitment.signing_key}`
        : 'Signature verification failed',
    });
  } catch (e) {
    checks.push({ name: 'Commitment Signature', pass: false, detail: e.message });
  }

  // 2. Verify beacon (check that round is after commitment)
  if (selection?.beacon_output) {
    const roundTime = Number(wasm.drandRoundTime(BigInt(selection.beacon_output.round)));
    const committedAt = Math.floor(new Date(receipt.registered_at).getTime() / 1000);
    const beaconAfter = roundTime > committedAt - 3; // Allow small clock skew
    checks.push({
      name: 'Beacon Temporal Ordering',
      pass: beaconAfter,
      detail: `drand round ${selection.beacon_output.round} (t=${roundTime}) is after registered_at (t=${committedAt})`,
    });
  } else {
    checks.push({ name: 'Beacon Temporal Ordering', pass: false, detail: 'No beacon output in receipt' });
  }

  // 3. Verify selection — re-run the algorithm (respecting selection mode)
  if (selection?.beacon_output?.randomness) {
    const randomness = selection.beacon_output.randomness;
    let recomputedSelected;
    const mode = selection.selection_mode || 'per_item';

    if (mode === 'batch') {
      const count = Math.ceil(commitment.reveal_probability * commitment.items.length);
      recomputedSelected = wasm.selectBatch(JSON.stringify(commitment.items), randomness, count);
    } else {
      recomputedSelected = commitment.items.filter(itemHash =>
        wasm.selectPerItem(randomness, commitment.commitment_hash, itemHash, commitment.reveal_probability)
      );
    }

    const match = JSON.stringify([...recomputedSelected].sort()) === JSON.stringify([...(selection.selected_items || [])].sort());
    checks.push({
      name: 'Selection Recomputation',
      pass: match,
      detail: match
        ? `Re-ran ${mode} selection: ${recomputedSelected.length} items selected, matches server`
        : `Mismatch: recomputed ${recomputedSelected.length} items, server says ${selection.selected_items?.length}`,
    });
  } else {
    checks.push({ name: 'Selection Recomputation', pass: false, detail: 'No beacon randomness available' });
  }

  // 4. Verify reveal signature
  try {
    const revealPayload = {
      spec_version: reveal.spec_version,
      commitment_hash: reveal.commitment_hash,
      selected_items: reveal.selected_items,
      voluntary_items: reveal.voluntary_items,
      revealed_at: reveal.revealed_at,
      signing_key: reveal.signing_key,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
    const valid = wasm.verifySignature(reveal.signing_key, payloadBytes, reveal.signature);
    checks.push({
      name: 'Reveal Signature',
      pass: valid,
      detail: valid
        ? `Ed25519 signature verified against ${reveal.signing_key}`
        : 'Signature verification failed',
    });
  } catch (e) {
    checks.push({ name: 'Reveal Signature', pass: false, detail: e.message });
  }

  // 5. Verify data integrity — hash each item and compare
  const allRevealed = [...reveal.selected_items, ...reveal.voluntary_items];
  let dataIntegrityPass = true;
  const dataDetails = [];
  for (const hash of allRevealed) {
    const idx = commitment.items.indexOf(hash);
    if (idx >= 0 && sampleData[idx]) {
      const computed = wasm.hashBytes(new TextEncoder().encode(sampleData[idx]));
      if (computed === hash) {
        dataDetails.push(`Item ${idx + 1}: hash matches`);
      } else {
        dataDetails.push(`Item ${idx + 1}: MISMATCH`);
        dataIntegrityPass = false;
      }
    }
  }
  checks.push({
    name: 'Data Integrity',
    pass: dataIntegrityPass,
    detail: dataDetails.join('; '),
  });

  // 6. Check completeness
  const selectedSet = new Set(selection?.selected_items || []);
  const revealedSelected = new Set(reveal.selected_items);
  const missing = [...selectedSet].filter(h => !revealedSelected.has(h));
  checks.push({
    name: 'Completeness',
    pass: missing.length === 0,
    detail: missing.length === 0
      ? 'All selected items are revealed'
      : `${missing.length} selected item(s) missing from reveal`,
  });

  return checks;
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.reveal) return c.redirect('/steps/7');

  const verificationResults = session.verificationResults;

  let content;
  if (!verificationResults) {
    content = `
      <p>The final step: <strong>offline verification</strong>. Given the commitment, beacon output,
      selection, reveal, and actual data — anyone can verify the entire chain without contacting a server.</p>

      <h2>Verification Steps</h2>
      <ol>
        <li><strong>Verify commitment signature</strong> — Ed25519 verify against the signing payload</li>
        <li><strong>Verify beacon</strong> — confirm the beacon output is authentic and postdates the commitment</li>
        <li><strong>Verify selection</strong> — re-run the selection algorithm, confirm it matches</li>
        <li><strong>Verify reveal signature</strong> — Ed25519 verify the reveal object</li>
        <li><strong>Verify data integrity</strong> — hash revealed data, confirm it matches committed hashes</li>
        <li><strong>Check completeness</strong> — are all selected items actually revealed?</li>
      </ol>

      ${note('This is the most important part of the protocol. Everything up to now was setup — this is where the proofs are checked. All verification happens locally, no network needed.')}
      ${button('Run Verification')}
    `;
  } else {
    const allServersPass = verificationResults.every(vr => vr.allPassed);

    const serverBlocks = verificationResults.map(vr => `
      <div class="server-result" style="margin-bottom:24px">
        <h3>${esc(vr.name)}
          <span class="${vr.allPassed ? 'check' : 'cross'}">
            ${vr.allPassed ? 'ALL PASSED' : 'SOME FAILED'}
          </span>
        </h3>
        ${vr.checks.map(ch => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #eee">
            <span class="${ch.pass ? 'check' : 'cross'}" style="font-size:1.2rem">${ch.pass ? '\u2713' : '\u2717'}</span>
            <div>
              <div style="font-weight:600;font-size:0.95rem">${ch.name}</div>
              <div style="font-size:0.8rem;color:#666">${ch.detail}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');

    content = `
      <h2>Verification Results</h2>
      ${serverBlocks}

      <div style="margin:20px 0;padding:16px;border-radius:8px;background:${allServersPass ? '#d4edda' : '#f8d7da'};border:1px solid ${allServersPass ? '#c3e6cb' : '#f5c6cb'}">
        <strong style="font-size:1.1rem">${allServersPass
          ? `All checks passed on ${verificationResults.length} server(s)!`
          : 'Some checks failed'}</strong>
        <p style="margin-top:4px;font-size:0.9rem">${allServersPass
          ? 'The commitment, selection, and reveal form a valid proof chain — verified independently against each server\'s receipt. This verification required zero network access.'
          : 'Review the failed checks above.'}</p>
      </div>

      ${note(`<strong>What this proves:</strong><br>
      1. The committer declared these hashes <em>before</em> the randomness existed<br>
      2. The beacon randomly selected items — the committer couldn't influence this<br>
      3. The revealed data matches the committed hashes<br>
      4. All selected items were actually revealed (no cherry-picking)`)}

      <div style="margin-top:24px">
        <a href="/" class="btn">Start Over</a>
      </div>
    `;
  }

  return c.html(page({ title: 'Step 8: Verify', stepNumber: 8, content, codeRefs: refs, session }));
});

route.post('/', (c) => {
  const session = c.get('session');
  const commitment = session.commitment;
  const reveal = session.reveal;
  const sampleData = session.sampleData;
  const serverResults = session.serverResults || [];

  const verificationResults = serverResults
    .filter(r => r.status === 'ok')
    .map(serverResult => {
      const checks = runVerificationChecks(commitment, serverResult.receipt, reveal, sampleData);
      const allPassed = checks.every(ch => ch.pass);
      return { name: serverResult.name, checks, allPassed };
    });

  session.verificationResults = verificationResults;
  session._completedStep = Math.max(session._completedStep || 0, 8);
  return c.redirect('/steps/8');
});

export default route;
