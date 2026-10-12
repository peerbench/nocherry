/**
 * Commit-Reveal CLI — JS implementation using pb-wasm.
 *
 * Usage:
 *   pb-js go <dir> [-p <prob>] [--no-anchor]  Guided wizard (just hit Enter)
 *   pb-js key generate
 *   pb-js key show
 *   pb-js hash file <path>
 *   pb-js hash dir <path>
 *   pb-js commit <dir> --probability <p> [--beacon drand] [--no-anchor]
 *   pb-js verify <commitment.json | receipt.json | server-receipts.json>
 *   pb-js servers                         List known servers
 *   pb-js submit <dir|file> [-s <server>]  Submit commitment to server(s)
 *   pb-js reveal <dir>                           Create & submit reveal
 *   pb-js publish github <dir> [--repo <name>]    Publish data to GitHub
 *   pb-js publish huggingface <dir> [--repo <name>] Publish data to Hugging Face
 *   pb-js publish <dir>                   Interactive: detect providers & choose
 *   pb-js generate-random-data [dir] [-n <count>]        Generate random test data
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, cpSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes, randomInt } from 'node:crypto';
import * as wasm from '@nocherry/pb-wasm';
import { getServers, resolveServer, getRevealPublishers } from './registry.js';
import { resolveSelectedFiles, copySelectedFiles, loadSelectedHashes, type SelectedFile } from './publish-select.js';
import {
  createAnchoredCommitment, reanchorCommitment, submitCommitment, verifyReceiptAnchor,
  type SubmitResult,
} from './anchor.js';
import { verifyReceipt, verifyReveal } from './receipt.js';
import {
  FORMAT_V5, SECRET_FILE, parseFormat, planCommitment, planReveal, readSecret, writeSecret, manifestKey, describeProbability,
  publishedManifest, type Format,
} from './format.js';

const KEY_DIR = join(homedir(), '.nocherry');
const KEY_FILE = join(KEY_DIR, 'key.json');
const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadKey(): Record<string, any> {
  // Check env var first
  const envKey = process.env.PB_SIGNING_KEY;
  if (envKey) {
    const keyBytes = Buffer.from(envKey, 'hex');
    if (keyBytes.length !== 32) {
      console.error('PB_SIGNING_KEY must be 32 bytes (64 hex chars)');
      process.exit(1);
    }
    return { private_key_hex: envKey };
  }

  if (!existsSync(KEY_FILE)) {
    console.error('No key found. Run: pb-js key generate');
    process.exit(1);
  }
  return JSON.parse(readFileSync(KEY_FILE, 'utf-8'));
}

/** Like loadKey, but returns null instead of exiting when no key is configured. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryLoadKey(): Record<string, any> | null {
  if (process.env.PB_SIGNING_KEY || existsSync(KEY_FILE)) return loadKey();
  return null;
}

/**
 * Re-sign callback for submitCommitment: a server only accepts an anchor
 * round for a few seconds, so a commitment created earlier is re-signed with
 * a fresh one at submit time. The new commitment replaces the file on disk.
 */
function reanchorAndSave(commitmentPath: string, log: (msg: string) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (stale: Record<string, any>) => {
    const key = tryLoadKey();
    if (!key) {
      throw new Error('anchor round is no longer fresh and no signing key is available to re-sign. Run: pb-js commit <dir>');
    }
    const fresh = await reanchorCommitment(stale, key.private_key_hex);
    if (fresh.signing_key !== stale.signing_key) {
      throw new Error('anchor round is no longer fresh and the available signing key is not the one that signed this commitment');
    }
    writeFileSync(commitmentPath, JSON.stringify(fresh, null, 2) + '\n');
    log(`Re-signed with fresh anchor round ${fresh.beacon.anchor_round}`);
    log(`New commitment hash: ${fresh.commitment_hash}`);
    return fresh;
  };
}

function describeFailure(r: SubmitResult): string {
  if (r.status === 0) return r.error || 'request failed';
  const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  let hint = '';
  if (r.status === 400 && /spec_version_unsupported|Missing required field: reveal_probability/.test(body)) {
    hint = ' (this server does not accept object format 0.5.0 yet; retry with: pb-js commit <dir> --format 0.2.0)';
  } else if (r.status === 400 && /signature/i.test(body)) {
    hint = ' (if this server predates anchor_round, retry with: pb-js commit <dir> --no-anchor)';
  } else if (r.status === 409 && /stream_sequence_taken/.test(body)) {
    hint = ' (this server already holds another commitment for this stream_id and sequence; use the next sequence number)';
  }
  return `${r.status} ${body}${hint}`;
}

