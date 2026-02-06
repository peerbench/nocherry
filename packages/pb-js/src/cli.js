#!/usr/bin/env node

/**
 * PeerBench CLI — JS implementation using pb-wasm.
 *
 * Usage:
 *   pb-js key generate
 *   pb-js key show
 *   pb-js hash file <path>
 *   pb-js hash dir <path>
 *   pb-js commit <dir> --probability <p> [--beacon drand]
 *   pb-js verify <commitment.json>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import * as wasm from 'pb-wasm';

const KEY_DIR = join(homedir(), '.peerbench');
const KEY_FILE = join(KEY_DIR, 'key.json');
const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

function loadKey() {
  // Check env var first
  const envKey = process.env.PB_SIGNING_KEY;
  if (envKey) {
    const keyBytes = Buffer.from(envKey, 'hex');
    if (keyBytes.length !== 32) {
      console.error('PB_SIGNING_KEY must be 32 bytes (64 hex chars)');
      process.exit(1);
    }
    const pubHex = wasm.encodeDIDKey ? null : null; // We need to derive pub from priv
    // Re-derive public key by creating commitment with a dummy — actually we need a helper
    // For now, just store what we have
    return { private_key_hex: envKey };
  }

  if (!existsSync(KEY_FILE)) {
    console.error('No key found. Run: pb-js key generate');
    process.exit(1);
  }
  return JSON.parse(readFileSync(KEY_FILE, 'utf-8'));
}

function saveKey(kp) {
  mkdirSync(KEY_DIR, { recursive: true });
  const data = {
    did: kp.did_key,
    private_key_hex: kp.private_key_hex,
    public_key_hex: kp.public_key_hex,
    algorithm: 'Ed25519',
    created_at: new Date().toISOString(),
  };
  writeFileSync(KEY_FILE, JSON.stringify(data, null, 2) + '\n');
  return data;
}

function hashFile(filePath) {
  const data = readFileSync(filePath);
  return wasm.hashBytes(new Uint8Array(data));
}

function walkDir(dirPath, prefix = '') {
  const entries = readdirSync(dirPath).sort();
  const manifest = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const fullPath = join(dirPath, name);
    const relName = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      const hash = hashFile(fullPath);
      manifest.push({ name: relName, type: 'file', hash });
    } else if (stat.isDirectory()) {
      const subManifest = walkDir(fullPath, relName);
      const subHash = wasm.hashManifest(JSON.stringify(subManifest));
      manifest.push({ name: relName, type: 'dir', hash: subHash });
    }
  }
  return manifest;
}

function hashDir(dirPath) {
  const manifest = walkDir(dirPath);
  return {
    manifest,
    hash: wasm.hashManifest(JSON.stringify(manifest)),
  };
}

// ── Command handlers ──

function cmdKeyGenerate() {
  const kp = wasm.generateKeypair();
  const saved = saveKey(kp);
  console.log(saved.did);
}

function cmdKeyShow() {
  const key = loadKey();
  console.log(key.did || key.did_key || 'unknown');
}

function cmdHashFile(filePath) {
  const hash = hashFile(resolve(filePath));
  console.log(hash);
}

function cmdHashDir(dirPath) {
  const result = hashDir(resolve(dirPath));
  console.log(JSON.stringify({ hash: result.hash, items: result.manifest.length }, null, 2));
}

function cmdCommit(dirPath, probability, beacon) {
  const key = loadKey();
  const dir = resolve(dirPath);

  // Hash all files
  const manifest = walkDir(dir);
  const itemHashes = manifest
    .filter(e => e.type === 'file')
    .map(e => e.hash);

  if (itemHashes.length === 0) {
    console.error('No files found in directory');
    process.exit(1);
  }

  const beaconRef = beacon === 'drand'
    ? { type: 'drand', chain_hash: DRAND_CHAIN_HASH }
    : { type: beacon };

  const params = {
    items: itemHashes,
    reveal_probability: probability,
    beacon: beaconRef,
    committed_at: new Date().toISOString(),
  };

  const commitment = wasm.createCommitment(
    JSON.stringify(params),
    key.private_key_hex
  );

  console.log(JSON.stringify(commitment, null, 2));
}

function cmdVerify(commitmentPath) {
  const raw = readFileSync(resolve(commitmentPath), 'utf-8');
  const commitment = JSON.parse(raw);

  try {
    const valid = wasm.verifyCommitment(JSON.stringify(commitment));
    if (valid) {
      console.log('Commitment signature: VALID');
      console.log(`  Hash: ${commitment.commitment_hash}`);
      console.log(`  Signer: ${commitment.signing_key}`);
      console.log(`  Items: ${commitment.item_count}`);
      console.log(`  Probability: ${commitment.reveal_probability}`);
      process.exit(0);
    } else {
      console.error('Commitment signature: INVALID');
      process.exit(1);
    }
  } catch (e) {
    console.error(`Verification failed: ${e.message}`);
    process.exit(1);
  }
}

// ── Argument parsing ──

function usage() {
  console.log(`Usage:
  pb-js key generate              Generate Ed25519 keypair
  pb-js key show                  Show stored did:key
  pb-js hash file <path>          Hash a file (SHA-256)
  pb-js hash dir <path>           Hash a directory
  pb-js commit <dir> -p <prob>    Create commitment from directory
  pb-js verify <commitment.json>  Verify commitment signature`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const cmd = args[0];
const sub = args[1];

if (cmd === 'key' && sub === 'generate') {
  cmdKeyGenerate();
} else if (cmd === 'key' && sub === 'show') {
  cmdKeyShow();
} else if (cmd === 'hash' && sub === 'file' && args[2]) {
  cmdHashFile(args[2]);
} else if (cmd === 'hash' && sub === 'dir' && args[2]) {
  cmdHashDir(args[2]);
} else if (cmd === 'commit' && args[1]) {
  let probability = 0.10;
  let beacon = 'drand';
  for (let i = 2; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--probability') && args[i + 1]) {
      probability = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--beacon' && args[i + 1]) {
      beacon = args[i + 1];
      i++;
    }
  }
  cmdCommit(args[1], probability, beacon);
} else if (cmd === 'verify' && args[1]) {
  cmdVerify(args[1]);
} else {
  usage();
}
