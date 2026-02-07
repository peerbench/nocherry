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

/**
 * Register a mirror URL with all commit-reveal servers.
 */
async function registerMirrorWithServers(mirrorUrl, provider, commitmentHash, kp, pbServers) {
  const mirrorPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitmentHash,
    url: mirrorUrl,
    provider,
    registered_at: new Date().toISOString(),
    signing_key: kp.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
  const signature = wasm.signMessage(kp.private_key_hex, payloadBytes);
  const signed = { ...mirrorPayload, signature };

  const results = await Promise.allSettled(
    pbServers.map(async (server) => {
      const res = await server.client.request(
        `http://localhost/v1/commitments/${commitmentHash}/mirrors`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
        }
      );

      if (res.ok) {
        const body = await res.json();
        return {
          name: server.name,
          status: 'ok',
          mirrorId: body.mirror_id,
          serverRegisteredAt: body.server_registered_at,
          url: mirrorUrl,
          provider,
        };
      } else {
        let errMsg;
        try {
          const errBody = await res.json();
          errMsg = errBody.error || `HTTP ${res.status}`;
        } catch {
          errMsg = `HTTP ${res.status}`;
        }
        return { name: server.name, status: 'error', error: errMsg, url: mirrorUrl, provider };
      }
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: pbServers[i].name,
      status: 'error',
      error: r.reason?.message || 'Unknown error',
      url: mirrorUrl,
      provider,
    };
  });
}

function remoteServerSection(publishServers, signingKeyHex, hasPublishResults) {
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
      <summary style="cursor:pointer;font-weight:600;color:var(--accent2)">Remote Publish Servers (Optional)</summary>
      <div style="margin-top:12px">
        <p style="font-size:0.9rem;color:#444">You can also publish to remote servers hosted on Cloudflare R2 and Google Cloud Storage.
        First link your signing key via Google OAuth, then publish.</p>
        ${serverRows}
        ${hasPublishResults ? `
          <form method="POST" action="/steps/6/remote" style="margin-top:12px">
            <button type="submit" class="btn" style="background:#6c757d">Publish to Remote Servers</button>
          </form>
        ` : ''}
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
        <h3>${esc(u.serverName)} <span class="cross">FAILED</span></h3>
        <p style="color:#e63946">${esc(u.error)}</p>
      </div>`;
  }
}

function renderMirrorBlocks(mirrorResults) {
  if (mirrorResults.length === 0) return '';

  const okMirrors = mirrorResults.filter(r => r.status === 'ok');
  const byServer = {};
  for (const r of mirrorResults) {
    if (!byServer[r.name]) byServer[r.name] = [];
    byServer[r.name].push(r);
  }

  const blocks = Object.entries(byServer).map(([name, results]) => {
    const allOk = results.every(r => r.status === 'ok');
    const rows = results.map(r => {
      if (r.status === 'ok') {
        return `
          <div style="padding:8px 0;border-bottom:1px solid #eee">
            <span class="check" style="font-size:1.1rem">\u2713</span>
            <strong>${esc(r.provider)}</strong>: <a href="${esc(r.url)}" target="_blank" style="color:var(--accent)">${esc(r.url)}</a>
            <div style="font-size:0.8rem;color:#666">mirror_id: ${esc(r.mirrorId)}</div>
          </div>`;
      } else {
        return `
          <div style="padding:8px 0;border-bottom:1px solid #eee">
            <span class="cross" style="font-size:1.1rem">\u2717</span>
            <strong>${esc(r.provider)}</strong>: ${esc(r.url)}
            <div style="font-size:0.8rem;color:#e63946">${esc(r.error)}</div>
          </div>`;
      }
    }).join('');

    return `
      <div class="server-result">
        <h3>${esc(name)} <span class="${allOk ? 'check' : 'cross'}">${allOk ? 'OK' : 'PARTIAL'}</span></h3>
        ${rows}
      </div>`;
  }).join('');

  return `
    <h2>Mirror Registration</h2>
    <p>Registered ${okMirrors.length} mirror(s) across ${Object.keys(byServer).length} server(s).</p>
    ${blocks}
  `;
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

    // Only show embedded publish server in the demo (remote servers require OAuth signup)
    const embeddedServers = publishServers.filter(s => s.environment === 'embedded');
    const serverList = embeddedServers.length > 0
      ? embeddedServers.map(s => `<li><strong>${esc(s.name)}</strong>: ${esc(s.url)}</li>`).join('')
      : '<li style="color:#e63946">No publish servers configured</li>';

    content = `
      <p>Before telling the servers what you're revealing, first <strong>upload the selected data</strong>
      to a publish server so it's publicly accessible, then <strong>register the URL</strong> as a data mirror.</p>

      <h2>Items to Publish</h2>
      <p><strong>${selectedItems.length} item(s)</strong> randomly selected by the beacon:</p>
      <ul class="item-list">${itemList}</ul>

      ${note(`Only the randomly selected items are published. The beacon chose which items to audit —
      this is the anti-cherry-picking guarantee. Non-selected items remain private.`)}

      <h2>Publish Server</h2>
      <p>Data will be uploaded to:</p>
      <ul class="item-list">${serverList}</ul>

      ${note('The publish server stores the actual data files (not just hashes). After upload, the returned URL is registered as a mirror with the embedded commit-reveal server.')}

      ${button('Publish Selected Random Sample')}

      ${remoteServerSection(publishServers, signingKeyHex, false)}
    `;
  } else {
    const uploadBlocks = publishResults.uploads.map(renderUploadBlock).join('');
    const mirrorResults = publishResults.mirrors || [];

    content = `
      <h2>Upload Results</h2>
      ${uploadBlocks}

      ${renderMirrorBlocks(mirrorResults)}

      ${note('Data is now publicly accessible. Next, submit the reveal to formally tell the servers which items you\'re revealing.')}

      ${remoteServerSection(publishServers, signingKeyHex, true)}

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

  // Upload to embedded publish server only (remote servers require OAuth signup)
  const embeddedPublishServers = publishServers.filter(s => s.environment === 'embedded');
  const uploads = [];
  for (const server of embeddedPublishServers) {
    try {
      const result = await uploadToPublishServer(server, receipt, files, kp);
      uploads.push({ serverName: server.name, serverUrl: server.url, ...result });
    } catch (err) {
      uploads.push({ serverName: server.name, serverUrl: server.url, status: 'error', error: err.message });
    }
  }

  // Register mirrors for each successful upload
  const allMirrorResults = [];
  for (const upload of uploads) {
    if (upload.status !== 'ok' || !upload.files) continue;

    // The upload response includes per-file URLs; register the base path as a mirror
    const baseUrl = upload.files[0]?.url?.replace(/\/[^/]+$/, '') || upload.serverUrl;
    const provider = 'peerbench';

    // Only register localhost URLs with the embedded server (remote servers can't reach localhost)
    const isLocalUrl = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
    const targetServers = isLocalUrl
      ? pbServers.filter(s => s.environment === 'embedded')
      : pbServers;

    const mirrorResults = await registerMirrorWithServers(
      baseUrl, provider, commitment.commitment_hash, kp, targetServers
    );
    allMirrorResults.push(...mirrorResults);
  }

  session.publishResults = { uploads, mirrors: allMirrorResults };
  session.mirrorResults = allMirrorResults.length > 0 ? allMirrorResults : uploads; // ensure step 7 guard passes
  session._completedStep = Math.max(session._completedStep || 0, 6);
  return c.redirect('/steps/6');
});

