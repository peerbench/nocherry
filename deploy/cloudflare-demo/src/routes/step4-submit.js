import { Hono } from 'hono';
import { page, field, jsonBlock, nextButton, note } from '../template.js';

const route = new Hono();

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function submitToAllServers(commitment, pbServers) {
  const results = await Promise.allSettled(
    pbServers.map(async (server) => {
      const res = await server.client.request('http://localhost/v1/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitment),
      });

      if (res.ok) {
        const receipt = await res.json();
        return { name: server.name, status: 'ok', receipt, error: null };
      } else {
        let errMsg;
        try {
          const errBody = await res.json();
          errMsg = errBody.error || `HTTP ${res.status}`;
        } catch {
          errMsg = `HTTP ${res.status}`;
        }
        return { name: server.name, status: 'error', receipt: null, error: errMsg };
      }
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: pbServers[i].name,
      status: 'error',
      receipt: null,
      error: r.reason?.message || 'Unknown error',
    };
  });
}

function receiptHTML(receipt) {
  const arrival = receipt.arrival_beacon;
  const selBeacon = receipt.selection?.beacon_output;
  return `
    <p>The server accepted the commitment and returned a signed receipt.</p>
    ${field('Status', '201 Created', false)}
    ${field('Registered At', receipt.registered_at)}
    ${field('Server Key', receipt.server_key)}
    ${field('Server Signature', receipt.server_signature)}

    <h3>Beacon Rounds</h3>
    ${arrival ? `
      <p style="font-size:0.9rem;color:#666;margin-bottom:4px"><strong>Arrival beacon</strong> — the latest drand round when the commitment was received (already public):</p>
      ${field('Arrival Round', arrival.round, false)}
      ${field('Arrival Randomness', arrival.randomness)}
    ` : '<p style="color:#999">Arrival beacon not available</p>'}
    ${selBeacon ? `
      <p style="font-size:0.9rem;color:#666;margin-bottom:4px;margin-top:12px"><strong>Selection beacon</strong> — the next drand round after arrival (not yet public at commit time, used for selection):</p>
      ${field('Selection Round', selBeacon.round, false)}
      ${field('Selection Randomness', selBeacon.randomness)}
    ` : ''}

    <h3>Signer Activity</h3>
    ${field('Past Hour', receipt.signer_activity?.commitments_past_hour ?? 'N/A', false)}
    ${field('Past Month', receipt.signer_activity?.commitments_past_month ?? 'N/A', false)}

    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:0.85rem;color:#666">Full Receipt JSON</summary>
      ${jsonBlock(receipt)}
    </details>
  `;
}

