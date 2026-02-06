import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('crates/pb-core/src/reveal.rs', 9, 36, 'Rust: Reveal struct & signing payload'),
  codeRef('packages/pb-node/src/routes/reveals.js', 17, 80, 'Server: POST reveals handler'),
];

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
      <p><strong>Voluntary:</strong> ${voluntaryItems.length} additional item(s) you choose to reveal</p>

      ${note(`In this demo, we'll reveal <em>all</em> items — the randomly selected ones plus
      the rest as voluntary reveals. In practice, you only <em>must</em> reveal the selected items.
      Voluntary reveals are valuable for transparency but carry less anti-cherry-picking assurance.`)}

      <h2>Reveal Signing Payload</h2>
      <p>Key order: <code>spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key</code></p>
      ${button('Create & Submit Reveal')}
    `;
  } else {
    const revealBeacon = session.beaconAtReveal;
    content = `
      <p>Reveal created and submitted to the server.</p>
      ${field('Reveal ID', session.revealId)}
      ${field('Registered At', session.revealRegisteredAt)}
      ${field('Selected Items', `${reveal.selected_items.length} item(s)`, false)}
      ${field('Voluntary Items', `${reveal.voluntary_items.length} item(s)`, false)}
      ${revealBeacon ? `
        <h2>Beacon at Reveal Time</h2>
        ${field('Round', revealBeacon.round, false)}
        ${field('Randomness', revealBeacon.randomness)}
        ${note('At reveal time, the drand beacon is at round <strong>' + revealBeacon.round + '</strong>. Compare this to the selection round from step 5 — the gap shows how much time elapsed between commitment and reveal.')}
      ` : ''}
      <h2>Full Reveal Object</h2>
      ${jsonBlock(reveal)}
      ${note('The server stores the reveal <em>metadata</em> but NOT the actual data. Data lives wherever you publish it — GitHub, IPFS, a personal website. The server is just a receipt printer.')}
      ${nextButton(7)}
    `;
  }

  return c.html(page({ title: 'Step 6: Reveal', stepNumber: 6, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbNode = c.get('pbNode');
  const kp = session.keypair;
  const commitment = session.commitment;
  const selectedItems = session.selectedItems || [];
  const voluntaryItems = commitment.items.filter(h => !selectedItems.includes(h));

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

  // Submit to server
  const hash = commitment.commitment_hash;
  const res = await pbNode.request(`http://localhost/v1/commitments/${hash}/reveals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reveal),
  });

  if (res.ok) {
    const body = await res.json();
    session.revealId = body.reveal_id;
    session.revealRegisteredAt = body.registered_at;
    session.beaconAtReveal = body.beacon_at_reveal;
  }
  session._completedStep = Math.max(session._completedStep || 0, 6);
  return c.redirect('/steps/6');
});

export default route;