// Publish to remote servers (optional, requires OAuth-linked key)
route.post('/remote', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');
  const publishServers = c.get('publishServers') || [];
  const kp = session.keypair;
  const commitment = session.commitment;
  const receipt = session.receipt;
  const selectedItems = session.selectedItems || [];

  if (!session.publishResults) return c.redirect('/steps/6');

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

  // Upload to remote publish servers only
  const remotePublishServers = publishServers.filter(s => s.environment !== 'embedded');
  const remoteUploads = [];
  for (const server of remotePublishServers) {
    try {
      const result = await uploadToPublishServer(server, receipt, files, kp);
      remoteUploads.push({ serverName: server.name, serverUrl: server.url, ...result });
    } catch (err) {
      remoteUploads.push({ serverName: server.name, serverUrl: server.url, status: 'error', error: err.message });
    }
  }

  // Register mirrors for successful remote uploads with all commit-reveal servers
  const remoteMirrorResults = [];
  for (const upload of remoteUploads) {
    if (upload.status !== 'ok' || !upload.files) continue;

    const baseUrl = upload.files[0]?.url?.replace(/\/[^/]+$/, '') || upload.serverUrl;
    const provider = 'peerbench';

    const mirrorResults = await registerMirrorWithServers(
      baseUrl, provider, commitment.commitment_hash, kp, pbServers
    );
    remoteMirrorResults.push(...mirrorResults);
  }

  // Merge remote results into existing publish results
  session.publishResults.uploads.push(...remoteUploads);
  session.publishResults.mirrors.push(...remoteMirrorResults);

  return c.redirect('/steps/6');
});

export default route;
