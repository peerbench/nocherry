/**
 * Server signing utilities.
 * The server has its own Ed25519 keypair for signing responses.
 */

import type { KyselyStorage } from "./storage/postgres.ts";
import type { Keypair } from "./types.ts";
import * as wasm from "./wasm/mod.ts";

let serverKeypair: Keypair | null = null;

/**
 * Initialize or load the server's signing keypair.
 * No-op after first successful call (module-level cache).
 */
export async function initServerKey(storage: KyselyStorage): Promise<Keypair> {
  if (serverKeypair) return serverKeypair;

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

export function getServerKey(): string {
  if (!serverKeypair) throw new Error("Server key not initialized");
  return serverKeypair.did_key;
}

/**
 * Sign a JSON object with the server's key.
 */
export function serverSign(obj: unknown): string {
  if (!serverKeypair) throw new Error("Server key not initialized");
  const payload = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(payload);
  return wasm.signMessage(serverKeypair.private_key_hex, bytes);
}

/**
 * Add server_key and server_signature to a response object.
 */
export function signResponse<T extends Record<string, unknown>>(obj: T) {
  const withKey = { ...obj, server_key: getServerKey() };
  const signature = serverSign(withKey);
  return { ...withKey, server_signature: signature };
}
