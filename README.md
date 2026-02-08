# Commit-Reveal Protocol

> Hash your data, commit the hashes to a timestamped server, wait for a drand beacon round you couldn't have predicted, and the beacon deterministically picks which items you must reveal. You can't cherry-pick what gets audited.

<p align="center">
  <img src="demo.gif" alt="Terminal demo: key generation, hashing, commitment, verification, and server submission" width="800">
</p>

A standalone commit-reveal protocol that proves three things about data:

1. **Temporal ordering** -- the commitment existed before the randomness that selected it
2. **Integrity** -- revealed data matches committed hashes
3. **Unbiased selection** -- which items are chosen for reveal is determined by external randomness, not the committer

The protocol is domain-agnostic. It deals in opaque SHA-256 hashes. Higher-level systems (like benchmark verification) layer meaning on top.

## How the protocol works

```
 User                          Server                      drand beacon
  │                              │                              │
  │  1. Hash data locally        │                              │
  │     (SHA-256 per item)       │                              │
  │                              │                              │
  │  2. Create commitment        │                              │
  │     (bundle hashes +         │                              │
  │      sign with Ed25519)      │                              │
  │                              │                              │
  │  3. Submit ─────────────────>│                              │
  │                              │  4. Record timestamp         │
  │                              │  5. Wait for next round ────>│
  │                              │<──── beacon randomness ──────│
  │                              │  6. Compute selection        │
  │                              │     (deterministic from      │
  │                              │      beacon + commitment)    │
  │<──── signed receipt ─────────│                              │
  │                              │                              │
  │  7. Reveal selected items ──>│                              │
  │                              │                              │
  │         Anyone can verify the entire chain offline          │
```

### The key insight

The commitment is recorded *before* the beacon round that determines selection. The beacon randomness is unpredictable (BLS threshold signatures from a distributed network). This means the committer cannot know which items will be selected when they commit, preventing cherry-picking.

### Selection algorithm

Given a beacon output and a commitment, selection is fully deterministic:

- **Per-item selection** (1-20 items): For each item, compute `HMAC-SHA256(beacon_randomness, commitment_hash || item_hash)`. If the result (as a 64-bit integer) is below `floor(probability * 2^64)`, the item is selected.
- **Batch selection** (21+ items): Seed a PRNG with beacon randomness, then run Fisher-Yates shuffle to pick `ceil(count * probability)` items.

Both methods are deterministic -- anyone with the beacon output and commitment can recompute the exact same selection.

### Verification (offline)

A receipt is self-contained. Verification requires no network access and runs six checks:

1. **Commitment signature** -- Ed25519 verify the commitment using the signer's public key
2. **Beacon temporal ordering** -- the drand round timestamp is after `registered_at`
3. **Selection recomputation** -- re-run the selection algorithm, confirm it matches
4. **Reveal signature** -- Ed25519 verify the reveal object
5. **Data integrity** -- SHA-256 hash revealed data, confirm it matches committed hashes
6. **Completeness** -- all randomly-selected items are actually revealed

## Cryptographic primitives

| Primitive | Usage |
|-----------|-------|
| SHA-256 | File hashing, commitment hashing, HMAC-based PRNG |
| Ed25519 | Commitment and reveal signing, server key management |
| HMAC-SHA256 | Selection PRNG, seeded with beacon randomness |
| BLS12-381 | drand beacon signature verification |
| Canonical JSON | Deterministic serialization for signing payloads |

All cryptographic operations are implemented once in Rust (`crates/pb-core`) and compiled to WebAssembly for use in browsers and Node.js.

## Randomness beacon

