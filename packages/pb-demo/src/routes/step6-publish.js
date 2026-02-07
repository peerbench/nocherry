import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, button, nextButton, note } from '../template.js';

const route = new Hono();

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Upload selected items to a publish server (R2 / GCS).
 * Auth: Ed25519 signature using the session keypair.
 */
async function uploadToPublishServer(publishServer, receipt, files, kp) {
  const url = `${publishServer.url.replace(/\/$/, '')}/v1/upload`;

  // Build multipart form
  const formData = new FormData();
  formData.append('receipt', JSON.stringify(receipt));
  for (const file of files) {
    formData.append('files[]', new Blob([file.data], { type: 'text/plain' }), file.name);
  }

  const headers = {};

  // Embedded publisher runs in-process — no auth needed
  if (publishServer.environment !== 'embedded') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `upload:${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
    const sig = wasm.signMessage(kp.private_key_hex, messageBytes);
    headers['Authorization'] = `Ed25519 ${kp.public_key_hex} ${timestamp} ${sig}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (res.ok) {
    const body = await res.json();
    return { status: 'ok', ...body };
  } else {
    let errMsg;
    try {
      const errBody = await res.json();
      errMsg = errBody.error || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}`;
    }
    return { status: 'error', error: errMsg, httpStatus: res.status };
  }
}

function oauthSection(publishServers, signingKeyHex) {
  const remoteServers = publishServers.filter(s => s.environment !== 'embedded');
  if (remoteServers.length === 0) return '';

  const serverRows = remoteServers.map(s => {
    const signupUrl = `${s.url.replace(/\/$/, '')}/auth/signup?signing_key=${encodeURIComponent(signingKeyHex)}`;
    return `
      <div style="padding:8px 10px;margin:4px 0;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <strong>${esc(s.name)}</strong>
          <div style="font-size:0.8rem;color:#666">${esc(s.url)}</div>
        </div>
        <a href="${esc(signupUrl)}" target="_blank" style="font-size:0.85rem;color:var(--accent);white-space:nowrap">Link Account &rarr;</a>
      </div>`;
  }).join('');

  return `
    <details style="margin-top:20px">
      <summary style="cursor:pointer;font-weight:600;color:var(--accent2)">Link Google Account (Optional)</summary>
      <div style="margin-top:12px">
        <p style="font-size:0.9rem;color:#444">Remote servers accept anonymous uploads by default using your Ed25519 signing key.
        Optionally link a Google account for higher rate limits and permanent storage.</p>
        ${serverRows}
      </div>
    </details>
  `;
}

function renderUploadBlock(u) {
  if (u.status === 'ok') {
    const fileRows = (u.files || []).map(f => `
      <div style="padding:4px 0;font-size:0.8rem">
        <span class="check">\u2713</span> <code>${esc(f.name)}</code>
        <a href="${esc(f.url)}" target="_blank" style="color:var(--accent);margin-left:8px">${esc(f.url)}</a>
      </div>`).join('');
    return `
      <div class="server-result">
        <h3>${esc(u.serverName)} <span class="check">UPLOADED</span></h3>
        ${field('Commitment', u.commitment_hash)}
        ${field('Uploaded At', u.uploaded_at)}
        ${fileRows}
      </div>`;
  } else {
    return `
      <div class="server-result">
        <h3>${esc(u.serverName)} <span style="color:#6c757d;font-size:0.85rem">FAILED</span></h3>
        <p style="color:#6c757d;font-size:0.9rem">${esc(u.error)}</p>
      </div>`;
  }
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.selectedItems) return c.redirect('/steps/5');

  const publishResults = session.publishResults;
  const commitment = session.commitment;
  const selectedItems = session.selectedItems || [];
  const publishServers = c.get('publishServers') || [];
  const signingKeyHex = session.keypair?.public_key_hex || '';

  let content;
  if (!publishResults) {
    // Show which items will be published and to which servers
    const itemList = selectedItems.map((hash, i) => {
      const idx = commitment.items.indexOf(hash);
      const label = idx >= 0 && session.sampleData?.[idx]
        ? session.sampleData[idx]
        : hash;
      const short = label.length > 70 ? label.substring(0, 70) + '...' : label;
      return `<li class="selected"><span class="check">SELECTED</span> &nbsp; ${esc(short)}</li>`;
    }).join('');

    const serverList = publishServers.length > 0
      ? publishServers.map(s => `<li><strong>${esc(s.name)}</strong>: ${esc(s.url)}</li>`).join('')
      : '<li style="color:#e63946">No publish servers configured</li>';

    content = `
      <p>Before telling the servers what you're revealing, first <strong>upload the selected data</strong>
      to publish servers so it's publicly accessible.</p>

      <h2>Items to Publish</h2>
      <p><strong>${selectedItems.length} item(s)</strong> randomly selected by the beacon:</p>
      <ul class="item-list">${itemList}</ul>

      ${note(`Only the randomly selected items are published. The beacon chose which items to audit —
      this is the anti-cherry-picking guarantee. Non-selected items remain private.`)}

      <h2>Publish Servers</h2>
      <p>Data will be uploaded to:</p>
      <ul class="item-list">${serverList}</ul>

      ${note('Publish servers store the actual data files (not just hashes). Remote servers accept anonymous uploads using your Ed25519 signing key. When you submit the reveal in the next step, the servers will fetch and verify the data from these URLs.')}

      ${button('Publish Selected Random Sample')}

      ${oauthSection(publishServers, signingKeyHex)}
    `;
  } else {
    const uploadBlocks = publishResults.uploads.map(renderUploadBlock).join('');

    content = `
      <h2>Upload Results</h2>
      ${uploadBlocks}

      ${note('Data is now publicly accessible. Next, submit the reveal — the servers will fetch and verify the data at these URLs.')}

      ${oauthSection(publishServers, signingKeyHex)}

      ${nextButton(7)}
    `;
  }

  return c.html(page({ title: 'Step 6: Publish Selected Data', stepNumber: 6, content, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');
  const publishServers = c.get('publishServers') || [];
  const kp = session.keypair;
  const commitment = session.commitment;
  const receipt = session.receipt;
  const selectedItems = session.selectedItems || [];

  // Build files for selected items
  const files = [];
  for (const hash of selectedItems) {
    const idx = commitment.items.indexOf(hash);
    if (idx >= 0 && session.sampleData?.[idx]) {
      files.push({
        name: `item-${idx + 1}.txt`,
        data: session.sampleData[idx],
        hash,
      });
    }
  }

  // Upload to all publish servers (embedded + remote with Ed25519 anon auth)
  const uploads = [];
  for (const server of publishServers) {
    try {
      const result = await uploadToPublishServer(server, receipt, files, kp);
      uploads.push({ serverName: server.name, serverUrl: server.url, ...result });
    } catch (err) {
      uploads.push({ serverName: server.name, serverUrl: server.url, status: 'error', error: err.message });
    }
  }

  // Build file_urls: store both local and public URLs per hash so step 7
  // can send the right URLs to each server (localhost to embedded, public to remote).
  const fileUrlMap = {};
  for (const upload of uploads) {
    if (upload.status !== 'ok' || !upload.files) continue;
    for (const f of upload.files) {
      if (!fileUrlMap[f.hash]) fileUrlMap[f.hash] = {};
      const isLocal = f.url.includes('localhost') || f.url.includes('127.0.0.1');
      if (isLocal) {
        fileUrlMap[f.hash].local = f.url;
      } else {
        fileUrlMap[f.hash].public = f.url;
      }
    }
  }

  session.publishResults = { uploads };
  session.fileUrlMap = fileUrlMap;
  session._completedStep = Math.max(session._completedStep || 0, 6);
  return c.redirect('/steps/6');
});

export default route;
