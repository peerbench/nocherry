import { Hono } from 'hono';
import { page, field, jsonBlock, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('packages/pb-node/src/routes/commitments.js', 18, 100, 'Server: POST /v1/commitments handler'),
  codeRef('packages/pb-node/src/signing.js', 39, 53, 'Server: signResponse — countersigning'),
  codeRef('packages/pb-node/src/beacon.js', 47, 76, 'Server: getBeaconOutput — fetch drand'),
];

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.commitment) return c.redirect('/steps/3');

  const receipt = session.receipt;

  let content;
  if (!receipt) {
    content = `
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
      ${button('Submit to Server')}
      <p style="margin-top:8px;font-size:0.85rem;color:#666">This may take a few seconds while waiting for the drand beacon...</p>
    `;
  } else {
    const arrival = receipt.arrival_beacon;
    const selBeacon = receipt.selection?.beacon_output;
    content = `
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

  return c.html(page({ title: 'Step 4: Submit to Server', stepNumber: 4, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const pbNode = c.get('pbNode');

  // Submit to the embedded pb-node server
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
