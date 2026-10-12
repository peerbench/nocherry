/**
 * Committer-side handling of object format 0.5.0 (spec v0.5 10.6): the
 * manifest discloses no plain hash, the item secret opens the items, a reveal
 * recomputes its openings from the files, and re-anchoring keeps every signed
 * field. Ends with the CLI verifying a 0.5.0 reveal folder offline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as wasm from '@nocherry/pb-wasm';
import {
  planCommitment, planReveal, probabilityToPpm, manifestKey, parseFormat, describeProbability, publishedManifest, FORMAT_V5, SECRET_FILE,
} from '../src/format.js';
import { reanchorCommitment } from '../src/anchor.js';
import { resolveSelectedFiles } from '../src/publish-select.js';
import { verifyReveal } from '../src/receipt.js';

const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const COMMITTER_KEY = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SERVER_KEY = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
const ANCHOR = 25892262;
const ROUND = { type: 'drand', chain_hash: CHAIN, round: ANCHOR + 2, randomness: '5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108', signature: '8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8' };
const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const FILES: Record<string, Uint8Array> = Object.fromEntries(
  ['alpha', 'beta', 'gamma', 'delta'].map((name) => [`${name}.txt`, new TextEncoder().encode(`contents of ${name}\n`)]));
const files = () => Object.entries(FILES).map(([path, bytes]) => ({ path, hash: wasm.hashBytes(bytes) }));
const beacon = { type: 'drand', anchor_round: ANCHOR, chain_hash: CHAIN };

describe('probabilityToPpm', () => {
  it('maps decimal fractions to whole parts per million', () => {
    assert.equal(probabilityToPpm(0.1), 100000);
    assert.equal(probabilityToPpm(0.07), 70000);
    assert.equal(probabilityToPpm(1), 1000000);
    assert.equal(probabilityToPpm(0.000001), 1);
    assert.equal(probabilityToPpm(0.333333), 333333);
  });
  it('rejects probabilities that are not whole ppm or out of range', () => {
    for (const bad of [0, -0.1, 1.5, 1 / 3, 0.0000001, NaN]) assert.throws(() => probabilityToPpm(bad), undefined, String(bad));
  });
  it('parseFormat accepts the two formats and nothing else', () => {
    assert.equal(parseFormat('0.2.0'), '0.2.0');
    assert.equal(parseFormat('0.5.0'), '0.5.0');
    assert.throws(() => parseFormat('0.4.0'));
  });
});

describe('planCommitment', () => {
  it('0.2.0: manifest lists plain hashes, params carry reveal_probability', () => {
    const plan = planCommitment(files(), 'root'.repeat(16), { format: '0.2.0', probability: 0.5, beacon });
    assert.equal(plan.manifest.spec_version, '0.2.0');
    assert.deepEqual(plan.manifest.items.map(manifestKey), files().map((f) => f.hash));
    assert.equal(plan.params.reveal_probability, 0.5);
    assert.equal(plan.params.spec_version, undefined);
  });

  it('0.5.0: manifest lists item commitments and no plain hash; params are a well-formed 0.5.0 commitment', () => {
    const plan = planCommitment(files(), 'root'.repeat(16), { format: FORMAT_V5, probability: 0.5, beacon, streamId: 'bench', sequence: 2 }, SECRET);
    const text = JSON.stringify(plan.manifest);
    for (const f of files()) assert.ok(!text.includes(f.hash), `plain hash ${f.hash} in manifest`);
    assert.equal(plan.manifest.root_hash, undefined, 'no root over plain hashes either');
    const { items } = wasm.commitItems(SECRET, JSON.stringify(files().map((f) => f.hash)));
    assert.deepEqual(plan.manifest.items.map(manifestKey), items);
    assert.deepEqual(plan.params.items, items);
    assert.equal(plan.params.reveal_probability_ppm, 500000);
    assert.equal(plan.params.selection_mode, 'batch');
    assert.equal(plan.params.stream_id, 'bench');
    assert.equal(plan.params.sequence, 2);
    assert.deepEqual(plan.params.metadata, {});
    const c = wasm.createCommitment(JSON.stringify(plan.params), COMMITTER_KEY);
    assert.equal(c.spec_version, '0.5.0');
    assert.deepEqual(wasm.validateCommitment(JSON.stringify(c)), { ok: true });
    assert.equal(describeProbability(c), '50%');
  });

  it('0.5.0: one item defaults to per_item, an explicit mode wins, identical files are refused', () => {
    const one = planCommitment(files().slice(0, 1), 'r'.repeat(64), { format: FORMAT_V5, probability: 0.1, beacon }, SECRET);
    assert.equal(one.params.selection_mode, 'per_item');
    const forced = planCommitment(files().slice(0, 1), 'r'.repeat(64), { format: FORMAT_V5, probability: 0.1, beacon, selectionMode: 'batch' }, SECRET);
    assert.equal(forced.params.selection_mode, 'batch');
    const dup = [...files(), { path: 'copy.txt', hash: files()[0].hash }];
    assert.throws(() => planCommitment(dup, 'r'.repeat(64), { format: FORMAT_V5, probability: 0.1, beacon }, SECRET), /identical contents/);
    assert.throws(() => planCommitment(files(), 'r'.repeat(64), { format: FORMAT_V5, probability: 0.1, beacon }), /item secret/);
  });
});

function commitV5(secret = SECRET) {
  const plan = planCommitment(files(), 'r'.repeat(64), { format: FORMAT_V5, probability: 0.5, beacon, metadata: { set: 'test' } }, secret);
  const commitment = wasm.createCommitment(JSON.stringify(plan.params), COMMITTER_KEY);
  const selection = wasm.computeSelectionRecord(JSON.stringify(commitment), JSON.stringify(ROUND), '2026-02-07T16:02:37Z');
  return { plan, commitment, selection };
}

describe('planReveal', () => {
  it('recomputes the openings from the files and the secret', () => {
    const { plan, commitment, selection } = commitV5();
    const params = planReveal({
      commitment, selectedItems: selection.selected_items, manifest: plan.manifest.items, itemSecret: SECRET,
      readFile: (p) => FILES[p], signingKey: 'did:key:z', revealedAt: '2026-02-08T10:00:00Z',
    });
    assert.equal(params.spec_version, '0.5.0');
    const openings = params.openings as { item: string; salt: string; hash: string }[];
    assert.equal(openings.length, 2);
    for (const o of openings) {
      assert.equal(wasm.itemCommitment(o.salt, o.hash), o.item);
      assert.equal(o.salt, wasm.deriveItemSalt(SECRET, o.hash));
    }
    const reveal = wasm.createReveal(JSON.stringify(params), COMMITTER_KEY);
    assert.deepEqual(wasm.verifyRevealObject(JSON.stringify(reveal)), { ok: true });
  });

  it('refuses when a file changed since the commitment or the secret is wrong', () => {
    const { plan, commitment, selection } = commitV5();
    const changed = { ...FILES, [plan.manifest.items.find((e) => e.item === selection.selected_items[0])!.path]: new TextEncoder().encode('edited') };
    assert.throws(() => planReveal({
      commitment, selectedItems: selection.selected_items, manifest: plan.manifest.items, itemSecret: SECRET,
      readFile: (p) => changed[p], signingKey: 'did:key:z',
    }), /does not open item/);
    assert.throws(() => planReveal({
      commitment, selectedItems: selection.selected_items, manifest: plan.manifest.items, itemSecret: 'ff'.repeat(32),
      readFile: (p) => FILES[p], signingKey: 'did:key:z',
    }), /does not open item/);
  });

  it('0.2.0 reveals carry no openings', () => {
    const legacy = wasm.createCommitment(JSON.stringify({ items: files().map((f) => f.hash), reveal_probability: 0.5, beacon, committed_at: '2026-02-07T16:02:30Z' }), COMMITTER_KEY);
    const params = planReveal({ commitment: legacy, selectedItems: [files()[0].hash], manifest: [], readFile: () => new Uint8Array(), signingKey: 'did:key:z' });
    assert.equal(params.spec_version, '0.2.0');
    assert.equal(params.openings, undefined);
  });
});

describe('reanchorCommitment keeps every signed 0.5.0 field', () => {
  it('changes only the anchor and committed_at', async () => {
    const { commitment } = commitV5();
    const fresh = await reanchorCommitment({ ...commitment, stream_id: undefined }, COMMITTER_KEY, { currentRound: async () => ANCHOR + 10 });
    assert.equal(fresh.spec_version, '0.5.0');
    assert.equal(fresh.beacon.anchor_round, ANCHOR + 10);
    assert.deepEqual(fresh.items, commitment.items, 'same item commitments, so the same salts still open them');
    assert.equal(fresh.reveal_probability_ppm, 500000);
    assert.equal(fresh.selection_mode, 'batch');
    assert.deepEqual(fresh.metadata, { set: 'test' });
    assert.notEqual(fresh.commitment_hash, commitment.commitment_hash);
    assert.ok(wasm.verifyCommitment(JSON.stringify(fresh)));

    const streamed = wasm.createCommitment(JSON.stringify({ ...commitment, stream_id: 'bench', sequence: 4, commitment_hash: undefined, signature: undefined }), COMMITTER_KEY);
    const fresh2 = await reanchorCommitment(streamed, COMMITTER_KEY, { currentRound: async () => ANCHOR + 10 });
    assert.equal(fresh2.stream_id, 'bench');
    assert.equal(fresh2.sequence, 4);
  });
});

describe('publishedManifest', () => {
  it('keeps only revealed entries of a 0.5.0 manifest and the whole 0.2.0 manifest', () => {
    const { plan, selection } = commitV5();
    const reveal = { selected_items: selection.selected_items, voluntary_items: [] };
    const published = publishedManifest(plan.manifest, reveal);
    assert.equal(published.items!.length, 2);
    assert.deepEqual(published.items!.map((e) => e.item).sort(), [...selection.selected_items].sort());
    const unrevealed = plan.manifest.items.filter((e) => !selection.selected_items.includes(e.item!)).map((e) => e.path);
    assert.ok(unrevealed.length === 2 && !JSON.stringify(published).includes(unrevealed[0]), 'unrevealed paths stay private');
    const legacy = { spec_version: '0.2.0', items: [{ path: 'a', hash: 'aa' }, { path: 'b', hash: 'bb' }] };
    assert.deepEqual(publishedManifest(legacy, { selected_items: ['aa'] }), legacy);
  });
});

describe('publish selection with a 0.5.0 manifest', () => {
  it('matches selected item commitments to files', () => {
    const { plan, selection } = commitV5();
    const dir = mkdtempSync(join(tmpdir(), 'pb-format-publish-'));
    for (const [name, bytes] of Object.entries(FILES)) writeFileSync(join(dir, name), bytes);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(plan.manifest));
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ selection }));
    const selected = resolveSelectedFiles(dir);
    assert.equal(selected.length, 2);
    for (const f of selected) {
      assert.ok(selection.selected_items.includes(f.hash), 'keyed by item commitment');
      assert.equal(plan.manifest.items.find((e) => e.item === f.hash)!.path, f.path);
    }
  });
});

describe('pb-js verify <0.5.0 reveal folder>', () => {
  const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');
  const run = (args: string[]) => execFileSync('npx', ['tsx', CLI, ...args], { encoding: 'utf-8', timeout: 30000 });

  function makeFolder(opts: { skip?: boolean; tamper?: boolean } = {}) {
    const { plan, commitment, selection } = commitV5();
    const dir = mkdtempSync(join(tmpdir(), 'pb-v5-folder-'));
    const selected: string[] = selection.selected_items;
    const serverDid = wasm.createCommitment(JSON.stringify({ items: files().map((f) => f.hash), reveal_probability: 0.5, committed_at: '2026-02-06T14:30:00Z' }), SERVER_KEY).signing_key;
    const body = {
      commitment, commitment_hash: commitment.commitment_hash, registered_at: '2026-02-07T16:02:31.500Z', arrival_beacon: null, selection,
      signer_activity: { commitments_past_hour: 1, commitments_past_month: 1 }, key_matches_identity: null, server_key: serverDid,
    };
    const receipt = { ...body, server_signature: wasm.signMessage(SERVER_KEY, new TextEncoder().encode(JSON.stringify(body))) };
    const reveal = wasm.createReveal(JSON.stringify(planReveal({
      commitment, selectedItems: selected, manifest: plan.manifest.items, itemSecret: SECRET, readFile: (p) => FILES[p], signingKey: 'x',
    })), COMMITTER_KEY);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(plan.manifest));
    writeFileSync(join(dir, 'commitment.json'), JSON.stringify(commitment));
    writeFileSync(join(dir, 'server-receipts.json'), JSON.stringify({ receipts: [{ server_name: 'local', receipt }] }));
    writeFileSync(join(dir, 'reveal.json'), JSON.stringify(reveal));
    for (const entry of plan.manifest.items) {
      if (!selected.includes(entry.item!)) continue; // only selected files are published
      if (opts.skip && entry.item === selected[0]) continue;
      const bytes = opts.tamper && entry.item === selected[0] ? new TextEncoder().encode('tampered') : FILES[entry.path];
      writeFileSync(join(dir, entry.path), bytes);
    }
    return { dir, receipt, reveal, selected };
  }

  it('verifies a complete 0.5.0 folder and prints the 0.5.0 checks', () => {
    const { dir, receipt, reveal, selected } = makeFolder();
    assert.ok(!existsSync(join(dir, SECRET_FILE)), 'the published folder carries no secret');
    const out = run(['verify', dir]);
    assert.match(out, /Reveal against receipt local: VERIFIED/);
    assert.match(out, /pass commitment_wellformed/);
    assert.match(out, /pass selection_mode\n/);
    assert.match(out, /pass item_openings/);
    assert.match(out, /pass data_integrity \(2\/2 items verified\)/);
    // The same result through the library, keyed by item commitment.
    const data = Object.fromEntries(selected.map((c) => [c, FILES[reveal.openings.find((o: any) => o.item === c) ? Object.keys(FILES).find((p) => wasm.hashBytes(FILES[p]) === reveal.openings.find((o: any) => o.item === c).hash)! : '']]));
    assert.equal(verifyReveal(receipt, reveal, data).status, 'verified');
  });

  it('exits 2 when a selected file is missing and 1 when it was changed', () => {
    assert.throws(() => run(['verify', makeFolder({ skip: true }).dir]), (e: unknown) => (e as { status?: number }).status === 2);
    assert.throws(() => run(['verify', makeFolder({ tamper: true }).dir]), (e: unknown) => {
      const err = e as { status?: number; stdout?: string };
      return err.status === 1 && /fail data_integrity/.test(err.stdout ?? '');
    });
  });

  it('verify <commitment.json> reports the format and probability of a 0.5.0 commitment', () => {
    const { dir } = makeFolder();
    const out = run(['verify', join(dir, 'commitment.json')]);
    assert.match(out, /Commitment signature: VALID/);
    assert.match(out, /Format: 0\.5\.0/);
    assert.match(out, /Probability: 50%/);
  });
});
