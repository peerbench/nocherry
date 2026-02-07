import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('packages/pb-node/src/beacon.js', 81, 114, 'Server: computeSelection'),
  codeRef('crates/pb-core/src/select.rs', 1, 40, 'Rust: PRNG + per-item selection'),
  codeRef('packages/pb-node/src/beacon.js', 17, 40, 'Server: fetchDrandRound'),
];

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.receipt) return c.redirect('/steps/4');

  const receipt = session.receipt;
  const selection = receipt.selection;
  const commitment = session.commitment;
  const selectedSet = new Set(selection?.selected_items || []);

  // Store which items were selected for later steps
  session.selectedItems = selection?.selected_items || [];
  session._completedStep = Math.max(session._completedStep || 0, 5);

  const arrival = receipt.arrival_beacon;
  const content = `
    <p>After the server recorded the commitment, it waited for the next
    <strong>drand beacon</strong> output — an independently verifiable random value
    published every 3 seconds by the League of Entropy.</p>

    <h2>Beacon Rounds</h2>
    ${arrival ? `
      ${field('Arrival Round', `${arrival.round} (already public at commit time)`, false)}
    ` : ''}
    ${selection ? `
      ${field('Selection Round', `${selection.beacon_output?.round} (first round after commit — used for selection)`, false)}
      ${field('Randomness', selection.beacon_output?.randomness)}
      ${field('Selection Mode', selection.selection_mode, false)}
    ` : '<p>Selection not available (beacon may be unreachable)</p>'}

    <h2>Selection Result</h2>
    ${note(`With <strong>reveal_probability = ${commitment.reveal_probability}</strong> and
    <strong>${commitment.item_count} items</strong>, the per-item selection algorithm
    independently tests each item: <code>HMAC-SHA256(beacon_randomness, commitment_hash || item_hash)</code>
    produces a value that's compared against <code>floor(p &times; 2<sup>64</sup>)</code>.`)}

    <ul class="item-list">
      ${(commitment.items || []).map((hash, i) => {
        const sel = selectedSet.has(hash);
        return `<li class="${sel ? 'selected' : 'not-selected'}">
          <span class="${sel ? 'check' : 'cross'}">${sel ? 'SELECTED' : 'not selected'}</span>
          &nbsp; Item ${i + 1}: ${hash.substring(0, 16)}...${hash.substring(48)}
        </li>`;
      }).join('')}
    </ul>

    ${field('Selected Count', `${selection?.selected_count ?? 0} / ${selection?.total_count ?? commitment.item_count}`, false)}

    ${(() => {
      const serverResults = session.serverResults || [];
      const okCount = serverResults.filter(r => r.status === 'ok').length;
      return okCount > 1
        ? note(`<strong>${okCount} server(s)</strong> all computed the same selection using drand round <strong>${selection?.beacon_output?.round}</strong>. Because every server observes the same beacon, the selection is identical everywhere.`)
        : note('This selection is <strong>deterministic</strong> — anyone with the commitment and beacon output can independently recompute it. The server signature is a convenience attestation, not required for verification.');
    })()}

    ${nextButton(6)}
  `;

  return c.html(page({ title: 'Step 5: Selection', stepNumber: 5, content, codeRefs: refs, session }));
});

export default route;