function renderServerResults(serverResults) {
  const successCount = serverResults.filter(r => r.status === 'ok').length;
  const blocks = serverResults.map(r => {
    if (r.status === 'ok') {
      return `
        <div class="server-result">
          <h2>${esc(r.name)} <span class="check">OK</span></h2>
          ${receiptHTML(r.receipt)}
        </div>`;
    } else {
      return `
        <div class="server-result">
          <h2>${esc(r.name)} <span class="cross">ERROR</span></h2>
          <p style="color:#e63946">${esc(r.error)}</p>
        </div>`;
    }
  }).join('');

  return `
    ${note(`Submitted to <strong>${serverResults.length} server(s)</strong>: ${successCount} succeeded, ${serverResults.length - successCount} failed.`)}
    ${blocks}
  `;
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.commitment) return c.redirect('/steps/3');
  const pbServers = c.get('pbServers');

  const serverResults = session.serverResults;

  // Post-submit state: show aggregated results
  if (serverResults && serverResults.length > 0) {
    const content = `
      <div id="receipt-result">
        ${renderServerResults(serverResults)}
      </div>
      ${nextButton(5)}
    `;
    return c.html(page({ title: 'Step 4: Submit to Servers', stepNumber: 4, content, session }));
  }

  // Pre-submit: left panel = submit form, right panel = live server health + beacon
  const serverListJSON = JSON.stringify(pbServers.map(s => ({
    name: s.name,
    environment: s.environment || 'embedded',
    url: s.url || 'embedded',
  })));

  const rightPanel = `
    <div class="code-panel">
      <h3>Servers</h3>
      <div id="server-list" style="margin-bottom:20px">
        <div style="color:#a6adc8;font-size:0.85rem">Checking servers...</div>
      </div>

      <h3 style="margin-top:20px">Live drand Beacon</h3>
      <div class="beacon-status" id="beacon-status">Connecting to drand network...</div>
      <div class="beacon-list" id="beacon-list"></div>
    </div>
  `;

  const content = `
    <div id="submit-section">
      <p>Now we submit the commitment to the server(s). Each server will:</p>
      <ol>
        <li>Validate the Ed25519 signature</li>
        <li>Verify <code>commitment_hash == SHA-256(signing_payload)</code></li>
        <li>Record a server-side <code>registered_at</code> timestamp</li>
        <li>Wait for the next drand beacon output (~0-3 seconds)</li>
        <li>Compute selection (which items are randomly chosen for reveal)</li>
        <li>Sign the entire response with the server's key</li>
        <li>Return a self-contained receipt</li>
      </ol>
      ${note('The commitment is submitted to <strong>all known servers</strong> in parallel. Each server independently records the commitment and waits for the same drand beacon round. You get back one receipt per server.')}
      <button type="button" id="submit-btn" class="btn">Submit to All Servers</button>
      <noscript>
        <form method="POST">
          <button type="submit" class="btn">Submit to All Servers</button>
        </form>
      </noscript>
      <p style="margin-top:8px;font-size:0.85rem;color:#666">This may take a few seconds while waiting for the drand beacon...</p>
    </div>

    <div id="receipt-result"></div>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
      var SERVER_LIST = ${serverListJSON};
      var CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
      var GENESIS = 1692803367;
      var PERIOD = 3;
      var API_BASE = 'https://api.drand.sh/' + CHAIN_HASH + '/public';

      var serverListEl = document.getElementById('server-list');
      var beaconList = document.getElementById('beacon-list');
      var beaconStatus = document.getElementById('beacon-status');
      var submitBtn = document.getElementById('submit-btn');
      var receiptResult = document.getElementById('receipt-result');
      var rounds = {};
      var selectionRound = null;
      var submitted = false;

      // ── Server Health Checks ──
      function renderServerList(results) {
        var html = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var dot = r.status === 'checking' ? '\\u25CB'
                  : r.status === 'ok' ? '\\u25CF'
                  : '\\u25CF';
          var color = r.status === 'checking' ? '#a6adc8'
                    : r.status === 'ok' ? '#a6e3a1'
                    : '#f38ba8';
          var latency = r.latencyMs != null ? ' (' + r.latencyMs + 'ms)' : '';
          var details = '<div style="font-size:0.7rem;color:#585b70;margin-top:4px;word-break:break-all">'
            + '<div>url: ' + escapeHTML(r.url) + '</div>'
            + '<div>server_key: ' + escapeHTML(r.serverKey || '(pending)') + '</div>'
            + '<div>environment: ' + escapeHTML(r.environment) + '</div>'
            + '</div>';
          html += '<div style="padding:8px 10px;margin:4px 0;background:#181825;border-radius:4px;font-size:0.85rem">'
            + '<div style="display:flex;align-items:center;gap:8px">'
            + '<span style="color:' + color + '">' + dot + '</span>'
            + '<span style="color:#cdd6f4;flex:1">' + escapeHTML(r.name) + '</span>'
            + '<span style="color:' + color + ';font-size:0.8rem">' + escapeHTML(r.statusText) + latency + '</span>'
            + '</div>'
            + details
            + '</div>';
        }
        serverListEl.innerHTML = html;
      }

      function checkServers() {
        var results = SERVER_LIST.map(function(s) {
          return { name: s.name, url: s.url, environment: s.environment, status: 'checking', statusText: 'checking...', serverKey: null, latencyMs: null };
        });
        renderServerList(results);

        fetch('/steps/4/health')
          .then(function(res) { return res.json(); })
          .then(function(data) {
            results = data.map(function(r) {
              return {
                name: r.name,
                url: r.url || 'embedded',
                environment: r.environment || 'embedded',
                status: r.status,
                statusText: r.status === 'ok' ? 'healthy' : r.error || 'unreachable',
                serverKey: r.server_key || null,
                latencyMs: r.latencyMs,
              };
            });
            renderServerList(results);
          })
          .catch(function() {
            results = results.map(function(r) {
              r.status = 'error'; r.statusText = 'check failed';
              return r;
            });
            renderServerList(results);
          });
      }

      // ── Beacon Ticker ──
      function timeAgo(round) {
        var roundTime = GENESIS + (round - 1) * PERIOD;
        var diff = Math.floor(Date.now() / 1000 - roundTime);
        if (diff < 1) return 'now';
        if (diff < 60) return diff + 's ago';
        return Math.floor(diff / 60) + 'm ago';
      }

      function addRoundToUI(data) {
        if (rounds[data.round]) return;
        rounds[data.round] = data;

        var el = document.createElement('div');
        el.className = 'beacon-round latest';
        el.setAttribute('data-round', data.round);
        var randHex = data.randomness.substring(0, 32);
        el.innerHTML =
          '<span class="round-num">#' + data.round + '</span>' +
          '<span class="round-rand">' + randHex + '...</span>' +
          '<span class="round-time">' + timeAgo(data.round) + '</span>';

        var prev = beaconList.querySelectorAll('.latest');
        for (var i = 0; i < prev.length; i++) prev[i].classList.remove('latest');
        beaconList.insertBefore(el, beaconList.firstChild);
        while (beaconList.children.length > 20) beaconList.removeChild(beaconList.lastChild);

        if (selectionRound && data.round === selectionRound) highlightRound(selectionRound);
      }

      function highlightRound(round) {
        var el = beaconList.querySelector('[data-round="' + round + '"]');
        if (el) {
          el.classList.add('highlighted');
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function updateTimes() {
        var els = beaconList.querySelectorAll('.beacon-round');
        for (var i = 0; i < els.length; i++) {
          var r = parseInt(els[i].getAttribute('data-round'), 10);
          els[i].querySelector('.round-time').textContent = timeAgo(r);
        }
      }

      async function fetchLatest() {
        try {
          var resp = await fetch(API_BASE + '/latest');
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          var data = await resp.json();
          addRoundToUI(data);
          beaconStatus.textContent = 'Round #' + data.round + ' — streaming live from drand quicknet';
        } catch (err) {
          beaconStatus.textContent = 'Beacon fetch error — retrying...';
        }
      }

      function startTicker() {
        fetchLatest();
        setInterval(function() { fetchLatest(); updateTimes(); }, 2000);
      }

      // ── Helpers ──
      function escapeHTML(s) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(s));
        return div.innerHTML;
      }

      function fieldHTML(label, value, mono) {
        var cls = mono !== false ? 'mono' : '';
        return '<div class="field"><span class="field-label">' + escapeHTML(label) + '</span><span class="field-value ' + cls + '">' + escapeHTML(String(value)) + '</span></div>';
      }

      function renderReceipt(receipt) {
        var arrival = receipt.arrival_beacon;
        var selBeacon = receipt.selection && receipt.selection.beacon_output;
        var html = '<p>The server accepted the commitment and returned a signed receipt.</p>';
        html += fieldHTML('Status', '201 Created', false);
        html += fieldHTML('Registered At', receipt.registered_at);
        html += fieldHTML('Server Key', receipt.server_key);
        html += fieldHTML('Server Signature', receipt.server_signature);
        html += '<h3>Beacon Rounds</h3>';
        if (arrival) {
          html += '<p style="font-size:0.9rem;color:#666;margin-bottom:4px"><strong>Arrival beacon</strong>:</p>';
          html += fieldHTML('Arrival Round', arrival.round, false);
          html += fieldHTML('Arrival Randomness', arrival.randomness);
        }
        if (selBeacon) {
          html += '<p style="font-size:0.9rem;color:#666;margin-bottom:4px;margin-top:12px"><strong>Selection beacon</strong>:</p>';
          html += fieldHTML('Selection Round', selBeacon.round, false);
          html += fieldHTML('Selection Randomness', selBeacon.randomness);
        }
        html += '<h3>Signer Activity</h3>';
        var pastHour = (receipt.signer_activity && receipt.signer_activity.commitments_past_hour) != null ? receipt.signer_activity.commitments_past_hour : 'N/A';
        var pastMonth = (receipt.signer_activity && receipt.signer_activity.commitments_past_month) != null ? receipt.signer_activity.commitments_past_month : 'N/A';
        html += fieldHTML('Past Hour', pastHour, false);
        html += fieldHTML('Past Month', pastMonth, false);
        return html;
      }

      function appendServerResult(result) {
        var div = document.createElement('div');
        div.className = 'server-result fade-in';
        if (result.status === 'ok') {
          div.innerHTML = '<h2>' + escapeHTML(result.name) + ' <span class="check">OK</span></h2>' + renderReceipt(result.receipt);
        } else {
          div.innerHTML = '<h2>' + escapeHTML(result.name) + ' <span class="cross">ERROR</span></h2><p style="color:#e63946">' + escapeHTML(result.error) + '</p>';
        }
        receiptResult.appendChild(div);
      }

      // ── Submit Handler ──
      async function handleSubmit() {
        if (submitted) return;
        submitted = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Submitting to all servers...';
        beaconStatus.textContent = 'Submitting commitment to all servers...';

        var progressEl = document.createElement('div');
        progressEl.className = 'note';
        progressEl.id = 'stream-progress';
        progressEl.innerHTML = '<span class="spinner"></span> Waiting for server responses...';

        try {
          var resp = await fetch('/steps/4/api', { method: 'POST' });

          if (!resp.ok) {
            var json = await resp.json();
            if (resp.status === 400) {
              window.location.href = '/steps/1';
              return;
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit to All Servers';
            submitted = false;
            beaconStatus.textContent = 'Error: ' + (json.error || 'Unknown error') + ' — try again';
            return;
          }

          // Stream started — hide submit button, show progress
          submitBtn.style.display = 'none';
          receiptResult.appendChild(progressEl);

          var reader = resp.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';
          var successCount = 0;
          var failCount = 0;
          var totalServers = 0;

          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });

            var lines = buffer.split('\\n');
            buffer = lines.pop(); // keep incomplete line in buffer

            for (var i = 0; i < lines.length; i++) {
              if (!lines[i].trim()) continue;
              var result = JSON.parse(lines[i]);
              totalServers = result.total;

              if (result.status === 'ok') {
                successCount++;
                // Highlight selection round on first OK
                if (successCount === 1 && result.receipt) {
                  selectionRound = result.receipt.selection && result.receipt.selection.beacon_output && result.receipt.selection.beacon_output.round;
                  if (selectionRound) {
                    beaconStatus.textContent = 'Selection round #' + selectionRound + ' — highlighted below';
                    highlightRound(selectionRound);
                  }
                }
              } else {
                failCount++;
              }

              appendServerResult(result);
              progressEl.innerHTML = 'Received <strong>' + result.received + '</strong> of <strong>' + totalServers + '</strong> — ' + successCount + ' succeeded, ' + failCount + ' failed.';
            }
          }

          // Stream finished — update progress to final summary and show continue link
          var totalReceived = successCount + failCount;
          progressEl.innerHTML = 'Submitted to <strong>' + totalReceived + ' server(s)</strong>: ' + successCount + ' succeeded, ' + failCount + ' failed.';

          if (successCount > 0) {
            var continueLink = document.createElement('a');
            continueLink.href = '/steps/5';
            continueLink.className = 'btn btn-next';
            continueLink.innerHTML = 'Continue to Step 5 &rarr;';
            receiptResult.appendChild(continueLink);
          }
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit to All Servers';
          submitBtn.style.display = '';
          submitted = false;
          beaconStatus.textContent = 'Network error — try again';
          if (progressEl.parentNode) progressEl.parentNode.removeChild(progressEl);
        }
      }

      if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
      checkServers();
      startTicker();
    });
    </script>
  `;

  return c.html(page({
    title: 'Step 4: Submit to Servers',
    stepNumber: 4,
    content,
    rightPanel,
    session,
  }));
});

