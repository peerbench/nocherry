import { Hono } from 'hono';
import { page, button } from '../template.js';
import { resetSession } from '../session.js';

const route = new Hono();

route.get('/', (c) => {
  return c.html(page({
    title: 'Commit-Reveal Protocol',
    content: `
      <div class="hero">
        <h1>Commit-Reveal Protocol</h1>
        <p>
          An interactive walkthrough of the PeerBench commit-reveal protocol.
          You'll generate a key, hash data, create a commitment, submit it to a server,
          see how random selection works, and verify everything — with source code references at every step.
        </p>

        <div class="features">
          <div class="feature">
            <h3>Temporal Ordering</h3>
            <p>Prove a commitment existed before the randomness that selected it</p>
          </div>
          <div class="feature">
            <h3>Integrity</h3>
            <p>Revealed data matches committed hashes — verified by SHA-256</p>
          </div>
          <div class="feature">
            <h3>Unbiased Selection</h3>
            <p>Items chosen by external randomness (drand beacon), not by the committer</p>
          </div>
        </div>

        ${button('Start Demo', '/steps/1')}
      </div>
    `,
  }));
});

route.post('/', (c) => {
  resetSession(c);
  return c.redirect('/steps/1');
});

export default route;
