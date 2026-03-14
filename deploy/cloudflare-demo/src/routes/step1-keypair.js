import { Hono } from 'hono';
import * as wasm from 'pb-wasm';
import { page, field, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('packages/pb-wasm/src/lib.rs', 23, 33, 'WASM: generateKeypair()'),
  codeRef('crates/pb-core/src/sign.rs', 1, 30, 'Rust: Ed25519 key generation'),
];

route.get('/', (c) => {
  const session = c.get('session');
  const kp = session.keypair;

  let content;
  if (!kp) {
    content = `
      <p>Every commitment is signed with an <strong>Ed25519</strong> keypair. The public key
      is encoded as a <code>did:key</code> identifier — a self-describing format that embeds
      the key type and value in a single string.</p>
      ${note('The private key signs commitments. The public key (did:key) goes into the commitment so anyone can verify the signature without contacting a server.')}
      ${button('Generate Keypair')}
    `;
  } else {
    content = `
      <p>Your Ed25519 keypair has been generated.</p>
      ${field('DID Key', kp.did_key)}
      ${field('Public Key', kp.public_key_hex)}
      ${field('Private Key', kp.private_key_hex)}
      ${note('<strong>did:key</strong> format: the prefix <code>z6Mk</code> means Ed25519. The rest is the base58-encoded public key with a multicodec prefix <code>0xed01</code>.')}
      ${nextButton(2)}
    `;
  }

  return c.html(page({ title: 'Step 1: Generate Keypair', stepNumber: 1, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();

  // Mode selection from home page (local/live)
  if (body.mode) {
    session._demoMode = body.mode === 'live' ? 'live' : 'local';
  }

  session.keypair = wasm.generateKeypair();
  session._completedStep = Math.max(session._completedStep || 0, 1);
  return c.redirect('/steps/1');
});

export default route;
