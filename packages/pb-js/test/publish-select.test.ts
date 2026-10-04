/**
 * Publishing must copy only beacon-selected files.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSelectedFiles, copySelectedFiles } from '../src/publish-select.ts';

let base: string;

function makeDir(name: string, opts: { selection?: string[]; receipts?: boolean } = {}) {
  const dir = join(base, name);
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'a.txt'), 'private a');
  writeFileSync(join(dir, 'b.txt'), 'selected b');
  writeFileSync(join(dir, 'sub', 'c.txt'), 'selected c');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    items: [
      { path: 'a.txt', hash: 'aa' },
      { path: 'b.txt', hash: 'bb' },
      { path: 'sub/c.txt', hash: 'cc' },
    ],
  }));
  if (opts.selection) {
    const selection = { selected_items: opts.selection };
    if (opts.receipts) {
      writeFileSync(join(dir, 'server-receipts.json'), JSON.stringify({ receipts: [{ receipt: { selection } }] }));
    } else {
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ selection }));
    }
  }
  return dir;
}

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
}

describe('publish file selection', () => {
  before(() => { base = mkdtempSync(join(tmpdir(), 'pb-publish-select-')); });

  it('copies only selected files and no protocol files', () => {
    const src = makeDir('selected', { selection: ['bb', 'cc'], receipts: true });
    const dest = join(base, 'out-selected');
    const copied = copySelectedFiles(src, dest);
    assert.deepEqual(copied.map((f) => f.path).sort(), ['b.txt', 'sub/c.txt']);
    assert.deepEqual(listFiles(dest).sort(), ['b.txt', 'sub/c.txt']);
    assert.equal(existsSync(join(dest, 'a.txt')), false);
  });

  it('reads the selection from receipt.json when there are no server receipts', () => {
    const src = makeDir('single', { selection: ['bb'] });
    assert.deepEqual(resolveSelectedFiles(src), [{ path: 'b.txt', hash: 'bb' }]);
  });

  it('copies nothing when the selection is empty', () => {
    const src = makeDir('empty', { selection: [], receipts: true });
    const dest = join(base, 'out-empty');
    assert.deepEqual(copySelectedFiles(src, dest), []);
    assert.deepEqual(listFiles(dest), []);
  });

  it('refuses when no selection has been recorded', () => {
    const src = makeDir('nosel');
    assert.throws(() => copySelectedFiles(src, join(base, 'out-nosel')), /No selection found/);
    assert.equal(existsSync(join(base, 'out-nosel')), false);
  });

  it('refuses a manifest path outside the directory', () => {
    const src = makeDir('escape', { selection: ['zz'] });
    writeFileSync(join(src, 'manifest.json'), JSON.stringify({ items: [{ path: '../selected/a.txt', hash: 'zz' }] }));
    assert.throws(() => resolveSelectedFiles(src), /escapes the directory/);
  });
});
