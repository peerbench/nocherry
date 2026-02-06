# Commit-Reveal Service Specification

**Version:** 0.2.0-draft
**Status:** Draft for review

## 1. Overview

This specification defines a standalone commit-reveal service. A user commits to one or more hashes. The service records each commitment and, using the next output from an external randomness beacon, deterministically decides which committed items are **selected for reveal**. The user then reveals the actual data behind selected items.

The service proves three things:

1. **Temporal ordering** — the commitment existed before the randomness that selected it
2. **Integrity** — revealed data matches committed hashes
3. **Unbiased selection** — the items chosen for reveal are determined by external randomness, not the committer

The service is domain-agnostic. It deals in opaque SHA-256 hashes. Higher-level systems (e.g. PeerBench) layer meaning on top.

### 1.1 Design Priorities

1. **Standalone** — runs independently; no dependency on PeerBench nodes, identity systems, or benchmark registries
2. **Verifiable offline** — given the commitment, randomness beacon output, and revealed data, anyone can verify without contacting the service
3. **Simple** — one hash algorithm (SHA-256), one signature scheme (Ed25519), pluggable randomness sources
4. **Composable** — can be embedded in PeerBench nodes or run as a separate microservice
5. **Streaming-friendly** — supports both batch commits (many items at once) and single-item commits (one at a time, as work is produced)

### 1.2 Terminology

- **Item** — an opaque unit identified by a SHA-256 hash. Could be a file, a test case, a JSON object — the service doesn't care.
- **Commitment** — a signed declaration that one or more item hashes exist.
- **Beacon** — an external randomness source (drand, NIST Randomness Beacon, etc.).
- **Selection** — the deterministic process of deciding which items must be revealed, seeded by beacon randomness.
- **Reveal probability** — the probability (0, 1] that any given item is selected for reveal.
- **Voluntary reveal** — revealing items beyond the random selection, at the committer's discretion.

## 2. Modes of Operation

The service supports two commit modes. Both use the same selection and verification logic.

### 2.1 Batch Mode

The user commits a list of item hashes in a single request, with a reveal probability. The next beacon output after the commitment determines which items are selected.

Use case: a benchmark author has 500 test cases ready and commits them all at once.

### 2.2 Stream Mode

The user commits items one at a time (or in small batches), each under a shared **stream ID**. Each commit is individually timestamped. A beacon output covers all items committed before it.

Use case: a researcher creates test cases over weeks, committing each one as it's written. They don't need to wait until the full dataset is ready.

Stream mode is sugar over batch mode — it's equivalent to many single-item commits grouped under a stream ID, with selection applied per-beacon-period.

## 3. Commitment

### 3.1 Commitment Object

```json
{
  "spec_version": "0.2.0",
  "commitment_hash": "e4d7f1b2...",
  "stream_id": null,
  "items": [
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
  ],
  "item_count": 1,
  "reveal_probability": 0.10,
  "beacon": {
    "type": "drand",
    "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
  },
  "metadata": {},
  "committed_at": "2026-02-06T14:30:00Z",
  "signing_key": "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP",
  "signature": "ef567890..."
}
```

Fields:

- **`spec_version`** (string): version of this specification.
- **`commitment_hash`** (string): `SHA-256(signing_payload)`, lowercase hex (64 chars). Computed by the client before submission. Deterministic: the same commitment always produces the same hash, on every server, on every machine. This is the canonical identifier for the commitment across all servers. Not part of the signed payload (it is derived from it).
- **`stream_id`** (string | null): groups related commits in stream mode. `null` for standalone batch commits. Assigned by the service on first commit in a stream; provided by the user on subsequent commits. Not part of the signed payload.
- **`items`** (array of strings): SHA-256 hashes (lowercase hex, 64 chars). At least 1 item. No duplicates. For single-item commits, this is a one-element array.
- **`item_count`** (integer): length of `items`.
- **`reveal_probability`** (number): the probability that any given item is selected for reveal. Range: (0.0, 1.0]. For example, 0.10 means ~10% of items will be selected. See Section 4 for how this is applied.
- **`beacon`** (object): identifies the randomness source. See Section 5.
- **`metadata`** (object): arbitrary key-value data. Stored but not interpreted by the service. Not signed.
- **`committed_at`** (string): ISO 8601 UTC timestamp, set by the committer.
- **`signing_key`** (string): public key as `did:key`. Used to verify the signature.
- **`signature`** (string): signature, lowercase hex.

