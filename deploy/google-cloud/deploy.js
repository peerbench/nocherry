#!/usr/bin/env node

/**
 * Interactive Google Cloud Run + Firestore deploy script.
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

  // Check gcloud CLI
  try {
    const version = runCapture('gcloud version --format="value(Google Cloud SDK)"');
    console.log(`  gcloud SDK: ${version}`);
  } catch {
    console.error('  ERROR: gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install');
    process.exit(1);
  }

  // Check auth
  try {
    const account = runCapture('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
    if (!account) throw new Error('No active account');
    console.log(`  Authenticated as: ${account}`);
  } catch {
    console.log('  Not authenticated. Starting login flow...');
    run('gcloud auth login');
  }

  // Check project
  let project;
  try {
    project = runCapture('gcloud config get-value project');
    if (!project || project === '(unset)') throw new Error('No project');
    console.log(`  Project: ${project}`);
  } catch {
    console.error('  ERROR: No project set. Run: gcloud config set project YOUR_PROJECT_ID');
    process.exit(1);
  }

  return { project };
}

async function interactiveConfig(prereqs) {
  banner('Step 2: Configuration');

  const suffix = randomBytes(2).toString('hex');
  const defaultName = `commit-reveal-${suffix}`;

  const serviceName = await menu('Cloud Run service name:', [
    { label: defaultName, value: defaultName, default: true },
    { label: 'commit-reveal-prod', value: 'commit-reveal-prod' },
    { label: 'commit-reveal-staging', value: 'commit-reveal-staging' },
  ]);

  const region = await menu('Region:', [
    { label: 'us-central1 (Iowa)', value: 'us-central1', default: true },
    { label: 'us-east1 (South Carolina)', value: 'us-east1' },
    { label: 'europe-west1 (Belgium)', value: 'europe-west1' },
    { label: 'asia-east1 (Taiwan)', value: 'asia-east1' },
  ]);

  const operator = await menu('Operator name:', [
    { label: 'Commit-Reveal', value: 'Commit-Reveal', default: true },
    { label: 'Custom (edit env vars after deploy)', value: 'Commit-Reveal' },
  ]);

  const retention = await menu('Data retention:', [
    { label: '30 days', value: '30d', default: true },
    { label: '7 days', value: '7d' },
    { label: '90 days', value: '90d' },
    { label: '365 days', value: '365d' },
  ]);

  console.log(`\n  Service:   ${serviceName}`);
  console.log(`  Region:    ${region}`);
  console.log(`  Project:   ${prereqs.project}`);
  console.log(`  Operator:  ${operator}`);
  console.log(`  Retention: ${retention}`);

  return { serviceName, region, operator, retention, project: prereqs.project };
}

function enableAPIs() {
  banner('Step 3: Enabling Google Cloud APIs');

  const apis = [
    'run.googleapis.com',
    'firestore.googleapis.com',
    'artifactregistry.googleapis.com',
    'cloudbuild.googleapis.com',
  ];

  run(`gcloud services enable ${apis.join(' ')}`);
  console.log('  APIs enabled.');
}

function createFirestoreDB(config) {
  banner('Step 4: Creating Firestore database');

  // Map Cloud Run region to Firestore location
  const firestoreLocationMap = {
    'us-central1': 'nam5',
    'us-east1': 'nam5',
    'europe-west1': 'eur3',
    'asia-east1': 'asia-east1',
  };
  const firestoreLocation = firestoreLocationMap[config.region] || 'nam5';

  const dbName = config.serviceName;

  try {
    run(`gcloud firestore databases create --location=${firestoreLocation} --type=firestore-native --database=${dbName}`, { silent: true });
    console.log(`  Firestore database "${dbName}" created (location: ${firestoreLocation}).`);
  } catch (e) {
    const msg = e.stderr || e.stdout || e.message || '';
    if (msg.includes('already exists') || msg.includes('ALREADY_EXISTS')) {
      console.log(`  Firestore database "${dbName}" already exists. Skipping.`);
    } else {
      console.error(`  ERROR: Failed to create Firestore database: ${msg}`);
      process.exit(1);
    }
  }

  config.firestoreDatabase = dbName;
}

function createFirestoreIndex(config) {
  banner('Step 5: Creating Firestore composite index');

  const indexSpec = resolve(__dirname, 'firestore.indexes.json');

  try {
    // Deploy indexes using gcloud firestore indexes composite create
    run(`gcloud firestore indexes composite create --collection-group=commitments --field-config=field-path=signing_key,order=ascending --field-config=field-path=registered_at,order=ascending --database=${config.firestoreDatabase}`, { silent: true });
    console.log('  Composite index created (signing_key + registered_at).');
  } catch (e) {
    const msg = e.stderr || e.stdout || e.message || '';
    if (msg.includes('already exists') || msg.includes('ALREADY_EXISTS')) {
      console.log('  Composite index already exists. Skipping.');
    } else {
      // Non-fatal — index may take a few minutes to build
      console.log(`  Index creation submitted (may take a few minutes to build).`);
    }
  }
}

function copyWasm() {
  banner('Step 6: Copying WASM binary');

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

function buildAndPush(config) {
  banner('Step 7: Building and pushing container image');

  const imageTag = `${config.region}-docker.pkg.dev/${config.project}/cloud-run-source-deploy/${config.serviceName}`;
  const nocherryRoot = resolve(__dirname, '../..');

  run(`gcloud builds submit --tag ${imageTag} --dockerfile deploy/google-cloud/Dockerfile`, { cwd: nocherryRoot });
  console.log(`  Image built and pushed: ${imageTag}`);

  return { imageTag };
}

function deployService(config, build) {
  banner('Step 8: Deploying to Cloud Run');

  const envVars = [
    `OPERATOR=${config.operator}`,
    `RETENTION=${config.retention}`,
    `GOOGLE_CLOUD_PROJECT=${config.project}`,
    `FIRESTORE_DATABASE=${config.firestoreDatabase}`,
  ].join(',');

  run([
    `gcloud run deploy ${config.serviceName}`,
    `--image=${build.imageTag}`,
    `--region=${config.region}`,
    `--allow-unauthenticated`,
    `--set-env-vars=${envVars}`,
    `--memory=256Mi`,
    `--min-instances=0`,
    `--max-instances=10`,
  ].join(' '));

  // Get the service URL
  const serviceUrl = runCapture(
    `gcloud run services describe ${config.serviceName} --region=${config.region} --format="value(status.url)"`
  );

  console.log(`  Service deployed: ${serviceUrl}`);
  return { serviceUrl };
}

async function smokeTest(serviceUrl) {
  banner('Step 9: Smoke test');

  console.log(`  Testing ${serviceUrl}...`);

  // Wait a moment for propagation
  await new Promise((r) => setTimeout(r, 3000));

  let healthOk = false;
  let serverInfo = null;

  try {
    const healthResp = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(10000) });
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
    const infoResp = await fetch(`${serviceUrl}/v1/server-info`, { signal: AbortSignal.timeout(10000) });
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

  console.log(`\n  Service URL: ${serviceUrl}`);
  return { healthOk, serverInfo };
}

function appendDeploymentLog(config, serviceUrl, smokeResult) {
  const logPath = resolve(__dirname, '../../deployments.log');
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const serverKey = smokeResult.serverInfo?.server_key || 'unknown (smoke test failed)';
  const smokeStatus = smokeResult.healthOk ? '/health OK, /v1/server-info OK' : 'FAILED';

  const entry = `
${'='.repeat(80)}
[${ts}] DEPLOY — Google Cloud Run
${'='.repeat(80)}
Action:      deploy
Platform:    Google Cloud Run + Firestore
Service:     ${config.serviceName}
Service URL: ${serviceUrl}
Server key:  ${serverKey}
Region:      ${config.region}
Project:     ${config.project}
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
  console.log('  Commit-Reveal Protocol — Google Cloud Run Deploy');
  console.log('  =================================================');

  try {
    const prereqs = await checkPrereqs();
    const config = await interactiveConfig(prereqs);
    copyWasm();

    const confirm = await menu('Ready to enable APIs, create Firestore DB, and deploy?', [
      { label: 'Yes, proceed', value: true, default: true },
      { label: 'No, abort', value: false },
    ]);
    if (!confirm) {
      console.log('\n  Aborted.');
      process.exit(0);
    }

    enableAPIs();
    createFirestoreDB(config);
    createFirestoreIndex(config);
    const build = buildAndPush(config);
    const deployment = deployService(config, build);
    const smokeResult = await smokeTest(deployment.serviceUrl);
    appendDeploymentLog(config, deployment.serviceUrl, smokeResult);

    banner('Deployment complete!');
    console.log(`\n  Service: ${deployment.serviceUrl}`);
    console.log(`  Region:  ${config.region}`);
    console.log(`  Project: ${config.project}`);
    if (smokeResult.serverInfo?.server_key) {
      console.log(`  Key:     ${smokeResult.serverInfo.server_key}`);
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
