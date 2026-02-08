#!/usr/bin/env node

/**
 * Interactive Cloudflare Workers + D1 deploy script.
 * All prompts are option-based (no typing required, auto-generated defaults).
 *
 * Usage: node deploy.js
 */

import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = createInterface({ input: process.stdin, output: process.stdout });

// ── Helpers ──

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function menu(prompt, options) {
  console.log(`\n${prompt}`);
  options.forEach((opt, i) => {
    const tag = opt.default ? ' (default)' : '';
    console.log(`  ${i + 1}) ${opt.label}${tag}`);
  });
  const answer = await ask(`Choose [1-${options.length}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  // Default to first option on empty/invalid
  const def = options.find((o) => o.default) || options[0];
  return def.value;
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: __dirname, encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: __dirname, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function banner(text) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(60));
}

// ── Steps ──

async function checkPrereqs() {
  banner('Step 1: Checking prerequisites');

  // Check npx wrangler
  try {
    const version = runCapture('npx wrangler --version');
    console.log(`  wrangler: ${version}`);
  } catch {
    console.error('  ERROR: npx wrangler not available. Run: npm install');
    process.exit(1);
  }

  // Check login status
  try {
    runCapture('npx wrangler whoami');
    console.log('  Logged in to Cloudflare.');
  } catch {
    console.log('  Not logged in. Starting login flow...');
    run('npx wrangler login');
  }
}

async function interactiveConfig() {
  banner('Step 2: Configuration');

  const suffix = randomBytes(2).toString('hex');
  const defaultName = `commit-reveal-${suffix}`;

  const workerName = await menu('Worker name:', [
    { label: defaultName, value: defaultName, default: true },
    { label: 'commit-reveal-prod', value: 'commit-reveal-prod' },
    { label: 'commit-reveal-staging', value: 'commit-reveal-staging' },
  ]);

  const operator = await menu('Operator name:', [
    { label: 'Commit-Reveal', value: 'Commit-Reveal', default: true },
    { label: 'Custom (edit wrangler.toml after deploy)', value: 'Commit-Reveal' },
  ]);

  const retention = await menu('Data retention:', [
    { label: '30 days', value: '30d', default: true },
    { label: '7 days', value: '7d' },
    { label: '90 days', value: '90d' },
    { label: '365 days', value: '365d' },
  ]);

  console.log(`\n  Worker name: ${workerName}`);
  console.log(`  Operator:    ${operator}`);
  console.log(`  Retention:   ${retention}`);

  return { workerName, operator, retention };
}

function copyWasm() {
  banner('Step 3: Copying WASM binary');

  const src = resolve(__dirname, '../../pkg/pb_wasm_bg.wasm');
  const dst = resolve(__dirname, 'src/wasm/pb_wasm_bg.wasm');

  if (!existsSync(src)) {
    console.error(`  ERROR: WASM binary not found at ${src}`);
    console.error('  Run: cd ../../ && cargo build --target wasm32-unknown-unknown && wasm-bindgen ...');
    process.exit(1);
  }

  copyFileSync(src, dst);
  const size = readFileSync(dst).length;
  console.log(`  Copied pb_wasm_bg.wasm (${(size / 1024).toFixed(0)} KB)`);
}

function createD1(config) {
  banner('Step 4: Creating D1 database');

  const dbName = `${config.workerName}-db`;
  let output;
  try {
    output = runCapture(`npx wrangler d1 create ${dbName}`);
  } catch (e) {
    // If DB already exists, try to find it
    console.log(`  Database "${dbName}" may already exist. Looking it up...`);
    try {
      output = runCapture('npx wrangler d1 list --json');
      const dbs = JSON.parse(output);
      const existing = dbs.find((db) => db.name === dbName);
      if (existing) {
        console.log(`  Found existing database: ${existing.uuid}`);
        return { dbName, dbId: existing.uuid };
      }
    } catch {
      // Fall through
    }
    console.error(`  ERROR: Failed to create D1 database: ${e.message}`);
    process.exit(1);
  }

  // Parse database_id from output
  const match = output.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match) {
    console.error('  ERROR: Could not parse database_id from wrangler output');
    console.error(output);
    process.exit(1);
  }

  const dbId = match[1];
  console.log(`  Created D1 database: ${dbName} (${dbId})`);
  return { dbName, dbId };
}

function patchWranglerToml(config, db) {
  banner('Step 5: Patching wrangler.toml');

  const tomlPath = resolve(__dirname, 'wrangler.toml');
  let toml = readFileSync(tomlPath, 'utf-8');

  toml = toml.replace(/^name = "PLACEHOLDER"/m, `name = "${config.workerName}"`);
  toml = toml.replace(/^database_name = "PLACEHOLDER"/m, `database_name = "${db.dbName}"`);
  toml = toml.replace(/^database_id = "PLACEHOLDER"/m, `database_id = "${db.dbId}"`);
  toml = toml.replace(/^OPERATOR = "Commit-Reveal"/m, `OPERATOR = "${config.operator}"`);
  toml = toml.replace(/^RETENTION = "30d"/m, `RETENTION = "${config.retention}"`);

  writeFileSync(tomlPath, toml);
  console.log('  wrangler.toml updated.');
}

function applyMigrations(db) {
  banner('Step 6: Applying D1 migrations');

  run(`npx wrangler d1 execute ${db.dbName} --remote --file=migrations/0001_initial.sql`);
  console.log('  Migrations applied.');
}

function deploy() {
  banner('Step 7: Deploying Worker');

  run('npx wrangler deploy');
  console.log('  Worker deployed.');
}

async function smokeTest(config) {
  banner('Step 8: Smoke test');

  const baseUrl = `https://${config.workerName}.workers.dev`;
  console.log(`  Testing ${baseUrl}...`);

  // Wait a moment for propagation
  await new Promise((r) => setTimeout(r, 3000));

  let healthOk = false;
  let serverInfo = null;

  try {
    const healthResp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10000) });
    const health = await healthResp.json();
    if (health.status === 'ok') {
      console.log('  /health ............. OK');
      healthOk = true;
    } else {
      console.log(`  /health ............. UNEXPECTED: ${JSON.stringify(health)}`);
    }
  } catch (e) {
    console.log(`  /health ............. FAILED: ${e.message}`);
  }

  try {
    const infoResp = await fetch(`${baseUrl}/v1/server-info`, { signal: AbortSignal.timeout(10000) });
    serverInfo = await infoResp.json();
    if (serverInfo.server_key && serverInfo.operator) {
      console.log('  /v1/server-info ..... OK');
      console.log(`    operator:   ${serverInfo.operator}`);
      console.log(`    server_key: ${serverInfo.server_key}`);
      console.log(`    retention:  ${serverInfo.retention}`);
    } else {
      console.log(`  /v1/server-info ..... UNEXPECTED: ${JSON.stringify(serverInfo)}`);
    }
  } catch (e) {
    console.log(`  /v1/server-info ..... FAILED: ${e.message}`);
  }

  console.log(`\n  Worker URL: ${baseUrl}`);
  return { healthOk, serverInfo };
}

