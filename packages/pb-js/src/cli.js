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
 *   pb-js servers                         List known servers
 *   pb-js submit <commitment.json> [-s <server>]  Submit commitment
 *   pb-js publish github <dir> [--repo <name>]    Publish data to GitHub
 *   pb-js publish huggingface <dir> [--repo <name>] Publish data to Hugging Face
 *   pb-js publish <dir>                   Interactive: detect providers & choose
 *   pb-js mirrors add <hash> <url> [--provider github]  Register data mirror
 *   pb-js mirrors list <hash> [-s <server>]             List mirrors
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, cpSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as wasm from 'pb-wasm';
import { getServers, resolveServer } from './registry.js';

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

async function cmdSubmit(commitmentPath, serverNameOrUrl) {
  const raw = readFileSync(resolve(commitmentPath), 'utf-8');
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

// ── Mirror registration ──

async function registerMirrorWithServers(srcDir, url, provider) {
  const receipt = findReceipt(srcDir);
  if (!receipt?.commitment_hash) {
    console.log('No commitment_hash found in directory — skipping mirror registration.');
    return null;
  }

  const key = loadKey();
  const servers = getServers();
  if (servers.length === 0) {
    console.log('No servers in registry — skipping mirror registration.');
    return null;
  }

  const mirrorPayload = {
    spec_version: '0.2.0',
    commitment_hash: receipt.commitment_hash,
    url,
    provider,
    registered_at: new Date().toISOString(),
    signing_key: key.did || key.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
  const signature = wasm.signMessage(key.private_key_hex, payloadBytes);
  const mirror = { ...mirrorPayload, signature };

  console.log(`\nRegistering mirror with ${servers.length} server(s)...`);

  const settled = await Promise.allSettled(
    servers.map(async (server) => {
      const endpoint = `${server.url.replace(/\/$/, '')}/v1/commitments/${receipt.commitment_hash}/mirrors`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mirror),
      });
      if (res.ok) {
        const body = await res.json();
        return { server: server.name, server_url: server.url, status: 'ok', mirror_id: body.mirror_id, server_registered_at: body.server_registered_at };
      } else {
        const body = await res.text();
        return { server: server.name, server_url: server.url, status: 'error', error: `${res.status}: ${body}` };
      }
    })
  );

  const mirrorResults = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { server: servers[i].name, server_url: servers[i].url, status: 'error', error: r.reason?.message || 'unknown error' };
  });

  for (const v of mirrorResults) {
    if (v.status === 'ok') {
      console.log(`  ${v.server}: registered (mirror_id: ${v.mirror_id})`);
    } else {
      console.log(`  ${v.server}: ${v.error}`);
    }
  }

  return { mirror_request: mirror, results: mirrorResults };
}

async function cmdMirrorsAdd(commitmentHash, url, provider) {
  const key = loadKey();
  const servers = getServers();
  if (servers.length === 0) {
    console.error('No servers in registry.');
    process.exit(1);
  }

  const mirrorPayload = {
    spec_version: '0.2.0',
    commitment_hash: commitmentHash,
    url,
    provider,
    registered_at: new Date().toISOString(),
    signing_key: key.did || key.did_key,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(mirrorPayload));
  const signature = wasm.signMessage(key.private_key_hex, payloadBytes);
  const mirror = { ...mirrorPayload, signature };

  console.log(`Registering mirror with ${servers.length} server(s)...`);

  for (const server of servers) {
    const endpoint = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitmentHash}/mirrors`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mirror),
      });
      if (res.ok) {
        const body = await res.json();
        console.log(`  ${server.name}: registered (mirror_id: ${body.mirror_id})`);
      } else {
        const body = await res.text();
        console.log(`  ${server.name}: ${res.status} ${body}`);
      }
    } catch (e) {
      console.log(`  ${server.name}: unreachable (${e.message})`);
    }
  }
}

async function cmdMirrorsList(commitmentHash, serverNameOrUrl) {
  const server = resolveServer(serverNameOrUrl);
  const endpoint = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitmentHash}/mirrors`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text();
    console.error(`Server returned ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json();
  if (data.mirrors.length === 0) {
    console.log('No mirrors registered for this commitment.');
    return;
  }

  console.log(`Mirrors for ${commitmentHash}:`);
  for (const m of data.mirrors) {
    console.log(`  ${m.provider}: ${m.url}`);
    console.log(`    mirror_id: ${m.mirror_id}`);
    console.log(`    registered: ${m.server_registered_at}`);
    console.log();
  }
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

  // Write a README for this reveal
  const commitHash = receipt?.commitment_hash || 'unknown';
  const readmeContent = `# PeerBench Reveal

- **Commitment Hash**: \`${commitHash}\`
- **Date**: ${new Date().toISOString()}
- **Verification**: Run \`./verify.sh\` or \`npx @peerbench/sdk verify commitment.json\`

## Contents

- \`data/\` — Revealed benchmark data
- \`commitment.json\` — Original cryptographic commitment
- \`receipt.json\` — Server receipt with timestamp proof
- \`verify.sh\` — One-command verification script
`;
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

  // Register mirror with servers
  const mirrorResult = await registerMirrorWithServers(srcDir, githubUrl, 'github');

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
    mirror_registrations: mirrorResult?.results || [],
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

  // Register mirror with servers
  const mirrorResult = await registerMirrorWithServers(srcDir, hfUrl, 'huggingface');

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
    mirror_registrations: mirrorResult?.results || [],
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

// ── Argument parsing ──

function usage() {
  console.log(`Usage:
  pb-js key generate                        Generate Ed25519 keypair
  pb-js key show                            Show stored did:key
  pb-js hash file <path>                    Hash a file (SHA-256)
  pb-js hash dir <path>                     Hash a directory
  pb-js commit <dir> -p <prob>              Create commitment from directory
  pb-js verify <commitment.json>            Verify commitment signature
  pb-js servers                             List known servers
  pb-js submit <file> [-s <srv>]            Submit commitment to server
  pb-js publish github <dir> [--repo <r>]   Publish reveal to GitHub
  pb-js publish huggingface <dir> [--repo <r>]  Publish reveal to Hugging Face
  pb-js publish <dir>                       Interactive provider selection
  pb-js mirrors add <hash> <url> [--provider github]  Register data mirror
  pb-js mirrors list <hash> [-s <server>]   List mirrors for a commitment`);
  process.exit(1);
}

async function main() {
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
  } else if (cmd === 'mirrors' && sub === 'add' && args[2] && args[3]) {
    let provider = 'custom';
    for (let i = 4; i < args.length; i++) {
      if (args[i] === '--provider' && args[i + 1]) {
        provider = args[i + 1];
        i++;
      }
    }
    await cmdMirrorsAdd(args[2], args[3], provider);
  } else if (cmd === 'mirrors' && sub === 'list' && args[2]) {
    let server = undefined;
    for (let i = 3; i < args.length; i++) {
      if ((args[i] === '-s' || args[i] === '--server') && args[i + 1]) {
        server = args[i + 1];
        i++;
      }
    }
    await cmdMirrorsList(args[2], server);
  } else {
    usage();
  }
}

main();
