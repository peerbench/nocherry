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

/**
 * Build file_urls for a specific server.
 * Embedded → localhost URLs. Remote → public URLs only.
 * Returns null if any selected item is missing a usable URL.
 */
function buildFileUrls(fileUrlMap, selectedItems, isEmbedded) {
  const urls = {};
  for (const hash of selectedItems) {
    const entry = fileUrlMap[hash];
    if (!entry) return null;
    const url = isEmbedded ? (entry.local || entry.public) : entry.public;
    if (!url) return null;
    urls[hash] = url;
  }
  return urls;
}

async function submitRevealToServer(reveal, commitmentHash, server) {
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
      dataVerified: body.data_verified,
      fileUrlsRegistered: body.file_urls_registered || 0,
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
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.publishResults) return c.redirect('/steps/6');

  const reveal = session.reveal;

  let content;
  if (!reveal) {
    const selectedItems = session.selectedItems || [];

    content = `
      <p>Your data is published. Now <strong>submit the reveal</strong> to formally tell the
      servers which items you're revealing. This creates a signed cryptographic proof tying
      the beacon selection to your committed data.</p>

      <h2>Items to Reveal</h2>
      <p><strong>${selectedItems.length} item(s)</strong> randomly selected by the beacon will be revealed.</p>

      ${note(`Only the randomly selected items are included in the reveal. This is the core
      anti-cherry-picking guarantee — the beacon chose which items to audit, not the submitter.`)}

      <h2>Reveal Signing Payload</h2>
      <p>Key order: <code>spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key</code></p>
      ${button('Get Verification of Publication')}
    `;
  } else {
    const revealResults = session.revealResults || [];
    const okResults = revealResults.filter(r => r.status === 'ok');
    const skippedResults = revealResults.filter(r => r.status === 'skipped');

    const serverBlocks = revealResults.map(r => {
      if (r.status === 'ok') {
        return `
          <div class="server-result">
            <h3>${esc(r.name)} <span class="check">OK</span></h3>
            ${field('Reveal ID', r.revealId)}
            ${field('Registered At', r.registeredAt)}
            ${r.beaconAtReveal ? field('Beacon Round', r.beaconAtReveal.round, false) : ''}
            ${r.dataVerified ? field('Data Verified', 'Server fetched and verified published data', false) : ''}
            ${r.fileUrlsRegistered > 0 ? field('File URLs Registered', `${r.fileUrlsRegistered} file URL(s) persisted for verifiers`, false) : ''}
          </div>`;
      } else if (r.status === 'skipped') {
        return `
          <div class="server-result">
            <h3>${esc(r.name)} <span style="color:#6c757d;font-size:0.85rem">SKIPPED</span></h3>
            <p style="color:#6c757d;font-size:0.9rem">${esc(r.reason)}</p>
          </div>`;
      } else {
        return `
          <div class="server-result">
            <h3>${esc(r.name)} <span class="cross">ERROR</span></h3>
            <p style="color:#e63946">${esc(r.error)}</p>
          </div>`;
      }
    }).join('');

    const submitted = revealResults.length - skippedResults.length;
    content = `
      <p>Reveal created and submitted to ${submitted} server(s)${skippedResults.length > 0 ? `, ${skippedResults.length} skipped` : ''}.</p>
      ${note(`<strong>${okResults.length}</strong> of ${submitted} server(s) accepted the reveal.`)}
      ${serverBlocks}

      ${field('Selected Items', `${reveal.selected_items.length} item(s) revealed`, false)}

      ${note('The server now knows which items you revealed and can direct verifiers to your published data mirrors. The reveal ID is your receipt.')}

      <h2>Full Reveal Object</h2>
      ${jsonBlock(reveal)}
      ${nextButton(8)}
    `;
  }

  return c.html(page({ title: 'Step 7: Reveal', stepNumber: 7, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');
  const kp = session.keypair;
  const commitment = session.commitment;
  const selectedItems = session.selectedItems || [];

  // Only reveal selected items — no voluntary reveals
  const revealPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    selected_items: selectedItems,
    voluntary_items: [],
    revealed_at: new Date().toISOString(),
    signing_key: kp.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
  const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);

  const reveal = { ...revealPayload, signature };
  session.reveal = reveal;

  const fileUrlMap = session.fileUrlMap || {};

  // Submit to each server with the right file_urls.
  // Skip servers where we can't provide all needed URLs.
  const revealResults = await Promise.all(
    pbServers.map(async (server) => {
      const isEmbedded = server.environment === 'embedded';
      const fileUrls = buildFileUrls(fileUrlMap, selectedItems, isEmbedded);

      if (!fileUrls) {
        return {
          name: server.name,
          status: 'skipped',
          reason: 'No public data URLs available — publish to a remote server first',
        };
      }

      try {
        return await submitRevealToServer(
          { ...reveal, file_urls: fileUrls },
          commitment.commitment_hash,
          server
        );
      } catch (err) {
        return { name: server.name, status: 'error', error: err.message };
      }
    })
  );

  session.revealResults = revealResults;

  const firstOk = revealResults.find(r => r.status === 'ok');
  if (firstOk) {
    session.revealId = firstOk.revealId;
    session.revealRegisteredAt = firstOk.registeredAt;
    session.beaconAtReveal = firstOk.beaconAtReveal;
  }

  session._completedStep = Math.max(session._completedStep || 0, 7);
  return c.redirect('/steps/7');
});

export default route;
