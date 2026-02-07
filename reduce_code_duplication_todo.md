# Reduce Code Duplication: pb-node vs Deploy Targets

## Current State

The same business logic is copy-pasted **4 times** across:

| Target | Path | Language | Storage |
|--------|------|----------|---------|
| pb-node (reference) | `packages/pb-node/src/` | JS | Kysely + SQLite |
| Cloudflare Workers | `deploy/cloudflare/src/` | JS | D1 (raw SQL) |
| Supabase Edge | `deploy/supabase/.../commit-reveal/` | TS | Kysely + Postgres |
| Google Cloud Run | `deploy/google-cloud/src/` | JS | Firestore |

---

## File-by-File Duplication Matrix

| File | Shared Logic? | Duplicated 4x? | Notes |
|------|--------------|-----------------|-------|
| `beacon.js` | **100% identical** | Yes | Drand fetching, retry, caching, `computeSelection()` |
| `signing.js` | **~98% identical** | Yes | Only WASM import path differs |
| `routes/commitments.js` | **~95% identical** | Yes | Same validation, same response shape. Only diff: how config is accessed (`c.get('config')` vs module import) |
| `routes/reveals.js` | **~95% identical** | Yes | Same validation, same data verification. Same config access diff |
| `routes/server-info.js` | **~98% identical** | Yes | Trivial endpoint, same config access diff |
| `config.js` | ~70% similar | Yes | Same shape, different defaults (port, operator, storage-specific fields) |
| `app.js` | ~80% similar | Yes | Same route wiring, differs in middleware (config injection, storage creation) |
| `storage/*` | **Different** | No | Each target has a unique storage adapter (D1, Firestore, Kysely/SQLite, Kysely/Postgres) |
| Entry point | **Different** | No | `serve()` vs `export default { fetch }` vs `Deno.serve()` |
| WASM loading | **Different** | No | npm import vs ESM bundle vs base64-inlined |

---

## What CAN Be Shared (move to a common package)

### 1. `beacon.js` — Move entirely to shared code

Currently identical in all 4 targets. Zero platform-specific code.

Functions to share:
- `fetchDrandRound(round)` — pure fetch + JSON parse
- `getBeaconOutput(storage, beacon, registeredAt, maxWaitMs)` — uses storage interface only
- `getArrivalBeacon(storage, beacon, timestamp)` — uses storage interface only
- `computeSelection(commitment, beaconOutput)` — pure WASM calls

**Dependency:** `storage.getCachedBeacon()`, `storage.cacheBeacon()`, WASM functions. All are already abstracted behind the same interface in every target.

### 2. `signing.js` — Move entirely to shared code

Functions to share:
- `initServerKey(storage)` — lazy-init pattern, uses `storage.getServerIdentity()` / `storage.setServerIdentity()`
- `getServerKey()` — returns cached DID key
- `serverSign(obj)` — signs JSON with server key
- `signResponse(obj)` — wraps object with server_key + server_signature

**Only diff today:** WASM import path (`import * as wasm from 'pb-wasm'` vs `from './wasm/pb_wasm.js'`). Fix by having the shared module accept WASM as a parameter, or by standardizing the import.

### 3. `routes/commitments.js` — Move business logic to shared code

The handler body is ~95% identical. Two minor diffs:

| Diff | Current | Fix |
|------|---------|-----|
| Config access | `c.get('config')` (CF/GC) vs `import { config }` (pb-node) | Always use `c.get('config')` — pb-node middleware already sets storage, just also set config |
| WASM import | Different paths | Pass WASM via param or standardize import |

Everything else — validation, signature check, duplicate check, beacon fetch, selection compute, signer activity, response signing — is identical.

### 4. `routes/reveals.js` — Move business logic to shared code

Same situation as commitments. The data verification logic (fetch URLs, hash, compare) is identical across all 4 targets. Same two minor diffs (config access, WASM import).

### 5. `routes/server-info.js` — Move entirely to shared code