### 3.2 Signing and Commitment Hash

The signature covers the **signing payload** — canonical JSON of the commitment with these fields removed: `commitment_hash`, `stream_id`, `metadata`, `signature`.

```
signing_payload = canonical_json({
  "spec_version": "...",
  "items": [...],
  "item_count": ...,
  "reveal_probability": ...,
  "beacon": {...},
  "committed_at": "...",
  "signing_key": "..."
})

signature = Sign(private_key, signing_payload)
commitment_hash = SHA-256(signing_payload)    // lowercase hex, 64 chars
```

The `commitment_hash` is derived from the same bytes that are signed. The client computes both before submission. The server verifies the signature AND checks that the provided `commitment_hash` matches `SHA-256(signing_payload)` — rejecting the request if they disagree.

Canonical JSON rules:

1. No whitespace
2. Object keys in the order listed above
3. Strings use minimal JSON escaping (RFC 8259)
4. UTF-8 encoding

### 3.3 Commitment Immutability

Once submitted, a commitment is immutable. All signed fields are frozen. The `metadata` field can be updated (since it is not signed). Items cannot be added to or removed from an existing commitment — create a new commitment instead.

## 4. Selection Algorithm

The selection algorithm determines which committed items must be revealed. It runs after the service receives the next beacon output following a commitment.

### 4.1 Selection Trigger

The service waits for the **first beacon output whose timestamp is strictly after the commitment's `registered_at` time** (the server-side timestamp, not `committed_at`). This ensures the committer could not have known the randomness when they committed.

```
beacon_output = first beacon where beacon.timestamp > commitment.registered_at
```

### 4.2 Why HMAC-SHA256 instead of a standard library?

Built-in PRNGs (`Math.random()` in JS, `random.shuffle()` in Python) use different algorithms internally (xorshift128+ vs. Mersenne Twister) and cannot produce identical outputs across languages from the same seed.

The closest standard is **HMAC_DRBG** from NIST SP 800-90A — a standardized CSPRNG built on HMAC. Our construction is a simplified variant of its generate phase: `HMAC-SHA256(seed, counter)` is the core operation, but we skip the instantiation ceremony (deriving initial K/V state), reseeding, and prediction resistance tracking that HMAC_DRBG requires for long-lived generators. We don't need any of that — we seed once with a beacon output and draw a small number of values.

The result is 5 lines of code per language, uses only HMAC-SHA256 (which every crypto library provides), and is fully specified with no hidden implementation details. The Python and JavaScript reference implementations produce bit-identical outputs for all test vectors.

### 4.3 Per-Item Selection (Single Item or Small Batches)

For a commitment with `reveal_probability` p and a single item:

```
decision_input = HMAC-SHA256(
  key  = beacon_randomness,          // 32 bytes from the beacon
  msg  = commitment_hash || item_hash  // concatenation of hex strings, UTF-8 encoded
)

threshold = floor(p × 2^64)
value     = le_uint64(decision_input[0..7])

selected  = (value < threshold)
```

The item is selected if the HMAC-derived value falls below the probability threshold. This is a simple Bernoulli trial seeded by the beacon.

For commitments with multiple items, this is applied independently to each item:

```
for each item_hash in commitment.items:
  decision_input = HMAC-SHA256(key=beacon_randomness, msg=commitment_hash || item_hash)
  value = le_uint64(decision_input[0..7])
  if value < threshold:
    item is selected
```

### 4.4 Batch Selection (Exact Count)

When a user commits a large batch and wants **exactly** N items selected (rather than a probabilistic number), the service uses a seeded Fisher-Yates shuffle:

```
count = ceil(reveal_probability × item_count)
```

Then apply the shuffle:

```
Input:
  items[]           — committed item hashes, in committed order
  beacon_randomness — 32 bytes from the beacon
  count             — number of items to select

Algorithm:
  1. pool = copy of items[]
  2. seed = beacon_randomness
  3. For i = 0 to count - 1:
     a. range = len(pool) - i
     b. j = i + (prng_next(seed, i) mod range)
     c. Swap pool[i] and pool[j]
  4. Return pool[0..count-1]
```

Where `prng_next` is:

```
prng_next(seed, index):
  mac = HMAC-SHA256(key=seed, message=uint64_le(index))
  return le_uint64(mac[0..7])
```

### 4.5 Which Mode to Use

