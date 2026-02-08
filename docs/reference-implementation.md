# Reference Implementation

**Status:** Architecture document
**Repo:** `github.com/peerbench/nocherry` (monorepo)

## 1. Overview

This document describes the reference implementation architecture for the hashing specification and the commit-reveal service specification. Both live in a single monorepo.

The guiding principle: **cryptographic correctness is implemented once in Rust**, then exposed everywhere via WASM and native FFI. HTTP servers, CLI tools, and storage adapters are thin wrappers in the language most natural for each deployment target.

## 2. Monorepo Structure

```
nocherry/
├── crates/
│   ├── pb-core/                  # Rust: all cryptographic primitives
│   │   ├── src/
│   │   │   ├── hash.rs           # SHA-256 file/directory hashing, manifests
│   │   │   ├── canonical.rs      # Canonical JSON serialization
│   │   │   ├── sign.rs           # Ed25519 sign/verify, did:key encode/decode
│   │   │   ├── select.rs         # PRNG, per-item selection, Fisher-Yates
│   │   │   ├── beacon/
│   │   │   │   ├── mod.rs        # Beacon trait
│   │   │   │   ├── drand.rs      # drand quicknet: BLS verify, round↔time
│   │   │   │   └── nist.rs       # NIST Beacon v2.0: RSA verify
│   │   │   ├── commitment.rs     # Commitment object, signing payload construction
│   │   │   ├── reveal.rs         # Reveal object, signing payload construction
│   │   │   ├── verify.rs         # Full verification pipeline (offline)
│   │   │   └── lib.rs
│   │   ├── Cargo.toml
│   │   └── tests/
│   │       └── test_vectors.rs   # Spec test vectors as unit tests
│   │
│   └── pb-cli/                   # Rust: native CLI binary
│       ├── src/
│       │   └── main.rs
│       └── Cargo.toml
│
├── packages/
│   ├── pb-wasm/                  # WASM build of pb-core
│   │   ├── src/
│   │   │   └── lib.rs            # wasm-bindgen exports
│   │   ├── Cargo.toml
│   │   ├── package.json          # npm package: @nocherry/core
│   │   └── build.sh              # wasm-pack build
│   │
│   ├── pb-node/                  # Node.js commit-reveal server (Hono)
│   │   ├── src/
│   │   │   ├── app.ts            # Hono app (portable: Workers/Deno/Node)
│   │   │   ├── routes/
│   │   │   │   ├── commitments.ts
│   │   │   │   ├── selections.ts
│   │   │   │   ├── reveals.ts
│   │   │   │   └── server-info.ts
│   │   │   ├── storage/
│   │   │   │   ├── interface.ts  # Storage adapter interface
│   │   │   │   ├── sqlite.ts     # SQLite adapter (default)
│   │   │   │   └── postgres.ts   # PostgreSQL adapter
│   │   │   ├── beacon.ts         # Reactive beacon fetch + cache
│   │   │   └── config.ts         # Server config (retention, beacon, etc.)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── pb-python/                # Python bindings
│   │   ├── src/
│   │   │   └── nocherry/
│   │   │       ├── __init__.py
│   │   │       ├── _core.pyd     # PyO3 native extension from pb-core
│   │   │       ├── hash.py       # Pythonic API over _core
│   │   │       ├── commit.py     # Pythonic API over _core
│   │   │       └── verify.py     # Pythonic API over _core
│   │   ├── pyproject.toml        # maturin build
│   │   └── tests/
│   │
│   └── pb-js/                    # JS/TS convenience wrapper over WASM
│       ├── src/
│       │   ├── index.ts
│       │   ├── hash.ts           # hash files/directories
│       │   ├── commit.ts         # create & sign commitments
│       │   ├── verify.ts         # offline verification
│       │   └── client.ts         # multi-server submit client
│       ├── package.json          # npm package: @nocherry/sdk
│       └── tsconfig.json
│
├── deploy/
│   ├── cloudflare/               # Cloudflare Workers + D1
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   └── worker.ts         # imports pb-wasm, routes to D1
│   │   └── migrations/
│   │       └── 0001_init.sql
│   │
│   └── supabase/                 # Supabase Edge Functions + Postgres
│       ├── supabase/
│       │   ├── functions/
│       │   │   └── commit-reveal/
│       │   │       └── index.ts
│       │   └── migrations/
│       │       └── 0001_init.sql
│       └── config.toml
│
├── Cargo.toml                    # Workspace root
├── package.json                  # npm workspace root
└── README.md
```

