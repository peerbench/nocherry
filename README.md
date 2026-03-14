# NoCherry -- Anti Data Cherry-Picking Consortium

<p align="center">
  <img src="assets/nocherry_mascot1.png" alt="Just say no to cherry picking data" width="300">
</p>

# Commit-Reveal Protocol

> Hash your data, commit the hashes to a timestamped server, wait for a drand beacon round you couldn't have predicted, and the beacon deterministically picks which items you must reveal. You can't cherry-pick what gets audited.

<p align="center">
  <img src="demo.gif" alt="Terminal demo: key generation, hashing, commitment, verification, and server submission" width="800">
</p>

A standalone commit-reveal protocol that proves three things about data:

1. **Temporal ordering** -- the commitment existed before the randomness that selected it
2. **Integrity** -- revealed data matches committed hashes
3. **Unbiased selection** -- which items are chosen for reveal is determined by external randomness, not the committer

The protocol is domain-agnostic. It deals in opaque SHA-256 hashes. Higher-level systems layer meaning on top.

## Why this exists

When someone holds a private dataset and must reveal a subset to prove something about the whole, they'll cherry-pick the best-looking slice. This protocol makes that impossible — an external beacon nobody controls picks what gets revealed, after the data is already committed.

This matters for [AI benchmarks, standardized test fairness, training data provenance, compliance audits, and more](docs/use-cases.md).

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

### Verification is offline

A receipt is self-contained. Anyone can verify the entire chain — commitment signature, beacon timing, selection correctness, data integrity — without contacting the server.

<details>
<summary>Selection algorithm and verification details</summary>

#### Selection algorithm

Given a beacon output and a commitment, selection is fully deterministic:

- **Per-item selection** (1-20 items): For each item, compute `HMAC-SHA256(beacon_randomness, commitment_hash || item_hash)`. If the result (as a 64-bit integer) is below `floor(probability * 2^64)`, the item is selected.
- **Batch selection** (21+ items): Seed a PRNG with beacon randomness, then run Fisher-Yates shuffle to pick `ceil(count * probability)` items.

Both methods are deterministic -- anyone with the beacon output and commitment can recompute the exact same selection.

#### Verification checks

1. **Commitment signature** -- Ed25519 verify the commitment using the signer's public key
2. **Beacon temporal ordering** -- the drand round timestamp is after `registered_at`
3. **Selection recomputation** -- re-run the selection algorithm, confirm it matches
4. **Reveal signature** -- Ed25519 verify the reveal object
5. **Data integrity** -- SHA-256 hash revealed data, confirm it matches committed hashes
6. **Completeness** -- all randomly-selected items are actually revealed

#### Cryptographic primitives

| Primitive | Usage |
|-----------|-------|
| SHA-256 | File hashing, commitment hashing, HMAC-based PRNG |
| Ed25519 | Commitment and reveal signing, server key management |
| HMAC-SHA256 | Selection PRNG, seeded with beacon randomness |
| BLS12-381 | drand beacon signature verification |
| Canonical JSON | Deterministic serialization for signing payloads |

</details>

All cryptographic operations are implemented once in Rust (`crates/pb-core`) and compiled to WebAssembly for use in browsers and Node.js.

## What you provide

You hash your files locally and only send the hashes -- the server never sees your raw data. The SDK needs two things:

1. **Your data** -- files or bytes to hash (the SDK computes SHA-256 for you via `hashBytes`)
2. **A signing key** -- identifies you and prevents forgery. Generate one with `generateKeypair()` or `pb-js key generate`

Everything else has sensible defaults. Two things you might want to change:

- **Reveal probability** (default: `0.10`) -- what fraction of your items the beacon randomly selects for reveal. `0.10` means ~10%. For 2+ items, at least 1 is always selected. Set higher for more transparency, lower for less.
- **Identity (DID)** -- link your signing key to a verifiable identity (`did:web` or `did:plc`). Without this, your commitment is pseudonymous. With it, the server resolves the DID and confirms the key matches.

### Single-item commitments: coin-flip mode

When you commit a batch of items, the protocol uses a Fisher-Yates shuffle to select exactly `ceil(probability * item_count)` items -- this guarantees at least 1 item is always selected.

But when you commit a single item, the protocol switches to **coin-flip mode**. Each commitment is an independent Bernoulli trial: the beacon randomness is fed into an HMAC along with your commitment, and if the output falls below the probability threshold, the item is selected. At the default 10% probability, there's a 10% chance it's selected and a 90% chance it's not.

If the coin doesn't land, nothing happens -- but you can commit the same data again. Each new commitment gets a different timestamp, which means a different beacon round, which means a fresh coin flip. Over repeated commitments, the probability compounds: after 10 independent commits at 10%, the chance of being selected at least once is ~65%. After 22 commits, it exceeds 90%.