| Scenario | Selection mode | Rationale |
|----------|---------------|-----------|
| Single item commit | Per-item (4.3) | Bernoulli trial: selected or not |
| Stream of single items | Per-item (4.3) on each | Each item independently tested |
| Batch of 2-20 items | Per-item (4.3) | Probabilistic count is fine for small sets |
| Batch of 20+ items | Batch (4.4) | Exact count via shuffle is more predictable |

The `selection_mode` is recorded in the selection record (Section 4.7) so verifiers know which algorithm was used. The service chooses the mode based on `item_count`; the threshold of 20 is a default that can be configured per-deployment.

### 4.6 Stream Mode Selection

In stream mode, the service accumulates commits under a `stream_id`. Selection happens at regular intervals driven by the beacon:

1. At each beacon output, the service collects all **unprocessed** commits in the stream (those registered since the last beacon output)
2. Per-item selection (4.2) is applied to each new item, using the beacon output and each item's own `commitment_hash || item_hash`
3. Results are recorded in a selection record tied to that beacon round

This means a stream gets one selection record per beacon period that contained new commits.

### 4.7 Selection Record

After the beacon fires and selection runs, the service produces:

```json
{
  "commitment_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "beacon_output": {
    "type": "drand",
    "chain_hash": "52db9ba70e...",
    "round": 35200000,
    "randomness": "abc123...64hex...",
    "signature": "def456..."
  },
  "selection_mode": "per_item",
  "reveal_probability": 0.10,
  "selected_items": [
    "b2c3d4e5f6a1..."
  ],
  "selected_count": 1,
  "total_count": 1,
  "computed_at": "2026-02-06T14:30:03Z",
  "server_key": "did:key:z6Mkq...",
  "server_signature": "..."
}
```

This record is deterministic — anyone with the commitment and beacon output can recompute it. The server signature provides a convenience attestation, but verification does not depend on it.

## 5. Randomness Beacons

The service supports multiple randomness beacon types. The commitment's `beacon` field pins it to a specific source.

### 5.1 Beacon Interface

Every beacon type must provide:

- **Identification** — a type string and chain/source identifier
- **Temporal ordering** — beacon outputs have timestamps or round numbers that establish "after" relationships
- **Randomness** — a 32-byte output that is unpredictable before it's published
- **Verifiability** — anyone can verify the beacon output is authentic without trusting the commit-reveal service

### 5.2 drand (League of Entropy)

```json
{
  "type": "drand",
  "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
}
```

**Chain: quicknet**

| Parameter | Value |
|-----------|-------|
| Chain hash | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| Period | 3 seconds |
| Genesis time | `1692803367` (Unix, 2023-08-23) |
| Scheme | `bls-unchained-g1-rfc9380` |
| Signature group | G1 on BLS12-381 |

Round-to-time mapping:
```
round_time(round) = genesis_time + (round - 1) × period
time_to_round(unix_time) = floor((unix_time - genesis_time) / period) + 1
```

Beacon output:
```
randomness = SHA-256(signature)   // for quicknet unchained mode
```

Public relays:
- `https://api.drand.sh/<chain_hash>/public/<round>`
- `https://drand.cloudflare.com/<chain_hash>/public/<round>`

Verification (stateless for unchained):
```
message = SHA-256(uint64_be(round))
valid = BLS_Verify(chain_public_key, message, beacon_signature)
randomness = SHA-256(beacon_signature)
```

**Latency:** 3 seconds. A single-item commit waits at most 3 seconds for selection.

### 5.3 NIST Randomness Beacon

```json
{
  "type": "nist",
  "version": "2.0"
}
```

**NIST Interoperable Randomness Beacon (IRB), Version 2.0**

| Parameter | Value |
|-----------|-------|
| Period | 60 seconds |
| Output | 512-bit random value |
| Signature | RSA / PKI-signed pulse records |
| API | `https://beacon.nist.gov/beacon/2.0/pulse/last` |

For this service, use first 32 bytes of the `outputValue` as the randomness seed.

Verification: verify the pulse's RSA signature against the NIST beacon's published certificate chain.

**Latency:** 60 seconds. Suitable for batch commits where a minute wait is acceptable.

### 5.4 Adding New Beacon Types

New beacon types can be added by implementing the beacon interface (Section 5.1). The `beacon.type` string must be registered in the service configuration. Commitments are permanently bound to their beacon type — the same commitment cannot be evaluated against a different beacon.