## 3. Rust Core (`pb-core`)

Everything that must be deterministic and correct lives here. This crate has **zero network dependencies** — it is pure computation.

### 3.1 Scope

| Module | Hashing spec | Commit-reveal spec | Notes |
|--------|-------------|-------------------|-------|
| `hash.rs` | ✓ File hashing, streaming | | SHA-256, 64 KiB chunks |
| `canonical.rs` | ✓ Canonical JSON | ✓ Signing payloads | Shared by both specs |
| `sign.rs` | | ✓ Signing | Ed25519, P-256, secp256k1 via `did:key` multicodec |
| `select.rs` | | ✓ PRNG, selection | HMAC-SHA256 Fisher-Yates |
| `beacon/drand.rs` | | ✓ drand verify | BLS12-381 G1 on quicknet |
| `beacon/nist.rs` | | ✓ NIST verify | RSA signature check |
| `commitment.rs` | | ✓ Commitment objects | Signing payload construction |
| `reveal.rs` | | ✓ Reveal objects | Signing payload construction |
| `verify.rs` | ✓ Hash data vs manifest | ✓ Full chain verify | Offline verification pipeline |

### 3.2 Dependencies

```toml
[dependencies]
sha2 = "0.10"           # SHA-256
hmac = "0.12"            # HMAC-SHA256 PRNG
ed25519-dalek = "2"      # Ed25519 sign/verify
p256 = "0.13"            # NIST P-256 sign/verify
k256 = "0.13"            # secp256k1 sign/verify
bs58 = "0.5"             # did:key base58btc encoding
blst = "0.3"             # BLS12-381 for drand verification
serde = "1"              # JSON serialization
serde_json = "1"         # JSON serialization
```

The `did:key` multicodec prefix determines which curve to use:
- `0xed01` → Ed25519 (default, recommended)
- `0x1200` → P-256
- `0xe701` → secp256k1

No async runtime. No HTTP client. No filesystem (hash.rs takes `Read` trait, not file paths). This keeps it compilable to WASM without wasi.

### 3.3 WASM Constraints

The crate is designed to compile cleanly to `wasm32-unknown-unknown`:

- No `std::fs`, no `std::net` — all I/O via trait parameters
- `hash.rs` takes `impl Read`, caller provides the bytes
- `blst` has WASM support via `portable` feature
- `ed25519-dalek` compiles to WASM natively
- All randomness comes from function parameters (beacon output), never from OS

### 3.4 Public API Surface

```rust
// ── Hashing ──
pub fn hash_bytes(data: &[u8]) -> Hash;
pub fn hash_reader(reader: impl Read) -> Result<Hash>;
pub fn manifest_from_entries(entries: &[ManifestEntry]) -> Vec<u8>;  // canonical JSON bytes
pub fn hash_manifest(entries: &[ManifestEntry]) -> Hash;

// ── Canonical JSON ──
pub fn canonical_json(value: &impl Serialize) -> Vec<u8>;

// ── Ed25519 / did:key ──
pub fn generate_keypair() -> (SigningKey, VerifyingKey);
pub fn did_key_encode(pubkey: &VerifyingKey) -> String;
pub fn did_key_decode(did: &str) -> Result<VerifyingKey>;
pub fn sign(key: &SigningKey, message: &[u8]) -> Signature;
pub fn verify(did: &str, message: &[u8], sig: &Signature) -> Result<()>;

// ── Selection ──
pub fn prng_next(seed: &[u8; 32], index: u64) -> u64;
pub fn select_per_item(
    beacon_randomness: &[u8; 32],
    commitment_hash: &str,
    item_hash: &str,
    reveal_probability: f64,
) -> bool;
pub fn select_batch(
    items: &[Hash],
    beacon_randomness: &[u8; 32],
    count: usize,
) -> Vec<Hash>;

// ── Beacon verification ──
pub fn verify_drand(chain_hash: &[u8], round: u64, signature: &[u8]) -> Result<[u8; 32]>;
pub fn verify_nist(pulse: &NistPulse) -> Result<[u8; 32]>;

// ── Commitment / Reveal ──
pub fn commitment_signing_payload(commitment: &Commitment) -> Vec<u8>;
pub fn reveal_signing_payload(reveal: &Reveal) -> Vec<u8>;

// ── Full verification ──
pub fn verify_commitment(commitment: &Commitment) -> Result<()>;
pub fn verify_receipt(receipt: &Receipt) -> Result<()>;
pub fn verify_selection(commitment: &Commitment, beacon: &BeaconOutput) -> SelectionRecord;
pub fn verify_reveal(
    commitment: &Commitment,
    selection: &SelectionRecord,
    reveal: &Reveal,
    data: &[(Hash, &[u8])],
) -> VerifyResult;
```