/** Warn when a receipt for an anchored commitment fails the verifier's anchor checks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warnOnAnchorChecks(serverName: string | null, receipt: any): void {
  if (!receipt) return;
  for (const check of verifyReceiptAnchor(receipt)) {
    if (check.status === 'fail') {
      console.error(`  WARNING ${serverName}: ${check.name} failed: ${check.detail}`);
    }
  }
}

function saveKey(kp: { did_key: string; private_key_hex: string; public_key_hex: string }) {
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

function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return wasm.hashBytes(new Uint8Array(data));
}

const PROTOCOL_FILES = new Set([
  'manifest.json', 'commitment.json', 'server-receipts.json',
  'reveal.json', 'reveal-receipts.json', 'publication.json',
  'receipt.json', 'verify.sh', 'README.md', SECRET_FILE,
]);

function walkDir(dirPath: string, prefix = ''): { name: string; type: string; hash: string }[] {
  const entries = readdirSync(dirPath).sort();
  const manifest: { name: string; type: string; hash: string }[] = [];
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

function hashDir(dirPath: string) {
  const manifest = walkDir(dirPath);
  return {
    manifest,
    hash: wasm.hashManifest(JSON.stringify(manifest)),
  };
}

// ── Command handlers ──

function cmdKeyGenerate(): void {
  const kp = wasm.generateKeypair();
  const saved = saveKey(kp);
  console.log(saved.did);
}

function cmdKeyShow(): void {
  const key = loadKey();
  console.log(key.did || key.did_key || 'unknown');
}

function cmdHashFile(filePath: string): void {
  const hash = hashFile(resolve(filePath));
  console.log(hash);
}

function cmdHashDir(dirPath: string): void {
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

interface CommitFlags {
  format: Format;
  anchor: boolean;
  selectionMode?: 'per_item' | 'batch';
  streamId?: string;
  sequence?: number;
}

/**
 * Hash the directory, write manifest.json (and, for 0.5.0, the item secret),
 * and return the signed commitment. Shared by `commit` and `go`.
 */
async function buildCommitment(dir: string, probability: number, beacon: string, flags: CommitFlags, key: Record<string, any>) {
  const { manifest, hash: rootHash } = hashDir(dir);
  const files = manifest.filter(e => e.type === 'file').map(e => ({ path: e.name, hash: e.hash }));
  if (files.length === 0) {
    console.error('No files found in directory');
    process.exit(1);
  }
  if (flags.format === FORMAT_V5 && !flags.anchor) {
    console.error('Object format 0.5.0 requires an anchor round; drop --no-anchor or use --format 0.2.0');
    process.exit(1);
  }
  if (flags.format === FORMAT_V5 && beacon !== 'drand') {
    console.error('Object format 0.5.0 defines the drand beacon only');
    process.exit(1);
  }
  const beaconRef = beacon === 'drand'
    ? { type: 'drand', chain_hash: DRAND_CHAIN_HASH }
    : { type: beacon };

  let itemSecret: string | undefined;
  if (flags.format === FORMAT_V5) {
    if (existsSync(join(dir, 'server-receipts.json')) || existsSync(join(dir, 'receipt.json'))) {
      console.error(`Warning: ${dir} already holds server receipts; a new commitment gets a fresh item secret and the old ${SECRET_FILE} is replaced`);
    }
    itemSecret = writeSecret(dir).item_secret;
    console.error(`Saved ${SECRET_FILE} (keep it private; it opens every item)`);
  }
  const plan = planCommitment(files, rootHash, {
    format: flags.format, probability, beacon: beaconRef,
    selectionMode: flags.selectionMode, streamId: flags.streamId, sequence: flags.sequence,
  }, itemSecret);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(plan.manifest, null, 2) + '\n');
  console.error('Saved manifest.json');

  const commitment = await createAnchoredCommitment(plan.params, key.private_key_hex, { anchor: flags.anchor });
  writeFileSync(join(dir, 'commitment.json'), JSON.stringify(commitment, null, 2) + '\n');
  console.error('Saved commitment.json');
  return { commitment, manifest: plan.manifest };
}

async function cmdCommit(dirPath: string, probability: number, beacon: string, flags: CommitFlags): Promise<void> {
  const key = loadKey();
  const dir = resolve(dirPath);
  const { commitment } = await buildCommitment(dir, probability, beacon, flags, key);
  console.log(JSON.stringify(commitment, null, 2));
}

/** Print the offline checks of each receipt; exit 1 if any receipt fails. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmdVerifyReceipts(receipts: { label: string; receipt: any }[]): never {
  let failed = false;
  for (const { label, receipt } of receipts) {
    const result = verifyReceipt(receipt);
    console.log(`Receipt ${label}: ${result.status.toUpperCase()}`);
    console.log(`  Hash: ${receipt.commitment_hash}`);
    for (const check of result.checks) {
      console.log(`  ${check.status.padEnd(4)} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    if (result.status === 'failed') failed = true;
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Verify a reveal folder offline: receipts, signed reveal, and the revealed
 * files named in manifest.json. Exit 1 if any receipt fails, 2 if the result
 * is only partial (data or selected items missing).
 */