// Health check API — pings all servers in parallel
route.get('/health', async (c) => {
  const pbServers = c.get('pbServers');

  const results = await Promise.allSettled(
    pbServers.map(async (server) => {
      const start = Date.now();
      const res = await server.client.request('http://localhost/health');
      const latencyMs = Date.now() - start;

      if (res.ok) {
        let serverKey = null;
        try {
          const infoRes = await server.client.request('http://localhost/v1/server-info');
          if (infoRes.ok) {
            const info = await infoRes.json();
            serverKey = info.server_key;
          }
        } catch {}
        return { name: server.name, url: server.url || 'embedded', environment: server.environment || 'embedded', status: 'ok', latencyMs, server_key: serverKey };
      } else {
        return { name: server.name, url: server.url || 'embedded', environment: server.environment || 'embedded', status: 'error', latencyMs, error: `HTTP ${res.status}` };
      }
    })
  );

  const data = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: pbServers[i].name,
      url: pbServers[i].url || 'embedded',
      environment: pbServers[i].environment || 'embedded',
      status: 'error',
      latencyMs: null,
      error: r.reason?.message || 'Unreachable',
    };
  });

  return c.json(data);
});

// NDJSON streaming API for JS-driven submit
route.post('/api', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');

  if (!session.commitment) {
    return c.json({ error: 'No commitment in session' }, 400);
  }

  const commitment = session.commitment;
  const total = pbServers.length;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const serverResults = [];

      const tasks = pbServers.map(async (server) => {
        let result;
        try {
          const res = await server.client.request('http://localhost/v1/commitments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(commitment),
          });

          if (res.ok) {
            const receipt = await res.json();
            result = { name: server.name, status: 'ok', receipt, error: null };
          } else {
            let errMsg;
            try {
              const errBody = await res.json();
              errMsg = errBody.error || `HTTP ${res.status}`;
            } catch {
              errMsg = `HTTP ${res.status}`;
            }
            result = { name: server.name, status: 'error', receipt: null, error: errMsg };
          }
        } catch (err) {
          result = { name: server.name, status: 'error', receipt: null, error: err.message || 'Unknown error' };
        }

        serverResults.push(result);
        const line = JSON.stringify({ ...result, total, received: serverResults.length }) + '\n';
        controller.enqueue(encoder.encode(line));
      });

      await Promise.allSettled(tasks);

      // Update session after all servers responded
      session.serverResults = serverResults;
      const firstOk = serverResults.find(r => r.status === 'ok');
      if (firstOk) {
        session.receipt = firstOk.receipt;
        session._completedStep = Math.max(session._completedStep || 0, 4);
      } else {
        session.submitError = serverResults.map(r => `${r.name}: ${r.error}`).join('; ');
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
});

// Non-JS fallback: form POST with redirect
route.post('/', async (c) => {
  const session = c.get('session');
  const pbServers = c.get('pbServers');

  const serverResults = await submitToAllServers(session.commitment, pbServers);
  session.serverResults = serverResults;

  const firstOk = serverResults.find(r => r.status === 'ok');
  if (firstOk) {
    session.receipt = firstOk.receipt;
    session._completedStep = Math.max(session._completedStep || 0, 4);
  } else {
    session.submitError = serverResults.map(r => `${r.name}: ${r.error}`).join('; ');
  }
  return c.redirect('/steps/4');
});

export default route;