## 4. WASM Package (`pb-wasm`)

Built with `wasm-pack`. Published as `@nocherry/core` on npm.

```rust
// src/lib.rs — wasm-bindgen exports
// Thin wrappers that convert between JS types and pb-core types

#[wasm_bindgen]
pub fn hash_bytes(data: &[u8]) -> String { ... }

#[wasm_bindgen]
pub fn select_per_item(
    beacon_randomness: &[u8],
    commitment_hash: &str,
    item_hash: &str,
    reveal_probability: f64,
) -> bool { ... }

#[wasm_bindgen]
pub fn verify_commitment(commitment_json: &str) -> JsValue { ... }

// ... etc
```

Target size: <500 KiB gzipped. The `blst` BLS library is the largest dependency (~200 KiB WASM).

## 5. Python Bindings (`pb-python`)

Built with PyO3 + maturin. Published as `nocherry` on PyPI.

```python
import nocherry

# Hashing
h = nocherry.hash_file("case_001.json")
manifest = nocherry.hash_directory("my-benchmark/")

# Commitment
key = nocherry.generate_keypair()
commitment = nocherry.create_commitment(
    items=[h1, h2, h3],
    reveal_probability=0.10,
    beacon={"type": "drand", "chain_hash": "52db9ba..."},
    signing_key=key,
)

# Multi-server submit
receipts = nocherry.submit(commitment)  # submits to all known servers

# Verification
result = nocherry.verify_directory("my-reveal/")
```

The Python package wraps PyO3-compiled `pb-core`. All crypto happens in Rust. The Python layer adds filesystem access (walking directories, reading files) and the HTTP client for server submission.

## 6. CLI (`pb-cli`)

Native Rust binary. Installed via `cargo install pb-cli` or prebuilt binaries.

### 6.1 Key Management

Private keys are stored as plaintext JSON at `~/.nocherry/key.json`:

```json
{
  "did": "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP",
  "private_key": "base58-encoded-private-key",
  "algorithm": "Ed25519",
  "created_at": "2026-02-06T14:30:00Z"
}
```

Key resolution order:
1. `PB_SIGNING_KEY` environment variable (hex-encoded private key) — for CI/scripts
2. `~/.nocherry/key.json` — for interactive use

This is not a wallet. The key proves authorship of commitments, not control of funds. Plaintext is fine.

### 6.2 Commands

```bash
# ── Hashing ──
pb hash file case_001.json
pb hash dir my-benchmark/

# ── Key management ──
pb key generate                     # prints did:key + saves to ~/.nocherry/key
pb key show                         # prints did:key

# ── Commit ──
pb commit my-benchmark/ \
  --probability 0.10 \
  --beacon drand
# → hashes all files
# → creates commitment
# → submits to all known servers
# → saves receipts to .commit-reveal/receipts/

# ── Reveal ──
pb reveal my-benchmark/ \
  --commitment .commit-reveal/commitment.json
# → checks which items are selected
# → copies selected items to reveal directory
# → creates reveal object
# → saves everything to .commit-reveal/

# ── Verify (offline) ──
pb verify my-reveal/
# → reads .commit-reveal/ directory
# → verifies full chain: signatures, beacon, selection, hashes
# → prints report

# ── Server management ──
pb servers list                     # show known servers + status
pb servers add https://my-server.example.com
```

## 7. Node.js Server (`pb-node`)

The commit-reveal HTTP server. Built with **Hono** — runs natively on Cloudflare Workers, Deno, and Node.js without adapters. Calls `@nocherry/core` (WASM) for all crypto. Delegates storage to a pluggable adapter.

### 7.1 Full-Echo Receipts

The server response to `POST /v1/commitments` echoes back the **entire commitment** plus the server's attestation, all server-signed. This makes the receipt fully self-contained:

```json
{
  "commitment": {
    "spec_version": "0.2.0",
    "items": ["a1b2c3d4..."],
    "item_count": 1,
    "reveal_probability": 0.10,
    "beacon": { "type": "drand", "chain_hash": "52db9ba..." },
    "committed_at": "2026-02-06T14:30:00Z",
    "signing_key": "did:key:z6Mkf5r...",
    "signature": "user-signature..."
  },
  "commitment_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "registered_at": "2026-02-06T14:30:00.500Z",
  "signer_activity": {
    "commitments_past_hour": 3,
    "commitments_past_month": 47
  },
  "server_key": "did:key:z6Mkq...",
  "server_signature": "server-signature..."
}
```

The `server_signature` covers the entire JSON above (minus `server_signature` itself). Anyone with this file can:
1. Verify the user's commitment signature (user's `did:key` is in the receipt)
2. Verify the server's attestation of timing and activity (server's `did:key` is in the receipt)
3. No network access needed — both public keys are encoded in the `did:key` identifiers

### 7.2 Storage Interface

```typescript
interface Storage {
  // Commitments
  putCommitment(id: string, commitment: Commitment, registeredAt: Date): Promise<void>;
  getCommitment(id: string): Promise<Commitment | null>;

  // Selections
  putSelection(commitmentId: string, selection: SelectionRecord): Promise<void>;
  getSelection(commitmentId: string): Promise<SelectionRecord | null>;

  // Reveals
  putReveal(commitmentId: string, reveal: Reveal): Promise<void>;
  getReveals(commitmentId: string): Promise<Reveal[]>;

  // Anti-spam
  countCommitmentsByKey(signingKey: string, since: Date): Promise<number>;

  // Retention
  deleteOlderThan(cutoff: Date): Promise<number>;
}
```

### 7.3 SQLite Adapter (Default)

```sql
CREATE TABLE commitments (
  id TEXT PRIMARY KEY,
  signing_key TEXT NOT NULL,
  body JSON NOT NULL,
  registered_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_commitments_signing_key ON commitments(signing_key);
CREATE INDEX idx_commitments_registered_at ON commitments(registered_at);

CREATE TABLE selections (
  commitment_hash TEXT PRIMARY KEY REFERENCES commitments(id),
  beacon_round INTEGER,
  body JSON NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE reveals (
  id TEXT PRIMARY KEY,
  commitment_hash TEXT NOT NULL REFERENCES commitments(id),
  body JSON NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE INDEX idx_reveals_commitment_hash ON reveals(commitment_hash);
```

### 7.4 PostgreSQL Adapter

Same schema, with:
- `JSONB` instead of `JSON`
- `TIMESTAMPTZ` instead of `TEXT` for timestamps
- `GIN` index on `commitments.body` for flexible querying

### 7.5 Beacon Fetching (Synchronous)

The server has no background processes. Every request is fully synchronous — a serverless function that starts, does its work, and returns.

```
GET /v1/commitments/{id}/selection

  1. Look up commitment from storage
  2. Check if selection already cached → return it
  3. Compute needed beacon round: first round after registered_at
  4. HTTP GET to drand relay (or NIST API) for that round (~100ms)
  5. Compute selection via pb-core WASM (~1ms)
  6. Cache the selection record in storage
  7. Return selection record
```

That's it. No polling loop, no background workers, no pending queue. The drand fetch is a single HTTP call inside the request handler. For drand quicknet, the round is available within 3 seconds of `registered_at`, so the client just needs to wait a few seconds after committing before asking for the selection.

If the beacon round hasn't occurred yet (client asked too early), the server holds the connection until it's available — a simple sleep-and-retry against the drand relay, bounded by the beacon period.

The beacon response is cached by `(beacon_type, round_number)` since beacon outputs are immutable. Subsequent requests for the same or different commitments that need the same round hit the cache.

### 7.6 Retention Cleanup

A background job runs periodically (default: daily):

```
delete from commitments where registered_at < now() - retention_period
cascade to selections, reveals
```

### 7.7 Server Identity

On first startup, the server generates an Ed25519 keypair and stores it. The `did:key` is served at `GET /v1/server-info` and used to sign all responses.

