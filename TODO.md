# Session Log & TODO

## Completed (2026-02-06)

### Live drand Beacon Ticker (Step 4)
- Replaced static form POST with live-streaming drand beacon ticker
- Inline vanilla JS polls drand quicknet every 2s, shows rounds in real-time
- Async fetch submit — selection round gets highlighted in ticker
- Added `POST /steps/4/api` JSON endpoint for JS-driven submit
- Kept `POST /steps/4/` form fallback for no-JS browsers
- All tests pass (11 pb-node + 8 walkthrough + 4 Playwright)

### Storage Refactor Compatibility Fix
- Another agent extracted `storage/sqlite.js` → `packages/pb-storage/` (Kysely-based)
- Fixed demo app imports to use new `pb-storage/sqlite` package
- Made `createDemoApp()` async, added `initServerKey()` call
- Fixed walkthrough test `before()` hook

### Remote Mode for Demo
- Another agent added `--remote <url>` flag and `SERVER_URL` env var
- Demo can now run against a remote pb-node server (e.g., Cloudflare deployment)

### README
- Wrote comprehensive README with protocol explanation, architecture, quick start
- ASCII sequence diagram showing full commit-reveal flow
- Links to all three spec docs

### Terminal Demo GIF
- Created VHS tape file (`demo.tape`) for reproducible terminal recording
- Shows full CLI flow: keygen → hash → commit → verify → servers → submit
- 2.5MB GIF with Catppuccin Mocha theme, embedded in README

### Git
- Rebased onto origin/main, resolved `.gitignore` conflict
- Pushed to remote

---

## TODO

### Spec Alignment (nochery-commit-reveal-spec-v0.4.md) — Completed 2026-02-08

Issues found during full code audit against the unified spec.

- [x] ~~CLI: Hidden file exclusion~~ — spec updated to match code (exclude all dotfiles)
- [x] ~~CLI: `cmdReveal` auto-voluntaries all items~~ — fixed, now uses `voluntary_items: []`
- [x] ~~Proof bundle layout in spec~~ — removed prescriptive directory layout from spec
- [x] ~~Web demo vs CLI voluntary items mismatch~~ — fixed by #2 above

---

### Deploy & Test Publishing Helper Auth (DO FIRST)

