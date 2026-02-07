#!/usr/bin/env node

/**
 * PeerBench CLI — JS implementation using pb-wasm.
 *
 * Usage:
 *   pb-js go <dir> [-p <prob>]              Guided wizard (just hit Enter)
 *   pb-js key generate
 *   pb-js key show
 *   pb-js hash file <path>
 *   pb-js hash dir <path>
 *   pb-js commit <dir> --probability <p> [--beacon drand]
 *   pb-js verify <commitment.json>
 *   pb-js servers                         List known servers
 *   pb-js submit <dir|file> [-s <server>]  Submit commitment to server(s)
 *   pb-js reveal <dir>                           Create & submit reveal
 *   pb-js publish github <dir> [--repo <name>]    Publish data to GitHub
 *   pb-js publish huggingface <dir> [--repo <name>] Publish data to Hugging Face
 *   pb-js publish <dir>                   Interactive: detect providers & choose
 *   pb-js generate-random-data [dir] [-n <count>]        Generate random test data
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, cpSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes, randomInt } from 'node:crypto';
import * as wasm from 'pb-wasm';
import { getServers, resolveServer, getRevealPublishers } from './registry.js';

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

const PROTOCOL_FILES = new Set([
  'manifest.json', 'commitment.json', 'server-receipts.json',
  'reveal.json', 'reveal-receipts.json', 'publication.json',
  'receipt.json', 'verify.sh', 'README.md',
]);

function walkDir(dirPath, prefix = '') {
  const entries = readdirSync(dirPath).sort();
  const manifest = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (prefix === '' && PROTOCOL_FILES.has(name)) continue;
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
  const dir = resolve(dirPath);
  const result = hashDir(dir);

  const manifestData = {
    spec_version: '0.2.0',
    root_hash: result.hash,
    items: result.manifest
      .filter(e => e.type === 'file')
      .map(e => ({ path: e.name, hash: e.hash })),
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestData, null, 2) + '\n');
  console.error('Saved manifest.json');

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

  writeFileSync(join(dir, 'commitment.json'), JSON.stringify(commitment, null, 2) + '\n');
  console.error('Saved commitment.json');

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

function cmdServers() {
  const servers = getServers();
  if (servers.length === 0) {
    console.log('No servers in registry.');
    return;
  }
  for (const s of servers) {
    console.log(`  ${s.name}`);
    console.log(`    url:         ${s.url}`);
    console.log(`    server_key:  ${s.server_key || '(dynamic)'}`);
    console.log(`    environment: ${s.environment}`);
    console.log();
  }
}

async function cmdSubmit(target, serverNameOrUrl) {
  const resolved = resolve(target);
  const isDir = existsSync(resolved) && statSync(resolved).isDirectory();

  if (isDir) {
    await cmdSubmitDir(resolved);
  } else {
    await cmdSubmitFile(resolved, serverNameOrUrl);
  }
}

async function cmdSubmitFile(commitmentPath, serverNameOrUrl) {
  const raw = readFileSync(commitmentPath, 'utf-8');
  const commitment = JSON.parse(raw);

  const server = resolveServer(serverNameOrUrl);
  const url = `${server.url.replace(/\/$/, '')}/v1/commitments`;

  console.log(`Submitting to ${server.name || server.url} ...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commitment),
  });

  if (res.ok) {
    const receipt = await res.json();
    console.log(`201 Created`);
    console.log(`  Server:       ${receipt.server_key}`);
    console.log(`  Registered:   ${receipt.registered_at}`);
    if (receipt.selection?.beacon_output) {
      console.log(`  Beacon Round: ${receipt.selection.beacon_output.round}`);
    }
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    const body = await res.text();
    console.error(`Server returned ${res.status}: ${body}`);
    process.exit(1);
  }
}

async function cmdSubmitDir(dir) {
  const commitmentPath = join(dir, 'commitment.json');
  if (!existsSync(commitmentPath)) {
    console.error('No commitment.json found in directory. Run: pb-js commit <dir>');
    process.exit(1);
  }

  const commitment = JSON.parse(readFileSync(commitmentPath, 'utf-8'));
  const servers = getServers();
  if (servers.length === 0) {
    console.error('No servers in registry.');
    process.exit(1);
  }

  console.log(`Submitting to ${servers.length} server(s)...`);

  const settled = await Promise.allSettled(
    servers.map(async (server) => {
      const url = `${server.url.replace(/\/$/, '')}/v1/commitments`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitment),
      });
      if (res.ok) {
        const receipt = await res.json();
        return { server_name: server.name, server_url: server.url, receipt };
      } else {
        const body = await res.text();
        throw new Error(`${server.name}: ${res.status} ${body}`);
      }
    })
  );

  const receipts = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      const r = result.value;
      console.log(`  ${r.server_name}: 201 Created (round ${r.receipt.selection?.beacon_output?.round || '?'})`);
      receipts.push(r);
    } else {
      console.error(`  ${servers[i].name}: ${result.reason?.message || 'unknown error'}`);
    }
  }

  if (receipts.length === 0) {
    console.error('All servers failed.');
    process.exit(1);
  }

  const serverReceipts = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    submitted_at: new Date().toISOString(),
    receipts,
  };
  writeFileSync(join(dir, 'server-receipts.json'), JSON.stringify(serverReceipts, null, 2) + '\n');
  console.error('Saved server-receipts.json');

  // Save first successful receipt as receipt.json for backward compat
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipts[0].receipt, null, 2) + '\n');
  console.error('Saved receipt.json');

  console.log(JSON.stringify(serverReceipts, null, 2));
}

// ── Reveal ──

async function cmdReveal(dirPath) {
  const dir = resolve(dirPath);
  const key = loadKey();

  // Load commitment (from commitment.json or extract from receipts)
  let commitment;
  const commitmentPath = join(dir, 'commitment.json');
  if (existsSync(commitmentPath)) {
    commitment = JSON.parse(readFileSync(commitmentPath, 'utf-8'));
  } else {
    console.error('No commitment.json found in directory. Run: pb-js commit <dir>');
    process.exit(1);
  }

  // Load selection from server-receipts.json or receipt.json
  let selectedItems;
  const serverReceiptsPath = join(dir, 'server-receipts.json');
  const receiptPath = join(dir, 'receipt.json');

  if (existsSync(serverReceiptsPath)) {
    const sr = JSON.parse(readFileSync(serverReceiptsPath, 'utf-8'));
    const firstReceipt = sr.receipts.find(r => r.receipt?.selection?.selected_items);
    if (firstReceipt) {
      selectedItems = firstReceipt.receipt.selection.selected_items;
    }
  }
  if (!selectedItems && existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
    selectedItems = receipt.selection?.selected_items;
  }

  if (!selectedItems) {
    console.error('No selection found. Run: pb-js submit <dir>');
    process.exit(1);
  }

  const voluntaryItems = commitment.items.filter(h => !selectedItems.includes(h));

  // Build reveal signing payload (canonical key order from spec)
  const revealPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    selected_items: selectedItems,
    voluntary_items: voluntaryItems,
    revealed_at: new Date().toISOString(),
    signing_key: key.did || key.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
  const signature = wasm.signMessage(key.private_key_hex, payloadBytes);
  const reveal = { ...revealPayload, signature };

  // Save reveal.json
  writeFileSync(join(dir, 'reveal.json'), JSON.stringify(reveal, null, 2) + '\n');
  console.error('Saved reveal.json');

  // Load file_urls from publication.json for server-side data verification
  let selectedFileUrls = {};
  const pubPath = join(dir, 'publication.json');
  if (existsSync(pubPath)) {
    try {
      const pub = JSON.parse(readFileSync(pubPath, 'utf-8'));
      if (pub.file_urls && typeof pub.file_urls === 'object') {
        for (const hash of selectedItems) {
          if (pub.file_urls[hash]) selectedFileUrls[hash] = pub.file_urls[hash];
        }
      }
    } catch {}
  }
  if (Object.keys(selectedFileUrls).length === 0) {
    console.error('Warning: No publication.json found — servers may reject reveal without file_urls');
  }

  // Submit to all servers
  const servers = getServers();
  if (servers.length === 0) {
    console.log('No servers in registry — skipping reveal submission.');
    console.log(JSON.stringify(reveal, null, 2));
    return;
  }

  console.log(`Submitting reveal to ${servers.length} server(s)...`);

  const settled = await Promise.allSettled(
    servers.map(async (server) => {
      const url = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitment.commitment_hash}/reveals`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...reveal, file_urls: selectedFileUrls }),
      });
      if (res.ok) {
        const body = await res.json();
        return {
          server_name: server.name,
          server_url: server.url,
          response: body,
        };
      } else {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
    })
  );

  const revealReceipts = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      const r = result.value;
      const resp = r.response;
      const parts = [`reveal_id: ${resp.reveal_id}`];
      if (resp.data_verified) parts.push('data_verified: true');
      if (resp.file_urls_registered > 0) parts.push(`${resp.file_urls_registered} file URLs registered`);
      console.log(`  ${r.server_name}: accepted (${parts.join(', ')})`);
      revealReceipts.push(r);
    } else {
      console.error(`  ${servers[i].name}: ${result.reason?.message || 'unknown error'}`);
    }
  }

  const revealReceiptsData = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    revealed_at: reveal.revealed_at,
    receipts: revealReceipts,
  };
  writeFileSync(join(dir, 'reveal-receipts.json'), JSON.stringify(revealReceiptsData, null, 2) + '\n');
  console.error('Saved reveal-receipts.json');

  console.log(JSON.stringify(reveal, null, 2));
}

// ── Publish helpers ──

function shell(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return null;
    throw e;
  }
}

function hasCommand(name) {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans.trim()); }));
}

async function waitForEnter() {
  await prompt('  [Enter] ');
}

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

function startSpinner(message) {
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}`);
  }, 120);
  return {
    stop(finalMessage) {
      clearInterval(id);
      process.stdout.write(`\r  ✓ ${finalMessage}\n`);
    },
    fail(finalMessage) {
      clearInterval(id);
      process.stdout.write(`\r  ✗ ${finalMessage}\n`);
    },
  };
}

function findReceipt(dir) {
  let result = null;
  const receiptPath = join(dir, 'receipt.json');
  if (existsSync(receiptPath)) result = JSON.parse(readFileSync(receiptPath, 'utf-8'));
  // If receipt has no commitment_hash, try commitment.json
  if (!result?.commitment_hash) {
    const commitPath = join(dir, 'commitment.json');
    if (existsSync(commitPath)) {
      const c = JSON.parse(readFileSync(commitPath, 'utf-8'));
      if (c.commitment_hash) {
        result = result || {};
        result.commitment_hash = c.commitment_hash;
      }
    }
  }
  return result;
}

function buildRevealFolder(srcDir) {
  const receipt = findReceipt(srcDir);
  const hashPrefix = receipt?.commitment_hash?.slice(0, 12) || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  return `reveals/${date}-${hashPrefix}`;
}

function generateVerifyScript(commitmentHash) {
  return `#!/usr/bin/env bash
# Verify this reveal against the PeerBench commitment
# Commitment hash: ${commitmentHash || 'unknown'}
#
# Requirements: npm (for npx)
#
# Usage: ./verify.sh

set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

echo "Verifying PeerBench reveal..."
echo "  Commitment: ${commitmentHash || 'unknown'}"
echo ""

if [ -f "$DIR/commitment.json" ]; then
  npx @peerbench/sdk verify "$DIR/commitment.json"
else
  echo "No commitment.json found in reveal folder."
  echo "Download it from the server or the original committer."
fi
`;
}


// ── Publication verification ──

async function verifyPublicationWithServers(commitmentHash, fileUrls) {
  const servers = getServers();
  if (servers.length === 0) {
    console.log('No servers in registry — skipping publication verification.');
    return [];
  }

  console.log(`\nVerifying publication with ${servers.length} server(s)...`);

  const attestations = [];

  for (const server of servers) {
    const endpoint = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitmentHash}/verify-publication`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_urls: fileUrls }),
      });
      if (res.ok) {
        const body = await res.json();
        const icon = body.all_match ? '\u2713' : '\u2717';
        console.log(`  ${server.name}: ${icon} ${body.verified_items}/${body.provided_items} items verified`);
        if (body.all_match) {
          console.log(`    Signed attestation from ${body.server_key}`);
        } else {
          for (const item of body.items) {
            if (item.status !== 'match') {
              console.log(`    ${item.status}: ${item.hash.slice(0, 12)}... ${item.detail || item.computed_hash || ''}`);
            }
          }
        }
        attestations.push({ server: server.name, server_url: server.url, attestation: body });
      } else if (res.status === 404) {
        // Server doesn't support this endpoint — skip silently
      } else {
        const body = await res.text();
        console.log(`  ${server.name}: ${res.status} ${body}`);
        attestations.push({ server: server.name, server_url: server.url, error: `${res.status}: ${body}` });
      }
    } catch (e) {
      console.log(`  ${server.name}: unreachable (${e.message})`);
      attestations.push({ server: server.name, server_url: server.url, error: e.message });
    }
  }

  return attestations;
}

function generateRevealReadme(srcDir, commitHash) {
  let md = `# Commitment Reveal: ${commitHash.slice(0, 12)}\n\n`;
  md += `## Protocol Evidence\n\n`;

  // Commitment table
  const commitmentPath = join(srcDir, 'commitment.json');
  if (existsSync(commitmentPath)) {
    const c = JSON.parse(readFileSync(commitmentPath, 'utf-8'));
    md += `### Commitment\n`;
    md += `| Field | Value |\n|-------|-------|\n`;
    md += `| Hash | \`${c.commitment_hash}\` |\n`;
    md += `| Items | ${c.item_count} files |\n`;
    md += `| Reveal probability | ${(c.reveal_probability * 100).toFixed(0)}% |\n`;
    md += `| Signing key | \`${c.signing_key}\` |\n`;
    md += `| Created | ${c.committed_at || 'N/A'} |\n\n`;
  }

  // Server receipts table
  const srPath = join(srcDir, 'server-receipts.json');
  if (existsSync(srPath)) {
    const sr = JSON.parse(readFileSync(srPath, 'utf-8'));
    md += `### Server Receipts\n`;
    md += `| Server | Beacon Round | Received At |\n|--------|-------------|-------------|\n`;
    for (const r of sr.receipts) {
      const round = r.receipt?.selection?.beacon_output?.round || '?';
      const registeredAt = r.receipt?.registered_at || '?';
      md += `| ${r.server_name} | ${round} | ${registeredAt} |\n`;
    }
    md += '\n';
  }

  // Selection results table
  const manifestPath = join(srcDir, 'manifest.json');
  const revealPath = join(srcDir, 'reveal.json');
  if (existsSync(manifestPath) && existsSync(revealPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const reveal = JSON.parse(readFileSync(revealPath, 'utf-8'));
    const selectedSet = new Set(reveal.selected_items || []);
    md += `### Random Selection\n`;
    md += `| # | File | Hash | Selected? |\n|---|------|------|-----------|\n`;
    manifest.items.forEach((item, i) => {
      const sel = selectedSet.has(item.hash) ? 'Yes' : 'No';
      md += `| ${i + 1} | ${item.path} | \`${item.hash.slice(0, 12)}...\` | ${sel} |\n`;
    });
    md += '\n';
  }

  md += `## Verify Yourself\n\n`;
  md += '```bash\n./verify.sh\n```\n';

  return md;
}

// ── Publish: GitHub ──

async function cmdPublishGithub(dir, repoName) {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Check gh CLI
  if (!hasCommand('gh')) {
    console.error('GitHub CLI (gh) not found. Install it: https://cli.github.com');
    process.exit(1);
  }

  // Check auth
  const authStatus = shell('gh auth status 2>&1', { allowFail: true });
  if (!authStatus || authStatus.includes('not logged')) {
    console.error('Not authenticated with GitHub. Run: gh auth login');
    process.exit(1);
  }

  // Get GitHub username
  const ghUser = shell('gh api user -q .login');
  const repo = repoName || 'peerbench-reveals';
  const fullRepo = repo.includes('/') ? repo : `${ghUser}/${repo}`;

  console.log(`Publishing to GitHub: ${fullRepo}`);

  // Check if repo exists, create if not
  const repoExists = shell(`gh repo view ${fullRepo} --json name 2>&1`, { allowFail: true });
  if (!repoExists || repoExists.includes('not found') || repoExists.includes('Could not')) {
    console.log(`Creating repository ${fullRepo} ...`);
    shell(`gh repo create ${fullRepo} --public --description "PeerBench reveals — cryptographic benchmark commitments" --clone=false`);
    console.log(`  Created: https://github.com/${fullRepo}`);
  }

  // Clone (or pull) into temp dir
  const tmpBase = join(homedir(), '.peerbench', 'publish-tmp');
  mkdirSync(tmpBase, { recursive: true });
  const cloneDir = join(tmpBase, repo.replace('/', '-'));

  if (existsSync(join(cloneDir, '.git'))) {
    shell('git pull --ff-only 2>&1', { cwd: cloneDir, allowFail: true });
  } else {
    if (existsSync(cloneDir)) {
      shell(`rm -rf "${cloneDir}"`);
    }
    shell(`gh repo clone ${fullRepo} "${cloneDir}" 2>&1`);
  }

  // Determine reveal folder name
  const revealFolder = buildRevealFolder(srcDir);
  const destDir = join(cloneDir, revealFolder);
  mkdirSync(destDir, { recursive: true });

  // Copy data (excluding protocol files from the data subfolder)
  const dataDir = join(destDir, 'data');
  cpSync(srcDir, dataDir, { recursive: true, filter: (src) => {
    const name = basename(src);
    if (src === srcDir) return true; // allow root
    return !PROTOCOL_FILES.has(name);
  }});

  // Copy all protocol files into reveal folder root
  const receipt = findReceipt(srcDir);
  const protocolFilesToCopy = [
    'manifest.json', 'commitment.json', 'server-receipts.json',
    'reveal.json', 'reveal-receipts.json', 'receipt.json',
  ];
  for (const pf of protocolFilesToCopy) {
    if (existsSync(join(srcDir, pf))) {
      cpSync(join(srcDir, pf), join(destDir, pf));
    }
  }

  // Generate verify script
  writeFileSync(join(destDir, 'verify.sh'), generateVerifyScript(receipt?.commitment_hash));
  shell(`chmod +x "${join(destDir, 'verify.sh')}"`);

  // Generate enhanced README with protocol evidence tables
  const commitHash = receipt?.commitment_hash || 'unknown';
  const readmeContent = generateRevealReadme(srcDir, commitHash);
  writeFileSync(join(destDir, 'README.md'), readmeContent);

  // Ensure repo-level README exists
  const repoReadme = join(cloneDir, 'README.md');
  if (!existsSync(repoReadme)) {
    writeFileSync(repoReadme, `# PeerBench Reveals

Cryptographically committed benchmark data, published via [PeerBench](https://github.com/peerBench/commit-reveal).

Each folder in \`reveals/\` contains data that was committed before evaluation, timestamped by an independent server, and can be independently verified.
`);
  }

  // Git add, commit, push
  shell('git add -A', { cwd: cloneDir });
  const diffCheck = shell('git diff --cached --stat', { cwd: cloneDir, allowFail: true });
  if (!diffCheck) {
    console.log('No new changes to publish.');
    return;
  }
  shell(`git commit -m "Add reveal ${revealFolder}"`, { cwd: cloneDir });
  shell('git push', { cwd: cloneDir });

  const githubUrl = `https://github.com/${fullRepo}/tree/main/${revealFolder}`;
  console.log(`\nPublished to GitHub:`);
  console.log(`  ${githubUrl}`);
  console.log(`  Verify: cd ${revealFolder} && ./verify.sh`);

  // Verify publication — server fetches data from GitHub and confirms hashes
  let attestations = [];
  let fileUrls = {};
  if (receipt?.commitment_hash) {
    const manifest = walkDir(srcDir);
    for (const entry of manifest) {
      if (entry.type === 'file') {
        fileUrls[entry.hash] = `https://raw.githubusercontent.com/${fullRepo}/main/${revealFolder}/data/${entry.name}`;
      }
    }
    if (Object.keys(fileUrls).length > 0) {
      attestations = await verifyPublicationWithServers(receipt.commitment_hash, fileUrls);
    }
  }

  // Save publication.json — the portable proof of publication + server verification
  const publication = {
    spec_version: '0.2.0',
    commitment_hash: receipt?.commitment_hash || null,
    published_at: new Date().toISOString(),
    provider: 'github',
    mirror_url: githubUrl,
    repository: fullRepo,
    reveal_folder: revealFolder,
    file_urls: fileUrls,
    server_attestations: attestations,
  };
  const pubPath = join(srcDir, 'publication.json');
  writeFileSync(pubPath, JSON.stringify(publication, null, 2) + '\n');
  console.log(`\nSaved: ${pubPath}`);
}

// ── Publish: Hugging Face ──

async function cmdPublishHuggingface(dir, repoName) {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Detect auth method: HF_TOKEN env var → cached token file → huggingface-cli
  const hasHfCli = hasCommand('huggingface-cli');
  let hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    const cachedTokenPath = join(homedir(), '.cache', 'huggingface', 'token');
    if (existsSync(cachedTokenPath)) {
      hfToken = readFileSync(cachedTokenPath, 'utf-8').trim();
    }
  }
  let hfUser = null;

  if (hasHfCli) {
    const whoami = shell('huggingface-cli whoami 2>&1', { allowFail: true });
    if (whoami && !whoami.includes('Not logged in') && !whoami.includes('error')) {
      hfUser = whoami.split('\n')[0].trim();
    }
  }

  if (!hfUser && hfToken) {
    // Try to get username via API
    try {
      const res = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${hfToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        hfUser = data.name;
      }
    } catch {}
  }

  if (!hfUser) {
    console.error('Not authenticated with Hugging Face.');
    console.error('Options:');
    console.error('  1. Install huggingface-cli and run: huggingface-cli login');
    console.error('  2. Set HF_TOKEN environment variable');
    process.exit(1);
  }

  const repo = repoName || 'peerbench-reveals';
  const fullRepo = repo.includes('/') ? repo : `${hfUser}/${repo}`;

  console.log(`Publishing to Hugging Face: ${fullRepo}`);

  // Determine clone URL
  let cloneUrl;
  if (hfToken) {
    cloneUrl = `https://${hfUser}:${hfToken}@huggingface.co/datasets/${fullRepo}`;
  } else {
    cloneUrl = `git@hf.co:datasets/${fullRepo}`;
  }

  // Create dataset repo if needed (via API)
  const checkUrl = `https://huggingface.co/api/datasets/${fullRepo}`;
  const authHeaders = hfToken
    ? { Authorization: `Bearer ${hfToken}` }
    : {};

  let repoExists = false;
  try {
    const res = await fetch(checkUrl, { headers: authHeaders });
    repoExists = res.ok;
  } catch {}

  if (!repoExists) {
    console.log(`Creating dataset repository ${fullRepo} ...`);
    const createRes = await fetch('https://huggingface.co/api/repos/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
      },
      body: JSON.stringify({
        type: 'dataset',
        name: repo.includes('/') ? repo.split('/')[1] : repo,
        private: false,
      }),
    });
    if (!createRes.ok && createRes.status !== 409) {
      const err = await createRes.text();
      console.error(`Failed to create HF dataset repo: ${err}`);
      if (!hfToken) {
        console.error('Hint: Set HF_TOKEN env var for API-based repo creation.');
      }
      process.exit(1);
    }
    console.log(`  Created: https://huggingface.co/datasets/${fullRepo}`);
  }

  // Clone into temp dir
  const tmpBase = join(homedir(), '.peerbench', 'publish-tmp');
  mkdirSync(tmpBase, { recursive: true });
  const cloneDir = join(tmpBase, `hf-${repo.replace('/', '-')}`);

  if (existsSync(join(cloneDir, '.git'))) {
    shell('git pull --ff-only 2>&1', { cwd: cloneDir, allowFail: true });
  } else {
    if (existsSync(cloneDir)) {
      shell(`rm -rf "${cloneDir}"`);
    }
    // Configure git-lfs for HF
    if (hasCommand('git-lfs')) {
      shell('git lfs install --skip-smudge 2>&1', { allowFail: true });
    }
    shell(`git clone "${cloneUrl}" "${cloneDir}" 2>&1`, { allowFail: true });
    if (!existsSync(join(cloneDir, '.git'))) {
      // Fresh repo, init manually
      mkdirSync(cloneDir, { recursive: true });
      shell('git init', { cwd: cloneDir });
      shell(`git remote add origin "${cloneUrl}"`, { cwd: cloneDir });
    }
  }

  // Determine reveal folder name
  const revealFolder = buildRevealFolder(srcDir);
  const destDir = join(cloneDir, revealFolder);
  mkdirSync(destDir, { recursive: true });

  // Copy data
  const dataDir = join(destDir, 'data');
  cpSync(srcDir, dataDir, { recursive: true });

  // Copy receipt/commitment if present
  const receipt = findReceipt(srcDir);
  if (existsSync(join(srcDir, 'receipt.json'))) {
    cpSync(join(srcDir, 'receipt.json'), join(destDir, 'receipt.json'));
  }
  if (existsSync(join(srcDir, 'commitment.json'))) {
    cpSync(join(srcDir, 'commitment.json'), join(destDir, 'commitment.json'));
  }

  // Generate verify script
  writeFileSync(join(destDir, 'verify.sh'), generateVerifyScript(receipt?.commitment_hash));
  shell(`chmod +x "${join(destDir, 'verify.sh')}"`);

  // Write HF dataset card (README.md) at repo root
  const commitHash = receipt?.commitment_hash || 'unknown';
  const repoReadme = join(cloneDir, 'README.md');
  if (!existsSync(repoReadme)) {
    writeFileSync(repoReadme, `---
license: mit
task_categories:
  - other
tags:
  - peerbench
  - benchmark
  - commit-reveal
pretty_name: PeerBench Reveals
---

# PeerBench Reveals

Cryptographically committed benchmark data, published via [PeerBench](https://github.com/peerBench/commit-reveal).

Each folder in \`reveals/\` contains data that was committed before evaluation,
timestamped by an independent server, and can be independently verified.

## Verification

\`\`\`bash
npx @peerbench/sdk verify reveals/<folder>/commitment.json
\`\`\`
`);
  }

  // Write a per-reveal README
  writeFileSync(join(destDir, 'README.md'), `# Reveal: ${commitHash.slice(0, 12)}

- **Commitment Hash**: \`${commitHash}\`
- **Date**: ${new Date().toISOString()}
- **Verification**: \`npx @peerbench/sdk verify commitment.json\`
`);

  // Git add, commit, push
  shell('git add -A', { cwd: cloneDir });
  const diffCheck = shell('git diff --cached --stat', { cwd: cloneDir, allowFail: true });
  if (!diffCheck) {
    console.log('No new changes to publish.');
    return;
  }
  shell(`git commit -m "Add reveal ${revealFolder}"`, { cwd: cloneDir });
  shell('git push 2>&1', { cwd: cloneDir });

  const hfUrl = `https://huggingface.co/datasets/${fullRepo}/tree/main/${revealFolder}`;
  console.log(`\nPublished to Hugging Face:`);
  console.log(`  ${hfUrl}`);

  // Verify publication — server fetches data from HF and confirms hashes
  let attestations = [];
  let fileUrls = {};
  if (receipt?.commitment_hash) {
    const manifest = walkDir(srcDir);
    for (const entry of manifest) {
      if (entry.type === 'file') {
        fileUrls[entry.hash] = `https://huggingface.co/datasets/${fullRepo}/resolve/main/${revealFolder}/data/${entry.name}`;
      }
    }
    if (Object.keys(fileUrls).length > 0) {
      attestations = await verifyPublicationWithServers(receipt.commitment_hash, fileUrls);
    }
  }

  // Save publication.json
  const publication = {
    spec_version: '0.2.0',
    commitment_hash: receipt?.commitment_hash || null,
    published_at: new Date().toISOString(),
    provider: 'huggingface',
    mirror_url: hfUrl,
    repository: fullRepo,
    reveal_folder: revealFolder,
    file_urls: fileUrls,
    server_attestations: attestations,
  };
  const pubPath = join(srcDir, 'publication.json');
  writeFileSync(pubPath, JSON.stringify(publication, null, 2) + '\n');
  console.log(`\nSaved: ${pubPath}`);
}

// ── Publish: Interactive ──

async function cmdPublishInteractive(dir) {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Detect available providers
  const providers = [];

  // GitHub
  if (hasCommand('gh')) {
    const ghAuth = shell('gh auth status 2>&1', { allowFail: true });
    if (ghAuth && !ghAuth.includes('not logged')) {
      providers.push({ name: 'GitHub', key: 'github' });
    }
  }

  // Hugging Face
  const hasHfCli = hasCommand('huggingface-cli');
  let hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    const cachedTokenPath = join(homedir(), '.cache', 'huggingface', 'token');
    if (existsSync(cachedTokenPath)) hfToken = readFileSync(cachedTokenPath, 'utf-8').trim();
  }
  if (hasHfCli || hfToken) {
    let hfOk = false;
    if (hasHfCli) {
      const whoami = shell('huggingface-cli whoami 2>&1', { allowFail: true });
      hfOk = whoami && !whoami.includes('Not logged in') && !whoami.includes('error');
    }
    if (!hfOk && hfToken) hfOk = true;
    if (hfOk) providers.push({ name: 'Hugging Face', key: 'huggingface' });
  }

  if (providers.length === 0) {
    console.error('No publish providers detected.');
    console.error('Set up one of:');
    console.error('  GitHub:       gh auth login');
    console.error('  Hugging Face: huggingface-cli login  OR  export HF_TOKEN=...');
    process.exit(1);
  }

  console.log('Available publish targets:');
  providers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));

  const answer = await prompt(`\nChoose target (1-${providers.length}): `);
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= providers.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }

  const chosen = providers[idx];
  if (chosen.key === 'github') {
    await cmdPublishGithub(dir);
  } else if (chosen.key === 'huggingface') {
    await cmdPublishHuggingface(dir);
  }
}

// ── Go: Interactive Wizard ──

async function cmdGo(dirPath, probability = 0.50) {
  const dir = resolve(dirPath);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  // Count data files
  const dataFiles = walkDir(dir);
  const fileCount = dataFiles.filter(e => e.type === 'file').length;
  if (fileCount === 0) {
    console.error('No files found in directory.');
    process.exit(1);
  }

  // Auto-generate key if needed
  let key;
  if (!process.env.PB_SIGNING_KEY && !existsSync(KEY_FILE)) {
    console.log('  No signing key found — generating one now...');
    const kp = wasm.generateKeypair();
    saveKey(kp);
    key = JSON.parse(readFileSync(KEY_FILE, 'utf-8'));
    console.log(`  ✓ Key saved: ${key.did}`);
    console.log();
  } else {
    key = loadKey();
  }

  console.log();
  console.log('  PeerBench Commit-Reveal Protocol');
  console.log('  ─────────────────────────────────');
  console.log(`  Directory: ${dirPath} (${fileCount} file${fileCount !== 1 ? 's' : ''})`);
  console.log();

  // ── Step 1: Hash ──
  console.log('  Step 1 of 5 — Hash');
  console.log('  Compute SHA-256 hash of every file to create a tamper-proof manifest.');
  console.log('  → manifest.json');
  console.log();
  await waitForEnter();

  const result = hashDir(dir);
  const manifestData = {
    spec_version: '0.2.0',
    root_hash: result.hash,
    items: result.manifest
      .filter(e => e.type === 'file')
      .map(e => ({ path: e.name, hash: e.hash })),
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestData, null, 2) + '\n');

  console.log(`  ✓ Root hash: ${result.hash.slice(0, 16)}...${result.hash.slice(-6)}`);
  console.log(`  ✓ Saved manifest.json (${manifestData.items.length} item${manifestData.items.length !== 1 ? 's' : ''})`);
  console.log();

  // ── Step 2: Commit ──
  console.log('  Step 2 of 5 — Commit');
  console.log(`  Sign a cryptographic commitment locking in your data and a ${(probability * 100).toFixed(0)}% reveal rate.`);
  console.log('  → commitment.json');
  console.log();
  await waitForEnter();

  const itemHashes = result.manifest
    .filter(e => e.type === 'file')
    .map(e => e.hash);

  const beaconRef = { type: 'drand', chain_hash: DRAND_CHAIN_HASH };
  const commitParams = {
    items: itemHashes,
    reveal_probability: probability,
    beacon: beaconRef,
    committed_at: new Date().toISOString(),
  };

  const commitment = wasm.createCommitment(
    JSON.stringify(commitParams),
    key.private_key_hex
  );
  writeFileSync(join(dir, 'commitment.json'), JSON.stringify(commitment, null, 2) + '\n');

  console.log(`  ✓ Commitment: ${commitment.commitment_hash.slice(0, 16)}...${commitment.commitment_hash.slice(-6)}`);
  console.log('  ✓ Saved commitment.json');
  console.log();

  // ── Step 3: Submit ──
  console.log('  Step 3 of 5 — Submit');
  console.log('  Send commitment to independent timestamp servers. Each waits for the next');
  console.log('  drand random beacon (~3s) before returning a receipt.');
  console.log('  → server-receipts.json');
  console.log();
  await waitForEnter();

  const servers = getServers();
  if (servers.length === 0) {
    console.log('  ✗ No servers in registry. Run: pb-js servers');
    process.exit(1);
  }

  const spinner = startSpinner('Waiting for drand beacon...');

  const settled = await Promise.allSettled(
    servers.map(async (server) => {
      const url = `${server.url.replace(/\/$/, '')}/v1/commitments`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitment),
      });
      if (res.ok) {
        const receipt = await res.json();
        return { server_name: server.name, server_url: server.url, receipt, duplicate: false };
      } else if (res.status === 409) {
        // Commitment already exists — fetch the existing receipt
        const getUrl = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitment.commitment_hash}`;
        const getRes = await fetch(getUrl);
        if (getRes.ok) {
          const existing = await getRes.json();
          return { server_name: server.name, server_url: server.url, receipt: existing, duplicate: true };
        }
        return { server_name: server.name, server_url: server.url, receipt: null, duplicate: true };
      } else {
        const body = await res.text();
        throw new Error(`${server.name}: ${res.status} ${body}`);
      }
    })
  );

  const receipts = [];
  let duplicateCount = 0;
  let firstFailure = null;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      if (r.value.duplicate) duplicateCount++;
      const label = r.value.duplicate ? '(already committed)' : `round ${r.value.receipt?.selection?.beacon_output?.round || '?'}`;
      if (receipts.length === 0) spinner.stop(`${r.value.server_name}: ${label}`);
      else console.log(`  ✓ ${r.value.server_name}: ${label}`);
      if (r.value.receipt) receipts.push(r.value);
    } else {
      if (!firstFailure) { spinner.fail(`${servers[i].name}: ${r.reason?.message || 'failed'}`); firstFailure = true; }
      else console.log(`  ✗ ${servers[i].name}: ${r.reason?.message || 'failed'}`);
    }
  }

  if (receipts.length === 0) {
    console.log('  ✗ All servers failed.');
    process.exit(1);
  }

  if (duplicateCount > 0) {
    console.log();
    console.log(`  ⚠ WARNING: This data has already been committed to ${duplicateCount} server${duplicateCount !== 1 ? 's' : ''}.`);
    console.log('  Re-running on previously committed data — using existing server receipts.');
  }

  const serverReceipts = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    submitted_at: new Date().toISOString(),
    receipts,
  };
  writeFileSync(join(dir, 'server-receipts.json'), JSON.stringify(serverReceipts, null, 2) + '\n');
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipts[0].receipt, null, 2) + '\n');

  console.log(`  ✓ Saved server-receipts.json (${receipts.length} receipt${receipts.length !== 1 ? 's' : ''})`);
  console.log();

  // ── Step 4: Publish ──
  console.log('  Step 4 of 5 — Publish');
  console.log('  Publish your data and protocol evidence to GitHub and a PeerBench publish server.');
  console.log();
  await waitForEnter();

  // 4a. GitHub publish (required — error if fails)
  await cmdPublishGithub(dirPath);

  // 4b. Publish server upload (best-effort — warn if fails)
  try {
    const publishers = getRevealPublishers();
    if (publishers.length > 0) {
      const publisher = publishers[0];
      const publishUrl = `${publisher.url.replace(/\/$/, '')}/v1/upload`;
      console.log(`\n  Uploading to publish server: ${publisher.name}...`);

      // Load receipt (the individual server receipt with .commitment inside, not the wrapper)
      const receiptPath = join(dir, 'receipt.json');
      if (!existsSync(receiptPath)) {
        console.log('  ⚠ No receipt.json found — skipping publish server upload');
        throw new Error('skip');
      }
      const receiptJson = readFileSync(receiptPath, 'utf-8');

      // Collect data files (non-protocol files)
      const dataFiles = walkDir(dir).filter(e => e.type === 'file');

      // Build multipart form
      const formData = new FormData();
      formData.append('receipt', receiptJson);
      for (const entry of dataFiles) {
        const filePath = join(dir, entry.name);
        const fileBytes = readFileSync(filePath);
        formData.append('files[]', new Blob([fileBytes]), entry.name);
      }

      // Auth: try Ed25519 signature auth using the signing key
      const authHeaders = {};
      if (key.private_key_hex && (key.public_key_hex || key.did)) {
        const ts = Math.floor(Date.now() / 1000).toString();
        const message = `upload:${ts}`;
        const msgBytes = new TextEncoder().encode(message);
        const sig = wasm.signMessage(key.private_key_hex, msgBytes);
        const pubHex = key.public_key_hex || '';
        if (pubHex) {
          authHeaders['Authorization'] = `Ed25519 ${pubHex} ${ts} ${sig}`;
        }
      }
      // Fallback: bearer token from env
      if (!authHeaders['Authorization'] && process.env.PB_PUBLISH_TOKEN) {
        authHeaders['Authorization'] = `Bearer ${process.env.PB_PUBLISH_TOKEN}`;
      }

      if (!authHeaders['Authorization']) {
        console.log('  ⚠ No publish server auth available (set PB_PUBLISH_TOKEN or link signing key)');
        console.log('  (continuing — GitHub publish succeeded)');
      } else {
        const uploadRes = await fetch(publishUrl, {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });

        if (uploadRes.ok) {
          const uploadResult = await uploadRes.json();
          console.log(`  ✓ Uploaded ${dataFiles.length} file${dataFiles.length !== 1 ? 's' : ''} to ${publisher.name}`);
        } else {
          const errBody = await uploadRes.text();
          console.log(`  ⚠ Publish server upload failed: ${uploadRes.status} ${errBody}`);
          console.log('  (continuing — GitHub publish succeeded)');
        }
      }
    }
  } catch (err) {
    if (err.message !== 'skip') {
      console.log(`  ⚠ Publish server upload failed: ${err.message}`);
      console.log('  (continuing — GitHub publish succeeded)');
    }
  }

  console.log();

  // ── Step 5: Reveal ──
  console.log('  Step 5 of 5 — Reveal');
  console.log('  Sign and submit reveal for the randomly selected items.');
  console.log('  → reveal.json, reveal-receipts.json');
  console.log();
  await waitForEnter();

  // Get selected items from first receipt
  const firstReceipt = receipts.find(r => r.receipt?.selection?.selected_items);
  if (!firstReceipt) {
    console.log('  ✗ No selection found in receipts.');
    process.exit(1);
  }
  const selectedItems = firstReceipt.receipt.selection.selected_items;

  const revealPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    selected_items: selectedItems,
    voluntary_items: [],
    revealed_at: new Date().toISOString(),
    signing_key: key.did || key.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(revealPayload));
  const signature = wasm.signMessage(key.private_key_hex, payloadBytes);
  const reveal = { ...revealPayload, signature };

  writeFileSync(join(dir, 'reveal.json'), JSON.stringify(reveal, null, 2) + '\n');

  console.log(`  ✓ Revealing ${selectedItems.length} selected item${selectedItems.length !== 1 ? 's' : ''}`);

  // Load file_urls from publication.json for server-side data verification
  let selectedFileUrls = {};
  const pubPath = join(dir, 'publication.json');
  if (existsSync(pubPath)) {
    try {
      const pub = JSON.parse(readFileSync(pubPath, 'utf-8'));
      if (pub.file_urls && typeof pub.file_urls === 'object') {
        for (const hash of selectedItems) {
          if (pub.file_urls[hash]) selectedFileUrls[hash] = pub.file_urls[hash];
        }
      }
    } catch {}
  }
  if (Object.keys(selectedFileUrls).length === 0) {
    console.log('  ⚠ No publication.json found — servers may reject reveal without file_urls');
  }

  // Submit reveal to servers
  const revealSpinner = startSpinner('Submitting reveal...');

  const revealSettled = await Promise.allSettled(
    servers.map(async (server) => {
      const url = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitment.commitment_hash}/reveals`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...reveal, file_urls: selectedFileUrls }),
      });
      if (res.ok) {
        const body = await res.json();
        return { server_name: server.name, server_url: server.url, response: body };
      } else {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
    })
  );

  const revealReceipts = [];
  let firstRevealPrinted = false;
  for (let i = 0; i < revealSettled.length; i++) {
    const r = revealSettled[i];
    if (r.status === 'fulfilled') {
      const resp = r.value.response;
      const parts = [r.value.server_name + ': accepted'];
      if (resp.data_verified) parts.push('data verified');
      if (resp.file_urls_registered > 0) parts.push(`${resp.file_urls_registered} file URLs registered`);
      const msg = parts.join(', ');
      if (!firstRevealPrinted) { revealSpinner.stop(msg); firstRevealPrinted = true; }
      else console.log(`  ✓ ${msg}`);
      revealReceipts.push(r.value);
    } else {
      if (!firstRevealPrinted) { revealSpinner.fail(`${servers[i].name}: ${r.reason?.message || 'failed'}`); firstRevealPrinted = true; }
      else console.log(`  ✗ ${servers[i].name}: ${r.reason?.message || 'failed'}`);
    }
  }

  if (!firstRevealPrinted) revealSpinner.stop('done');

  const revealReceiptsData = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    revealed_at: reveal.revealed_at,
    receipts: revealReceipts,
  };
  writeFileSync(join(dir, 'reveal-receipts.json'), JSON.stringify(revealReceiptsData, null, 2) + '\n');

  console.log('  ✓ Saved reveal.json + reveal-receipts.json');

  // Push reveal files back to GitHub repo
  if (existsSync(join(dir, 'publication.json'))) {
    try {
      const pub = JSON.parse(readFileSync(join(dir, 'publication.json'), 'utf-8'));
      if (pub.repository && pub.reveal_folder) {
        const repo = pub.repository;
        const tmpBase = join(homedir(), '.peerbench', 'publish-tmp');
        const cloneDir = join(tmpBase, repo.split('/').pop());

        if (existsSync(join(cloneDir, '.git'))) {
          const destDir = join(cloneDir, pub.reveal_folder);

          // Copy reveal files
          for (const rf of ['reveal.json', 'reveal-receipts.json']) {
            if (existsSync(join(dir, rf))) {
              cpSync(join(dir, rf), join(destDir, rf));
            }
          }

          // Git add, commit, push
          shell('git add -A', { cwd: cloneDir });
          const diffCheck = shell('git diff --cached --stat', { cwd: cloneDir, allowFail: true });
          if (diffCheck) {
            shell(`git commit -m "Add reveal receipts for ${pub.reveal_folder}"`, { cwd: cloneDir });
            shell('git push', { cwd: cloneDir });
            console.log('  ✓ Pushed reveal receipts to GitHub');
          }
        }
      }
    } catch (err) {
      console.log(`  ⚠ Could not update GitHub repo: ${err.message}`);
    }
  }

  console.log();

  // ── Summary ──
  console.log('  ─────────────────────────────────');
  console.log(`  Done! Evidence chain in ${dirPath}:`);
  console.log('    manifest.json        file hashes');
  console.log('    commitment.json      signed commitment');
  console.log('    server-receipts.json server timestamps');
  console.log('    publication.json     publish receipts');
  console.log('    reveal.json          signed reveal');
  console.log('    reveal-receipts.json server confirmations');
  console.log();
}

// ── Generate random test data ──

function cmdGenerate(baseDir, count) {
  const dir = resolve(baseDir);
  // Find next available index
  let idx = 0;
  while (existsSync(join(dir, `random_data_${idx}`))) idx++;

  for (let batch = 0; batch < count; batch++) {
    const outDir = join(dir, `random_data_${idx + batch}`);
    mkdirSync(outDir, { recursive: true });

    const topics = [
      'contracts', 'torts', 'constitutional', 'criminal-law', 'evidence',
      'civil-procedure', 'property', 'family-law', 'administrative', 'ethics'
    ];
    const difficulties = ['easy', 'medium', 'hard'];

    const numFiles = 3 + randomInt(4); // 3-6 files per batch
    for (let f = 0; f < numFiles; f++) {
      const topic = topics[randomInt(topics.length)];
      const numQuestions = 2 + randomInt(4); // 2-5 questions per file
      const questions = [];
      for (let q = 0; q < numQuestions; q++) {
        questions.push({
          id: q + 1,
          topic,
          question: `Sample question ${randomBytes(4).toString('hex')}?`,
          choices: [
            `Answer_${randomBytes(3).toString('hex')}`,
            `Answer_${randomBytes(3).toString('hex')}`,
            `Answer_${randomBytes(3).toString('hex')}`,
            `Answer_${randomBytes(3).toString('hex')}`
          ],
          answer: randomInt(4),
          difficulty: difficulties[randomInt(3)],
          nonce: randomBytes(8).toString('hex')
        });
      }
      const filename = `${topic}_${randomBytes(4).toString('hex')}.json`;
      writeFileSync(join(outDir, filename), JSON.stringify(questions, null, 2) + '\n');
    }

    console.log(`Created ${outDir}  (${numFiles} files)`);
  }
}

// ── Argument parsing ──

function usage() {
  console.log(`Usage:
  pb-js go <dir> [-p <prob>]                Guided wizard (just hit Enter)
  pb-js key generate                        Generate Ed25519 keypair
  pb-js key show                            Show stored did:key
  pb-js hash file <path>                    Hash a file (SHA-256)
  pb-js hash dir <path>                     Hash a directory
  pb-js commit <dir> -p <prob>              Create commitment from directory
  pb-js verify <commitment.json>            Verify commitment signature
  pb-js servers                             List known servers
  pb-js submit <dir|file> [-s <srv>]         Submit commitment to server(s)
  pb-js reveal <dir>                        Create & submit reveal
  pb-js publish github <dir> [--repo <r>]   Publish reveal to GitHub
  pb-js publish huggingface <dir> [--repo <r>]  Publish reveal to Hugging Face
  pb-js publish <dir>                       Interactive provider selection
  pb-js generate-random-data [dir] [-n <n>] Generate random test data (default: random-sample/)`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  const sub = args[1];

  if (cmd === 'go' && args[1]) {
    let probability = 0.50;
    let dirArg = args[1];
    for (let i = 2; i < args.length; i++) {
      if ((args[i] === '-p' || args[i] === '--probability') && args[i + 1]) {
        probability = parseFloat(args[i + 1]);
        i++;
      }
    }
    await cmdGo(dirArg, probability);
  } else if (cmd === 'key' && sub === 'generate') {
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
  } else if (cmd === 'servers') {
    cmdServers();
  } else if (cmd === 'submit' && args[1]) {
    let server = undefined;
    for (let i = 2; i < args.length; i++) {
      if ((args[i] === '-s' || args[i] === '--server') && args[i + 1]) {
        server = args[i + 1];
        i++;
      }
    }
    await cmdSubmit(args[1], server);
  } else if (cmd === 'reveal' && args[1]) {
    await cmdReveal(args[1]);
  } else if (cmd === 'publish') {
    let repoName = undefined;
    // Parse --repo flag from remaining args
    const publishArgs = args.slice(1);
    for (let i = 0; i < publishArgs.length; i++) {
      if (publishArgs[i] === '--repo' && publishArgs[i + 1]) {
        repoName = publishArgs[i + 1];
        publishArgs.splice(i, 2);
        i--;
      }
    }

    const target = publishArgs[0];
    const dirArg = publishArgs[1] || publishArgs[0];

    if (target === 'github' && publishArgs[1]) {
      await cmdPublishGithub(publishArgs[1], repoName);
    } else if (target === 'huggingface' && publishArgs[1]) {
      await cmdPublishHuggingface(publishArgs[1], repoName);
    } else if (target && target !== 'github' && target !== 'huggingface') {
      // No target specified, treat first arg as dir → interactive
      await cmdPublishInteractive(target);
    } else {
      console.error('Usage: pb-js publish [github|huggingface] <dir> [--repo <name>]');
      process.exit(1);
    }
  } else if (cmd === 'generate-random-data') {
    let count = 1;
    let dirArg = 'random-sample';
    for (let i = 1; i < args.length; i++) {
      if ((args[i] === '-n' || args[i] === '--count') && args[i + 1]) {
        count = parseInt(args[i + 1], 10);
        i++;
      } else if (!args[i].startsWith('-')) {
        dirArg = args[i];
      }
    }
    cmdGenerate(dirArg, count);
  } else {
    usage();
  }
}

main();
