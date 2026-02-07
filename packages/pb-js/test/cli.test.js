/**
 * Tests for the JS CLI (pb-js).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'src', 'cli.js');
let tempDir;

function run(args, opts = {}) {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...opts.env },
    timeout: 10000,
  }).trim();
}

describe('JS CLI', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pb-cli-test-'));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows usage with no args', () => {
    try {
      run([]);
      assert.fail('Should have exited');
    } catch (e) {
      assert.ok(e.stdout.includes('Usage') || e.stderr.includes('Usage'));
    }
  });

  it('key generate creates a key', () => {
    const keyDir = join(tempDir, 'home1', '.peerbench');
    const output = run(['key', 'generate'], { env: { HOME: join(tempDir, 'home1') } });
    assert.ok(output.startsWith('did:key:z'));
    // Key file should exist
    const keyFile = join(keyDir, 'key.json');
    const key = JSON.parse(readFileSync(keyFile, 'utf-8'));
    assert.equal(key.algorithm, 'Ed25519');
    assert.ok(key.did.startsWith('did:key:z'));
  });

  it('key show prints the did:key', () => {
    const output = run(['key', 'show'], { env: { HOME: join(tempDir, 'home1') } });
    assert.ok(output.startsWith('did:key:z'));
  });

  it('hash file hashes a file', () => {
    const testFile = join(tempDir, 'test.txt');
    writeFileSync(testFile, 'hello');
    const hash = run(['hash', 'file', testFile]);
    assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hash dir hashes a directory', () => {
    const dir = join(tempDir, 'testdir');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'hello.txt'), 'hello');
    const output = run(['hash', 'dir', dir]);
    const result = JSON.parse(output);
    assert.ok(result.hash);
    assert.equal(result.hash.length, 64);
    assert.equal(result.items, 1);
  });

  it('commit creates a commitment from a directory', () => {
    const dir = join(tempDir, 'commitdir');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'item1.txt'), 'test item 1');
    writeFileSync(join(dir, 'item2.txt'), 'test item 2');

    const output = run(['commit', dir, '-p', '0.50'], {
      env: { HOME: join(tempDir, 'home1') },
    });
    const commitment = JSON.parse(output);
    assert.equal(commitment.spec_version, '0.2.0');
    assert.equal(commitment.item_count, 2);
    assert.equal(commitment.reveal_probability, 0.5);
    assert.ok(commitment.commitment_hash);
    assert.ok(commitment.signature);
    assert.ok(commitment.signing_key.startsWith('did:key:z'));

    // Save for verify test
    writeFileSync(join(tempDir, 'commitment.json'), output);
  });

  it('verify checks a commitment', () => {
    const output = run(['verify', join(tempDir, 'commitment.json')]);
    assert.ok(output.includes('VALID'));
  });

  it('usage includes mirrors commands', () => {
    try {
      run([]);
      assert.fail('Should have exited');
    } catch (e) {
      const output = e.stdout || e.stderr || '';
      assert.ok(output.includes('mirrors add'));
      assert.ok(output.includes('mirrors list'));
    }
  });

  it('verify rejects tampered commitment', () => {
    const raw = readFileSync(join(tempDir, 'commitment.json'), 'utf-8');
    const commitment = JSON.parse(raw);
    commitment.reveal_probability = 0.99; // Tamper
    const tamperedPath = join(tempDir, 'tampered.json');
    writeFileSync(tamperedPath, JSON.stringify(commitment));

    try {
      run(['verify', tamperedPath]);
      assert.fail('Should have failed');
    } catch (e) {
      assert.ok(e.stdout.includes('INVALID') || e.stderr.includes('INVALID') || e.status !== 0);
    }
  });
});