### 5.5 Beacon Liveness

If a beacon experiences downtime, selection is deferred until it resumes. The protocol is correct regardless of beacon latency — the invariant is only that the beacon output postdates the commitment.

If a beacon is permanently retired, existing commitments bound to it remain valid as long as historical outputs are archived. The service SHOULD maintain a cache of beacon outputs for all commitments it has processed.

## 6. Reveal

A reveal publishes the actual data behind selected item hashes. Reveals can happen anywhere — GitHub, a personal website, IPFS, or registered with this service.

### 6.1 What Must Be Revealed

Items that appear in the selection record's `selected_items` are expected to be revealed. This is a social/protocol expectation, not something the service can force. The selection is public — anyone can see what *should* have been revealed.

### 6.2 Voluntary Reveals

The committer may reveal **any** items they choose, beyond the random selection. Voluntary reveals are valuable for transparency and peer review but carry less anti-cherry-picking assurance than randomly selected reveals.

A reveal object indicates which items were randomly selected vs. voluntarily revealed.

### 6.3 Reveal Object

```json
{
  "spec_version": "0.2.0",
  "commitment_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "selected_items": [
    "b2c3d4e5f6a1..."
  ],
  "voluntary_items": [
    "a1b2c3d4e5f6..."
  ],
  "data_url": "https://github.com/myorg/benchmark-reveal",
  "revealed_at": "2026-02-07T10:00:00Z",
  "signing_key": "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP",
  "signature": "..."
}
```

- **`selected_items`** (array): items from the selection record that are being revealed. Subset of or equal to the selection record's `selected_items`.
- **`voluntary_items`** (array): additional items the committer chooses to reveal. Must be hashes from the original commitment's `items` and not in `selected_items`.
- **`data_url`** (string | null): where the actual data for revealed items can be found. A git repo URL, a static file server, an IPFS gateway, etc. Informational — the commit-reveal server does not fetch this.
- **`signing_key`**: need not match the commitment's key. Anyone with the data can create a reveal.
- **`signature`**: over all fields except `signature`.

### 6.4 Reveal Verification

Given: commitment, selection record, reveal object, and actual data for each revealed item.

1. **Verify commitment signature.** Ed25519 verify against signing payload (Section 3.2).

2. **Verify beacon.** Confirm the beacon output in the selection record is authentic (BLS verify for drand, RSA verify for NIST, etc.) and that its timestamp/round is after `commitment.registered_at`.

3. **Verify selection.** Re-run the selection algorithm (Section 4) with the commitment's items and the beacon's randomness. Confirm the selection record's `selected_items` matches.

4. **Verify reveal signature.** Ed25519 verify the reveal object.

5. **Verify data integrity.** For each item in `selected_items` ∪ `voluntary_items`: hash the provided data with SHA-256 and confirm it matches.

6. **Check completeness.** Note which items from the selection record are present in the reveal's `selected_items` vs. missing. Missing items weaken trust.

Steps 1-5 can be performed entirely offline. Commit-reveal servers do **not** perform this verification — they only store reveal metadata. Verification is done by the end user via CLI tooling, or optionally by a separate verification service (see Section 9).

### 6.5 Where Reveal Data Lives

The service stores the reveal object (metadata) but NOT the actual item data. Data can live anywhere. The only requirement is that verifiers can obtain the data for each revealed item and hash it.

## 7. Server Trust Model and Discovery

### 7.1 What a Server Does

A commit-reveal server is a **timestamped receipt printer**. It accepts commitments, records when it received them, waits for beacon outputs, computes selections, and stores reveals. That's it.

Each server has an Ed25519 keypair identified as a `did:key`. The server signs every response — commitment receipts, selection records — with this key. These signed responses are **self-contained proofs**: once the user has them, the server can go offline, delete its data, or cease to exist, and the proofs remain independently verifiable.

A server cannot forge commitments (they're signed by the committer), cannot influence selection (that's determined by the beacon), and cannot fabricate beacon outputs (those are independently verifiable). The server's only trusted role is providing a `registered_at` timestamp — and even that is anchored by the beacon round, limiting backdating to at most one beacon period (~3s for drand).

### 7.2 Trust Properties

The protocol's trust guarantees come from two properties:

1. **Multiple servers make censorship hard.** The client submits to all known servers in parallel. A commitment is valid if *any* server records it. To censor a commitment, every server would need to collude in refusing it.

