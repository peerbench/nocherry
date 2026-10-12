/**
 * Object formats on the committer's side (spec v0.5 Section 10.6).
 *
 * 0.2.0 commits plain file hashes. 0.5.0 commits hiding item commitments
 * derived from one per-commitment secret, kept in `commitment-secret.json`
 * next to the data and never published; the reveal carries the openings
 * (salt and plain hash) of the revealed items only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as wasm from '@nocherry/pb-wasm';

export const FORMAT_LEGACY = '0.2.0';
export const FORMAT_V5 = '0.5.0';
export const FORMATS = [FORMAT_LEGACY, FORMAT_V5] as const;
export type Format = typeof FORMATS[number];

/** Default format of new commitments until every registry server lists 0.5.0. */
export const DEFAULT_FORMAT: Format = FORMAT_LEGACY;

export const SECRET_FILE = 'commitment-secret.json';

export function parseFormat(value: string | undefined): Format {
  const v = value ?? process.env.PB_FORMAT ?? DEFAULT_FORMAT;
  if (!(FORMATS as readonly string[]).includes(v)) {
    throw new Error(`unknown format ${v}; use one of ${FORMATS.join(', ')}`);
  }
  return v as Format;
}

/** `reveal_probability_ppm` for a probability given as a decimal fraction. */
export function probabilityToPpm(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p > 1) throw new Error(`probability must be in (0, 1], got ${p}`);
  const ppm = Math.round(p * 1_000_000);
  if (Math.abs(ppm - p * 1_000_000) > 1e-6 || ppm < 1) {
    throw new Error(`probability ${p} is not a whole number of parts per million (6 decimals at most)`);
  }
  return ppm;
}

export interface ManifestEntry { path: string; hash?: string; item?: string }

/** The key under which a manifest entry's file is revealed: item commitment in 0.5.0, plain hash in 0.2.0. */
export function manifestKey(entry: ManifestEntry): string | undefined {
  return entry.item ?? entry.hash;
}

export interface SecretFile { spec_version: string; item_secret: string; created_at: string }

export function readSecret(dir: string): SecretFile {
  const path = join(dir, SECRET_FILE);
  if (!existsSync(path)) {
    throw new Error(`No ${SECRET_FILE} in ${dir}. The 0.5.0 reveal needs the item secret written by: pb-js commit <dir> --format 0.5.0`);
  }
  const secret = JSON.parse(readFileSync(path, 'utf-8')) as SecretFile;
  if (!/^[0-9a-f]{64}$/.test(secret.item_secret ?? '')) throw new Error(`${SECRET_FILE} does not hold a 32-byte item_secret`);
  return secret;
}

/** Write a fresh item secret for the directory, owner-readable only. */
export function writeSecret(dir: string): SecretFile {
  const secret: SecretFile = { spec_version: FORMAT_V5, item_secret: wasm.generateItemSecret(), created_at: new Date().toISOString() };
  writeFileSync(join(dir, SECRET_FILE), JSON.stringify(secret, null, 2) + '\n', { mode: 0o600 });
  return secret;
}

export interface CommitOptions {
  format: Format;
  probability: number;
  beacon: Record<string, unknown>;
  /** 0.5.0 only; defaults to per_item for one item and batch otherwise. */
  selectionMode?: 'per_item' | 'batch';
  streamId?: string;
  sequence?: number;
  metadata?: Record<string, unknown>;
  identity?: string;
}

/** Entries of the manifest.json the client writes, and the parameters for createCommitment. */
export interface CommitPlan {
  manifest: { spec_version: string; root_hash?: string; items: ManifestEntry[]; created_at: string };
  params: Record<string, unknown>;
}

/**
 * Turn hashed files into a commitment plan. For 0.5.0 the plan derives salts
 * from `itemSecret` and writes only item commitments into the manifest, so a
 * published manifest discloses no plain hash.
 */
