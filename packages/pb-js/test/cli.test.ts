/**
 * Tests for the JS CLI (pb-js).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');
let tempDir: string;

function run(args: string[], opts: { env?: Record<string, string> } = {}): string {
  return execFileSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...opts.env },
    timeout: 30000,
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
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      assert.ok((err.stdout || '').includes('Usage') || (err.stderr || '').includes('Usage'));
    }
  });

  it('key generate creates a key', () => {
    const keyDir = join(tempDir, 'home1', '.nocherry');
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

  it('commit anchors to the current drand round by default', () => {
    const dir = join(tempDir, 'anchordir');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.txt'), 'anchored');

    const before = Math.floor((Date.now() / 1000 - 1692803367) / 3) + 1;
    const commitment = JSON.parse(run(['commit', dir, '-p', '0.50'], { env: { HOME: join(tempDir, 'home1') } }));
    const after = Math.floor((Date.now() / 1000 - 1692803367) / 3) + 1;

    const anchor = commitment.beacon.anchor_round;
    assert.ok(Number.isInteger(anchor), `anchor_round should be an integer, got ${anchor}`);
    // The relay may lag the local clock by a round or two.
    assert.ok(anchor >= before - 3 && anchor <= after + 1, `anchor ${anchor} not near current round ${before}..${after}`);
    assert.deepEqual(Object.keys(commitment.beacon), ['type', 'anchor_round', 'chain_hash']);

    const saved = join(dir, 'commitment.json');
    assert.ok(run(['verify', saved]).includes('VALID'));
  });

  it('commit --no-anchor omits anchor_round', () => {
    const dir = join(tempDir, 'noanchordir');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.txt'), 'not anchored');

    const commitment = JSON.parse(run(['commit', dir, '-p', '0.50', '--no-anchor'], { env: { HOME: join(tempDir, 'home1') } }));
    assert.deepEqual(Object.keys(commitment.beacon), ['type', 'chain_hash']);
    assert.ok(run(['verify', join(dir, 'commitment.json')]).includes('VALID'));
  });

  it('verify checks a commitment', () => {
    const output = run(['verify', join(tempDir, 'commitment.json')]);
    assert.ok(output.includes('VALID'));
  });

  it('usage does not include removed mirrors commands', () => {
    try {
      run([]);
      assert.fail('Should have exited');
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      const output = err.stdout || err.stderr || '';
      assert.ok(!output.includes('mirrors add'), 'mirrors add should be removed');
      assert.ok(!output.includes('mirrors list'), 'mirrors list should be removed');
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
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      assert.ok((err.stdout || '').includes('INVALID') || (err.stderr || '').includes('INVALID') || err.status !== 0);
    }
  });

  // ── File trail tests ──

  it('hash dir creates manifest.json', () => {
    const dir = join(tempDir, 'trail-hash');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'alpha');
    writeFileSync(join(dir, 'b.txt'), 'bravo');

    run(['hash', 'dir', dir]);

    assert.ok(existsSync(join(dir, 'manifest.json')), 'manifest.json should exist');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.spec_version, '0.2.0');
    assert.ok(manifest.root_hash);
    assert.equal(manifest.root_hash.length, 64);
    assert.ok(Array.isArray(manifest.items));
    assert.equal(manifest.items.length, 2);
    assert.ok(manifest.created_at);

    // Items should have path and hash
    for (const item of manifest.items) {
      assert.ok(item.path);
      assert.ok(item.hash);
      assert.equal(item.hash.length, 64);
    }
  });

  it('hash dir produces same hash after manifest.json exists (protocol file exclusion)', () => {
    const dir = join(tempDir, 'trail-exclusion');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'data.txt'), 'test data');

    // First hash — creates manifest.json
    const output1 = run(['hash', 'dir', dir]);
    const result1 = JSON.parse(output1);

    // Second hash — manifest.json now present but should be excluded
    const output2 = run(['hash', 'dir', dir]);
    const result2 = JSON.parse(output2);

    assert.equal(result1.hash, result2.hash, 'Hash should be stable after manifest.json is created');
    assert.equal(result1.items, result2.items, 'Item count should be stable');
  });

  it('protocol files exclusion: directory with protocol files produces same hash as without', () => {
    // Create a clean dir
    const dir = join(tempDir, 'trail-exclusion2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'file1.json'), '{"x":1}');

    // Get hash before any protocol files exist
    const output1 = run(['hash', 'dir', dir]);
    const hash1 = JSON.parse(output1).hash;

    // Now create protocol files manually (simulating previous runs)
    writeFileSync(join(dir, 'commitment.json'), '{}');
    writeFileSync(join(dir, 'receipt.json'), '{}');
    writeFileSync(join(dir, 'server-receipts.json'), '{}');
    writeFileSync(join(dir, 'reveal.json'), '{}');
    writeFileSync(join(dir, 'reveal-receipts.json'), '{}');
    writeFileSync(join(dir, 'publication.json'), '{}');
    writeFileSync(join(dir, 'verify.sh'), '#!/bin/bash');
    writeFileSync(join(dir, 'README.md'), '# Test');

    // Hash should be the same — protocol files excluded
    const output2 = run(['hash', 'dir', dir]);
    const hash2 = JSON.parse(output2).hash;

    assert.equal(hash1, hash2, 'Protocol files should be excluded from hash');
  });

  it('commit creates commitment.json in directory', () => {
    const dir = join(tempDir, 'trail-commit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'result.json'), '{"score": 0.95}');

    run(['commit', dir, '-p', '0.50'], {
      env: { HOME: join(tempDir, 'home1') },
    });

    assert.ok(existsSync(join(dir, 'commitment.json')), 'commitment.json should exist');
    const commitment = JSON.parse(readFileSync(join(dir, 'commitment.json'), 'utf-8'));
    assert.equal(commitment.spec_version, '0.2.0');
    assert.ok(commitment.commitment_hash);
    assert.ok(commitment.signature);
    assert.equal(commitment.item_count, 1);
    assert.equal(commitment.reveal_probability, 0.5);
  });

  it('usage includes reveal command', () => {
    try {
      run([]);
      assert.fail('Should have exited');
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      const output = err.stdout || err.stderr || '';
      assert.ok(output.includes('reveal'));
    }
  });
});

describe('JS CLI: object format 0.5.0', () => {
  let dir: string;
  let home: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-cli-v5-'));
    home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    run(['key', 'generate'], { env: { HOME: home } });
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('commit --format 0.5.0 writes a secret, a manifest without plain hashes, and a 0.5.0 commitment', () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'q1.json'), '{"q":"first"}');
    writeFileSync(join(data, 'q2.json'), '{"q":"second"}');
    const plain = [join(data, 'q1.json'), join(data, 'q2.json')].map((f) => run(['hash', 'file', f]));

    const commitment = JSON.parse(run(['commit', data, '-p', '0.25', '--format', '0.5.0', '--stream', 'cli-bench', '--sequence', '3'], { env: { HOME: home } }));
    assert.equal(commitment.spec_version, '0.5.0');
    assert.equal(commitment.reveal_probability_ppm, 250000);
    assert.equal(commitment.reveal_probability, undefined);
    assert.equal(commitment.selection_mode, 'batch');
    assert.equal(commitment.stream_id, 'cli-bench');
    assert.equal(commitment.sequence, 3);
    assert.deepEqual(commitment.metadata, {});
    assert.ok(Number.isInteger(commitment.beacon.anchor_round));
    assert.equal(commitment.item_count, 2);
    for (const h of plain) assert.ok(!commitment.items.includes(h), 'items are commitments, not plain hashes');

    const secret = JSON.parse(readFileSync(join(data, 'commitment-secret.json'), 'utf-8'));
    assert.match(secret.item_secret, /^[0-9a-f]{64}$/);
    const manifest = JSON.parse(readFileSync(join(data, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.spec_version, '0.5.0');
    assert.deepEqual(manifest.items.map((e: any) => e.item), commitment.items);
    const manifestText = readFileSync(join(data, 'manifest.json'), 'utf-8');
    for (const h of plain) assert.ok(!manifestText.includes(h), 'manifest leaks a plain hash');

    // The secret is not hashed as data: a second hash dir gives the same root.
    const before = JSON.parse(run(['hash', 'dir', data])).hash;
    assert.equal(JSON.parse(run(['hash', 'dir', data])).hash, before);

    assert.match(run(['verify', join(data, 'commitment.json')], { env: { HOME: home } }), /VALID[\s\S]*Format: 0\.5\.0[\s\S]*Probability: 25%/);
  });

  it('commit --format 0.5.0 --mode per_item and PB_FORMAT are honored', () => {
    const data = join(dir, 'data2');
    mkdirSync(data);
    writeFileSync(join(data, 'a.txt'), 'a');
    const c = JSON.parse(run(['commit', data, '-p', '0.1', '--mode', 'per_item'], { env: { HOME: home, PB_FORMAT: '0.5.0' } }));
    assert.equal(c.spec_version, '0.5.0');
    assert.equal(c.selection_mode, 'per_item');
  });

  it('refuses 0.5.0 without an anchor, a stream without a sequence, and an unknown format', () => {
    const data = join(dir, 'data3');
    mkdirSync(data);
    writeFileSync(join(data, 'a.txt'), 'a');
    const fails = (args: string[], pattern: RegExp) => {
      try {
        run(args, { env: { HOME: home } });
        assert.fail('should have exited');
      } catch (e: unknown) {
        const err = e as { status?: number; stderr?: string; message?: string };
        assert.notEqual(err.status, 0);
        assert.match((err.stderr ?? '') + (err.message ?? ''), pattern);
      }
    };
    fails(['commit', data, '--format', '0.5.0', '--no-anchor'], /requires an anchor/);
    fails(['commit', data, '--format', '0.5.0', '--stream', 'x'], /--stream and --sequence/);
    fails(['commit', data, '--format', '0.4.0'], /unknown format/);
  });
});
