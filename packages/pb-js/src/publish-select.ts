/**
 * Which files of a committed directory may be published.
 *
 * Publishing must expose only the beacon-selected items. Everything else in the
 * directory is private data that the commitment exists to protect, so the
 * publish commands refuse to run when the selection cannot be determined.
 */

import { readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';

export interface SelectedFile {
  path: string;
  /** The item as the commitment names it: plain hash (0.2.0) or item commitment (0.5.0). */
  hash: string;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Selected item hashes for a directory, from the server receipts written by
 * `submit` (same lookup order as the reveal command), falling back to
 * reveal.json. Returns undefined when no selection has been recorded yet.
 */
export function loadSelectedHashes(dir: string): string[] | undefined {
  const serverReceiptsPath = join(dir, 'server-receipts.json');
  if (existsSync(serverReceiptsPath)) {
    const sr = readJson(serverReceiptsPath);
    const first = (sr.receipts || []).find((r: any) => Array.isArray(r.receipt?.selection?.selected_items));
    if (first) return first.receipt.selection.selected_items;
  }
  const receiptPath = join(dir, 'receipt.json');
  if (existsSync(receiptPath)) {
    const selected = readJson(receiptPath).selection?.selected_items;
    if (Array.isArray(selected)) return selected;
  }
  const revealPath = join(dir, 'reveal.json');
  if (existsSync(revealPath)) {
    const selected = readJson(revealPath).selected_items;
    if (Array.isArray(selected)) return selected;
  }
  return undefined;
}

/**
 * Files in `dir` whose hash is among the selected items, resolved through
 * manifest.json. Throws when the manifest or the selection is missing, and when
 * a manifest path would escape `dir`.
 */
export function resolveSelectedFiles(dir: string): SelectedFile[] {
  const root = resolve(dir);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json in ${root}. Run: pb-js commit <dir>`);
  }
  const selected = loadSelectedHashes(root);
  if (!selected) {
    throw new Error(`No selection found in ${root}. Run: pb-js submit <dir> before publishing; refusing to publish unselected files.`);
  }
  const selectedSet = new Set(selected);
  const files: SelectedFile[] = [];
  for (const item of readJson(manifestPath).items || []) {
    // 0.5.0 manifests name items by item commitment, 0.2.0 by plain hash.
    const key: string | undefined = item.item ?? item.hash;
    if (key === undefined || !selectedSet.has(key)) continue;
    const abs = resolve(root, item.path);
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`Manifest path escapes the directory: ${item.path}`);
    }
    files.push({ path: item.path, hash: key });
  }
  return files;
}

/** Copy only the selected files from `srcDir` into `dataDir`, keeping relative paths. */
export function copySelectedFiles(srcDir: string, dataDir: string): SelectedFile[] {
  const files = resolveSelectedFiles(srcDir);
  mkdirSync(dataDir, { recursive: true });
  for (const f of files) {
    const dest = join(dataDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(srcDir, f.path), dest);
  }
  return files;
}