export function planCommitment(
  files: { path: string; hash: string }[],
  rootHash: string,
  opts: CommitOptions,
  itemSecret?: string,
): CommitPlan {
  const createdAt = new Date().toISOString();
  if (opts.format === FORMAT_LEGACY) {
    const params: Record<string, unknown> = {
      items: files.map((f) => f.hash),
      reveal_probability: opts.probability,
      beacon: opts.beacon,
      committed_at: createdAt,
    };
    if (opts.streamId !== undefined) params.stream_id = opts.streamId;
    if (opts.metadata !== undefined) params.metadata = opts.metadata;
    if (opts.identity !== undefined) params.identity = opts.identity;
    return {
      manifest: { spec_version: FORMAT_LEGACY, root_hash: rootHash, items: files.map((f) => ({ path: f.path, hash: f.hash })), created_at: createdAt },
      params,
    };
  }
  if (!itemSecret) throw new Error('0.5.0 needs an item secret');
  const hashes = files.map((f) => f.hash);
  if (new Set(hashes).size !== hashes.length) {
    throw new Error('two files have identical contents; 0.5.0 derives one salt per distinct file, so items would collide');
  }
  const { items } = wasm.commitItems(itemSecret, JSON.stringify(hashes)) as { items: string[] };
  const params: Record<string, unknown> = {
    spec_version: FORMAT_V5,
    items,
    reveal_probability_ppm: probabilityToPpm(opts.probability),
    selection_mode: opts.selectionMode ?? (items.length === 1 ? 'per_item' : 'batch'),
    beacon: opts.beacon,
    metadata: opts.metadata ?? {},
    committed_at: createdAt,
  };
  if (opts.streamId !== undefined) { params.stream_id = opts.streamId; params.sequence = opts.sequence; }
  if (opts.identity !== undefined) params.identity = opts.identity;
  return {
    manifest: { spec_version: FORMAT_V5, items: files.map((f, i) => ({ path: f.path, item: items[i] })), created_at: createdAt },
    params,
  };
}

export interface RevealInput {
  commitment: Record<string, any>;
  selectedItems: string[];
  voluntaryItems?: string[];
  /** Manifest entries of the directory. */
  manifest: ManifestEntry[];
  /** Bytes of a file by its manifest path. */
  readFile: (path: string) => Uint8Array;
  itemSecret?: string;
  signingKey: string;
  revealedAt?: string;
}

/** Parameters for `createReveal` in the commitment's format, with 0.5.0 openings recomputed from the files. */
export function planReveal(input: RevealInput): Record<string, unknown> {
  const { commitment, selectedItems, voluntaryItems = [] } = input;
  const base = {
    commitment_hash: commitment.commitment_hash,
    selected_items: selectedItems,
    voluntary_items: voluntaryItems,
    revealed_at: input.revealedAt ?? new Date().toISOString(),
  };
  if (commitment.spec_version !== FORMAT_V5) return { spec_version: FORMAT_LEGACY, ...base };
  if (!input.itemSecret) throw new Error('0.5.0 reveal needs the item secret');
  const pathOf = new Map(input.manifest.map((e) => [manifestKey(e), e.path]));
  const openings = [...selectedItems, ...voluntaryItems].map((item) => {
    const path = pathOf.get(item);
    if (!path) throw new Error(`no manifest entry for item ${item}`);
    const hash = wasm.hashBytes(input.readFile(path));
    const salt = wasm.deriveItemSalt(input.itemSecret!, hash);
    const recomputed = wasm.itemCommitment(salt, hash);
    if (recomputed !== item) {
      throw new Error(`file ${path} does not open item ${item}: the file changed since the commitment or the item secret is not the one used to commit`);
    }
    return { item, salt, hash };
  });
  return { spec_version: FORMAT_V5, ...base, openings };
}

/**
 * The manifest to publish next to a reveal: for 0.5.0 only the entries of
 * revealed items, since the paths of unrevealed items would disclose what
 * hiding was meant to hide (spec v0.5 10.6). 0.2.0 manifests already list
 * every plain hash and are published whole, as before.
 */
export function publishedManifest(manifest: { items?: ManifestEntry[]; [k: string]: unknown }, reveal: { selected_items?: string[]; voluntary_items?: string[] }) {
  if (manifest.spec_version !== FORMAT_V5) return manifest;
  const revealed = new Set([...(reveal.selected_items ?? []), ...(reveal.voluntary_items ?? [])]);
  return { ...manifest, items: (manifest.items ?? []).filter((e) => revealed.has(manifestKey(e) ?? '')) };
}

/** Reveal probability as a percentage string for either format. */
export function describeProbability(commitment: Record<string, any>): string {
  if (commitment.spec_version === FORMAT_V5) return `${commitment.reveal_probability_ppm / 10_000}%`;
  return `${(commitment.reveal_probability * 100).toFixed(0)}%`;
}
