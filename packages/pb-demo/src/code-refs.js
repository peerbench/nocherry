/**
 * Code reference loader — reads actual source files and extracts line ranges.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// Cache file contents
const fileCache = new Map();

function readFile(relPath) {
  if (!fileCache.has(relPath)) {
    const absPath = resolve(ROOT, relPath);
    fileCache.set(relPath, readFileSync(absPath, 'utf-8').split('\n'));
  }
  return fileCache.get(relPath);
}

/**
 * Extract a code snippet with metadata.
 * @param {string} relPath - relative to monorepo root
 * @param {number} startLine - 1-based inclusive
 * @param {number} endLine - 1-based inclusive
 * @param {string} [title] - human-readable title for the panel
 */
export function codeRef(relPath, startLine, endLine, title) {
  const lines = readFile(relPath);
  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  const ext = relPath.split('.').pop();
  const lang = ext === 'rs' ? 'rust' : ext === 'js' || ext === 'ts' ? 'typescript' : ext;
  return {
    path: relPath,
    startLine,
    endLine,
    code: snippet,
    lang,
    title: title || `${relPath}:${startLine}-${endLine}`,
  };
}