2. **Server operators have public reputation at stake.** Servers are run by institutions (universities, infrastructure companies, research organizations) whose names are attached to every receipt they issue. Misbehavior — backdating, selective censorship, downtime — is detectable and reputationally costly.

A commitment recorded on server A is exactly as valid as one on server B. Servers don't need to agree with each other, synchronize state, or maintain a shared log. Each operates independently.

### 7.3 Server Discovery

The client maintains a list of known servers. The list comes from two sources:

1. **Hardcoded fallback.** The client ships with a default list of well-known servers, similar to DNS root servers or drand relay endpoints. This list is updated with client releases.

2. **Fetchable list.** A JSON document at a well-known URL (e.g. `https://commit-reveal.peerbench.ai/servers.json`) provides the current server list. The client fetches this on startup and caches it. The document is signed so it can be verified even if served through a CDN.

```json
{
  "version": 1,
  "updated_at": "2026-02-01T00:00:00Z",
  "servers": [
    {
      "url": "https://cr.ethz.ch",
      "operator": "ETH Zürich",
      "server_key": "did:key:z6Mkq...",
      "retention": "30d",
      "contact": "peerbench@ethz.ch"
    },
    {
      "url": "https://cr.cloudflare.com",
      "operator": "Cloudflare",
      "server_key": "did:key:z6Mkr...",
      "retention": "30d",
      "contact": "peerbench@cloudflare.com"
    },
    {
      "url": "https://commit-reveal.peerbench.ai",
      "operator": "PeerBench",
      "server_key": "did:key:z6Mks...",
      "retention": "forever",
      "contact": "ops@peerbench.ai"
    }
  ],
  "signature": "..."
}
```

Each server has its own Ed25519 signing key, used to sign responses (including `signer_activity` counts and `registered_at` timestamps). The server's public key is published in the server list and at `GET /v1/server-info` on the server itself.

### 7.4 Multi-Submit

The client submits every commitment to **all known servers in parallel**. Every server receives the same `commitment_hash`. Each server independently records `registered_at`.

```
Client                    Server A          Server B          Server C
  |---POST /v1/commit--->|                  |                  |
  |---POST /v1/commit--->|----------------->|                  |
  |---POST /v1/commit--->|----------------->|----------------->|
  |<--201 {hash, reg_a}--|                  |                  |
  |<--201 {hash, reg_b}--|------------------|                  |
  |<--201 {hash, reg_c}--|------------------|------------------|
```

Same `commitment_hash` in every receipt. The client stores all receipts. For later operations (get selection, submit reveal), the client can use any server. If a server goes down, the commitment is still recorded elsewhere.

A commitment is considered successfully registered if at least one server accepts it. The client SHOULD warn if fewer than 2 servers respond.

### 7.5 Commitment Identity Across Servers

The `commitment_hash` is deterministic — computed from the signing payload by the client before submission. Every server receives the same `commitment_hash` for the same commitment. This is the canonical identifier everywhere: across servers, in receipts, in selection records, in reveal objects, and in API URLs.

No server-assigned IDs. No cross-referencing by signature. One hash, derived from content, the same everywhere.

## 8. Service API

The API is designed for single-call operation. The client submits a commitment and receives a complete receipt — including the selection result — in one response. The server holds the connection until the next beacon fires (max ~3s for drand, ~60s for NIST), then returns everything.

### 8.1 Submit Commitment

```
POST /v1/commitments

Request body: Commitment object (Section 3.1) with commitment_hash pre-computed by client

Response (201 Created):
{
  "commitment": {
    "spec_version": "0.2.0",
    "commitment_hash": "e4d7f1b2...64hex...",
    "items": ["a1b2c3d4..."],
    "item_count": 1,
    "reveal_probability": 0.10,
    "beacon": { "type": "drand", "chain_hash": "52db9ba..." },
    "committed_at": "2026-02-06T14:30:00Z",
    "signing_key": "did:key:z6Mkf5r...",
    "signature": "user-signature..."
  },
  "registered_at": "2026-02-06T14:30:00.500Z",
  "selection": {
    "beacon_output": {
      "type": "drand",
      "chain_hash": "52db9ba70e...",
      "round": 35200001,
      "randomness": "abc123...64hex...",
      "signature": "def456..."
    },
    "selection_mode": "per_item",
    "selected_items": ["a1b2c3d4..."],
    "selected_count": 0,
    "total_count": 1
  },
  "signer_activity": {
    "commitments_past_hour": 3,
    "commitments_past_month": 47
  },
  "server_key": "did:key:z6Mkq...",
  "server_signature": "..."
}
```