function cmdVerifyFolder(dir: string): never {
  const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf-8'));
  if (!existsSync(join(dir, 'reveal.json'))) {
    console.error('No reveal.json in folder. To check receipts only: pb-js verify <dir>/server-receipts.json');
    process.exit(1);
  }
  const reveal = read('reveal.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipts: { label: string; receipt: any }[] = existsSync(join(dir, 'server-receipts.json'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? read('server-receipts.json').receipts.map((r: any) => ({ label: r.server_name || r.server_url || 'unknown server', receipt: r.receipt }))
    : [{ label: 'receipt.json', receipt: read('receipt.json') }];

  // Item hash -> file, from the manifest written at commit time.
  const pathOf = new Map<string, string>();
  if (existsSync(join(dir, 'manifest.json'))) {
    for (const item of read('manifest.json').items ?? []) {
      const itemKey = manifestKey(item);
      if (itemKey) pathOf.set(itemKey, item.path);
    }
  }
  const data: Record<string, Uint8Array> = {};
  for (const itemHash of [...(reveal.selected_items ?? []), ...(reveal.voluntary_items ?? [])]) {
    const rel = pathOf.get(itemHash);
    const file = rel === undefined ? undefined : resolve(dir, rel);
    // Only files inside the folder count as revealed data.
    if (file && file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile()) {
      data[itemHash] = new Uint8Array(readFileSync(file));
    }
  }

  const statuses: string[] = [];
  for (const { label, receipt } of receipts) {
    const result = verifyReveal(receipt, reveal, data);
    console.log(`Reveal against receipt ${label}: ${result.status.toUpperCase()}`);
    console.log(`  Hash: ${receipt.commitment_hash}`);
    for (const check of result.checks) {
      console.log(`  ${check.status.padEnd(4)} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    statuses.push(result.status);
  }
  process.exit(statuses.includes('failed') ? 1 : statuses.includes('partial') ? 2 : 0);
}

function cmdVerify(commitmentPath: string): void {
  if (statSync(resolve(commitmentPath)).isDirectory()) cmdVerifyFolder(resolve(commitmentPath));
  const raw = readFileSync(resolve(commitmentPath), 'utf-8');
  const commitment = JSON.parse(raw);

  // server-receipts.json or a single receipt: verify the whole chain offline.
  if (Array.isArray(commitment.receipts)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cmdVerifyReceipts(commitment.receipts.map((r: any) => ({
      label: r.server_name || r.server_url || 'unknown server', receipt: r.receipt,
    })));
  }
  if (commitment.commitment && commitment.registered_at) {
    cmdVerifyReceipts([{ label: commitment.server_key || 'unknown server', receipt: commitment }]);
  }

  try {
    const valid = wasm.verifyCommitment(JSON.stringify(commitment));
    if (valid) {
      console.log('Commitment signature: VALID');
      console.log(`  Hash: ${commitment.commitment_hash}`);
      console.log(`  Signer: ${commitment.signing_key}`);
      console.log(`  Items: ${commitment.item_count}`);
      console.log(`  Format: ${commitment.spec_version}`);
      console.log(`  Probability: ${describeProbability(commitment)}`);
      process.exit(0);
    } else {
      console.error('Commitment signature: INVALID');
      process.exit(1);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Verification failed: ${msg}`);
    process.exit(1);
  }
}

function cmdServers(): void {
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

async function cmdSubmit(target: string, serverNameOrUrl?: string): Promise<void> {
  const resolved = resolve(target);
  const isDir = existsSync(resolved) && statSync(resolved).isDirectory();

  if (isDir) {
    await cmdSubmitDir(resolved);
  } else {
    await cmdSubmitFile(resolved, serverNameOrUrl);
  }
}

async function cmdSubmitFile(commitmentPath: string, serverNameOrUrl?: string): Promise<void> {
  const raw = readFileSync(commitmentPath, 'utf-8');
  const commitment = JSON.parse(raw);

  const server = resolveServer(serverNameOrUrl);

  console.log(`Submitting to ${server.name || server.url} ...`);

  let result: SubmitResult;
  try {
    const outcome = await submitCommitment([server], commitment, {
      reanchor: reanchorAndSave(commitmentPath, (msg) => console.error(msg)),
    });
    result = outcome.results[0];
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (result.status === 201) {
    const receipt = result.body;
    console.log(`201 Created`);
    console.log(`  Server:       ${receipt.server_key}`);
    console.log(`  Registered:   ${receipt.registered_at}`);
    if (receipt.selection?.beacon_output) {
      console.log(`  Beacon Round: ${receipt.selection.beacon_output.round}`);
    }
    warnOnAnchorChecks(server.name || server.url, receipt);
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    console.error(`Server returned ${describeFailure(result).replace(/^(\d+) /, '$1: ')}`);
    process.exit(1);
  }
}

async function cmdSubmitDir(dir: string): Promise<void> {
  const commitmentPath = join(dir, 'commitment.json');
  if (!existsSync(commitmentPath)) {
    console.error('No commitment.json found in directory. Run: pb-js commit <dir>');
    process.exit(1);
  }

  let commitment = JSON.parse(readFileSync(commitmentPath, 'utf-8'));
  const servers = getServers();
  if (servers.length === 0) {
    console.error('No servers in registry.');
    process.exit(1);
  }

  console.log(`Submitting to ${servers.length} server(s)...`);

  let results: SubmitResult<typeof servers[number]>[];
  try {
    const outcome = await submitCommitment(servers, commitment, {
      reanchor: reanchorAndSave(commitmentPath, (msg) => console.error(msg)),
    });
    commitment = outcome.commitment;
    results = outcome.results;
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipts: { server_name: string | null; server_url: string; receipt: any }[] = [];
  for (const r of results) {
    if (r.status === 201) {
      console.log(`  ${r.server.name}: 201 Created (round ${r.body.selection?.beacon_output?.round || '?'})`);
      warnOnAnchorChecks(r.server.name, r.body);
      receipts.push({ server_name: r.server.name, server_url: r.server.url, receipt: r.body });
    } else {
      console.error(`  ${r.server.name}: ${describeFailure(r)}`);
    }
  }

  if (receipts.length === 0) {
    console.error('All servers failed.');
    process.exit(1);
  }

  const rounds = new Set(receipts.map(r => r.receipt.selection?.beacon_output?.round).filter(r => r !== undefined));
  if (rounds.size > 1) {
    console.error(`  WARNING servers used different beacon rounds: ${[...rounds].join(', ')}`);
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

/**
 * Signed reveal of `selectedItems` in the commitment's format. A 0.5.0 reveal
 * recomputes each opening from the file and the item secret, so it fails if a
 * file changed since the commitment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReveal(dir: string, commitment: Record<string, any>, selectedItems: string[], key: Record<string, any>) {
  const manifestPath = join(dir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf-8')).items ?? []) : [];
  let itemSecret: string | undefined;
  if (commitment.spec_version === FORMAT_V5) {
    try {
      itemSecret = readSecret(dir).item_secret;
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
  let params: Record<string, unknown>;
  try {
    params = planReveal({
      commitment, selectedItems, manifest, itemSecret,
      readFile: (rel) => new Uint8Array(readFileSync(join(dir, rel))),
      signingKey: key.did || key.did_key,
    });
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  return wasm.createReveal(JSON.stringify(params), key.private_key_hex);
}

async function cmdReveal(dirPath: string): Promise<void> {
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
  let selectedItems: string[] | undefined;
  const serverReceiptsPath = join(dir, 'server-receipts.json');
  const receiptPath = join(dir, 'receipt.json');

  if (existsSync(serverReceiptsPath)) {
    const sr = JSON.parse(readFileSync(serverReceiptsPath, 'utf-8'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstReceipt = sr.receipts.find((r: any) => r.receipt?.selection?.selected_items);
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

  const reveal = buildReveal(dir, commitment, selectedItems, key);

  // Save reveal.json
  writeFileSync(join(dir, 'reveal.json'), JSON.stringify(reveal, null, 2) + '\n');
  console.error('Saved reveal.json');

  // Load file_urls from publication.json for server-side data verification
  const selectedFileUrls: Record<string, string> = {};
  const pubPath = join(dir, 'publication.json');
  if (existsSync(pubPath)) {
    try {
      const pub = JSON.parse(readFileSync(pubPath, 'utf-8'));
      if (pub.file_urls && typeof pub.file_urls === 'object') {
        for (const hash of selectedItems) {
          if (pub.file_urls[hash]) selectedFileUrls[hash] = pub.file_urls[hash];
        }
      }
    } catch { /* ignore */ }
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
        const body = await res.json() as any;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealReceipts: { server_name: string | null; server_url: string; response: any }[] = [];
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

function shell(cmd: string, opts: { allowFail?: boolean; cwd?: string } = {}): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return null;
    throw e;
  }
}

function hasCommand(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, (ans: string) => { rl.close(); res(ans.trim()); }));
}

async function waitForEnter(): Promise<void> {
  await prompt('  [Enter] ');
}

const SPINNER_FRAMES = ['\u25D0', '\u25D3', '\u25D1', '\u25D2'];

function startSpinner(message: string): { stop(msg: string): void; fail(msg: string): void } {
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}`);
  }, 120);
  return {
    stop(finalMessage: string) {
      clearInterval(id);
      process.stdout.write(`\r  \u2713 ${finalMessage}\n`);
    },
    fail(finalMessage: string) {
      clearInterval(id);
      process.stdout.write(`\r  \u2717 ${finalMessage}\n`);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findReceipt(dir: string): Record<string, any> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: Record<string, any> | null = null;
  const receiptPath = join(dir, 'receipt.json');
  if (existsSync(receiptPath)) result = JSON.parse(readFileSync(receiptPath, 'utf-8'));
  // If receipt has no commitment_hash, try commitment.json
  if (!result?.commitment_hash) {
    const commitPath = join(dir, 'commitment.json');
    if (existsSync(commitPath)) {
      const c = JSON.parse(readFileSync(commitPath, 'utf-8'));
      if (c.commitment_hash) {
        result = result || {};
        result!.commitment_hash = c.commitment_hash;
      }
    }
  }
  return result;
}

function buildRevealFolder(srcDir: string): string {
  const receipt = findReceipt(srcDir);
  const hashPrefix = receipt?.commitment_hash?.slice(0, 12) || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  return `reveals/${date}-${hashPrefix}`;
}

function generateVerifyScript(commitmentHash?: string): string {
  return `#!/usr/bin/env bash
# Verify this reveal against the commitment
# Commitment hash: ${commitmentHash || 'unknown'}
#
# Requirements: npm (for npx)
#
# Usage: ./verify.sh

set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

echo "Verifying commit-reveal..."
echo "  Commitment: ${commitmentHash || 'unknown'}"
echo ""

if [ -f "$DIR/commitment.json" ]; then
  npx cr verify "$DIR/commitment.json"
else
  echo "No commitment.json found in reveal folder."
  echo "Download it from the server or the original committer."
fi
`;
}


// ── Publication verification ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verifyPublicationWithServers(commitmentHash: string, fileUrls: Record<string, string>): Promise<any[]> {
  const servers = getServers();
  if (servers.length === 0) {
    console.log('No servers in registry — skipping publication verification.');
    return [];
  }

  console.log(`\nVerifying publication with ${servers.length} server(s)...`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attestations: any[] = [];

  for (const server of servers) {
    const endpoint = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitmentHash}/verify-publication`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_urls: fileUrls }),
      });
      if (res.ok) {
        const body = await res.json() as any;
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${server.name}: unreachable (${msg})`);
      attestations.push({ server: server.name, server_url: server.url, error: msg });
    }
  }

  return attestations;
}

function generateRevealReadme(srcDir: string, commitHash: string): string {
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
    md += `| Format | ${c.spec_version} |\n`;
    md += `| Reveal probability | ${describeProbability(c)} |\n`;
    md += `| Signing key | \`${c.signing_key}\` |\n`;
    md += `| Created | ${c.committed_at || 'N/A'} |\n\n`;
  }

  // Server receipts table
  const srPath = join(srcDir, 'server-receipts.json');
  if (existsSync(srPath)) {
    const sr = JSON.parse(readFileSync(srPath, 'utf-8'));
    md += `### Server Receipts\n`;
    md += `| Server | Beacon Round | Received At |\n|--------|-------------|-------------|\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const reveal = JSON.parse(readFileSync(revealPath, 'utf-8'));
    const manifest = publishedManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')), reveal);
    const selectedSet = new Set(reveal.selected_items || []);
    md += `### Random Selection\n`;
    md += `| # | File | Item | Selected? |\n|---|------|------|-----------|\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manifest.items ?? []).forEach((item: any, i: number) => {
      const itemKey = manifestKey(item) ?? '';
      const sel = selectedSet.has(itemKey) ? 'Yes' : 'No';
      md += `| ${i + 1} | ${item.path} | \`${itemKey}\` | ${sel} |\n`;
    });
    md += '\n';
  }

  md += `## Verify Yourself\n\n`;
  md += '```bash\n./verify.sh\n```\n';

  return md;
}

