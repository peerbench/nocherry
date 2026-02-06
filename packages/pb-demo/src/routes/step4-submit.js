import { Hono } from 'hono';
import { page, field, jsonBlock, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('packages/pb-node/src/routes/commitments.js', 18, 100, 'Server: POST /v1/commitments handler'),
  codeRef('packages/pb-node/src/signing.js', 39, 53, 'Server: signResponse — countersigning'),
  codeRef('packages/pb-node/src/beacon.js', 47, 76, 'Server: getBeaconOutput — fetch drand'),
];

function receiptHTML(receipt) {
  const arrival = receipt.arrival_beacon;
  const selBeacon = receipt.selection?.beacon_output;
  return `
    <p>The server accepted the commitment and returned a signed receipt.</p>
    ${field('Status', '201 Created', false)}
    ${field('Registered At', receipt.registered_at)}
    ${field('Server Key', receipt.server_key)}
    ${field('Server Signature', receipt.server_signature)}

    <h2>Beacon Rounds</h2>
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
    ${arrival && selBeacon ? note('The arrival round (<strong>' + arrival.round + '</strong>) was already known when you submitted. The selection round (<strong>' + selBeacon.round + '</strong>) hadn\'t been published yet — proving you couldn\'t have known the randomness that determines which items get selected.') : ''}

    <h2>Signer Activity</h2>
    ${field('Past Hour', receipt.signer_activity?.commitments_past_hour ?? 'N/A', false)}
    ${field('Past Month', receipt.signer_activity?.commitments_past_month ?? 'N/A', false)}
    ${note('The server tracks how many commitments this signing key has made. This is transparent context, not rate limiting — the server never rejects based on activity.')}
    <h2>Full Receipt</h2>
    ${jsonBlock(receipt)}
    ${nextButton(5)}
  `;
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.commitment) return c.redirect('/steps/3');

  const receipt = session.receipt;

  // Post-submit state: show static receipt (page reload / JS disabled fallback)
  if (receipt) {
    const content = `<div id="receipt-result">${receiptHTML(receipt)}</div>`;
    return c.html(page({ title: 'Step 4: Submit to Server', stepNumber: 4, content, codeRefs: refs, session }));
  }

  // Pre-submit state: show beacon ticker + submit button
  const content = `
    <div id="submit-section">
      <p>Now we submit the commitment to the server. The server will:</p>
      <ol>
        <li>Validate the Ed25519 signature</li>
        <li>Verify <code>commitment_hash == SHA-256(signing_payload)</code></li>
        <li>Record a server-side <code>registered_at</code> timestamp</li>
        <li>Wait for the next drand beacon output (~0-3 seconds)</li>
        <li>Compute selection (which items are randomly chosen for reveal)</li>
        <li>Sign the entire response with the server's key</li>
        <li>Return a self-contained receipt</li>
      </ol>
      ${note('The server holds the connection until the beacon fires. For drand quicknet this is at most 3 seconds. The receipt you get back contains <em>everything</em> needed for offline verification.')}
      <!-- JS submit button (visible when JS enabled) -->
      <button type="button" id="submit-btn" class="btn">Submit to Server</button>
      <!-- Non-JS fallback form (hidden when JS enabled) -->
      <noscript>
        <form method="POST">
          <button type="submit" class="btn">Submit to Server</button>
        </form>
      </noscript>
      <p style="margin-top:8px;font-size:0.85rem;color:#666">This may take a few seconds while waiting for the drand beacon...</p>
    </div>

    <div class="beacon-ticker">
      <h2>Live drand Beacon</h2>
      <div class="beacon-status" id="beacon-status">Connecting to drand network...</div>
      <div class="beacon-list" id="beacon-list"></div>
    </div>

    <div id="receipt-result"></div>

    <script>
    (function() {
      var CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
      var GENESIS = 1692803367;
      var PERIOD = 3;
      var API_BASE = 'https://api.drand.sh/' + CHAIN_HASH + '/public';

      var beaconList = document.getElementById('beacon-list');
      var beaconStatus = document.getElementById('beacon-status');
      var submitBtn = document.getElementById('submit-btn');
      var receiptResult = document.getElementById('receipt-result');
      var rounds = {};
      var selectionRound = null;
      var submitted = false;
      var tickerInterval = null;

      function currentRoundNumber() {
        return Math.floor((Date.now() / 1000 - GENESIS) / PERIOD) + 1;
      }

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

        // Remove 'latest' class from previous entries
        var prev = beaconList.querySelectorAll('.latest');
        for (var i = 0; i < prev.length; i++) prev[i].classList.remove('latest');

        beaconList.insertBefore(el, beaconList.firstChild);

        // Trim to 20 entries
        while (beaconList.children.length > 20) {
          beaconList.removeChild(beaconList.lastChild);
        }

        if (selectionRound && data.round === selectionRound) {
          highlightRound(selectionRound);
        }
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
        tickerInterval = setInterval(function() {
          fetchLatest();
          updateTimes();
        }, 2000);
      }

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
        html += '<h2>Beacon Rounds</h2>';
        if (arrival) {
          html += '<p style="font-size:0.9rem;color:#666;margin-bottom:4px"><strong>Arrival beacon</strong> — the latest drand round when the commitment was received (already public):</p>';
          html += fieldHTML('Arrival Round', arrival.round, false);
          html += fieldHTML('Arrival Randomness', arrival.randomness);
        }
        if (selBeacon) {
          html += '<p style="font-size:0.9rem;color:#666;margin-bottom:4px;margin-top:12px"><strong>Selection beacon</strong> — the next drand round after arrival (not yet public at commit time, used for selection):</p>';
          html += fieldHTML('Selection Round', selBeacon.round, false);
          html += fieldHTML('Selection Randomness', selBeacon.randomness);
        }
        if (arrival && selBeacon) {
          html += '<div class="note">The arrival round (<strong>' + arrival.round + '</strong>) was already known when you submitted. The selection round (<strong>' + selBeacon.round + '</strong>) hadn\\\'t been published yet — proving you couldn\\\'t have known the randomness that determines which items get selected.</div>';
        }
        html += '<h2>Signer Activity</h2>';
        var pastHour = (receipt.signer_activity && receipt.signer_activity.commitments_past_hour) != null ? receipt.signer_activity.commitments_past_hour : 'N/A';
        var pastMonth = (receipt.signer_activity && receipt.signer_activity.commitments_past_month) != null ? receipt.signer_activity.commitments_past_month : 'N/A';
        html += fieldHTML('Past Hour', pastHour, false);
        html += fieldHTML('Past Month', pastMonth, false);
        html += '<div class="note">The server tracks how many commitments this signing key has made. This is transparent context, not rate limiting — the server never rejects based on activity.</div>';
        html += '<h2>Full Receipt</h2>';
        html += '<pre class="json-block"><code>' + escapeHTML(JSON.stringify(receipt, null, 2)) + '</code></pre>';
        html += '<a href="/steps/5" class="btn btn-next">Continue to Step 5 &rarr;</a>';
        return html;
      }

      async function handleSubmit() {
        if (submitted) return;
        submitted = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Submitting...';
        beaconStatus.textContent = 'Submitting commitment to server...';

        try {
          var resp = await fetch('/steps/4/api', { method: 'POST' });
          var json = await resp.json();
          if (json.error) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit to Server';
            submitted = false;
            beaconStatus.textContent = 'Error: ' + json.error + ' — try again';
            return;
          }
          var receipt = json.receipt;
          selectionRound = receipt.selection && receipt.selection.beacon_output && receipt.selection.beacon_output.round;
          if (selectionRound) {
            beaconStatus.textContent = 'Selection round #' + selectionRound + ' — highlighted below';
            highlightRound(selectionRound);
          }
          submitBtn.style.display = 'none';
          receiptResult.innerHTML = renderReceipt(receipt);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit to Server';
          submitted = false;
          beaconStatus.textContent = 'Network error — try again';
        }
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', handleSubmit);
      }
      startTicker();
    })();
    </script>
  `;

  return c.html(page({ title: 'Step 4: Submit to Server', stepNumber: 4, content, codeRefs: refs, session }));
});

// JSON API for JS-driven submit
route.post('/api', async (c) => {
  const session = c.get('session');
  const pbNode = c.get('pbNode');

  if (!session.commitment) {
    return c.json({ error: 'No commitment in session' }, 400);
  }

  const res = await pbNode.request('http://localhost/v1/commitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session.commitment),
  });

  if (res.ok) {
    const receipt = await res.json();
    session.receipt = receipt;
    session._completedStep = Math.max(session._completedStep || 0, 4);
    return c.json({ receipt });
  } else {
    const err = await res.json();
    session.submitError = err.error || 'Unknown error';
    return c.json({ error: session.submitError }, res.status);
  }
});

// Non-JS fallback: form POST with redirect
route.post('/', async (c) => {
  const session = c.get('session');
  const pbNode = c.get('pbNode');

  const res = await pbNode.request('http://localhost/v1/commitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session.commitment),
  });

  if (res.ok) {
    session.receipt = await res.json();
    session._completedStep = Math.max(session._completedStep || 0, 4);
  } else {
    const err = await res.json();
    session.submitError = err.error || 'Unknown error';
  }
  return c.redirect('/steps/4');
});

export default route;