The protocol uses [drand](https://drand.love) quicknet as its randomness source:

- **Chain**: `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`
- **Period**: 3 seconds
- **Scheme**: BLS-unchained-g1-rfc9380 (BLS12-381, group G1)

The beacon interface is pluggable -- the spec also defines support for the NIST Randomness Beacon v2.0.

## Repository structure

```
├── crates/
│   ├── pb-core/              # Rust: all crypto primitives (zero network I/O)
│   └── pb-cli/               # Rust: native CLI (future)
├── packages/
│   ├── pb-wasm/              # WASM bindings for pb-core (@nocherry/core)
│   ├── pb-js/                # JavaScript SDK wrapping WASM (@nocherry/sdk)
│   ├── pb-node/              # HTTP server - Hono, portable (@nocherry/server)
│   ├── pb-storage/           # Storage adapters - SQLite & Postgres via Kysely
│   └── pb-demo/              # Interactive 7-step demo web app (@nocherry/demo)
├── deploy/
│   ├── cloudflare/           # Cloudflare Workers + D1 deployment
│   └── supabase/             # Supabase Edge Functions + Postgres
└── docs/                     # Protocol specifications
```

### Architecture principle

**Cryptographic correctness is implemented once in Rust**, then exposed everywhere:

- **WASM** -- browsers, Node.js, Cloudflare Workers, Deno
- **Native** -- CLI tools, Python bindings (via PyO3)
- **HTTP servers** -- thin wrappers in JavaScript using Hono (runs on Node.js, Workers, and Deno with the same code)

## Quick start

### Run the interactive demo

```bash
npm install
npm start -w packages/pb-demo
# Open http://localhost:7421
```

The demo walks through all 7 steps of the protocol with a live drand beacon ticker, real Ed25519 signing, and actual server-side receipt generation.

### Run the server standalone

```bash
npm start -w packages/pb-node
# Server at http://localhost:3000
```

### Run tests

```bash
# Server API tests (11 tests)
node --test packages/pb-node/test/api.test.js

# Demo walkthrough tests (8 tests)
node --test packages/pb-demo/test/walkthrough.test.js

# Browser tests (4 tests, requires Playwright)
npx playwright test --config packages/pb-demo/playwright.config.js

# Rust core tests
cargo test
```

### Build WASM from source

```bash
# Requires wasm-pack: cargo install wasm-pack
wasm-pack build packages/pb-wasm --target web --out-dir ../../pkg
```

## HTTP API

### `POST /v1/commitments`

Submit a signed commitment. Returns a receipt with beacon output and selection.

### `GET /v1/commitments/:hash`

Retrieve a stored commitment by its hash.

### `POST /v1/commitments/:hash/reveals`

Submit a reveal for a previously committed set of items.

### `GET /v1/server-info`

Server metadata: public key, supported beacon types, version.

### `GET /health`

Health check.

See the [full specification](docs/nochery-commit-reveal-spec-v0.4.md) for request/response schemas.

## Deployment

The server runs anywhere Hono runs:

| Target | Storage | Guide |
|--------|---------|-------|
| Node.js | SQLite (better-sqlite3) | `npm start -w packages/pb-node` |
| Cloudflare Workers | D1 (SQLite at edge) | [deploy/cloudflare/](deploy/cloudflare/) |
| Supabase Edge Functions | Postgres | [deploy/supabase/](deploy/supabase/) |

## Specifications

| Document | Description |
|----------|-------------|
| [**Unified Spec**](docs/nochery-commit-reveal-spec-v0.4.md) | Complete protocol specification (v0.4) -- hashing, commitment format, selection algorithms, beacon interface, verification pipeline, HTTP API, test vectors |
| [Reference Implementation](docs/reference-implementation.md) | Architecture document -- monorepo structure, Rust-once philosophy, storage adapters, deployment patterns |

<details>
<summary>Superseded specs (kept for history)</summary>

| Document | Description |
|----------|-------------|
| [Commit-Reveal Spec v0.2](docs/commit-reveal-spec.md) | Original protocol spec (superseded by unified spec) |
| [Hashing Spec v0.3](docs/hashing-spec.md) | Original hashing spec (superseded by unified spec) |

</details>

## Design priorities

1. **Standalone** -- runs independently; no dependency on external nodes, identity systems, or benchmark registries
2. **Verifiable offline** -- given the commitment, beacon output, and revealed data, anyone can verify without contacting the service
3. **Simple** -- one hash algorithm (SHA-256), one signature scheme (Ed25519), pluggable randomness sources
4. **Composable** -- can be embedded in other systems or run as a separate microservice

## License

See [LICENSE](LICENSE) for details.