// ── Publish: GitHub ──

async function cmdPublishGithub(dir: string, repoName?: string): Promise<void> {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Only beacon-selected files may leave the machine. Resolve them before any
  // remote side effect so a missing selection aborts the publish.
  let selectedFiles: SelectedFile[];
  try {
    selectedFiles = resolveSelectedFiles(srcDir);
  } catch (e: any) {
    console.error(e.message);
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
  const repo = repoName || 'nocherry-reveals';
  const fullRepo = repo.includes('/') ? repo : `${ghUser}/${repo}`;

  console.log(`Publishing to GitHub: ${fullRepo}`);

  // Check if repo exists, create if not
  const repoExists = shell(`gh repo view ${fullRepo} --json name 2>&1`, { allowFail: true });
  if (!repoExists || repoExists.includes('not found') || repoExists.includes('Could not')) {
    console.log(`Creating repository ${fullRepo} ...`);
    shell(`gh repo create ${fullRepo} --public --description "Reveals — cryptographic benchmark commitments" --clone=false`);
    console.log(`  Created: https://github.com/${fullRepo}`);
  }

  // Clone (or pull) into temp dir
  const tmpBase = join(homedir(), '.nocherry', 'publish-tmp');
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

  // Copy only the selected files into the data subfolder
  const dataDir = join(destDir, 'data');
  copySelectedFiles(srcDir, dataDir);

  // Copy the protocol files into the reveal folder root. The manifest is
  // reduced to the revealed items for 0.5.0: unrevealed paths stay private.
  const receipt = findReceipt(srcDir);
  const protocolFilesToCopy = [
    'commitment.json', 'server-receipts.json',
    'reveal.json', 'reveal-receipts.json', 'receipt.json',
  ];
  for (const pf of protocolFilesToCopy) {
    if (existsSync(join(srcDir, pf))) {
      cpSync(join(srcDir, pf), join(destDir, pf));
    }
  }
  if (existsSync(join(srcDir, 'manifest.json'))) {
    const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf-8'));
    const reveal = existsSync(join(srcDir, 'reveal.json')) ? JSON.parse(readFileSync(join(srcDir, 'reveal.json'), 'utf-8')) : { selected_items: loadSelectedHashes(srcDir) ?? [] };
    writeFileSync(join(destDir, 'manifest.json'), JSON.stringify(publishedManifest(manifest, reveal), null, 2) + '\n');
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
    writeFileSync(repoReadme, `# Reveals

Cryptographically committed benchmark data, published via the [Commit-Reveal Protocol](https://github.com/peerbench/nocherry).

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attestations: any[] = [];
  const fileUrls: Record<string, string> = {};
  if (receipt?.commitment_hash) {
    for (const f of selectedFiles) {
      fileUrls[f.hash] = `https://raw.githubusercontent.com/${fullRepo}/main/${revealFolder}/data/${f.path}`;
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

async function cmdPublishHuggingface(dir: string, repoName?: string): Promise<void> {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Only beacon-selected files may leave the machine. Resolve them before any
  // remote side effect so a missing selection aborts the publish.
  let selectedFiles: SelectedFile[];
  try {
    selectedFiles = resolveSelectedFiles(srcDir);
  } catch (e: any) {
    console.error(e.message);
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
  let hfUser: string | null = null;

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
        const data = await res.json() as any;
        hfUser = data.name;
      }
    } catch { /* ignore */ }
  }

  if (!hfUser) {
    console.error('Not authenticated with Hugging Face.');
    console.error('Options:');
    console.error('  1. Install huggingface-cli and run: huggingface-cli login');
    console.error('  2. Set HF_TOKEN environment variable');
    process.exit(1);
  }

  const repo = repoName || 'nocherry-reveals';
  const fullRepo = repo.includes('/') ? repo : `${hfUser}/${repo}`;

  console.log(`Publishing to Hugging Face: ${fullRepo}`);

  // Determine clone URL
  let cloneUrl: string;
  if (hfToken) {
    cloneUrl = `https://${hfUser}:${hfToken}@huggingface.co/datasets/${fullRepo}`;
  } else {
    cloneUrl = `git@hf.co:datasets/${fullRepo}`;
  }

  // Create dataset repo if needed (via API)
  const checkUrl = `https://huggingface.co/api/datasets/${fullRepo}`;
  const authHeaders: Record<string, string> = hfToken
    ? { Authorization: `Bearer ${hfToken}` }
    : {};

  let repoExists = false;
  try {
    const res = await fetch(checkUrl, { headers: authHeaders });
    repoExists = res.ok;
  } catch { /* ignore */ }

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
  const tmpBase = join(homedir(), '.nocherry', 'publish-tmp');
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

  // Copy only the selected files into the data subfolder
  const dataDir = join(destDir, 'data');
  copySelectedFiles(srcDir, dataDir);

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
  - benchmark
  - commit-reveal
pretty_name: Reveals
---

# Reveals

Cryptographically committed benchmark data, published via the [Commit-Reveal Protocol](https://github.com/peerbench/nocherry).

Each folder in \`reveals/\` contains data that was committed before evaluation,
timestamped by an independent server, and can be independently verified.

## Verification

\`\`\`bash
npx cr verify reveals/<folder>/commitment.json
\`\`\`
`);
  }

  // Write a per-reveal README
  writeFileSync(join(destDir, 'README.md'), `# Reveal: ${commitHash.slice(0, 12)}

- **Commitment Hash**: \`${commitHash}\`
- **Date**: ${new Date().toISOString()}
- **Verification**: \`npx cr verify commitment.json\`
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attestations: any[] = [];
  const fileUrls: Record<string, string> = {};
  if (receipt?.commitment_hash) {
    for (const f of selectedFiles) {
      fileUrls[f.hash] = `https://huggingface.co/datasets/${fullRepo}/resolve/main/${revealFolder}/data/${f.path}`;
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

async function cmdPublishInteractive(dir: string): Promise<void> {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Detect available providers
  const providers: { name: string; key: string }[] = [];

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
      hfOk = !!(whoami && !whoami.includes('Not logged in') && !whoami.includes('error'));
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

async function cmdGo(dirPath: string, probability = 0.50, flags: CommitFlags = { format: parseFormat(undefined), anchor: true }): Promise<void> {
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
    console.log(`  \u2713 Key saved: ${key.did}`);
    console.log();
  } else {
    key = loadKey();
  }

  console.log();
  console.log('  Commit-Reveal Protocol');
  console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Directory: ${dirPath} (${fileCount} file${fileCount !== 1 ? 's' : ''})`);
  console.log();

  const anchor = flags.anchor;

  // ── Step 1 and 2: Hash and Commit ──
  console.log('  Step 1 \u2014 Hash and Commit');
  if (flags.format === FORMAT_V5) {
    console.log('  SHA-256 hash each file, derive a hiding commitment per file from a fresh secret,');
    console.log(`  and sign a commitment over them at ${(probability * 100).toFixed(0)}% reveal probability (format 0.5.0).`);
  } else {
    console.log(`  SHA-256 hash each file and sign a commitment over the hashes at ${(probability * 100).toFixed(0)}% reveal probability (format 0.2.0).`);
  }
  console.log();
  await waitForEnter();

  const built = await buildCommitment(dir, probability, 'drand', flags, key);
  let commitment = built.commitment;
  const manifestData = built.manifest;
  for (const item of manifestData.items) {
    console.log(`    ${manifestKey(item)}  ${item.path}`);
  }
  console.log(`  \u2713 ${manifestData.items.length} files \u2192 manifest.json`);
  console.log(`  \u2713 Commitment: ${commitment.commitment_hash}`);
  console.log('  \u2713 Saved commitment.json');
  console.log();

  // ── Step 2: Submit ──
  console.log('  Step 2 \u2014 Submit');
  if (anchor) {
    console.log('  Send to independent servers. All of them wait for the same drand round');
    console.log('  (anchor round + 2, a few seconds) to randomly select which files must be revealed.');
  } else {
    console.log('  Send to independent servers. Each waits for the next drand beacon (~3s)');
    console.log('  to randomly select which files must be revealed.');
  }
  console.log();
  await waitForEnter();

  const servers = getServers();
  if (servers.length === 0) {
    console.log('  \u2717 No servers in registry. Run: pb-js servers');
    process.exit(1);
  }

  const spinner = startSpinner('Waiting for drand beacon...');

  const reanchorNotes: string[] = [];
  let submitted: SubmitResult<typeof servers[number]>[];
  try {
    const outcome = await submitCommitment(servers, commitment, {
      reanchor: reanchorAndSave(join(dir, 'commitment.json'), (msg) => reanchorNotes.push(msg)),
    });
    commitment = outcome.commitment;
    submitted = outcome.results;
  } catch (e: unknown) {
    spinner.fail(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const settled = await Promise.allSettled(
    submitted.map(async (r) => {
      const server = r.server;
      if (r.status === 201) {
        return { server_name: server.name, server_url: server.url, receipt: r.body, duplicate: false };
      } else if (r.status === 409) {
        // Commitment already exists — fetch the existing receipt
        const getUrl = `${server.url.replace(/\/$/, '')}/v1/commitments/${commitment.commitment_hash}`;
        const getRes = await fetch(getUrl);
        if (getRes.ok) {
          const existing = await getRes.json() as any;
          return { server_name: server.name, server_url: server.url, receipt: existing, duplicate: true };
        }
        return { server_name: server.name, server_url: server.url, receipt: null, duplicate: true };
      } else {
        throw new Error(`${server.name}: ${describeFailure(r)}`);
      }
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipts: { server_name: string | null; server_url: string; receipt: any; duplicate: boolean }[] = [];
  let duplicateCount = 0;
  let firstFailure: boolean | null = null;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      if (r.value.duplicate) duplicateCount++;
      const label = r.value.duplicate ? '(already committed)' : `round ${r.value.receipt?.selection?.beacon_output?.round || '?'}`;
      if (receipts.length === 0) spinner.stop(`${r.value.server_name}: ${label}`);
      else console.log(`  \u2713 ${r.value.server_name}: ${label}`);
      if (r.value.receipt) receipts.push(r.value);
    } else {
      if (!firstFailure) { spinner.fail(`${servers[i].name}: ${r.reason?.message || 'failed'}`); firstFailure = true; }
      else console.log(`  \u2717 ${servers[i].name}: ${r.reason?.message || 'failed'}`);
    }
  }

  if (receipts.length === 0) {
    console.log('  \u2717 All servers failed.');
    process.exit(1);
  }

  for (const note of reanchorNotes) console.log(`  ${note}`);
  for (const r of receipts) warnOnAnchorChecks(r.server_name, r.receipt);

  if (duplicateCount > 0) {
    console.log();
    console.log(`  \u26A0 WARNING: This data has already been committed to ${duplicateCount} server${duplicateCount !== 1 ? 's' : ''}.`);
    console.log('  Re-running on previously committed data \u2014 using existing server receipts.');
  }

  const serverReceipts = {
    spec_version: '0.2.0',
    commitment_hash: commitment.commitment_hash,
    submitted_at: new Date().toISOString(),
    receipts,
  };
  writeFileSync(join(dir, 'server-receipts.json'), JSON.stringify(serverReceipts, null, 2) + '\n');
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipts[0].receipt, null, 2) + '\n');

  console.log(`  \u2713 Saved server-receipts.json (${receipts.length} receipt${receipts.length !== 1 ? 's' : ''})`);

  // Show beacon randomness and selection result
  const firstSelection = receipts.find(r => r.receipt?.selection?.selected_items)?.receipt?.selection;
  if (firstSelection) {
    console.log();
    console.log(`  Beacon: ${firstSelection.beacon_output.randomness}`);
    const selectedSet = new Set(firstSelection.selected_items);
    console.log(`  Selected ${firstSelection.selected_count} of ${firstSelection.total_count} for reveal:`);
    for (const item of manifestData.items) {
      const sel = selectedSet.has(manifestKey(item));
      console.log(`    ${sel ? '\u2192' : ' '} ${item.path}`);
    }
  }
  console.log();

  // ── Step 3: Publish ──
  console.log('  Step 3 \u2014 Publish');
  console.log('  Publish the original data of selected files to GitHub or other public hosting.');
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
        console.log('  \u26A0 No receipt.json found \u2014 skipping publish server upload');
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
      const authHeaders: Record<string, string> = {};
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
        console.log('  \u26A0 No publish server auth available (set PB_PUBLISH_TOKEN or link signing key)');
        console.log('  (continuing \u2014 GitHub publish succeeded)');
      } else {
        const uploadRes = await fetch(publishUrl, {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });

        if (uploadRes.ok) {
          await uploadRes.json() as any;
          console.log(`  \u2713 Uploaded ${dataFiles.length} file${dataFiles.length !== 1 ? 's' : ''} to ${publisher.name}`);
        } else {
          const errBody = await uploadRes.text();
          console.log(`  \u26A0 Publish server upload failed: ${uploadRes.status} ${errBody}`);
          console.log('  (continuing \u2014 GitHub publish succeeded)');
        }
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg !== 'skip') {
      console.log(`  \u26A0 Publish server upload failed: ${errMsg}`);
      console.log('  (continuing \u2014 GitHub publish succeeded)');
    }
  }

  console.log();

  // ── Step 4: Reveal ──
  console.log('  Step 4 \u2014 Reveal');
  console.log('  Submit signed reveal to servers and get signed confirmation.');
  console.log();
  await waitForEnter();

  // Get selected items from first receipt
  const firstReceipt = receipts.find(r => r.receipt?.selection?.selected_items);
  if (!firstReceipt) {
    console.log('  \u2717 No selection found in receipts.');
    process.exit(1);
  }
  const selectedItems: string[] = firstReceipt.receipt.selection.selected_items;

  const reveal = buildReveal(dir, commitment, selectedItems, key);

  writeFileSync(join(dir, 'reveal.json'), JSON.stringify(reveal, null, 2) + '\n');

  console.log(`  \u2713 Revealing ${selectedItems.length} selected item${selectedItems.length !== 1 ? 's' : ''}`);

  // Load file_urls from publication.json for server-side data verification
  const selectedFileUrls: Record<string, string> = {};
  const pubPath = join(dir, 'publication.json');
  if (existsSync(pubPath)) {
    try {
      const pub = JSON.parse(readFileSync(pubPath, 'utf-8'));
      if (pub.file_urls && typeof pub.file_urls === 'object') {
        for (const hash of selectedItems) {
          if (pub.file_urls[hash]) selectedFileUrls[hash] = pub.file_urls[hash];
        }
      }
    } catch { /* ignore */ }
  }
  if (Object.keys(selectedFileUrls).length === 0) {
    console.log('  \u26A0 No publication.json found \u2014 servers may reject reveal without file_urls');
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
        const body = await res.json() as any;
        return { server_name: server.name, server_url: server.url, response: body };
      } else {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealReceipts: { server_name: string | null; server_url: string; response: any }[] = [];
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
      else console.log(`  \u2713 ${msg}`);
      revealReceipts.push(r.value);
    } else {
      if (!firstRevealPrinted) { revealSpinner.fail(`${servers[i].name}: ${r.reason?.message || 'failed'}`); firstRevealPrinted = true; }
      else console.log(`  \u2717 ${servers[i].name}: ${r.reason?.message || 'failed'}`);
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

  console.log('  \u2713 Saved reveal.json + reveal-receipts.json');

  // Push reveal files back to GitHub repo
  if (existsSync(join(dir, 'publication.json'))) {
    try {
      const pub = JSON.parse(readFileSync(join(dir, 'publication.json'), 'utf-8'));
      if (pub.repository && pub.reveal_folder) {
        const repo = pub.repository;
        const tmpBase = join(homedir(), '.nocherry', 'publish-tmp');
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
            console.log('  \u2713 Pushed reveal receipts to GitHub');
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`  \u26A0 Could not update GitHub repo: ${errMsg}`);
    }
  }

  console.log();

  // ── Summary ──
  console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Done! Evidence chain in ${dirPath}:`);
  console.log(flags.format === FORMAT_V5
    ? '    manifest.json        file paths and item commitments'
    : '    manifest.json        file hashes');
  if (flags.format === FORMAT_V5) console.log(`    ${SECRET_FILE} item secret (private, never publish)`);
  console.log('    commitment.json      signed commitment');
  console.log('    server-receipts.json server timestamps');
  console.log('    publication.json     publish receipts');
  console.log('    reveal.json          signed reveal');
  console.log('    reveal-receipts.json server confirmations');
  console.log();
}

// ── Generate random test data ──

function cmdGenerate(baseDir: string, count: number): void {
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

function usage(exitCode = 1): never {
  console.log(`Usage:
  pb-js go <dir> [-p <prob>] [--format <f>] [--no-anchor]  Guided wizard (just hit Enter)
  pb-js key generate                        Generate Ed25519 keypair
  pb-js key show                            Show stored did:key
  pb-js hash file <path>                    Hash a file (SHA-256)
  pb-js hash dir <path>                     Hash a directory
  pb-js commit <dir> -p <prob> [--format 0.2.0|0.5.0] [--mode batch|per_item]
                 [--stream <id> --sequence <n>] [--no-anchor]   Create commitment from directory
  pb-js verify <commitment.json>            Verify commitment signature
  pb-js verify <receipt.json>               Verify a server receipt offline (beacon, timing, selection)
  pb-js verify <reveal-folder>              Verify receipts, signed reveal and revealed files offline
  pb-js servers                             List known servers
  pb-js submit <dir|file> [-s <srv>]         Submit commitment to server(s)
  pb-js reveal <dir>                        Create & submit reveal
  pb-js publish github <dir> [--repo <r>]   Publish reveal to GitHub
  pb-js publish huggingface <dir> [--repo <r>]  Publish reveal to Hugging Face
  pb-js publish <dir>                       Interactive provider selection
  pb-js generate-random-data [dir] [-n <n>] Generate random test data (default: random-sample/)

  Commitments name the current drand round as beacon.anchor_round, so every
  server selects with the same round (anchor + 2). Use --no-anchor for servers
  that predate this field. An anchor is only fresh for a few seconds: submit
  re-signs commitment.json with a fresh anchor when needed.

  --format 0.5.0 (or PB_FORMAT=0.5.0) commits hiding item commitments instead
  of plain hashes, signs the selection mode, stream id and sequence, and keeps
  the item secret in commitment-secret.json. Servers list the formats they
  accept as spec_versions_accepted in /v1/server-info.`);
  process.exit(exitCode);
}

/**
 * Flags shared by `commit` and `go`. `extra` handles command-specific flags
 * and returns how many arguments it consumed (0 when it did not match).
 */
function parseCommitFlags(rest: string[], extra: (i: number, rest: string[]) => number): { flags: CommitFlags } {
  const flags: CommitFlags = { format: parseFormat(undefined), anchor: true };
  for (let i = 0; i < rest.length; i++) {
    const consumed = extra(i, rest);
    if (consumed > 0) { i += consumed - 1; continue; }
    if (rest[i] === '--format' && rest[i + 1]) {
      try { flags.format = parseFormat(rest[i + 1]); } catch (e: unknown) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
      i++;
    } else if (rest[i] === '--mode' && rest[i + 1]) {
      if (rest[i + 1] !== 'batch' && rest[i + 1] !== 'per_item') { console.error('--mode must be batch or per_item'); process.exit(1); }
      flags.selectionMode = rest[i + 1] as 'batch' | 'per_item';
      i++;
    } else if (rest[i] === '--stream' && rest[i + 1]) {
      flags.streamId = rest[i + 1];
      i++;
    } else if (rest[i] === '--sequence' && rest[i + 1]) {
      flags.sequence = Number(rest[i + 1]);
      if (!Number.isSafeInteger(flags.sequence) || flags.sequence < 0) { console.error('--sequence must be a non-negative integer'); process.exit(1); }
      i++;
    } else if (rest[i] === '--no-anchor') {
      flags.anchor = false;
    }
  }
  if ((flags.streamId === undefined) !== (flags.sequence === undefined)) {
    console.error('--stream and --sequence go together');
    process.exit(1);
  }
  return { flags };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') usage(0);

  const cmd = args[0];
  const sub = args[1];

  if (cmd === 'go' && args[1]) {
    let probability = 0.50;
    const dirArg = args[1];
    const { flags } = parseCommitFlags(args.slice(2), (i, rest) => {
      if ((rest[i] === '-p' || rest[i] === '--probability') && rest[i + 1]) { probability = parseFloat(rest[i + 1]); return 2; }
      return 0;
    });
    await cmdGo(dirArg, probability, flags);
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
    const { flags } = parseCommitFlags(args.slice(2), (i, rest) => {
      if ((rest[i] === '-p' || rest[i] === '--probability') && rest[i + 1]) { probability = parseFloat(rest[i + 1]); return 2; }
      if (rest[i] === '--beacon' && rest[i + 1]) { beacon = rest[i + 1]; return 2; }
      return 0;
    });
    await cmdCommit(args[1], probability, beacon, flags);
  } else if (cmd === 'verify' && args[1]) {
    cmdVerify(args[1]);
  } else if (cmd === 'servers') {
    cmdServers();
  } else if (cmd === 'submit' && args[1]) {
    let server: string | undefined = undefined;
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
    let repoName: string | undefined = undefined;
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
