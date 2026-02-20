/**
 * Shared test setup for publish server tests.
 *
 * Dual-mode:
 *   PUBLISH_URL not set        → local mode (embedded in-memory publisher)
 *   PUBLISH_URL=https://…      → remote mode (real fetch against live server)
 *
 * Both modes need a commit-reveal server to get a receipt.
 * Local mode uses an embedded pb-node; remote mode uses COMMIT_SERVER_URL or
 * falls back to the Cloudflare dev server.
 */

import { createEmbeddedPublisher } from '../src/embedded-publisher.js';
import * as wasm from 'pb-wasm';

const PUBLISH_URL = process.env.PUBLISH_URL;
const COMMIT_SERVER_URL = process.env.COMMIT_SERVER_URL || 'https://commit-reveal-cloudflare-dev.nocherry.ai';

export const isRemote = !!PUBLISH_URL;
// Local embedded publisher routes are at the root (no /publish prefix)
export const publishUrl = PUBLISH_URL || 'http://localhost';

let _publisher = null;
let _commitApp = null;
let _pbStorage = null;

/**
 * Returns an object with a .request(url, init) method that works against
 * either the embedded Hono app or a remote server.
 */
export async function getPublisher() {
  if (_publisher) return _publisher;

  if (isRemote) {
    console.log(`  [remote mode] Testing publish server at ${PUBLISH_URL}`);
    const base = PUBLISH_URL.replace(/\/$/, '');
    _publisher = {
      async request(localUrl, init) {
        const url = new URL(localUrl);
        return fetch(`${base}${url.pathname}`, init);
      },
    };
  } else {
    console.log('  [local mode] Using embedded in-memory publisher');
    _publisher = createEmbeddedPublisher();
  }
  return _publisher;
}

/**
 * Get a receipt for a commitment from either the embedded or remote commit-reveal server.
 */
export async function getReceipt(commitment) {
  if (isRemote) {
    // Use real commit-reveal server
    const res = await fetch(`${COMMIT_SERVER_URL}/v1/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitment),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Commit server returned ${res.status}: ${err}`);
    }
    return res.json();
  } else {
    // Use embedded pb-node
    if (!_commitApp) {
      const pbNodeMod = await import('../../pb-node/dist/app.js');
      const signingMod = await import('../../pb-node/dist/signing.js');
      const storageMod = await import('pb-storage/sqlite');
      _pbStorage = storageMod.createSqliteStorage(':memory:');
      await signingMod.initServerKey(_pbStorage);
      _commitApp = pbNodeMod.createApp(_pbStorage);
    }
    const res = await _commitApp.request('http://localhost/v1/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitment),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Commit server returned ${res.status}: ${err}`);
    }
    return res.json();
  }
}

/**
 * Build a commitment + receipt from a list of plaintext items.
 */
export async function makeReceiptForItems(items, kp) {
  const hashes = items.map(item => wasm.hashBytes(new TextEncoder().encode(item)));
  const params = {
    items: hashes,
    reveal_probability: 1.0,
    committed_at: new Date().toISOString(),
    beacon: { type: 'drand-quicknet', schedule: 'after_deadline' },
    metadata: {},
  };
  const commitment = wasm.createCommitment(JSON.stringify(params), kp.private_key_hex);
  const receipt = await getReceipt(commitment);
  return receipt;
}

/**
 * Build a FormData upload body from a receipt and files.
 */
export function buildUploadForm(receipt, files) {
  const form = new FormData();
  form.append('receipt', JSON.stringify(receipt));
  for (const f of files) {
    form.append('files[]', new Blob([f.data], { type: 'text/plain' }), f.name);
  }
  return form;
}

/**
 * Build Ed25519 auth header for remote uploads.
 */
export function makeAuthHeader(kp) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `upload:${timestamp}`;
  const sig = wasm.signMessage(kp.private_key_hex, new TextEncoder().encode(message));
  return `Ed25519 ${kp.public_key_hex} ${timestamp} ${sig}`;
}

export async function cleanup() {
  if (_pbStorage) {
    await _pbStorage.close();
    _pbStorage = null;
  }
  _commitApp = null;
  _publisher = null;
}