This is useful when you have a single piece of data (like a model or a report) that you want to subject to ongoing random audits. Each commit is cheap, and eventually the beacon will select it.

### Revealing data

Revealing is optional and can happen outside the protocol entirely. You can publish your data anywhere and anyone can verify it against the committed hashes offline -- the receipt is self-contained. If you use the server's reveal endpoint, you can optionally include `file_urls` mapping item hashes to public URLs, and the server will fetch and verify the data matches.

<details>
<summary>Advanced options</summary>

- **Beacon** (default: drand quicknet) -- which public randomness beacon determines selection. You'd only change this to use a different randomness source.
- **Committed at** (default: current time) -- client-side timestamp included in the signed commitment. The server records its own `registered_at` independently, which is what determines beacon timing. This field exists so the same signed commitment can go to multiple servers.
- **Metadata** -- arbitrary JSON stored with the commitment (not signed). Use it for dataset name, version, or description.
- **Stream ID** -- groups related commitments into a sequence, like daily snapshots of the same dataset.

</details>

## Randomness beacon

The protocol uses [drand](https://drand.love) quicknet as its randomness source:

- **Chain**: `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`
- **Period**: 3 seconds
- **Scheme**: BLS-unchained-g1-rfc9380 (BLS12-381, group G1)

The beacon interface is pluggable -- other randomness sources can be added.

## Repository structure

```
├── crates/
│   ├── pb-core/              # Rust: all crypto primitives (zero network I/O)
│   └── pb-cli/               # Rust: native CLI (future)
├── src/
│   └── core/                 # Shared Hono routes, beacon logic, signing, DID resolution
├── packages/
│   ├── pb-wasm/              # WASM bindings for pb-core (@nocherry/core)
│   ├── pb-js/                # JavaScript SDK wrapping WASM (@nocherry/sdk)
│   ├── pb-node/              # HTTP server - Hono, portable (@nocherry/server)
│   ├── pb-storage/           # Storage adapters - SQLite, Postgres, PGlite via Kysely
│   └── pb-demo/              # Interactive 7-step demo web app (@nocherry/demo)
├── deploy/
│   ├── cloudflare/           # Cloudflare Workers + D1 deployment
│   ├── google-cloud/         # Cloud Run + Firestore deployment
│   ├── supabase/             # Supabase Edge Functions + Postgres
│   └── pglite/               # In-process WASM Postgres (dev/testing)
└── docs/                     # Protocol specifications
```

## Quick start

### CLI

```bash
# Generate a signing key
npx pb-js key generate

# Hash a directory, create a commitment, and submit to servers
npx pb-js go ./my-data
```

The `go` command is a guided wizard that walks you through the full flow: hash, commit, submit, wait for beacon, and get your receipt.

### SDK

```js
import { generateKeypair, hashBytes, createCommitment } from '@nocherry/sdk';

// 1. Generate a key (or load an existing one)
const kp = generateKeypair();

// 2. Hash your data
const hashes = files.map(f => hashBytes(f));

// 3. Create a commitment (only items + key required, everything else defaults)
const commitment = createCommitment(
  JSON.stringify({ items: hashes }),
  kp.private_key_hex
);

// 4. Submit to a server
const res = await fetch('https://server.example/v1/commitments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(commitment),
});
const receipt = await res.json();
```

### Interactive demo

```bash
npm install
npm start -w packages/pb-demo
# Open http://localhost:7421
```

Walks through all 7 steps with a live drand beacon ticker, real Ed25519 signing, and server-side receipt generation.

### Run tests

```bash
npx tsx --test packages/pb-node/test/api.test.ts   # Server API tests
npx tsx --test packages/pb-demo/test/walkthrough.test.js  # Demo tests
cargo test                                          # Rust core tests
```

## Deployment

The server runs anywhere Hono runs:

| Target | Storage | Guide |
|--------|---------|-------|
| Node.js | SQLite (better-sqlite3) | `npm start -w packages/pb-node` |
| Cloudflare Workers | D1 (SQLite at edge) | [deploy/cloudflare/](deploy/cloudflare/) |
| Google Cloud Run | Firestore | [deploy/google-cloud/](deploy/google-cloud/) |
| Supabase Edge Functions | Postgres | [deploy/supabase/](deploy/supabase/) |
| PGlite (in-process) | WASM Postgres | [deploy/pglite/](deploy/pglite/) |

## Documentation

- [**Technical Spec v0.4**](docs/nochery-commit-reveal-spec-v0.4.md) -- complete protocol specification: hashing, commitment format, selection algorithms, beacon interface, verification pipeline, HTTP API, test vectors
- [**Use Cases**](docs/use-cases.md) -- AI benchmarks, test fairness, training data provenance, compliance audits

## License

See [LICENSE](LICENSE) for details.