- [ ] **Deploy auth updates to both publishing helpers**
  - **Cloudflare R2:** run `wrangler d1 migrations apply` for `0002_auth.sql`, set secrets (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`), then `wrangler deploy`
  - **Google Cloud Storage:** `npm install` (picks up `better-sqlite3`), rebuild Docker image, set env vars (`RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `DB_PATH`), `gcloud run deploy`
  - Pre-requisites: create Turnstile site in Cloudflare dashboard, create reCAPTCHA v3 site in Google console, create Google OAuth client (redirect URIs pointing to each service's `/auth/callback`)
- [ ] **Human: end-to-end test publish through reCAPTCHA/Turnstile auth flow**
  - **Cloudflare R2:** `https://reveal-r2.orgtopus.workers.dev/auth/signup`
  - **Google Cloud Storage:** `https://reveal-gcs-323104702830.us-central1.run.app/auth/signup`
  - Walk through: visit `/auth/signup`, complete captcha, sign in with Google, copy bearer token, use token to `POST /v1/upload`, confirm 201 success. Also verify: upload without token returns 401, signing key is linked to user in DB, rate limiting works per-user.

### CLI Protocol File Trail

- [ ] **Every CLI step should save a local file** — see [docs/plan-cli-file-trail.md](docs/plan-cli-file-trail.md)
  - `pb hash dir` → `manifest.json`
  - `pb commit <dir>` → `commitment.json`
  - `pb submit <dir>` → `server-receipts.json` (multi-server directory mode)
  - `pb reveal <dir>` → `reveal.json` + `reveal-receipts.json` (new command)
  - `pb publish github <dir>` → copies all protocol files to repo + generates human-readable README with evidence tables
  - Protocol files excluded from `walkDir()` hashing to prevent recursive inclusion
  - Status messages on stderr, parseable JSON on stdout

### CLI Verification & Hardening

- [ ] **Human: manually verify CLI end-to-end** — run `pb key generate`, hash, commit, submit, verify on real data and confirm everything feels right
- [ ] **AI: stress-test large file hashing** — verify that `pb hash file` works on large files (100MB+, 1GB+), check memory usage (should stream in 64KiB chunks per spec, verify the WASM implementation actually does this)
- [ ] **AI: stress-test deeply nested directory hashing** — create a test with 100+ subdirectories, each with deeply nested structures (5-10 levels), verify that `pb hash dir` produces a single reproducible hash per top-level folder. Test that identical directory trees on different machines produce identical hashes. Edge cases: empty directories, symlinks, hidden files (.gitkeep), unicode filenames
- [ ] **AI: test large item counts** — commit with 1000+ items, verify selection algorithm (batch mode kicks in at ≥20 items), confirm receipt is correct and verifiable

### Data Mirrors

- [x] **Mirrors API** — `POST/GET /v1/commitments/:hash/mirrors` for registering & querying data URLs
- [x] **Mirror registration in CLI** — `pb publish github` auto-registers mirror URLs with servers
- [x] **`pb mirrors add/list`** — Manual mirror registration and querying
- [x] **Web demo Step 7** — "Publish & Register Mirrors" step added (verify renumbered to Step 8)

### Publication Verification (Server-Side Attestation)

- [x] **`POST /v1/commitments/:hash/verify-publication`** — Server fetches published data from URLs, hashes it, confirms it matches committed item hashes, returns a signed attestation
  - Request: `{ file_urls: { "<item_hash>": "<raw_url>", ... } }`
  - Server fetches each URL, SHA-256 hashes the content, compares to committed hashes
  - Response: signed attestation with per-item match/mismatch/fetch_error results
  - This is the "we have seen the data publicly and it matches" proof
  - Anyone holding this signed attestation can prove: (1) the data was committed before randomness, (2) the server independently verified the published data matches
- [x] **CLI integration** — `pb publish github` automatically calls verify-publication after push, prints signed attestation
- [x] **E2E test** — Full cycle: generate data → commit → submit → drand selection → reveal → publish → register mirror → verify-publication → assert signed attestation with all hashes matching (6 tests: full cycle, tampered data, unreachable URLs, unknown commitment, empty urls, unknown hashes)

### CLI Data Upload Commands

- [ ] **Move Hugging Face integrations to peerbench repo** — HuggingFace is too AI-specific for this general-purpose commit-reveal repo. Move `pb publish huggingface`, HF auth detection, and HF dataset creation to the peerbench repo. Keep only GitHub and generic providers here.

- [x] **`pb publish github <dir>`** — Upload revealed data to GitHub
  - Check if user has `gh` CLI authenticated
  - Create a default repo (e.g., `peerbench-reveals`) if none specified
  - Push revealed data into a timestamped folder (e.g., `reveals/2026-02-06-<hash>/`)
  - If user doesn't specify a dataset, all future reveals go into this one repo
  - Link the reveal back to the commitment hash
  - Generate a verification script in the repo that anyone can run

- [x] **`pb publish huggingface <dir>`** — Upload revealed data to Hugging Face
  - Detect if user has HF SSH key configured (`~/.ssh` key linked to HF account)
  - Or check for `huggingface-cli` / `HF_TOKEN` env var
  - Create a dataset repo on HF (e.g., `<username>/peerbench-reveals`)
  - Push data as a HF dataset with proper README/metadata card
  - Same default-repo behavior as GitHub

- [ ] **`pb publish ipfs <dir>`** — Upload to IPFS (stretch goal)
  - Pin data, return CID
  - CID is deterministic from content, natural fit for hash verification

- [x] **`pb publish` (no target)** — Interactive: detect available providers and let user choose
  - Priority order: github (if `gh` authenticated) > dev reveal helpers (if available) > prompt user

### Dev Reveal Publishing Helpers

> **Important design decision:** Commit-reveal server operators do NOT need to provide long-term storage. The commit-reveal nodes only store commitments, receipts, and metadata. Actual data publication is the user's responsibility (GitHub, IPFS, etc.). These "dev reveal publishing helpers" are **our test infrastructure** — separate services we run to test the end-to-end flow. They are NOT part of the core protocol and should NOT be bundled into pb-node.

- [ ] **Create `dev-reveal-publishing-helpers/` directory** — Completely separate from `packages/` and `deploy/`
  - These are throwaway dev/test services, not core protocol infrastructure
  - Two implementations: Cloudflare R2 and Google Cloud Storage
  - Each is a standalone deployable service with its own `package.json`

- [ ] **`dev-reveal-publishing-helpers/cloudflare-r2/`** — Reveal data storage on Cloudflare R2
  - Hono server (same pattern as everything else, runs on Workers)
  - Cloudflare R2 for blob storage (free tier: 10GB storage, 10M reads/month, 1M writes/month)
  - Endpoints:
    - `POST /v1/upload` — accepts data + receipt, re-verifies everything, stores to R2
    - `GET /v1/data/:commitment-hash/*` — serves stored files from R2
    - `GET /health` — health check including R2 bucket accessibility
  - Server-side re-verification before accepting:
    - Re-verify commitment signature, server signature, beacon signature
    - Re-hash uploaded data, confirm matches committed hashes
    - Verify reveal pattern (completeness check)
  - Anti-spam (basic, since this is dev infra):
    - Size limit: 50MB per upload
    - Rate limit: 20 uploads/hour per signing key
    - Require valid receipt from a known commit-reveal server
  - Returns clean URLs: `https://<worker>.workers.dev/v1/data/<commitment-hash>/result-01.json`

- [ ] **`dev-reveal-publishing-helpers/google-cloud-storage/`** — Reveal data storage on GCS
  - Express or Hono server deployed to Cloud Run
  - Google Cloud Storage Standard tier (free tier: 5GB, then cheapest available)
  - Same endpoints and verification logic as Cloudflare version
  - Billing resilience (built-in):
    - Catch `BillingDisabled` / `AccountProblem` errors from GCS
    - Uploads: return 503 with message "Storage temporarily unavailable"
    - Reads: return 503 with suggestion to try other mirrors
    - Log billing errors to alerting (email/Slack webhook) so you know to fix it
    - Auto-retry with exponential backoff for transient GCS errors
    - Health check probes GCS bucket access — CLI can skip this helper if unhealthy
    - Budget alerts at $5, $10, $20 thresholds
  - Config: `GCS_BUCKET`, `GCS_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`

- [ ] **`servers.json` updates** — Add a separate section for reveal publishing helpers
  - Current structure: `servers` array for commit-reveal nodes
  - New: `reveal_publishers` array for data upload services
  - Each entry: `{ name, url, environment, storage_backend, max_upload_mb, accepts_reveals: true }`
  - CLI `pb publish` checks `reveal_publishers` for available upload targets
  - Clear separation: commit-reveal servers vs. reveal publishing helpers
  - Example:
    ```json
    {
      "servers": [ ... ],
      "reveal_publishers": [
        { "name": "dev-r2", "url": "https://...", "environment": "dev", "storage_backend": "cloudflare-r2" },
        { "name": "dev-gcs", "url": "https://...", "environment": "dev", "storage_backend": "gcs" }
      ]
    }
    ```

- [ ] **`pb publish dev <dir>`** — CLI command to upload to dev reveal publishing helpers
  - Tries available `reveal_publishers` from `servers.json`
  - Falls back gracefully if none are healthy
  - Auto-registers resulting URLs as mirrors on the commit-reveal server

### Verification & Trust

- [ ] **`pb verify-receipt <receipt.json>`** — Full offline verification of a server receipt
  - Currently `pb verify` only checks commitment signature
  - Need to also verify: server signature, beacon signature (BLS), selection recomputation, temporal ordering
  - This is the "anyone can verify" promise — it needs to work without network access
  - Should output a clear pass/fail for each of the 6 checks

- [ ] **`pb verify-reveal <reveal.json> <data-dir>`** — Verify that revealed data matches committed hashes
  - Hash the local data directory
  - Compare against committed item hashes
  - Confirm all selected items are present (completeness check)

- [ ] **BLS beacon verification in JS** — The WASM crate has `verify_drand()` but unclear if it's exposed through the JS CLI yet. Need to verify and wire up.

### Multi-Server Trust

- [ ] **`pb submit --multi`** — Submit same commitment to multiple servers simultaneously
  - Spec mentions multi-server trust model
  - Collect receipts from N servers, cross-check beacon rounds
  - Stronger guarantee: harder for a single malicious server to fake timing

- [ ] **Server discovery** — `pb servers add <url>` to register new servers
  - Currently hardcoded registry in `registry.js`
  - Should be able to add community servers

### Developer Experience

- [ ] **`npx pb-js`** — Make the CLI installable and runnable without cloning the repo
  - Publish `@peerbench/sdk` to npm
  - Ensure WASM binary is bundled correctly in the npm package

- [ ] **Python SDK** — PyO3 bindings for pb-core
  - Spec mentions this, Rust crate is ready
  - `pip install peerbench` → same API as JS SDK
  - Important for ML/data science users who work in Python

- [ ] **Programmatic JS API** — `packages/pb-js/src/index.js` exists but may be incomplete
  - `import { commit, verify, hash } from '@peerbench/sdk'`
  - Should be usable from Node.js scripts without the CLI

### Production Readiness

- [ ] **Retention & cleanup** — Server should prune old commitments (spec says configurable, default 1 month)
- [ ] **Rate limiting** — Spec says no rejection based on activity, but basic DoS protection needed
- [ ] **HTTPS enforcement** — Server should refuse to run without TLS in production
- [ ] **Monitoring** — Health check endpoint exists, but need metrics (commitments/hour, beacon latency, etc.)
- [ ] **Backup/export** — Export all commitments from a server instance for migration

### Documentation

- [ ] **Tutorial: "Commit your first benchmark"** — Step-by-step guide for a data scientist
- [ ] **Tutorial: "Run your own server"** — Self-hosting guide
- [ ] **API reference** — OpenAPI/Swagger spec for the HTTP API
- [ ] **Security model writeup** — Threat model, what the protocol does/doesn't protect against

### Demo Videos

#### CLI Terminal Demo (GIF for README)
- [x] **VHS tape file created** — `demo.tape` renders `demo.gif` (2.5MB, Catppuccin Mocha theme)
- [x] **Basic flow recorded** — keygen → hash → commit → verify → servers → submit
- [ ] **Re-record after CLI hardening** — once large-file hashing, deep directories, and `pb publish` are implemented, re-run `vhs demo.tape` to capture the fuller workflow
- [ ] **Add `pb verify-receipt` to tape** — show the full 6-check offline verification once implemented
- [ ] **Add `pb publish github` to tape** — show the reveal upload flow once implemented
- [ ] **Trim GIF size** — currently 2.5MB, could optimize with `--quality` flag or fewer frames. GitHub recommends <5MB for README GIFs.

#### Web Demo Video (Screen Recording)
- [ ] **Record manually** (not Playwright — needs human pacing, cursor movement, narration potential)
- [ ] **Pre-requisite: multi-node demo complete** — wait for the multi-server version to be finished so the video shows the full vision
- [ ] **Script the walkthrough** — plan what to show before recording:
  1. Landing page with protocol overview
  2. Step 1-3: keygen, hashing, commitment creation (show the crypto happening client-side)
  3. Step 4: live drand beacon ticker streaming rounds, click submit, watch selection round get highlighted with green glow
  4. Step 5-6: selection result, reveal creation
  5. Step 7: all 6 verification checks passing
  6. (Multi-node) show the same commitment going to multiple servers
- [ ] **Tool: QuickTime** (macOS built-in) or OBS for recording, iMovie/FFmpeg for editing
- [ ] **Format: MP4 for YouTube/Twitter, GIF/WebM snippet for README** — full video hosted externally, 10-15s highlight GIF in README
- [ ] **Resolution: 1280x720 or 1920x1080** — make sure browser zoom is set so text is readable at small embed sizes

### Unify CLI `pb go` and Web Demo Flows

The CLI wizard (`pb go <dir>`) and the web demo (`pb-demo`) implement the same commit-reveal protocol but have diverged in step ordering, data sources, selection logic, publishing strategy, and verification. They should share a single protocol engine so fixes and features land in one place.

#### Step ordering differs

| # | CLI (`pb go`) | Web Demo |
|---|--------------|----------|
| 1 | Hash directory → `manifest.json` | Generate Ed25519 keypair |
| 2 | Sign commitment → `commitment.json` | Hash data (random or custom) |
| 3 | Submit to servers → `server-receipts.json` | Sign commitment |
| 4 | Publish (GitHub + publish server) | Submit to servers |
| 5 | Reveal → `reveal.json` + `reveal-receipts.json` | View beacon selection |
| — | *(no explicit selection step)* | Publish to embedded/remote servers |
| — | *(no verification step)* | Submit reveal |
| — | — | Run 6-check offline verification |

**Key differences:**
- CLI: 5 steps. Demo: 8 steps. Demo splits selection into its own visible step and adds verification.
- CLI generates key automatically or loads from `~/.peerbench/key.json`. Demo generates per-session ephemeral key as an explicit step.
- CLI publishes *before* reveal (GitHub is required, publish server is best-effort). Demo also publishes before reveal but only to embedded/publish servers (no GitHub).
- CLI has no offline verification step in the wizard — it saves files for later `pb verify`.

#### Data model differs

- **CLI**: Hashes a real directory of files. `manifest.json` contains `{ path, hash }` entries. Items submitted are file-level SHA-256 hashes.
- **Demo**: Hashes arbitrary text strings (random benchmark-style lines or user input). No manifest file. Items are plain text hashed in-memory.
- **CLI**: Saves every artifact to disk (`manifest.json`, `commitment.json`, `server-receipts.json`, `receipt.json`, `publication.json`, `reveal.json`, `reveal-receipts.json`).
- **Demo**: Stores everything in HTTP session state. No files persisted.

#### Selection logic differs

- **CLI**: Reads `selected_items` directly from the first server receipt. No client-side selection recomputation.
- **Demo**: Recomputes selection client-side using `wasm.selectPerItem()` against the beacon output from each server, then takes the union across all servers. This is more correct (cross-server union) but the CLI doesn't do it.

#### Beacon configuration differs

- **CLI**: Uses `{ type: 'drand', chain_hash: '<quicknet_hash>' }` (explicit chain hash).
- **Demo**: Uses `{ type: 'drand-quicknet', schedule: 'after_deadline' }` (shorthand).
- These may be functionally equivalent but the field names differ, which could cause interop issues.

#### Publishing strategy differs

- **CLI**: Primary publish target is GitHub (`cmdPublishGithub()`), with publish server upload as best-effort secondary. Registers mirrors, runs server-side `verify-publication`. Saves `publication.json` with file URLs. Pushes reveal files back to GitHub after reveal.
- **Demo**: Publishes only to embedded in-memory server (no persistent storage) or remote R2/GCS publish servers. Registers mirrors with embedded commit-reveal server. No GitHub integration, no `verify-publication` call.

#### Reveal differs

- **CLI**: Includes `file_urls` (from `publication.json`) in the reveal submission so servers can fetch and verify data.
- **Demo**: Also includes `file_urls` from session but they're localhost URLs (only reachable by embedded server).

#### Verification differs

- **CLI**: No verification step in the wizard. Users must run `pb verify <commitment.json>` separately, which only checks commitment signature (not the full 6-check suite).
- **Demo**: Step 8 runs all 6 offline verification checks: commitment signature, beacon temporal ordering, selection recomputation, reveal signature, data integrity, completeness.

#### Plan to unify

- [ ] **Extract shared protocol engine** — Create `packages/pb-protocol/` (or add to `pb-js/src/protocol.js`) with pure functions for each step:
  - `createManifest(items)` — hash items into a manifest (works for both files and strings)
  - `createAndSignCommitment(itemHashes, probability, keypair, beaconConfig)` — sign commitment
  - `submitToServers(commitment, servers)` — submit and collect receipts
  - `computeSelection(receipts, commitment)` — client-side selection recomputation (union across servers)
  - `createAndSignReveal(commitment, selectedItems, keypair, fileUrls)` — sign reveal
  - `submitReveal(reveal, commitmentHash, servers)` — submit reveal to servers
  - `verifyAll(commitment, receipt, reveal, itemData)` — run all 6 verification checks
- [ ] **Standardize beacon config** — Pick one format (`drand-quicknet` shorthand or explicit `chain_hash`). Make `wasm.createCommitment()` accept both, normalize internally.
- [ ] **Add selection recomputation to CLI** — CLI currently trusts the server's `selected_items`. Should recompute client-side and compare, matching what the demo does.
- [ ] **Add verification step to CLI `go` wizard** — After reveal, run the same 6-check verification the demo does. Print pass/fail for each.
- [ ] **Add GitHub publish to demo** (optional, stretch) — If user has `gh` token, offer GitHub as a publish target alongside embedded server.
- [ ] **Unify receipt handling** — CLI saves `receipt.json` (single server) + `server-receipts.json` (multi-server wrapper). Demo keeps receipts in session as array. Standardize on the multi-server format everywhere.

### Demo Website Improvements

- [ ] **Multi-node demo** — Show commits going to multiple servers (in progress by another agent)

---

## Architecture Questions to Decide

1. **Default reveal repo structure** — When user does `pb publish github`, what's the folder layout? Suggestion: `reveals/<commitment-hash-prefix>/` with `receipt.json`, `data/`, and `verify.sh`

2. **Offline-first or server-first?** — The CLI currently requires a server for submission. Should there be a fully offline mode where you commit locally and submit later? The spec supports this (commitment is signed client-side, server just timestamps it).

3. **Key management** — Currently one key per machine in `~/.peerbench/key.json`. Should there be support for multiple keys, key rotation, or hardware key storage (e.g., YubiKey)?

4. **Reveal granularity** — The spec supports partial reveals (only selected items). The CLI's `pb publish` should respect this — only upload selected items, not the full dataset. But the user might want to voluntarily reveal everything. Need a `--all` flag?

5. **Git integration depth** — Should `pb commit` be able to read from a git repo directly? Hash the working tree, create commitment, and tag the commit? This would make the workflow: `git commit` → `pb commit .` → `pb submit` → `pb publish github`.

---

## Out of Scope (belongs in peerbench repo, not here)

> The nocherry commit-reveal system is a **general-purpose** protocol for provable commitments with unbiased selection. It is not AI-specific. The peerbench CLI will use nocherry as a dependency and extend it with domain-specific integrations. These items belong there, not here.

### HuggingFace Integration
- **`pb publish huggingface <dir>`** — Too AI/ML-specific for this repo
  - Detect if user has HF SSH key configured or `huggingface-cli` / `HF_TOKEN`
  - Create dataset repo on HF (`<username>/peerbench-reveals`)
  - Push data as HF dataset with README/metadata card
  - This makes sense in peerbench where users are committing benchmark results, not in a generic commit-reveal protocol

### `pb publish peerbench-shared-huggingface`
- **PeerBench-hosted reveal storage backed by HuggingFace** — AI-specific infrastructure
  - Our HF account (`peerbench/reveals`) as the storage backend
  - Users send data + receipt, we re-verify and store in HF dataset repo
  - Organized by commitment hash, one folder per reveal
  - Auto-generate dataset card with commitment metadata
  - This is a peerbench service, not a nocherry service

### Python SDK
- **PyO3 bindings for pb-core** — Important for ML/data science users
  - `pip install peerbench` → same API as JS SDK
  - The Rust crate is ready for bindings, but the Python audience is peerbench's, not nocherry's

---

## TypeScript Migration

> **Pre-requisite: comprehensive test coverage.** Before touching any JS→TS conversion, the existing JavaScript codebase needs thorough test coverage so the migration can be validated mechanically. Write the tests first, then migrate file-by-file with tests green the whole way.

### Phase 1: Test Coverage (do this FIRST)

- [ ] **pb-node API tests** — Current: 16 tests. Need full coverage of:
  - All error paths (malformed JSON, missing fields, invalid signatures, duplicate commits)
  - Beacon timeout / retry behavior
  - Server info endpoint
  - Concurrent commits race conditions
  - All mirrors + verify-publication edge cases
- [ ] **pb-js CLI tests** — Current: 9 tests. Need full coverage of:
  - Every command's happy path with file output verification
  - Error handling (missing key, bad file paths, unreachable servers, invalid JSON)
  - `pb submit` single-file mode vs directory mode
  - `pb publish github` full flow (mock `gh` CLI)
  - `pb mirrors add/list` with mock server
  - `pb verify` with tampered commitments
  - Key generation idempotency, PB_SIGNING_KEY env var
- [ ] **pb-storage tests** — Currently: 0 dedicated tests. Need:
  - All CRUD operations for commitments, reveals, mirrors
  - Schema migration (fresh DB creation)
  - Edge cases: duplicate inserts, missing records, concurrent writes
- [ ] **pb-demo walkthrough tests** — Current: 9 tests. Need:
  - Each step's error states (e.g., skip to step 4 without step 3)
  - Session isolation (two concurrent users don't interfere)
  - All 8 steps with full data verification
- [ ] **E2E integration tests** — Current: 6 tests. Need:
  - Multi-server submission with receipt cross-validation
  - Full CLI file trail (manifest → commitment → receipts → reveal → publication)
  - Offline verification of every artifact
- [ ] **Deploy target tests** — Currently: 0. Need at minimum:
  - Cloudflare D1 storage adapter unit tests
  - Google Firestore storage adapter unit tests
  - Supabase Postgres storage adapter unit tests

### Phase 2: TypeScript Migration

- [ ] **Set up TypeScript infrastructure**
  - Add `tsconfig.json` to each package (pb-node, pb-js, pb-storage, pb-demo)
  - Configure `strict: true`, `noUncheckedIndexedAccess: true`
  - Add build step (`tsc`) to each package
  - Keep `.js` entry points that import compiled `.ts` during transition
- [ ] **Migrate pb-storage first** — Smallest package, fewest dependencies, most benefit from types
  - `types.js` → `types.ts` (already has JSDoc typedefs, convert to interfaces)
  - `storage.js` → `storage.ts`
  - `sqlite.js` → `sqlite.ts`
  - `postgres.js` → `postgres.ts`
- [ ] **Migrate pb-node** — Server routes benefit heavily from typed request/response
  - `app.js` → `app.ts`
  - `routes/commitments.js` → `routes/commitments.ts`
  - `routes/reveals.js` → `routes/reveals.ts`
  - `routes/mirrors.js` → `routes/mirrors.ts`
  - `signing.js` → `signing.ts`
  - `beacon.js` → `beacon.ts`
- [ ] **Migrate pb-js** — CLI + SDK
  - `cli.js` → `cli.ts`
  - `registry.js` → `registry.ts`
  - `index.js` → `index.ts`
- [ ] **Migrate pb-demo** — Last, lowest priority
  - Template and route files
- [ ] **Migrate deploy targets** — Cloudflare, Google Cloud, Supabase
- [ ] **Type pb-wasm bindings** — Add `.d.ts` for the WASM module so all consumers get type safety
- [ ] **Remove JSDoc type annotations** — Once TypeScript types are in place, clean up redundant JSDoc `@typedef` blocks

---

## Later

### Cold Storage for Reveals
- **Google Cloud Storage archival tier** for long-term proof storage
  - Coldline: ~$0.004/GB/month, retrieval ~$0.01/GB
  - Archive: ~$0.0012/GB/month, retrieval ~$0.05/GB
  - Lifecycle policy: Standard → Coldline after 30 days → Archive after 90 days
  - Billing resilience: catch `BillingDisabled` errors, degrade gracefully, alert via webhook
  - Budget alerts at $5, $10, $20 thresholds
  - Reverse proxy in front (don't expose GCS URLs directly) so backend is swappable
  - Only worth building once there's meaningful volume of reveals to store long-term
