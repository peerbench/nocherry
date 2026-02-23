/**
 * Server signing utilities — the server has its own Ed25519 keypair
 * for signing responses.
 */

import type { StorageInterface, Keypair } from './types.ts'
import { getWasm } from './wasm-registry.ts'

let serverKeypair: Keypair | null = null;

export async function initServerKey(storage: StorageInterface): Promise<Keypair> {
  if (serverKeypair) return serverKeypair;

  const existing = await storage.getServerIdentity();
  if (existing) {
    serverKeypair = existing;
    return serverKeypair;
  }

  const wasm = getWasm();
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
  if (!serverKeypair) throw new Error('Server key not initialized');
  return serverKeypair.did_key;
}

export function serverSign(obj: unknown): string {
  if (!serverKeypair) throw new Error('Server key not initialized');
  const wasm = getWasm();
  const payload = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(payload);
  return wasm.signMessage(serverKeypair.private_key_hex, bytes);
}

export function signResponse<T extends Record<string, unknown>>(obj: T) {
  const withKey = { ...obj, server_key: getServerKey() };
  const signature = serverSign(withKey);
  return { ...withKey, server_signature: signature };
}
