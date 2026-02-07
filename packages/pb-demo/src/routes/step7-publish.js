import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, jsonBlock, nextButton, note } from '../template.js';

const route = new Hono();

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeDemoMirrorUrls(commitmentHash) {
  const prefix = commitmentHash.slice(0, 12);
  const date = new Date().toISOString().slice(0, 10);
  return [
    {
      url: `https://github.com/demo-user/peerbench-reveals/tree/main/reveals/${date}-${prefix}`,
      provider: 'github',
    },
    {
      url: `https://huggingface.co/datasets/demo-user/peerbench-reveals/tree/main/reveals/${date}-${prefix}`,
      provider: 'huggingface',
    },
  ];
}

async function submitMirrorsToAllServers(mirrors, commitmentHash, kp, pbServers) {
  const allResults = [];

  for (const mirror of mirrors) {
    const mirrorPayload = {
      spec_version: '0.2.0',
      commitment_hash: commitmentHash,
      url: mirror.url,
      provider: mirror.provider,
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
            url: mirror.url,
            provider: mirror.provider,
          };
        } else {
          let errMsg;
          try {
            const errBody = await res.json();
            errMsg = errBody.error || `HTTP ${res.status}`;
          } catch {
            errMsg = `HTTP ${res.status}`;
          }
          return {
            name: server.name,
            status: 'error',
            error: errMsg,
            url: mirror.url,
            provider: mirror.provider,
          };
        }
      })
    );

    allResults.push(
      ...results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          name: pbServers[i].name,
          status: 'error',
          error: r.reason?.message || 'Unknown error',
          url: mirror.url,
          provider: mirror.provider,
        };
      })
    );
  }

  return allResults;
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.reveal) return c.redirect('/steps/6');

  const mirrorResults = session.mirrorResults;
  const commitment = session.commitment;

  let content;
  if (!mirrorResults) {
    const demoUrls = makeDemoMirrorUrls(commitment.commitment_hash);

    content = `
      <p>After revealing your data, the next step is to <strong>publish</strong> it somewhere
      publicly accessible and <strong>register those URLs</strong> with the commit-reveal servers
      as "data mirrors".</p>

      <h2>Why Register Mirrors?</h2>
      <p>The commit-reveal servers store <em>metadata</em> (hashes, receipts, signatures) but not
      the actual data. By registering mirror URLs, anyone looking up your commitment can find
      where to download and verify the data.</p>

      <h2>Simulated Data Mirrors</h2>
      <p>In this demo, we'll register two simulated mirror URLs:</p>
      <ul class="item-list">
        ${demoUrls.map(m => `<li><strong>${esc(m.provider)}</strong>: ${esc(m.url)}</li>`).join('')}
      </ul>

      ${note('In production, you would first publish data via <code>pb publish github &lt;dir&gt;</code>, which automatically registers the mirror URL with all known servers.')}

      ${button('Register Data Mirrors')}
    `;
  } else {
    const okResults = mirrorResults.filter(r => r.status === 'ok');

    // Group by server
    const byServer = {};
    for (const r of mirrorResults) {
      if (!byServer[r.name]) byServer[r.name] = [];
      byServer[r.name].push(r);
    }

    const serverBlocks = Object.entries(byServer).map(([name, results]) => {
      const allOk = results.every(r => r.status === 'ok');
      const rows = results.map(r => {
        if (r.status === 'ok') {
          return `
            <div style="padding:8px 0;border-bottom:1px solid #eee">
              <span class="check" style="font-size:1.1rem">\u2713</span>
              <strong>${esc(r.provider)}</strong>: ${esc(r.url)}
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

    content = `
      <p>Registered ${okResults.length} mirror(s) across ${Object.keys(byServer).length} server(s).</p>
      ${note(`<strong>${okResults.length}</strong> of ${mirrorResults.length} mirror registration(s) succeeded.`)}
      ${serverBlocks}

      ${note('Anyone can now query <code>GET /v1/commitments/:hash/mirrors</code> on any server to discover where the data lives. Multiple mirrors provide redundancy and discoverability.')}

      ${nextButton(8)}
    `;
  }

  return c.html(page({ title: 'Step 7: Publish & Register Mirrors', stepNumber: 7, content, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');
  const kp = session.keypair;
  const commitment = session.commitment;

  const demoUrls = makeDemoMirrorUrls(commitment.commitment_hash);

  const mirrorResults = await submitMirrorsToAllServers(
    demoUrls, commitment.commitment_hash, kp, pbServers
  );

  session.mirrorResults = mirrorResults;
  session._completedStep = Math.max(session._completedStep || 0, 7);
  return c.redirect('/steps/7');
});

export default route;
