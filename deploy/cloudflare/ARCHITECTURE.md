# Cloudflare Workers Deployment — Architecture & Reusability

## Overview

The `deploy/cloudflare/` directory is a self-contained Cloudflare Workers deployment of the commit-reveal protocol server. It runs the same Hono-based REST API as `packages/pb-node/`, using Cloudflare D1 (SQLite-at-edge) instead of local better-sqlite3.

## File-by-File Reusability Map

This table shows exactly which pb-node files each Worker file derives from, what changed, and what's identical.

| Worker file | pb-node source | Reuse level | Changes |
|---|---|---|---|
| `src/routes/commitments.js` | `packages/pb-node/src/routes/commitments.js` | **~98% identical** | Import path for wasm (`../wasm/pb_wasm.js` vs `pb-wasm`). All business logic identical. |
| `src/routes/reveals.js` | `packages/pb-node/src/routes/reveals.js` | **~95% identical** | `crypto.randomUUID().replace(/-/g,'')` replaces `randomBytes(16).toString('hex')`. All storage calls gain `await`. Import path for wasm. |
| `src/routes/server-info.js` | `packages/pb-node/src/routes/server-info.js` | **~90% identical** | Reads config from `c.get('config')` instead of module-level `import { config }`. |
| `src/beacon.js` | `packages/pb-node/src/beacon.js` | **~99% identical** | Only import path changes (`./wasm/pb_wasm.js` vs `pb-wasm`). Logic is 100% the same. |
| `src/signing.js` | `packages/pb-node/src/signing.js` | **~95% identical** | Added `if (serverKeypair) return` early-exit for lazy init (no-op after first request). Import path for wasm. |
| `src/config.js` | `packages/pb-node/src/config.js` | **~80% identical** | `getConfig(env)` function vs module-level `config` object. No `port` or `dbPath`. Reads from Worker `env` bindings instead of `process.env`. |
| `src/app.js` | `packages/pb-node/src/app.js` | **~85% identical** | `createApp()` takes no args. Middleware creates `D1Storage(c.env.DB)` per-request, calls `getConfig(c.env)`, runs `initServerKey()`. Same route setup. |
| `src/storage/d1.js` | `packages/pb-storage/src/storage.js` | **~70% identical** | Same method signatures, same SQL logic. Uses D1 API (`prepare().bind().first/all/run`) instead of Kysely query builder. `getSignerActivity()` uses `db.batch()` for efficiency. |
| `src/wasm/pb_wasm.js` | `pkg/pb_wasm.js` | **~95% identical** | `exports.X = X` → `export function X`. Last 5 lines replaced: `require('fs').readFileSync` → `import wasmModule from './pb_wasm_bg.wasm'`. All internal helpers unchanged. |
| `src/index.js` | `packages/pb-node/src/server.js` | **~20% identical** | Completely different entry point pattern. Workers: `export default { fetch }`. Node: `serve()` with port binding. |
| `migrations/0001_initial.sql` | `packages/pb-storage/src/sqlite.js` lines 10-49 | **100% identical** | Exact same schema (5 tables, 3 indexes). |

## Adaptation Categories

### 1. Storage: Kysely → D1 Raw SQL (the biggest change)

pb-node uses `packages/pb-storage` which wraps Kysely for dialect-agnostic queries. D1's native API is simpler and doesn't need Kysely:

```js
// pb-storage (Kysely)
const row = await this.db
  .selectFrom('commitments')
  .select(['body', 'registered_at'])
  .where('id', '=', id)
  .executeTakeFirst();

// D1
const row = await this.db
  .prepare('SELECT body, registered_at FROM commitments WHERE id = ?')
  .bind(id)
  .first();
```

The D1Storage class has the **same method signatures** as KyselyStorage, so all route code works unchanged (just needs `await`).

### 2. WASM Loading: CJS → ESM

The original `pkg/pb_wasm.js` uses Node.js-specific CJS module loading:

```js
// Node.js (CJS)
const wasmPath = `${__dirname}/pb_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
```

Workers use ESM static imports with Wrangler's `CompiledWasm` rule:

```js
// Workers (ESM)
import wasmModule from './pb_wasm_bg.wasm';
const wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
```

All 500+ lines of wasm-bindgen glue code (helper functions, memory management, externref table) are **unchanged**.

### 3. Crypto: node:crypto → Web Crypto API

Only one usage needed adaptation:

```js
// Node.js
import { randomBytes } from 'node:crypto';
const revealId = randomBytes(16).toString('hex');  // 32 hex chars

// Workers
const revealId = crypto.randomUUID().replace(/-/g, '');  // 32 hex chars
```

The WASM module's `getrandom` crate already checks `globalThis.crypto` first, which Workers provides natively.

### 4. Configuration: process.env → Worker env bindings

```js
// Node.js (module-level singleton)
export const config = {
  port: parseInt(process.env.PORT || '7420', 10),
  retention: process.env.RETENTION || '30d',
  ...
};

// Workers (per-request from c.env)
export function getConfig(env) {
  return {
    retention: env.RETENTION || '30d',
    ...
  };
}
```

Config is set via `[vars]` in `wrangler.toml` and accessed through the Worker's `env` bindings.

### 5. Server Key Init: Sync startup → Async middleware

Node.js initializes the server key at startup (`await initServerKey(storage)` in `createDefaultApp()`). Workers can't do async work at module load time, so init runs in middleware:

```js
// Worker middleware — runs on every request, no-op after first
app.use('*', async (c, next) => {
  const storage = new D1Storage(c.env.DB);
  await initServerKey(storage);  // cached after first call
  ...
});
```

## Future: Improving Reusability

To maximize code sharing between Node.js and Workers deployments, consider:

1. **Extract route logic into pure functions** that take `(storage, config, wasm)` as args — no import-path differences
2. **Build the WASM glue as a dual CJS/ESM package** (wasm-bindgen `--target web` or `--target bundler`)
3. **Use `pb-storage` with a D1 Kysely dialect** — `kysely-d1` exists, which would let both deployments share the exact same KyselyStorage class
4. **Make config a factory function everywhere** — `getConfig(env)` pattern works for both `process.env` and Worker `env`

Currently, reuse is ~90% by line count. The remaining 10% is mechanical (import paths, async wrappers, entry point format).

## Deploy Flow

```
node deploy.js
├── 1. Check npx wrangler + login
├── 2. Interactive config (worker name, operator, retention)
├── 3. Copy WASM binary from ../../pkg/
├── 4. Create D1 database
├── 5. Patch wrangler.toml with database_id
├── 6. Apply SQL migrations
├── 7. npx wrangler deploy
└── 8. Smoke test /health + /v1/server-info
```

## Local Development

```bash
cd deploy/cloudflare
npm install
npx wrangler dev   # starts local Worker with local D1
```

Wrangler dev creates a local D1 database automatically and applies migrations on first request.
