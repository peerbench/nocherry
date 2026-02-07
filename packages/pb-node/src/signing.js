/**
 * Server signing utilities.
 * The server has its own Ed25519 keypair for signing responses.
 */

import * as wasm from 'pb-wasm';

let serverKeypair = null;

/**
 * Initialize or load the server's signing keypair.
 * Async because storage is now async (Kysely).
 */
export async function initServerKey(storage) {
  const existing = await storage.getServerIdentity();
  if (existing) {
    serverKeypair = existing;
    return serverKeypair;
  }

  const kp = wasm.generateKeypair();
  serverKeypair = {
    did_key: kp.did_key,
    private_key_hex: kp.private_key_hex,
    public_key_hex: kp.public_key_hex,
  };
  await storage.setServerIdentity(serverKeypair);
  return serverKeypair;
}

export function getServerKey() {
  if (!serverKeypair) throw new Error('Server key not initialized');
  return serverKeypair.did_key;
}

/**
 * Sign a JSON object with the server's key.
 * Returns the hex signature.
 */
export function serverSign(obj) {
  if (!serverKeypair) throw new Error('Server key not initialized');
  const payload = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(payload);
  return wasm.signMessage(serverKeypair.private_key_hex, bytes);
}

/**
 * Add server_key and server_signature to a response object.
 */
export function signResponse(obj) {
  const withKey = { ...obj, server_key: getServerKey() };
  const signature = serverSign(withKey);
  return { ...withKey, server_signature: signature };
}