Trivial 10-line handler. Only diff is config access pattern.

---

## What CANNOT Be Shared (must remain per-target)

### 1. Storage Adapters

Each target has a fundamentally different storage backend:

| Target | Adapter | Why it's unique |
|--------|---------|-----------------|
| pb-node | `pb-storage` (Kysely + SQLite) | Uses Kysely ORM, `better-sqlite3` driver |
| Cloudflare | `D1Storage` class | D1 API: `.prepare().bind().first()`, `.batch()`, raw SQL |
| Supabase | `KyselyStorage` (inlined) | Kysely + `pg` driver, JSONB columns, Postgres-specific upsert syntax |
| Google Cloud | `FirestoreStorage` class | Firestore NoSQL: `.doc().get()`, `.where()`, `.create()`, gRPC error codes |

**However:** All adapters implement the same interface. This is already the right pattern — just needs to be formalized as a documented interface/type.

### 2. Entry Points

Each runtime has a different startup mechanism:
- pb-node: `@hono/node-server` → `serve({ fetch: app.fetch, port })`
- Cloudflare: `export default { fetch: app.fetch }`
- Supabase: `Deno.serve(app.fetch)`
- Google Cloud: `@hono/node-server` (same as pb-node but different config)

### 3. WASM Loading

- pb-node: `import * as wasm from 'pb-wasm'` (npm workspace link)
- Cloudflare: ESM static import from bundled `./wasm/pb_wasm.js`
- Supabase: Base64-inlined WASM, `await initWasm()` at startup
- Google Cloud: Bundled `./wasm/pb_wasm.js`

### 4. Config Defaults

Port, operator name, storage-specific fields (dbPath, projectId, firestoreDatabase) vary per target. The config shape is the same though — just different defaults.

---

## Proposed Architecture

```
packages/
  pb-server-core/              # NEW shared package
    src/
      beacon.js                # Drand fetching + selection (moved from all 4)
      signing.js               # Server key mgmt + response signing (moved from all 4)
      routes/
        commitments.js         # Shared route handler logic
        reveals.js             # Shared route handler logic
        server-info.js         # Shared route handler logic
      types.d.ts               # StorageInterface definition
      index.js                 # Re-exports everything

  pb-node/                     # EXISTING — becomes thin wrapper
    src/
      server.js                # Entry point (unchanged)
      app.js                   # Wires shared routes + SQLite storage
      config.js                # Node-specific defaults

  pb-storage/                  # EXISTING — unchanged (Kysely adapters)

deploy/
  cloudflare/
    src/
      index.js                 # Entry point (unchanged)
      app.js                   # Wires shared routes + D1 storage
      config.js                # CF-specific defaults
      storage/d1.js            # D1 adapter (unchanged)
      wasm/                    # CF-specific WASM bundle

  supabase/
    ...functions/commit-reveal/
      index.ts                 # Entry point (unchanged)
      app.ts                   # Wires shared routes + Postgres storage
      config.ts                # Supabase-specific defaults
      storage/postgres.ts      # Postgres adapter (unchanged)
      wasm/                    # Base64-inlined WASM

  google-cloud/
    src/
      server.js                # Entry point (unchanged)
      app.js                   # Wires shared routes + Firestore storage
      config.js                # GC-specific defaults
      storage/firestore.js     # Firestore adapter (unchanged)
      wasm/                    # Bundled WASM
```

---

## Implementation Plan

### Step 1: Standardize config access across all targets

Make pb-node set `config` on context like the others already do. This eliminates the only diff in route handlers.

**Files changed:** `packages/pb-node/src/app.js` (add `c.set('config', config)` to middleware)

### Step 2: Create `pb-server-core` package

Move these files from `packages/pb-node/src/` into `packages/pb-server-core/src/`:
- `beacon.js`
- `signing.js`
- `routes/commitments.js`
- `routes/reveals.js`
- `routes/server-info.js`

Adjust imports: WASM functions should be injected or imported from a common path.