The server:
1. Validates the user's signature
2. Verifies `commitment_hash == SHA-256(signing_payload)`
3. Records server-side `registered_at`
4. Waits for the next beacon output (holds connection)
5. Computes selection
6. Signs the entire response
7. Returns the complete receipt

One call. The receipt contains everything needed for offline verification: the full commitment, the server's timestamp attestation, the beacon output, and the selection result.

The `signer_activity` field reports how many commitments this `signing_key` has made in the last hour and month. The entire response is signed by the server's key (`server_key`), so downstream consumers can trust these counts without trusting the committer. Since `did:key` encodes the public key directly, anyone can verify the signature without contacting the server.

This is not rate limiting — the server never rejects a commitment based on activity. It is **transparent context** that lets reviewers and higher-level systems judge whether a signing key is behaving normally or flooding the system.

### 8.1.1 Data Retention

By default, servers retain commitment data for **1 month** and then delete it. This keeps operating costs minimal — a commit-reveal server should fit comfortably within free-tier cloud resources.

Servers MAY configure longer retention. The `GET /v1/server-info` endpoint advertises the server's retention policy:

```json
{
  "operator": "ETH Zürich",
  "server_key": "did:key:z6Mkq...",
  "retention": "30d",
  "signer_activity_windows": ["1h", "30d"]
}
```

The `retention` field is a duration string (`30d`, `90d`, `forever`). The `signer_activity_windows` field lists which time windows appear in `signer_activity` — servers with longer retention may include additional windows like `365d`.

Retention only affects the server's ability to answer API queries. It does **not** affect the validity of receipts the user already holds — those are self-contained proofs that work forever.

### 8.1.2 Receipt-Based Proof

The user's client saves every server-signed receipt locally. These receipts are the proof — not the server's database. A typical workflow:

1. User commits items → receives complete receipts (with selection) from multiple servers
2. User publishes a reveal to a git repository
3. User includes the receipts in the same repo under a `.commit-reveal/` directory

The resulting repo is a **self-contained proof bundle**:

```
my-benchmark-reveal/
├── .commit-reveal/
│   ├── commitment.json          # user's signed commitment
│   ├── receipts/
│   │   ├── cr.ethz.ch.json      # server receipt (commitment + selection + beacon)
│   │   ├── cr.cloudflare.json   # server receipt (commitment + selection + beacon)
│   │   └── peerbench.ai.json    # server receipt (commitment + selection + beacon)
│   └── reveal.json              # user's signed reveal object
├── item_001.json                # revealed data
├── item_002.json
└── ...
```

