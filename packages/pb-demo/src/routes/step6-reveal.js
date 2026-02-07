import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('crates/pb-core/src/reveal.rs', 9, 36, 'Rust: Reveal struct & signing payload'),
  codeRef('packages/pb-node/src/routes/reveals.js', 17, 80, 'Server: POST reveals handler'),
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function submitRevealToAllServers(reveal, commitmentHash, pbServers) {
  const results = await Promise.allSettled(
    pbServers.map(async (server) => {
      const res = await server.client.request(
        `http://localhost/v1/commitments/${commitmentHash}/reveals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reveal),
        }
      );

      if (res.ok) {
        const body = await res.json();
        return {
          name: server.name,
          status: 'ok',
          revealId: body.reveal_id,
          registeredAt: body.registered_at,
          beaconAtReveal: body.beacon_at_reveal,
          error: null,
        };
      } else {
        let errMsg;
        try {
          const errBody = await res.json();
          errMsg = errBody.error || `HTTP ${res.status}`;
        } catch {
          errMsg = `HTTP ${res.status}`;
        }
        return { name: server.name, status: 'error', error: errMsg };
      }
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: pbServers[i].name,
      status: 'error',
      error: r.reason?.message || 'Unknown error',
    };
  });
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.selectedItems) return c.redirect('/steps/5');

  const reveal = session.reveal;

  let content;
  if (!reveal) {
    const selectedItems = session.selectedItems || [];
    const allItems = session.commitment.items || [];
    const voluntaryItems = allItems.filter(h => !selectedItems.includes(h));

    content = `
      <p>Now you <strong>reveal</strong> the data behind selected items. A reveal object
      declares which items you're revealing and where the data lives.</p>

      <h2>Items to Reveal</h2>
      <p><strong>Selected (mandatory):</strong> ${selectedItems.length} item(s) chosen by the beacon</p>
      <p><strong>Not selected:</strong> ${voluntaryItems.length} item(s) remain private</p>

      ${note(`Only the randomly selected items are revealed. This is the core anti-cherry-picking
      guarantee — the beacon chose which items to audit, not the submitter. Non-selected items
      stay private unless you voluntarily reveal them later.`)}

      <h2>Reveal Signing Payload</h2>
      <p>Key order: <code>spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key</code></p>
      ${button('Create & Submit Reveal')}
    `;
  } else {
    const revealResults = session.revealResults || [];
    const okResults = revealResults.filter(r => r.status === 'ok');

    const serverBlocks = revealResults.map(r => {
      if (r.status === 'ok') {
        return `
          <div class="server-result">
            <h3>${esc(r.name)} <span class="check">OK</span></h3>
            ${field('Reveal ID', r.revealId)}
            ${field('Registered At', r.registeredAt)}
            ${r.beaconAtReveal ? field('Beacon Round', r.beaconAtReveal.round, false) : ''}
          </div>`;
      } else {
        return `
          <div class="server-result">
            <h3>${esc(r.name)} <span class="cross">ERROR</span></h3>
            <p style="color:#e63946">${esc(r.error)}</p>
          </div>`;
      }
    }).join('');

    content = `
      <p>Reveal created and submitted to ${revealResults.length} server(s).</p>
      ${note(`<strong>${okResults.length}</strong> of ${revealResults.length} server(s) accepted the reveal.`)}
      ${serverBlocks}

      ${field('Selected Items', `${reveal.selected_items.length} item(s)`, false)}
      ${field('Voluntary Items', `${reveal.voluntary_items.length} item(s)`, false)}

      ${note('The server stores the reveal <em>metadata</em> but NOT the actual data. Data lives wherever you publish it — GitHub, IPFS, a personal website. The server is just a receipt printer.')}

      <h2>Full Reveal Object</h2>
      ${jsonBlock(reveal)}
      ${nextButton(7)}
    `;
  }

  return c.html(page({ title: 'Step 6: Reveal', stepNumber: 6, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');
  const kp = session.keypair;
  const commitment = session.commitment;
  const selectedItems = session.selectedItems || [];
  const voluntaryItems = [];

  // Build reveal signing payload (canonical key order from spec)
  const revealPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    selected_items: selectedItems,
    voluntary_items: voluntaryItems,
    revealed_at: new Date().toISOString(),
    signing_key: kp.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
  const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);

  const reveal = { ...revealPayload, signature };
  session.reveal = reveal;

  // Submit to ALL servers in parallel
  const revealResults = await submitRevealToAllServers(
    reveal, commitment.commitment_hash, pbServers
  );
  session.revealResults = revealResults;

  // Backward compat: set convenience fields from first successful
  const firstOk = revealResults.find(r => r.status === 'ok');
  if (firstOk) {
    session.revealId = firstOk.revealId;
    session.revealRegisteredAt = firstOk.registeredAt;
    session.beaconAtReveal = firstOk.beaconAtReveal;
  }

  session._completedStep = Math.max(session._completedStep || 0, 6);
  return c.redirect('/steps/6');
});

export default route;
