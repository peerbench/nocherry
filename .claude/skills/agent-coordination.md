# Agent Coordination — commit-reveal

> Shared context for multi-agent work in this repository.
> Update this file when you make significant changes, deploy services, or modify infrastructure.

## Repository Structure

```
commit-reveal/
├── packages/
│   ├── pb-core/          # Rust/WASM core (hashing, signing, commitments, drand)
│   ├── pb-node/          # Hono server — commit-reveal protocol node
│   ├── pb-js/            # CLI + JS SDK (@nocherry/sdk)
│   ├── pb-storage/       # Kysely-based storage (SQLite, Postgres adapters)
│   └── pb-demo/          # Interactive web walkthrough (8-step demo)
├── deploy/               # Production deploy configs (cloudflare, google-cloud, supabase)
├── dev-reveal-publishing-helpers/   # Dev/test upload services (NOT core protocol)
│   ├── cloudflare-r2/    # Cloudflare Workers + R2 + D1
│   └── google-cloud-storage/  # Cloud Run + GCS + SQLite
├── pkg/                  # Built WASM output (pb_wasm.js, pb_wasm_bg.wasm)
├── docs/                 # Spec docs (plan-*.md)
└── TODO.md               # Master task list
```

## Deployed Services

### Commit-Reveal Nodes
- Servers configured in `packages/pb-js/src/registry.js`

### Dev Reveal Publishing Helpers

| Service | URL | Platform | Storage |
|---------|-----|----------|---------|
| reveal-r2 | `https://reveal-r2.orgtopus.workers.dev` | Cloudflare Workers | R2 bucket `reveal-data`, D1 database `commit-reveal-db` |
| reveal-gcs | `https://reveal-gcs-323104702830.us-central1.run.app` | Google Cloud Run | GCS bucket `nocherry-reveal-data`, local SQLite |

### Custom Domains (partially configured)
- `publish-cloudflare.dev.nocherry.ai` — CNAME exists but causes SSL error. Needs: delete CNAME, add as Workers Custom Domain in CF dashboard.
- `publish-gcp.dev.nocherry.ai` — SSL cert mismatch. Needs: Cloud Run domain mapping + domain verification in GCP.

## Infrastructure Resources

### Cloudflare
- D1 database: `commit-reveal-db` (ID: `ad020215-1a37-46d7-8bdd-22f7e334a9d4`)
- R2 bucket: `reveal-data`
- Turnstile: using test keys (real keys need `challenges:write` scope or dashboard creation)
  - Site key: `1x00000000000000000000AA`
  - Secret: `1x0000000000000000000000000000000AA`
- Zone for nocherry.ai: `b1ce9706fc511834398c91cf2e1e0779`

### Google Cloud (project: same as OAuth client)
- GCS bucket: `nocherry-reveal-data`
- reCAPTCHA and OAuth credentials: stored in environment variables, not in repo

## Auth System Design

Both publishing helpers support dual authentication:

1. **Bearer token** — `Authorization: Bearer <token>` (obtained via OAuth signup flow)
2. **Ed25519 signature** — `Authorization: Ed25519 <public_key_hex> <unix_ts> <signature_hex>`
   - Signs message `upload:<unix_ts>` with the user's Ed25519 private key
   - Server verifies via WASM `verifySignature()` + checks key is linked to an OAuth user
   - 5-minute timestamp freshness window
   - Returns 403 with `signup_url` if key not yet linked

Flow: User does one-time OAuth signup (captcha + Google sign-in) which links their signing key to their account. After that, CLI uses Ed25519 signatures for all uploads — no token copy/paste needed.

Key files:
- `dev-reveal-publishing-helpers/*/src/middleware/auth.js` — dual auth middleware
- `dev-reveal-publishing-helpers/*/src/routes/auth.js` — OAuth signup/callback routes

## WASM Considerations

The `pkg/` directory contains wasm-bindgen output in CommonJS format. Each helper has its own adapted copy:
- **Cloudflare Workers**: Full ESM conversion in `src/wasm/pb_wasm.js` using `import wasmModule from './pb_wasm_bg.wasm'` + `new WebAssembly.Instance()`
- **Cloud Run (Node.js)**: Original renamed to `pb_wasm.cjs`, ESM wrapper `pb_wasm.js` uses `createRequire()`

If the WASM is rebuilt, both copies need updating.

## D1 Migrations

Located in `dev-reveal-publishing-helpers/cloudflare-r2/migrations/`:
- `0001_init.sql` — commitments, reveals, mirrors tables
- `0002_auth.sql` — users, auth_tokens, user_keys, rate_limits tables

Both have been applied to the live D1 database.

## What's Working
- Both services deployed and responding on their native URLs
- OAuth signup flow (captcha → Google sign-in → token issuance + key linking)
- Bearer token auth for uploads
- Ed25519 signature auth for uploads (pending CLI integration)
- D1/R2 and GCS/SQLite storage

## Known Issues / Pending
- Custom domains have SSL issues (see above)
- Turnstile uses test keys on CF (always passes)
- `pb publish dev` CLI command not yet wired to use Ed25519 auth
- OAuth redirect URI for Workers uses native `.workers.dev` URL (not custom domain)
- reCAPTCHA uses Enterprise key with legacy secret (works but non-standard)

## Conventions
- Package manager: check for lock files (`pnpm-lock.yaml`, `package-lock.json`, etc.)
- Both helpers use Hono framework
- CF helper uses D1 (async API), GCS helper uses better-sqlite3 (sync API)
- WASM functions imported from `../wasm/pb_wasm.js` in both helpers
- All services use `"type": "module"` in package.json