Anyone cloning this repo can verify the entire chain offline:
1. Verify commitment signature (user's `did:key`)
2. Verify receipt signatures (server `did:key`s — embedded in the receipt)
3. Verify beacon output (BLS/RSA — no network needed)
4. Re-run selection algorithm, confirm it matches
5. Hash revealed files, confirm they match committed hashes

No server needs to be online. No API calls needed. The `did:key` identifiers encode the public keys directly, so signature verification is self-contained.

### 8.2 Get Commitment

```
GET /v1/commitments/{commitment_hash}

Response: Full receipt (same format as POST response)
```

This is a convenience lookup — returns the stored receipt. Not required for the protocol since the client already has the receipt from the POST response.

### 8.3 Submit Stream Commit

```
POST /v1/streams/{stream_id}/commitments

Request body: Commitment object with stream_id matching the path

Response: same as 7.1 but with stream_id populated
```

To start a new stream:

```
POST /v1/streams

Request body:
{
  "reveal_probability": 0.10,
  "beacon": { "type": "drand", "chain_hash": "..." },
  "signing_key": "did:key:...",
  "metadata": {}
}

Response (201):
{
  "stream_id": "s_a1b2c3d4e5f6...",
  "created_at": "..."
}
```

Stream parameters (`reveal_probability`, `beacon`) are set once on stream creation and inherited by all commits in the stream.

### 8.4 Submit Reveal

```
POST /v1/commitments/{commitment_hash}/reveals

Request body: Reveal object (Section 6.3)

Response (201):
{
  "reveal_id": "...",
  "registered_at": "..."
}
```

The server stores the reveal metadata (which items are claimed as revealed, where the data lives) but does **not** download or verify the actual data. It is a record that the committer has declared a reveal. Verification of data integrity is the responsibility of whoever consumes the reveal (see Section 6.4).

### 8.5 Get Reveals

```
GET /v1/commitments/{commitment_hash}/reveals
GET /v1/streams/{stream_id}/reveals
```

### 8.6 Stream Status

```
GET /v1/streams/{stream_id}

Response:
{
  "stream_id": "...",
  "reveal_probability": 0.10,
  "beacon": { "type": "drand", ... },
  "total_items": 47,
  "total_selected": 5,
  "total_revealed": 3,
  "commitments": 47,
  "selection_rounds": 12,
  "created_at": "...",
  "last_commit_at": "..."
}
```

## 9. Verification Service (Optional, Separate)

Verification of revealed data — downloading it, hashing it, checking it against commitments — is **not** part of the commit-reveal server. It is a separate, optional service with its own API.

### 9.1 Why Separate

Commit-reveal servers are lightweight receipt printers. Verification requires downloading potentially large datasets, hashing every file, and confirming matches. These are fundamentally different workloads with different resource profiles and different trust implications. Bundling them would make it harder to run a commit-reveal server (higher bandwidth/compute requirements) and would conflate two roles: "I recorded when this commitment was made" vs. "I checked that the revealed data is legit."

### 9.2 Who Runs It

Anyone can run a verification service. PeerBench will operate one at `https://verify.peerbench.ai` as a convenience, but this is not guaranteed to remain available and should not be treated as authoritative. Users who care about verification should run it themselves or use the CLI tooling (Section 9.4).

### 9.3 Verification API

The verification service is a separate HTTP endpoint, potentially on a different domain.

```
POST /v1/verify

Request body:
{
  "commitment_server": "https://cr.ethz.ch",
  "commitment_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "data_url": "https://github.com/myorg/benchmark-reveal"
}

Response (200):
{
  "status": "verified",
  "checks": {
    "commitment_signature": "pass",
    "beacon_authentic": "pass",
    "selection_correct": "pass",
    "reveal_signature": "pass",
    "data_downloaded": true,
    "items_checked": 5,
    "items_passed": 5,
    "items_failed": 0
  },
  "verified_at": "2026-02-08T12:00:00Z"
}
```

The service:
1. Fetches the commitment and selection record from the commit-reveal server
2. Verifies signatures and beacon output
3. Re-runs the selection algorithm
4. Downloads data from `data_url`
5. Hashes each revealed item and checks against committed hashes
6. Returns a report

### 9.4 CLI Verification

The reference client includes offline verification that does the same thing locally:

```bash
# Verify from a local directory of revealed files
commit-reveal verify \
  --commitment https://cr.ethz.ch/v1/commitments/a1b2c3d4... \
  --data ./my-reveal/

# Verify from a remote data URL
commit-reveal verify \
  --commitment https://cr.ethz.ch/v1/commitments/a1b2c3d4... \
  --data https://github.com/myorg/benchmark-reveal
```

This requires no trust in any verification service — the user runs it themselves.

## 10. Test Vectors

Implementations MUST produce identical outputs for these inputs.

### 10.1 PRNG

```
seed (hex): e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

index 0:
  HMAC-SHA256(seed, 0x0000000000000000) = 8bc1aab00ed4423c741ed6670d50d4ab95e7207fc4a81f4aa09b8e2ba20b5658
  uint64_le(first 8 bytes) = 4342266150297190795

index 1:
  HMAC-SHA256(seed, 0x0100000000000000) = 4d0d8aedaf2ddd700fcdcad9c566103a29ee40c3b317a30d04916df298ac7a80
  uint64_le(first 8 bytes) = 8132706735728758093

index 2:
  HMAC-SHA256(seed, 0x0200000000000000) = a95b16931142b70abdc2fc01f651e9ad201cc86a780d719c892e58950809196b
  uint64_le(first 8 bytes) = 772158504366922665
```

### 10.2 Per-Item Selection

```
beacon_randomness (hex): f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6
commitment_hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
reveal_probability: 0.10
threshold: floor(0.10 × 2^64) = 1844674407370955264

--- Example: item IS selected ---

item_hash: 32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2
msg (UTF-8 bytes of concatenation):
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d432012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"
HMAC-SHA256(beacon_randomness, msg) = b42355774698a415dc125b565996db6c002f5f006d2f7d0f1ee0dba4b2d72b57
value = le_uint64(first 8 bytes) = 1559538799394235316
1559538799394235316 < 1844674407370955264 → selected = true

--- Example: item is NOT selected ---

item_hash: 2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8
msg (UTF-8 bytes of concatenation):
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d42f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"
HMAC-SHA256(beacon_randomness, msg) = e5cb6f092a341da003cd8ae1deadd933a772b411d474dafe5a72dadb2ca5e2a1
value = le_uint64(first 8 bytes) = 11537435175544671205
11537435175544671205 < 1844674407370955264 → selected = false
```

### 10.3 Batch Selection (Fisher-Yates)

```
items (5 hashes):
  items[0] = 2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8
  items[1] = 32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2
  items[2] = 6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da
  items[3] = 4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030
  items[4] = 57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b

beacon_randomness (hex): f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6
count: 2 (= ceil(0.40 × 5))

Step 0:
  HMAC-SHA256(seed, uint64_le(0)) → first 8 bytes → 6916673916840581544
  j = 0 + (6916673916840581544 mod 5) = 4
  swap pool[0] ↔ pool[4]

Step 1:
  HMAC-SHA256(seed, uint64_le(1)) → first 8 bytes → 9911365303496060051
  j = 1 + (9911365303496060051 mod 4) = 4
  swap pool[1] ↔ pool[4]

selected = [
  57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b,
  2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8
]
```

## 11. Security Properties

### 11.1 What This Proves

- **Pre-commitment:** The committer declared specific hashes before the randomness existed. They cannot retroactively change item contents.
- **Unbiased selection:** Selected items are determined by beacon randomness that postdates the commitment. The committer cannot influence which items are chosen.
- **Integrity:** Revealed data must hash-match committed hashes.

### 11.2 What This Does NOT Prove

- **Data existence:** The committer could commit hashes of data they haven't created yet.
- **Data quality:** The service says nothing about whether committed items are good or useful.
- **Author identity:** The service verifies Ed25519 signatures but has no opinion on who holds the key. Higher-level systems handle identity.
- **Completeness of the item set:** The committer could commit only a cherry-picked subset of their full data. The service proves integrity of what was committed, not that the committed set is representative.
- **Reveal compliance:** The service cannot force reveals. It can only make the selection public so that non-compliance is visible.

### 11.3 Threat Model

| Threat | Mitigation |
|--------|------------|
| Committer cherry-picks which items to reveal | Beacon-seeded selection; committer cannot choose |
| Committer modifies items after commitment | SHA-256 integrity check on reveal |
| Committer creates commitment after seeing beacon | Temporal ordering: beacon must postdate server-recorded `registered_at` |
| Committer predicts beacon output | drand: requires compromising t-of-n League of Entropy nodes. NIST: requires compromising NIST infrastructure. |
| Service operator tampers with commitments | Commitments are signed by the committer; tampering breaks the signature |
| Service operator backdates a commitment | `registered_at` is server-side; additionally, beacon round must postdate it |
| Committer reveals only easy/favorable items voluntarily | Voluntary vs. selected reveals are distinguished in the reveal object; reviewers can weight accordingly |

## 12. Canonical JSON

1. No whitespace
2. Object keys in the order specified per object type
3. Strings use minimal JSON escaping (RFC 8259)
4. UTF-8 encoding
5. No trailing commas, no BOM
6. Arrays preserve element order

Key order per object type:

**Commitment signing payload:** `spec_version`, `items`, `item_count`, `reveal_probability`, `beacon`, `committed_at`, `signing_key`

**Beacon object:** `type`, then type-specific fields in alphabetical order

**Reveal signing payload:** `spec_version`, `commitment_hash`, `selected_items`, `voluntary_items`, `revealed_at`, `signing_key`

## 13. Future Considerations

- **Timelock encryption:** drand quicknet supports timelock encryption. Items could be encrypted such that they automatically become readable when the beacon round occurs — eliminating the need for active participation in reveals.
- **Merkle commitments:** for very large item sets (>100k), a Merkle root over sorted hashes could replace the full list, with Merkle proofs for individual items.
- **Witness cosigning:** third parties cosign commitments for independent timestamps.
- **Commitment chaining:** linking a new commitment to a previous one (dataset versioning) via a `supersedes` field.
- **Selection receipts:** beacon nodes or third-party witnesses could sign selection records for additional non-repudiation.