### Step 3: WASM injection strategy

**Option A — Dependency injection:** Each target passes WASM module to shared functions at init time:
```js
import * as wasm from 'pb-wasm'; // or './wasm/pb_wasm.js'
import { initCore } from 'pb-server-core';
initCore({ wasm });
```

**Option B — Re-export from each target:** Each target has a `wasm.js` that re-exports from whatever source, and shared code imports from a relative path that each target provides.

**Recommendation: Option A** — cleanest, works across all runtimes.

### Step 4: Define StorageInterface type

Formalize the storage contract that all adapters already implement:

```typescript
interface StorageInterface {
  getServerIdentity(): Promise<Keypair | null>;
  setServerIdentity(keypair: Keypair): Promise<void>;
  putCommitment(id: string, commitment: object, registeredAt: string): Promise<void>;
  getCommitment(id: string): Promise<{ commitment: object, registered_at: string } | null>;
  putSelection(hash: string, selection: object, round: number): Promise<void>;
  getSelection(hash: string): Promise<object | null>;
  putReveal(id: string, hash: string, reveal: object, registeredAt: string): Promise<void>;
  getReveals(hash: string): Promise<object[]>;
  getSignerActivity(key: string): Promise<{ commitments_past_hour: number, commitments_past_month: number }>;
  getCachedBeacon(type: string, round: number): Promise<object | null>;
  cacheBeacon(type: string, round: number, output: object): Promise<void>;
  // Optional (not all targets implement):
  putMirror?(id: string, hash: string, mirror: object, registeredAt: string): Promise<void>;
  getMirrors?(hash: string): Promise<object[]>;
  mirrorExists?(hash: string, url: string): Promise<boolean>;
}
```

### Step 5: Rewire each deploy target

Each target's `app.js` becomes a thin composition:
```js
import { createRoutes } from 'pb-server-core';
import { D1Storage } from './storage/d1.js';
import * as wasm from './wasm/pb_wasm.js';

const routes = createRoutes({ wasm });
// ... wire into Hono app with platform storage
```

### Step 6: Delete duplicated files from deploy targets

Remove from each deploy target:
- `beacon.js` (~140 lines × 3 = 420 lines deleted)
- `signing.js` (~56 lines × 3 = 168 lines deleted)
- `routes/commitments.js` (~190 lines × 3 = 570 lines deleted)
- `routes/reveals.js` (~180 lines × 3 = 540 lines deleted)
- `routes/server-info.js` (~24 lines × 3 = 72 lines deleted)

**Total: ~1,770 lines of duplicated code eliminated.**

---

## Risks & Considerations

1. **Supabase is TypeScript** — shared package needs to be JS with `.d.ts` types, or TS compiled to JS. Supabase can import the compiled JS. Alternatively, write shared code in TS and compile for other targets.

2. **Cloudflare bundling** — Workers use `wrangler` which bundles via esbuild. Importing from a workspace package should work fine (`"pb-server-core": "file:../../packages/pb-server-core"`).

3. **Supabase Deno imports** — Supabase Edge Functions run on Deno which uses URL imports or import maps. May need an import map entry for the shared package, or vendor the compiled output.

4. **Mirrors route** — Currently only in pb-node. When shared, make it optional (only mounted if storage implements `putMirror`/`getMirrors`).

5. **Testing** — After refactor, run all existing tests against all targets to verify no regressions. The `pb-node` test suite (with `SERVER_URL` remote mode) can validate any target.

---

## Priority Order

1. **beacon.js** — Highest value, zero risk. Identical everywhere, no platform deps.
2. **signing.js** — High value, trivial diff (just WASM import). Easy win with injection.
3. **routes/server-info.js** — Trivial file, quick win.
4. **routes/commitments.js** — High value (~190 lines each), needs config standardization first.
5. **routes/reveals.js** — High value (~180 lines each), same prerequisites as commitments.
6. **StorageInterface type** — Formalizes what's already implicit. Good to do alongside step 4/5.
