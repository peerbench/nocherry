import { Hono } from 'hono';
import { page } from '../template.js';

const route = new Hono();

route.get('/', (c) => {
  return c.html(page({
    title: 'Commit-Reveal Protocol',
    content: `
      <div class="hero">
        <h1>Commit-Reveal Protocol</h1>
        <p>
          An interactive walkthrough of the commit-reveal protocol.
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

        <div style="display:flex;gap:16px;justify-content:center;margin-top:28px;flex-wrap:wrap">
          <form method="POST" action="/steps/1" style="margin:0">
            <input type="hidden" name="mode" value="live">
            <button type="submit" class="btn" style="padding:12px 28px;font-size:1rem">Start Demo</button>
          </form>
        </div>
      </div>
    `,
  }));
});

route.post('/', (c) => {
  return c.redirect('/steps/1');
});

export default route;