```json
// GET /v1/server-info
{
  "operator": "ETH Zürich",
  "server_key": "did:key:z6Mkq...",
  "retention": "30d",
  "signer_activity_windows": ["1h", "30d"],
  "beacon_types": ["drand"],
  "spec_version": "0.2.0"
}
```

## 8. Deployment Targets

The server is designed to run on free-tier cloud platforms. Each deployment target has a dedicated adapter in `deploy/`.

### 8.1 Cloudflare Workers + D1

```
deploy/cloudflare/
├── wrangler.toml           # D1 database binding, WASM import
├── src/worker.ts           # Same Hono app as pb-node, D1 storage adapter
└── migrations/0001_init.sql
```

- **Compute:** Cloudflare Workers (free: 100k req/day)
- **Storage:** D1 (SQLite at edge, free: 5 GB)
- **WASM:** imported directly into the Worker
- **Beacon fetching:** reactive (on-demand), cached in D1 or KV

### 8.2 Supabase Edge Functions + Postgres

```
deploy/supabase/
├── supabase/functions/commit-reveal/index.ts
├── supabase/migrations/0001_init.sql
└── config.toml
```

- **Compute:** Deno-based Edge Functions (free: 500k invocations/month)
- **Storage:** Supabase Postgres (free: 500 MB)
- **WASM:** loaded in Deno runtime
- **Beacon fetching:** reactive (on-demand), cached in Postgres

### 8.3 Standalone (Docker / Bare Metal)

```bash
docker run -p 3000:3000 \
  -e RETENTION=30d \
  -e BEACON=drand \
  -v ./data:/data \
  ghcr.io/peerbench/commit-reveal-server
```

Uses SQLite by default (`/data/commit-reveal.db`). Set `DATABASE_URL=postgres://...` for Postgres.

## 9. Package Matrix

| Package | Language | Published to | Contains |
|---------|----------|-------------|----------|
| `pb-core` | Rust | crates.io | All crypto, hashing, selection, verification |
| `pb-cli` | Rust | crates.io + GitHub releases | CLI binary |
| `@nocherry/core` | WASM | npm | pb-core compiled to WASM |
| `@nocherry/sdk` | TypeScript | npm | JS wrapper: hashing, commit, verify, multi-server client |
| `nocherry` | Python | PyPI | PyO3 wrapper: hashing, commit, verify |
| `@nocherry/server` | TypeScript | npm | Commit-reveal HTTP server |

## 10. Build & Test

```bash
# Rust core: test against spec test vectors
cargo test -p pb-core

# WASM: build + test
cd packages/pb-wasm && wasm-pack build --target web && wasm-pack test --node

# Python: build + test
cd packages/pb-python && maturin develop && pytest

# JS SDK: test (uses WASM under the hood)
cd packages/pb-js && npm test

# Server: integration tests (starts server, submits commitments, verifies)
cd packages/pb-node && npm test

# Cross-language: run spec test vectors through all implementations
./scripts/cross-test.sh
```

### 10.1 `cross-test.sh`

This script is critical: it runs the spec's test vectors (Section 10 of commit-reveal spec, Section 5 of hashing spec) through **every** language binding and confirms identical outputs. If any implementation diverges, the build fails. This is the single source of truth for correctness.

```bash
#!/bin/bash
set -euo pipefail

echo "=== Rust ==="
cargo test -p pb-core -- test_vectors

echo "=== WASM/Node ==="
node packages/pb-js/test/vectors.test.js

echo "=== Python ==="
python -m pytest packages/pb-python/tests/test_vectors.py

echo "=== All implementations agree ==="
```

## 11. Development Priorities

### Phase 1: Core + CLI
1. `pb-core` — implement all modules, pass test vectors
2. `pb-cli` — hash, commit, verify commands
3. Ship as Rust-only; earliest usable tool

### Phase 2: WASM + Server
4. `pb-wasm` — wasm-pack build, npm publish
5. `pb-node` — HTTP server with SQLite adapter
6. Standalone Docker deployment

### Phase 3: Bindings + Deployment
7. `pb-python` — PyO3 bindings
8. `@nocherry/sdk` — JS convenience wrapper
9. Cloudflare Workers deployment adapter
10. Supabase deployment adapter

### Phase 4: Hardening
11. PostgreSQL adapter + migration tooling
12. `cross-test.sh` in CI
13. Prebuilt CLI binaries (GitHub Actions → releases)
14. Documentation site
