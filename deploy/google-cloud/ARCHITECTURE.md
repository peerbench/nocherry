# Google Cloud Run Deployment — Architecture & Reusability

## Overview

The `deploy/google-cloud/` directory is a self-contained Google Cloud Run + Firestore deployment of the commit-reveal protocol server. It runs the same Hono-based REST API as `packages/pb-node/` and `deploy/cloudflare/`, using Firestore Native mode instead of SQLite or D1.

Cloud Run scales to zero (2M req/mo free tier) and Firestore Native mode provides 1 GiB free storage with 50K reads/day.

## File-by-File Reusability Map

This table shows exactly which Cloudflare Worker files each Cloud Run file derives from, what changed, and what's identical.

| Cloud Run file | Cloudflare source | Reuse level | Changes |
|---|---|---|---|
| `src/routes/commitments.js` | `deploy/cloudflare/src/routes/commitments.js` | **~98% identical** | Only wasm import path (`../wasm/pb_wasm.js`). All business logic identical. |
| `src/routes/reveals.js` | `deploy/cloudflare/src/routes/reveals.js` | **~98% identical** | Only wasm import path. All business logic identical. |
| `src/routes/server-info.js` | `deploy/cloudflare/src/routes/server-info.js` | **~98% identical** | Reads config from `c.get('config')` — same pattern as Cloudflare. |
| `src/beacon.js` | `deploy/cloudflare/src/beacon.js` | **~99% identical** | Only wasm import path changes. Logic is 100% the same. |
| `src/signing.js` | `deploy/cloudflare/src/signing.js` | **~95% identical** | Only wasm import path changes. Same lazy-init pattern. |
| `src/config.js` | `deploy/cloudflare/src/config.js` | **~80% identical** | `getConfig()` reads `process.env` directly (like pb-node). Adds `port` and `projectId`. |
| `src/app.js` | `deploy/cloudflare/src/app.js` | **~85% identical** | `createApp(storage)` receives long-lived storage instance. No per-request storage creation. Server key init moved to startup. |
| `src/server.js` | `packages/pb-node/src/server.js` | **~70% identical** | Same `@hono/node-server` pattern. Creates FirestoreStorage instead of SQLite. Adds SIGTERM handler for Cloud Run. |
| `src/storage/firestore.js` | `deploy/cloudflare/src/storage/d1.js` | **~30% identical** | Same method signatures and interface. Completely different implementation using Firestore SDK. |
| `src/wasm/pb_wasm.js` | `deploy/cloudflare/src/wasm/pb_wasm.js` | **~95% identical** | Top 8 lines: `fs.readFileSync` + `import.meta.url` replaces `import wasmModule from '*.wasm'`. All 500+ lines of wasm-bindgen glue unchanged. |
| `deploy.js` | `deploy/cloudflare/deploy.js` | **~60% identical** | Same menu UX and structure. gcloud commands replace wrangler commands. |

## Adaptation Categories

### 1. Storage: D1 SQL → Firestore Document DB (the biggest change)

D1 uses SQL queries; Firestore uses document-oriented reads/writes:

```js
// D1 (SQL)
const row = await this.db
  .prepare('SELECT body, registered_at FROM commitments WHERE id = ?')
  .bind(id)
  .first();

// Firestore (Document)
const doc = await this.commitments.doc(id).get();
const data = doc.data();
```

Firestore-specific patterns:
- `doc.create()` for insert-only (throws on duplicate) vs `INSERT INTO`
- `doc.set()` for upsert vs `INSERT OR REPLACE`
- `.where().get()` for queries vs `SELECT ... WHERE`
- `.count().get()` for server-side aggregation vs `SELECT COUNT(*)`
- Batched deletes (500 per batch) vs `DELETE FROM ... WHERE`

The FirestoreStorage class has the **same method signatures** as D1Storage/KyselyStorage, so all route code works unchanged.

### 2. WASM Loading: Workers Static Import → Node.js fs.readFileSync

```js
// Cloudflare Workers
import wasmModule from './pb_wasm_bg.wasm';

// Node.js (Cloud Run)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmBytes = readFileSync(join(__dirname, 'pb_wasm_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);
```

All 500+ lines of wasm-bindgen glue code are **unchanged**.

### 3. Entry Point: Workers Export → Node.js HTTP Server

```js
// Cloudflare Workers
export default { fetch: app.fetch };

// Cloud Run (Node.js)
import { serve } from '@hono/node-server';
const server = serve({ fetch: app.fetch, port: config.port });
```

### 4. Server Key Init: Per-Request Middleware → Startup

Cloud Run containers are long-lived (vs Workers which may be per-request), so server key initialization happens once at startup:

```js
// Workers — per-request middleware
app.use('*', async (c, next) => {
  await initServerKey(new D1Storage(c.env.DB));
  await next();
});

// Cloud Run — at startup
const storage = new FirestoreStorage(projectId);
await initServerKey(storage);
const app = createApp(storage);  // storage passed in, not created per-request
```

### 5. Configuration: Worker Env Bindings → process.env

```js
// Workers (per-request from c.env)
export function getConfig(env) {
  return { retention: env.RETENTION || '30d', ... };
}

// Cloud Run (process.env, module-level)
export function getConfig() {
  return { retention: process.env.RETENTION || '30d', ... };
}
```

## Firestore Collections

| Collection | Doc ID | Key Fields |
|---|---|---|
| `server_identity` | `"keypair"` | `value` (JSON string) |
| `commitments` | commitment_hash | `signing_key`, `body` (JSON), `registered_at`, `created_at` |
| `selections` | commitment_hash | `beacon_round`, `body` (JSON), `computed_at` |
| `reveals` | reveal_id | `commitment_hash`, `body` (JSON), `registered_at` |
| `beacon_cache` | `"{type}_{round}"` | `beacon_type`, `round_number`, `body` (JSON), `fetched_at` |

### Composite Index

`commitments`: `signing_key` (ASC) + `registered_at` (ASC) — required for `countCommitmentsByKey()`.

## Deploy Flow

```
node deploy.js
├── 1. Check gcloud CLI + authentication + project
├── 2. Interactive config (service name, region, operator, retention)
├── 3. Copy WASM binary from ../../pkg/
├── 4. Confirm proceed
├── 5. Enable Cloud APIs (Run, Firestore, Artifact Registry, Cloud Build)
├── 6. Create Firestore database (skip if exists)
├── 7. Create composite index for commitments
├── 8. Build + push container image (gcloud builds submit)
├── 9. Deploy to Cloud Run
└── 10. Smoke test /health + /v1/server-info
```

## Local Development

```bash
cd deploy/google-cloud
npm install

# Option 1: With Firestore emulator
gcloud emulators firestore start
export FIRESTORE_EMULATOR_HOST=localhost:8181
export GOOGLE_CLOUD_PROJECT=test-project
npm start

# Option 2: With real Firestore (requires gcloud auth)
export GOOGLE_CLOUD_PROJECT=your-project-id
npm start
```