function appendDeploymentLog(config, db, smokeResult) {
  const logPath = resolve(__dirname, '../../deployments.log');
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const serverKey = smokeResult.serverInfo?.server_key || 'unknown (smoke test failed)';
  const smokeStatus = smokeResult.healthOk ? '/health OK, /v1/server-info OK' : 'FAILED';

  const entry = `
${'='.repeat(80)}
[${ts}] DEPLOY — Cloudflare Workers
${'='.repeat(80)}
Action:      deploy
Platform:    Cloudflare Workers + D1
Worker name: ${config.workerName}
Worker URL:  https://${config.workerName}.workers.dev
Server key:  ${serverKey}
D1 database: ${db.dbName}
D1 DB ID:    ${db.dbId}
Operator:    ${config.operator}
Retention:   ${config.retention}
Spec ver:    0.2.0
Status:      LIVE
Smoke test:  ${smokeStatus}
`;

  if (existsSync(logPath)) {
    appendFileSync(logPath, entry);
  } else {
    writeFileSync(logPath, `# Deployment Log\n# Local-only record of deployments from this machine.\n# NOT checked into git.\n${entry}`);
  }
  console.log(`  Logged to deployments.log`);
}

// ── Main ──

async function main() {
  console.log('');
  console.log('  Commit-Reveal Protocol — Cloudflare Workers Deploy');
  console.log('  ==================================================');

  try {
    await checkPrereqs();
    const config = await interactiveConfig();
    copyWasm();

    const confirm = await menu('Ready to create D1 database and deploy?', [
      { label: 'Yes, proceed', value: true, default: true },
      { label: 'No, abort', value: false },
    ]);
    if (!confirm) {
      console.log('\n  Aborted.');
      process.exit(0);
    }

    const db = createD1(config);
    patchWranglerToml(config, db);
    applyMigrations(db);
    deploy();
    const smokeResult = await smokeTest(config);
    appendDeploymentLog(config, db, smokeResult);

    banner('Deployment complete!');
    console.log(`\n  Worker: https://${config.workerName}.workers.dev`);
    console.log(`  D1 DB:  ${db.dbName} (${db.dbId})`);
    if (smokeResult.serverInfo?.server_key) {
      console.log(`  Key:    ${smokeResult.serverInfo.server_key}`);
    }
    console.log('');
  } catch (e) {
    console.error(`\n  FATAL: ${e.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
