# Commit-Reveal Protocol Specification

**Version:** 0.4.0-draft
**Status:** Draft for review
**Supersedes:** commit-reveal-spec.md v0.2.0-draft, hashing-spec.md v0.3.0-draft

## 1. Overview

This specification defines the commit-reveal system end-to-end: how files and directories are hashed into deterministic SHA-256 identifiers, how those hashes are committed to a timestamped service, how an external randomness beacon selects items for reveal, and how reveals are verified.

The system proves three things:

1. **Temporal ordering** — the commitment existed before the randomness that selected it
2. **Integrity** — revealed data matches committed hashes
3. **Unbiased selection** — the items chosen for reveal are determined by external randomness, not the committer

The service is domain-agnostic. It deals in opaque SHA-256 hashes. Higher-level systems layer meaning on top.

### 1.1 Design Priorities

1. **Determinism** — identical inputs always produce identical hashes and selections, regardless of implementation language, OS, or filesystem
2. **Standalone** — runs independently; no dependency on external nodes, identity systems, or benchmark registries
3. **Verifiable offline** — given the commitment, randomness beacon output, and revealed data, anyone can verify without contacting the service
4. **Simple** — one hash algorithm (SHA-256), one signature scheme (Ed25519), pluggable randomness sources
5. **Composable** — can be embedded in higher-level systems or run as a separate microservice
6. **Minimal dependencies** — hashing requires only SHA-256 and JSON; no IPFS, no CID encoding, no multiformat overhead

### 1.2 Terminology

- **Item** — an opaque unit identified by a SHA-256 hash. Could be a file, a test case, a JSON object — the service doesn't care.
- **Commitment** — a signed declaration that one or more item hashes exist.
- **Beacon** — an external randomness source (currently drand).
- **Selection** — the deterministic process of deciding which items must be revealed, seeded by beacon randomness.
- **Reveal probability** — the probability (0, 1] that any given item is selected for reveal.
- **Voluntary reveal** — revealing items beyond the random selection, at the committer's discretion.
- **Manifest** — a canonical JSON representation of a directory's contents, used to compute directory hashes.

## 2. Hash Algorithm

- **Algorithm:** SHA-256 (always, no alternatives)
- **Output:** 32 bytes (256 bits) raw binary internally
- **String encoding:** lowercase hex (64 characters) for display, storage, and JSON serialization

Example: `a1b2c3d4e5f6...` (64 hex chars)

## 3. File Hashing

A file hash is the SHA-256 digest of the raw file bytes, computed as a stream.

```
file_hash = SHA-256(file_bytes)
```

### 3.1 Streaming

Implementations MUST stream the file through the hash function in chunks (recommended: 64 KiB read buffer). Implementations MUST NOT load entire files into memory.

### 3.2 Edge Cases

- **Empty file (0 bytes):** hash is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- **Symlinks:** MUST be skipped (not followed, not included in directory listings). Log a warning.
- **Binary files:** hashed as-is (no encoding conversion)
- **Text files:** hashed as-is (no BOM stripping, no newline normalization). The hash covers the exact bytes on disk.

## 4. Directory Hashing (Manifest)

A directory hash is computed from a **manifest** — a canonical JSON representation of the directory's contents, then hashed with SHA-256.

```
dir_hash = SHA-256(canonical_json(manifest))
```

The manifest serves dual purpose: it is both the input to the directory hash function and the proof structure used during reveal and verification.

### 4.1 Manifest Structure

The manifest is a JSON array of entry objects, sorted lexicographically by the `name` field (compared as UTF-8 byte sequences, not locale-aware collation).

Each entry is an object with exactly these fields, in this order:

```json
{"name":"filename.txt","type":"file","hash":"a1b2c3d4..."}
```

Fields:

- **`name`** (string): the basename of the file or directory (no path separators). Must be valid UTF-8. Subdirectories are represented as separate entries with `type: "dir"` whose `hash` is computed recursively (Section 4.6).
- **`type`** (string): either `"file"` or `"dir"`. No other values.
- **`hash`** (string): the lowercase hex SHA-256 hash. For files, the file hash (Section 3). For directories, the directory hash (this section, applied recursively).

### 4.2 Canonical JSON Serialization

The manifest MUST be serialized to a canonical JSON byte string before hashing:

1. No whitespace (no spaces, no newlines, no indentation)
2. Object keys in the exact order: `name`, `type`, `hash`
3. Strings use minimal JSON escaping (only characters required by RFC 8259: `"`, `\`, and control characters U+0000 through U+001F)
4. No trailing commas, no BOM
5. UTF-8 encoding
6. Unicode characters outside the required-escape range are included literally (not `\uXXXX` escaped)

Example:

```
[{"name":"a.txt","type":"file","hash":"e3b0c44298fc1c149afbf4c8996fb924..."},{"name":"logs","type":"dir","hash":"7d865e959b2466918c9863afca942d0f..."}]
```

### 4.3 Sorting Rules

Entries are sorted by byte-level lexicographic ordering of the UTF-8 encoded `name`. This matches the default `Array.sort()` in JavaScript and `sorted()` in Python 3 for ASCII filenames. Implementations SHOULD NFC-normalize filenames before sorting.

### 4.4 Exclusions

The following MUST be excluded from the manifest:

- Symlinks
- Entries named `.` or `..`
- All hidden files and directories (entries whose name starts with `.`)
- Protocol files at the root level: `manifest.json`, `commitment.json`, `server-receipts.json`, `reveal.json`, `reveal-receipts.json`, `publication.json`, `receipt.json`, `verify.sh`, `README.md`

Implementations MAY accept an additional exclusion list.

### 4.5 Empty Directory

An empty directory has manifest `[]`, hash: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`

### 4.6 Recursion

Subdirectories are hashed depth-first. Implementations SHOULD warn on depths exceeding 100 levels.

## 5. Producing Item Hashes for Commit-Reveal

When preparing data for the commit-reveal service, each leaf file becomes one "item" with a SHA-256 hash. The hashes from this spec become the `items` array in a commitment object (Section 7).

## 6. Mode of Operation

The user commits a list of item hashes in a single request, with a reveal probability. The next beacon output after the commitment determines which items are selected.

Use case: a benchmark author has 500 test cases ready and commits them all at once.

## 7. Commitment

### 7.1 Commitment Object

```json
{
  "spec_version": "0.2.0",
  "commitment_hash": "e4d7f1b2...",
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

- **`spec_version`** (string): version of the object format. It is `"0.2.0"` for objects defined by this document: the document version (0.4.0-draft) changed, the signed object formats did not. An implementation MUST NOT emit another value until a later version of this document changes a signing payload.
- **`commitment_hash`** (string): `SHA-256(signing_payload)`, lowercase hex (64 chars). Computed by the client before submission. Deterministic: the same commitment always produces the same hash, on every server, on every machine. This is the canonical identifier for the commitment across all servers. Not part of the signed payload (it is derived from it).
- **`items`** (array of strings): SHA-256 hashes (lowercase hex, 64 chars). At least 1 item. No duplicates. For single-item commits, this is a one-element array.
- **`item_count`** (integer): length of `items`.
- **`reveal_probability`** (number): the probability that any given item is selected for reveal. Range: (0.0, 1.0]. For example, 0.10 means ~10% of items will be selected. See Section 8 for how this is applied.
- **`beacon`** (object): identifies the randomness source. See Section 9. May carry the optional `anchor_round` (Section 8.1.1), which pins the selection round for all servers.
- **`metadata`** (object): arbitrary key-value data. Stored but not interpreted by the service. Not signed.
- **`committed_at`** (string): ISO 8601 UTC timestamp, set by the committer.
- **`signing_key`** (string): public key as `did:key`. Used to verify the signature.
- **`signature`** (string): Ed25519 signature, lowercase hex (128 chars).

### 7.2 Signing and Commitment Hash

The signature covers the **signing payload** — canonical JSON of the commitment with these fields only: `spec_version`, `items`, `item_count`, `reveal_probability`, `beacon`, `committed_at`, `signing_key`.

Fields excluded from signing: `commitment_hash` (derived from the payload), `metadata`, `signature`.

The whole `beacon` object is part of the payload, so `beacon.anchor_round` is signed when present. Optional fields that are absent are **omitted** from the payload, never written as `null`. A commitment without `anchor_round` therefore has exactly the signing payload, `commitment_hash`, and signature it had before the field was introduced (test vector 13.6).

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

### 7.3 Commitment Immutability

Once submitted, a commitment is immutable. Items cannot be added to or removed from an existing commitment — create a new commitment instead.

## 8. Selection Algorithm

The selection algorithm determines which committed items must be revealed. It runs after the service receives the next beacon output following a commitment.

### 8.1 Selection Trigger

The service waits for the **first beacon output whose timestamp is strictly after the commitment's `registered_at` time** (the server-side timestamp, not `committed_at`). This ensures the committer could not have known the randomness when they committed.

```
beacon_output = first beacon where beacon.timestamp > commitment.registered_at
```

This rule applies to commitments **without** `beacon.anchor_round`. Because each server uses its own `registered_at`, servers that receive the same commitment on opposite sides of a beacon tick use different rounds and compute different selections. Clients SHOULD set `anchor_round` (Section 8.1.1) so that all servers agree.

### 8.1.1 Anchored Selection Round (`anchor_round`)

`beacon.anchor_round` is an OPTIONAL unsigned integer. The client sets it to the current beacon round R, which is already public at signing time. It is covered by the commitment signature (Section 7.2).

```
ANCHOR_SELECTION_DELAY            = 2        // rounds
ANCHOR_SELECTION_SAFETY_MARGIN_MS = 1000     // milliseconds
ANCHOR_CLOCK_SKEW_ALLOWANCE_MS    = 1000     // milliseconds

selection_round = anchor_round + ANCHOR_SELECTION_DELAY
beacon_output   = beacon round selection_round
```

Every server that registers the commitment uses the same `selection_round`, regardless of its own `registered_at`.

**Registration rule.** A server MUST reject an anchored commitment (HTTP 400, Section 12.2) unless both conditions hold at its `registered_at`:

```
1. round_time(anchor_round)     <= registered_at + ANCHOR_CLOCK_SKEW_ALLOWANCE_MS
2. round_time(anchor_round + 2) >  registered_at + ANCHOR_SELECTION_SAFETY_MARGIN_MS
```

Condition 1: the anchor round is not in the future. The allowance tolerates a server clock that runs slightly behind the client's.

Condition 2: **the selection round is not yet available.** This is the rule that keeps anchoring safe. Without it a client could wait until round `anchor_round + 2` is published, learn the selection randomness, and only then register a commitment built to its liking. A server that receives the commitment too late MUST reject it. It MUST NOT fall back to another round, and it MUST NOT accept the commitment and select with randomness that is already public. The safety margin covers a server clock that runs behind the beacon.

Condition 2 also bounds how old an anchor can be, so there is no separate maximum anchor age. A "maximum age" check alone is not a substitute for condition 2: an anchor that is one or two rounds old can pass an age limit while its selection round is already public.

With drand quicknet (3 s period) the two conditions leave a window of 6 seconds, from 1 s before `round_time(anchor_round)` to 1 s before `round_time(anchor_round + 2)`. A client that anchors to the round that just became public has between 2 and 5 seconds to reach every server.

Additional requirements:

- `anchor_round` MUST be a positive integer. A server rejects `0`, `null`, and non-integer values. To send no anchor, omit the field.
- `anchor_round` is only defined for beacon types with a fixed round schedule. This version defines it for `drand`.
- The server still records `registered_at` and `arrival_beacon` as for any commitment.
- A commitment that is already registered is answered with 409 as before, whatever the time.

**Client behavior.** When creating a commitment, the client fetches the latest beacon round, sets `anchor_round`, signs, and submits to all servers immediately. If a server rejects the anchor (error codes in Section 12.2), the client re-signs with a fresh `anchor_round` and retries once. Re-signing produces a different `commitment_hash`, so the client retries only if no server accepted the first attempt. Clients MAY omit `anchor_round` for compatibility with servers that do not support it. Support is advertised by `anchor_selection_delay` in `GET /v1/server-info`.

**What this does and does not provide.** Anchoring makes all servers select with the same round, which removes the choice between diverging server receipts. It does not prevent a committer from registering several different commitments against the same future round and publishing only one of them. That is a separate problem (see `signer_activity`, Section 12.2).

### 8.2 Per-Item Selection (Single Item or Small Batches)

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

### 8.3 Batch Selection (Exact Count)

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

**Modulo bias.** Step 3b reduces a uniform 64-bit value modulo `range`, so the low residues are favored by at most `range / 2^64` per step (about 5 × 10^-14 for one million items). The bias is far below anything an audit can observe. Removing it by rejection sampling changes the selection output and the test vectors in Section 13, so it is deferred to the next version that changes the selection algorithm.

### 8.4 Which Mode to Use

| Scenario | Selection mode | Rationale |
|----------|---------------|-----------|
| Single item commit | Per-item (8.2) | Bernoulli trial: selected or not |
| Batch of 2–20 items | Per-item (8.2) | Probabilistic count is fine for small sets |
| Batch of 21+ items | Batch (8.3) | Exact count via shuffle is more predictable |

The boundary of 20 items is the default of this specification. It is a deployment setting: the reference server uses per-item selection only for single-item commitments and batch selection for two or more items. The mode that was used is recorded as `selection_mode` in the selection record (Section 8.5).

A verifier MUST recompute the selection with the algorithm named by `selection_mode` and MUST fail the selection check for any other value than `per_item` or `batch`. A verifier MUST NOT assume a threshold. A server SHOULD advertise its threshold as `selection_threshold` in `GET /v1/server-info` (commitments with more items than this value use batch selection).

The committer does not sign the threshold, so a server that is free to choose the mode has two candidate selections for one beacon output. A verifier therefore reports the check `selection_mode_default`: "pass" when the recorded mode is the one the reference rule gives (per-item for one item, batch otherwise), "warn" when it is not. "warn" does not change the overall result. A relying party that wants one fixed mode should state it in advance and treat a deviation as a failure.

### 8.5 Selection Record

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

## 9. Randomness Beacons

The service supports multiple randomness beacon types. The commitment's `beacon` field pins it to a specific source.

### 9.1 Beacon Interface

Every beacon type must provide:

- **Identification** — a type string and chain/source identifier
- **Temporal ordering** — beacon outputs have timestamps or round numbers that establish "after" relationships
- **Randomness** — a 32-byte output that is unpredictable before it's published
- **Verifiability** — anyone can verify the beacon output is authentic without trusting the commit-reveal service

### 9.2 drand (League of Entropy)

```json
{
  "type": "drand",
  "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
}
```

With the optional anchor (Section 8.1.1):

```json
{
  "type": "drand",
  "anchor_round": 25892262,
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

**Latency:** 3 seconds. A single-item commit waits at most 3 seconds for selection. With `anchor_round` the wait is until `round_time(anchor_round + 2)`, between 1 and 7 seconds after registration.

### 9.3 Beacon Liveness

If a beacon experiences downtime, selection is deferred until it resumes. The protocol is correct regardless of beacon latency — the invariant is only that the beacon output postdates the commitment.

## 10. Reveal

A reveal publishes the actual data behind selected item hashes. Reveals can happen anywhere — GitHub, a personal website, IPFS, or registered with this service.

### 10.1 What Must Be Revealed

Items that appear in the selection record's `selected_items` are expected to be revealed. This is a social/protocol expectation, not something the service can force. The selection is public — anyone can see what *should* have been revealed.

### 10.2 Voluntary Reveals

The committer may reveal **any** items they choose, beyond the random selection. Voluntary reveals are valuable for transparency and peer review but carry less anti-cherry-picking assurance than randomly selected reveals.

A reveal object indicates which items were randomly selected vs. voluntarily revealed.

### 10.3 Reveal Object

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
  "file_urls": {
    "b2c3d4e5f6a1...": "https://cdn.example.com/items/b2c3d4e5f6a1...",
    "a1b2c3d4e5f6...": "https://cdn.example.com/items/a1b2c3d4e5f6..."
  },
  "revealed_at": "2026-02-07T10:00:00Z",
  "signing_key": "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP",
  "signature": "..."
}
```

- **`selected_items`** (array): items from the selection record that are being revealed. Subset of or equal to the selection record's `selected_items`.
- **`voluntary_items`** (array): additional items the committer chooses to reveal. Must be hashes from the original commitment's `items` and not in `selected_items`.
- **`data_url`** (string | null): where the actual data for revealed items can be found. A git repo URL, a static file server, an IPFS gateway, etc. Informational — the commit-reveal server does not fetch this. Not part of the signed payload.
- **`file_urls`** (object | null, optional): a mapping of item hashes to direct URLs where each item's data can be fetched. Used by the server for optional data verification. Not part of the signed payload.
- **`signing_key`**: need not match the commitment's key. Anyone with the data can create a reveal.
- **`signature`**: Ed25519 signature over the reveal signing payload (see Section 10.4), lowercase hex (128 chars).

### 10.4 Reveal Signing Payload

The signature covers the **reveal signing payload** — canonical JSON of these fields only:

```
signing_payload = canonical_json({
  "spec_version": "...",
  "commitment_hash": "...",
  "selected_items": [...],
  "voluntary_items": [...],
  "revealed_at": "...",
  "signing_key": "..."
})
```

Fields excluded from signing: `data_url`, `file_urls`, `signature`.

### 10.5 Reveal Verification

Given: commitment, selection record, reveal object, and actual data for each revealed item.

1. **Verify commitment signature.** Ed25519 verify against signing payload (Section 7.2).

2. **Verify beacon.** Confirm the beacon output in the selection record is authentic and bound to the registration time. For drand quicknet the checks are reported by name and each fails verification on its own:
   - `beacon_randomness`: `randomness == SHA-256(signature)`.
   - `beacon_authentic`: the output is from the chain named in `commitment.beacon`, and the BLS signature verifies for `round` under the chain's public key (Section 9.2). A verifier that cannot run this check reports it as skipped, and the overall result is at most "partial".
   - `beacon_after_registration`, for a commitment without `beacon.anchor_round`: `round` is the first round strictly after the receipt's `registered_at`, taken at whole-second resolution (Section 8.1). An earlier round means the randomness was public at registration; a later round means the server did not use the round the rule prescribes. Without `registered_at` the check is skipped and the result is at most "partial".

   **2a. Verify the anchor**, if the commitment has `beacon.anchor_round`. Both checks are reported by name and each fails verification on its own:
   - `anchor_selection_round`: `selection.beacon_output.round == anchor_round + ANCHOR_SELECTION_DELAY`.
   - `anchor_registration_time`: the receipt's `registered_at` precedes `round_time(anchor_round + ANCHOR_SELECTION_DELAY)`. If the verifier has no `registered_at` (no receipt), this check is reported as skipped and the overall result is at most "partial", never "verified".

   Without `anchor_round`, step 2a does not apply; `beacon_after_registration` takes its place.

3. **Verify selection.** Confirm the selection record's `commitment_hash` is the commitment's. Report `selection_mode_default` (Section 8.4). Re-run the selection algorithm named by `selection_mode` with the commitment's items and the beacon's randomness. Confirm the selection record's `selected_items` matches.

4. **Verify reveal signature.** Ed25519 verify the reveal object.

   **4a. Verify the reveal matches the commitment** (`reveal_matches_commitment`): the reveal's `commitment_hash` is the commitment's, every hash in `selected_items` and `voluntary_items` is one of the commitment's `items`, and every hash in the reveal's `selected_items` is in the selection record's `selected_items`. Without this check a reveal could present data that was never committed, or present a voluntary item as a randomly selected one.

5. **Verify data integrity.** For each item in `selected_items` ∪ `voluntary_items`: hash the provided data with SHA-256 and confirm it matches.

6. **Check completeness.** Note which items from the selection record are present in the reveal's `selected_items` vs. missing. Missing items weaken trust.

Steps 1-5 can be performed entirely offline. Commit-reveal servers do **not** perform full verification — they store reveal metadata and optionally verify data integrity via `file_urls` (see Section 12.3). Full verification is done by the end user via CLI tooling.

### 10.6 Where Reveal Data Lives

The service stores the reveal object (metadata) but NOT the actual item data. Data can live anywhere. The only requirement is that verifiers can obtain the data for each revealed item and hash it.

## 11. Server Trust Model and Discovery

### 11.1 What a Server Does

A commit-reveal server is a **timestamped receipt printer**. It accepts commitments, records when it received them, waits for beacon outputs, computes selections, and stores reveals. That's it.

Each server has an Ed25519 keypair identified as a `did:key`. The server signs every response — commitment receipts, selection records, reveal receipts — with this key. These signed responses are **self-contained proofs**: once the user has them, the server can go offline, delete its data, or cease to exist, and the proofs remain independently verifiable.

A server cannot forge commitments (they're signed by the committer), cannot influence selection (that's determined by the beacon), and cannot fabricate beacon outputs (those are independently verifiable). The server's only trusted role is providing a `registered_at` timestamp — and even that is anchored by the beacon round, limiting backdating to at most one beacon period (~3s for drand).

### 11.2 Trust Properties

The protocol's trust guarantees come from two properties:

1. **Multiple servers make censorship hard.** The client submits to all known servers in parallel. A commitment is valid if *any* server records it. To censor a commitment, every server would need to collude in refusing it.

2. **Server operators have public reputation at stake.** Servers are run by institutions (universities, infrastructure companies, research organizations) whose names are attached to every receipt they issue. Misbehavior — backdating, selective censorship, downtime — is detectable and reputationally costly.

A commitment recorded on server A is exactly as valid as one on server B. Servers don't need to agree with each other, synchronize state, or maintain a shared log. Each operates independently.

### 11.3 Server Discovery

The client maintains a list of known servers. The client ships with a default list of well-known servers, similar to DNS root servers or drand relay endpoints. This list is updated with client releases.

Each server has its own Ed25519 signing key, used to sign responses (including `signer_activity` counts and `registered_at` timestamps). The server's public key is available at `GET /v1/server-info` on the server itself.

### 11.4 Multi-Submit

The client submits every commitment to **all known servers in parallel**. Every server receives the same `commitment_hash`. Each server independently records `registered_at`. Same `commitment_hash` in every receipt. With `beacon.anchor_round` (Section 8.1.1) every receipt also carries the same selection round and the same selected items; a server that receives the commitment too late rejects it instead of selecting with a different round. The client stores all receipts. For later operations (get selection, submit reveal), the client can use any server. If a server goes down, the commitment is still recorded elsewhere.

A commitment is considered successfully registered if at least one server accepts it. The client SHOULD warn if fewer than 2 servers respond.

### 11.5 Commitment Identity Across Servers

The `commitment_hash` is deterministic — computed from the signing payload by the client before submission. Every server receives the same `commitment_hash` for the same commitment. This is the canonical identifier everywhere: across servers, in receipts, in selection records, in reveal objects, and in API URLs.

No server-assigned IDs. No cross-referencing by signature. One hash, derived from content, the same everywhere.

## 12. Service API

The API is designed for single-call operation. The client submits a commitment and receives a complete receipt — including the selection result — in one response. The server holds the connection until the next beacon fires (max ~3s for drand), then returns everything.

### 12.1 Health Check

```
GET /health

Response (200):
{
  "status": "ok",
  "version": "0.2.0"
}
```

### 12.2 Submit Commitment

```
POST /v1/commitments

Request body: Commitment object (Section 7.1) with commitment_hash pre-computed by client

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
  "commitment_hash": "e4d7f1b2...64hex...",
  "registered_at": "2026-02-06T14:30:00.500Z",
  "arrival_beacon": {
    "type": "drand",
    "chain_hash": "52db9ba70e...",
    "round": 35200000,
    "randomness": "...",
    "signature": "..."
  },
  "selection": {
    "commitment_hash": "e4d7f1b2...",
    "beacon_output": {
      "type": "drand",
      "chain_hash": "52db9ba70e...",
      "round": 35200001,
      "randomness": "abc123...64hex...",
      "signature": "def456..."
    },
    "selection_mode": "per_item",
    "reveal_probability": 0.10,
    "selected_items": ["a1b2c3d4..."],
    "selected_count": 1,
    "total_count": 1,
    "computed_at": "2026-02-06T14:30:03Z"
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
3. Records server-side `registered_at`. If the commitment has `beacon.anchor_round`, applies the registration rule of Section 8.1.1 at this instant and rejects the commitment if it fails (see below)
4. Records the `arrival_beacon` — the current beacon round at time of registration
5. Waits for the selection beacon output (holds connection): round `anchor_round + 2` if anchored, otherwise the next round after `registered_at`
6. Computes selection
7. Signs the entire response
8. Returns the complete receipt

Anchor rejection (commitments with `beacon.anchor_round` only):

```
Response (400 Bad Request):
{
  "error": "selection round (anchor_round + 2) is already available or too close; re-sign with a fresh anchor_round",
  "error_code": "anchor_selection_round_available",
  "anchor_round": 25892262,
  "server_time": "2026-02-07T16:02:36.120Z"
}
```

| `error_code` | Meaning |
|--------------|---------|
| `anchor_round_invalid` | `anchor_round` is not a positive integer, or the beacon type does not support it |
| `anchor_round_in_future` | Condition 1 of Section 8.1.1 failed: the anchor round is not yet published |
| `anchor_selection_round_available` | Condition 2 failed: the selection round is already public or closer than the safety margin |

A rejected commitment is not stored. The client re-signs with a fresh `anchor_round` and submits again.

One call. The receipt contains everything needed for offline verification: the full commitment, the server's timestamp attestation, the beacon output, and the selection result.

The `commitment_hash` is included both inside the `commitment` object and as a top-level convenience field.

The `arrival_beacon` records which beacon round was current when the server received the commitment. This anchors the `registered_at` timestamp to the beacon timeline.

The `signer_activity` field reports how many commitments this `signing_key` has made in the last hour and month. The entire response is signed by the server's key (`server_key`), so downstream consumers can trust these counts without trusting the committer. Since `did:key` encodes the public key directly, anyone can verify the signature without contacting the server.

This is not rate limiting — the server never rejects a commitment based on activity. It is **transparent context** that lets reviewers and higher-level systems judge whether a signing key is behaving normally or flooding the system.

### 12.2.1 Data Retention

By default, servers retain commitment data for **1 month** and then delete it. This keeps operating costs minimal — a commit-reveal server should fit comfortably within free-tier cloud resources.

Servers MAY configure longer retention. The `GET /v1/server-info` endpoint advertises the server's retention policy. Retention only affects the server's ability to answer API queries. It does **not** affect the validity of receipts the user already holds — those are self-contained proofs that work forever.

### 12.2.2 Receipt-Based Proof

The user's client saves every server-signed receipt locally. These receipts are the proof — not the server's database. A typical workflow:

1. User commits items → receives complete receipts (with selection) from multiple servers
2. User publishes a reveal to a git repository
3. User includes the receipts alongside the data

The resulting repo is a **self-contained proof bundle** — the commitment, server receipts, reveal object, and the actual data files. Anyone cloning this repo can verify the entire chain offline:

1. Verify commitment signature (user's `did:key`)
2. Verify receipt signatures (server `did:key`s — embedded in the receipt)
3. Verify beacon output (BLS verify — no network needed)
4. Re-run selection algorithm, confirm it matches
5. Hash revealed files, confirm they match committed hashes

No server needs to be online. No API calls needed. The `did:key` identifiers encode the public keys directly, so signature verification is self-contained.

### 12.3 Submit Reveal

```
POST /v1/commitments/{commitment_hash}/reveals

Request body: Reveal object (Section 10.3)

Response (201):
{
  "reveal_id": "...",
  "registered_at": "...",
  "beacon_at_reveal": {
    "type": "drand",
    "chain_hash": "52db9ba70e...",
    "round": 35200100,
    "randomness": "...",
    "signature": "..."
  },
  "data_verified": true,
  "verification": {
    "verified_items": 5,
    "total_selected": 5,
    "items": [
      { "hash": "b2c3d4...", "url": "https://...", "status": "match" }
    ]
  },
  "file_urls_registered": 5,
  "server_key": "did:key:z6Mkq...",
  "server_signature": "..."
}
```

The `reveal_id` is a server-assigned random UUID (hex, no hyphens) used for deduplication and lookup — it has no cryptographic significance.

The server stores the reveal metadata (which items are claimed as revealed, where the data lives) and optionally verifies data integrity if `file_urls` are provided:

- For each item hash in `file_urls`, the server fetches the URL, hashes the response body with SHA-256, and compares against the committed hash.
- The `verification` object reports per-item results: `match`, `mismatch`, `fetch_error`, or `missing_url`.
- The `data_verified` field is `true` only if all selected items were verified and matched.

If no `file_urls` are provided, the server accepts the reveal but skips data verification.

### 12.4 Get Commitment

```
GET /v1/commitments/{commitment_hash}

Response: Full receipt (same format as POST response)
```

This is a convenience lookup — returns the stored receipt. Not required for the protocol since the client already has the receipt from the POST response.

### 12.5 Get Selection

```
GET /v1/commitments/{commitment_hash}/selection

Response: Selection record (Section 8.5)
```

### 12.6 Get Reveals

```
GET /v1/commitments/{commitment_hash}/reveals
```

### 12.7 Get Mirrors

```
GET /v1/commitments/{commitment_hash}/mirrors

Response:
{
  "commitment_hash": "...",
  "mirrors": [
    { "item_hash": "b2c3d4...", "url": "https://...", "revealed_at": "..." }
  ]
}
```

Extracts `file_urls` from all reveals for a commitment, providing a consolidated view of where revealed data can be found.

### 12.8 Verify Publication

```
POST /v1/commitments/{commitment_hash}/verify-publication

Request body:
{
  "file_urls": {
    "b2c3d4...": "https://cdn.example.com/items/b2c3d4...",
    "a1b2c3...": "https://cdn.example.com/items/a1b2c3..."
  }
}

Response (200):
{
  "commitment_hash": "...",
  "verified_items": 5,
  "total_items": 5,
  "all_match": true,
  "items": [
    { "hash": "b2c3d4...", "url": "https://...", "status": "match", "computed_hash": "b2c3d4..." }
  ],
  "server_key": "did:key:z6Mkq...",
  "server_signature": "..."
}
```

Fetches data from the provided URLs, hashes each file, and compares against committed item hashes. This endpoint provides a server-signed attestation that the published data matches the commitment. The signed response can be stored as evidence.

## 13. Test Vectors

Implementations MUST produce identical outputs for these inputs.

### 13.1 File Hashes

| Input | Expected Hash |
|-------|--------------|
| Empty file (0 bytes) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `hello\n` (6 bytes) | `5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03` |
| `hello` (5 bytes, no newline) | `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` |

### 13.2 Directory Hashes

**Single file directory:**

```
testdir/
  hello.txt  (contains "hello", 5 bytes, no newline)
```

Manifest: `[{"name":"hello.txt","type":"file","hash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}]`

Expected directory hash: `10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f`

**Nested directory:**

```
testdir/
  data/
    log.txt  (contains "log\n", 4 bytes)
  readme.txt  (contains "readme", 6 bytes, no newline)
```

Step 1: `log.txt` hash = `9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857`

Step 2: `data/` manifest = `[{"name":"log.txt","type":"file","hash":"9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857"}]`
`data/` hash = `3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80`

Step 3: `readme.txt` hash = `711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe`

Step 4: `testdir/` manifest = `[{"name":"data","type":"dir","hash":"3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80"},{"name":"readme.txt","type":"file","hash":"711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe"}]`
`testdir/` hash = `28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94`

### 13.3 PRNG

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

### 13.4 Per-Item Selection

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

### 13.5 Batch Selection (Fisher-Yates)

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

### 13.6 Commitment Without `anchor_round`

Signing key (Ed25519 secret, RFC 8032 section 7.1 test 1): `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`

```
signing_payload (one line, no whitespace):
{"spec_version":"0.2.0","items":["2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8","32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"],"item_count":2,"reveal_probability":0.1,"beacon":{"type":"drand","chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}

commitment_hash = 39b23208e0f65e4e2e5c0cd52e7eacb26047aaf9b4d89bb1280c3b78a21b33ac
signature       = 5516f721b6f71554c8bacc6b3458a2427db9fd4d2367a0722e6fa2e08366e1c59cc1aba2cec6563a61a80026a58b155746951b3e74fb662a3891dde4994aaa07
```

These values were produced by the implementation before `anchor_round` existed. An implementation that supports `anchor_round` MUST still produce them: the field is omitted when absent.

### 13.7 Commitment With `anchor_round`

The same commitment with `anchor_round = 25892262`. The only change to the payload is the added key, directly after `"type"`.

```
signing_payload (one line, no whitespace):
{"spec_version":"0.2.0","items":["2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8","32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"],"item_count":2,"reveal_probability":0.1,"beacon":{"type":"drand","anchor_round":25892262,"chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}

commitment_hash = d3e6d24523acbbae6c586378da650bbcf2b3419974a938e7fa3aeb5051d9a59b
signature       = f52fd33cdedd906ba795aa06fe13e7b944bac5506d058846eae8407cbfa2c9dc452695f57c06035f8175bda4809a4bb2a96893de6b8ec48dc641984a570f5e07

selection_round = 25892262 + 2 = 25892264
```

### 13.8 Anchor Registration Rule

For `anchor_round = 25892262` on drand quicknet:

```
round_time(25892262) = 1770480150   (2026-02-07T16:02:30Z)
round_time(25892263) = 1770480153   (2026-02-07T16:02:33Z)
round_time(25892264) = 1770480156   (2026-02-07T16:02:36Z, selection round)
```

| `registered_at` | Result |
|-----------------|--------|
| 2026-02-07T16:02:28.999Z | reject, `anchor_round_in_future` |
| 2026-02-07T16:02:29.000Z | accept, selection round 25892264 |
| 2026-02-07T16:02:32.800Z | accept, selection round 25892264 |
| 2026-02-07T16:02:33.200Z | accept, selection round 25892264 |
| 2026-02-07T16:02:34.999Z | accept, selection round 25892264 |
| 2026-02-07T16:02:35.000Z | reject, `anchor_selection_round_available` |
| 2026-02-07T16:02:36.000Z | reject, `anchor_selection_round_available` |

Rows 3 and 4 are two servers on opposite sides of the tick of round 25892263. Without `anchor_round` they would select with rounds 25892263 and 25892264. With it, both use 25892264.

Verifier (Section 10.5, step 2a) for a receipt of this commitment:

| `selection.beacon_output.round` | `registered_at` | `anchor_selection_round` | `anchor_registration_time` |
|---------------------------------|-----------------|--------------------------|----------------------------|
| 25892264 | 2026-02-07T16:02:31.500Z | pass | pass |
| 25892263 | 2026-02-07T16:02:31.500Z | fail | pass |
| 25892264 | 2026-02-07T16:02:36.000Z | pass | fail |
| 25892264 | (not supplied) | pass | skip |

## 14. Security Properties

### 14.1 What This Proves

- **Pre-commitment:** The committer declared specific hashes before the randomness existed. They cannot retroactively change item contents.
- **Unbiased selection:** Selected items are determined by beacon randomness that postdates the commitment. The committer cannot influence which items are chosen.
- **Integrity:** Revealed data must hash-match committed hashes.

### 14.2 What This Does NOT Prove

- **Data existence:** The committer could commit hashes of data they haven't created yet.
- **Data quality:** The service says nothing about whether committed items are good or useful.
- **Author identity:** The service verifies Ed25519 signatures but has no opinion on who holds the key. Higher-level systems handle identity.
- **Completeness of the item set:** The committer could commit only a cherry-picked subset of their full data. The service proves integrity of what was committed, not that the committed set is representative.
- **Reveal compliance:** The service cannot force reveals. It can only make the selection public so that non-compliance is visible.

### 14.3 Threat Model

| Threat | Mitigation |
|--------|------------|
| Committer cherry-picks which items to reveal | Beacon-seeded selection; committer cannot choose |
| Committer modifies items after commitment | SHA-256 integrity check on reveal |
| Committer creates commitment after seeing beacon | Temporal ordering: beacon must postdate server-recorded `registered_at` |
| Committer picks the favorable receipt when servers used different rounds | `anchor_round`: all servers select with round `anchor_round + 2` (Section 8.1.1) |
| Committer anchors to an old round whose selection round is already public | Servers reject unless `round_time(anchor_round + 2)` is after `registered_at` plus a safety margin; verifiers recheck round and time (Section 10.5, step 2a) |
| Committer predicts beacon output | drand: requires compromising t-of-n League of Entropy nodes |
| Service operator tampers with commitments | Commitments are signed by the committer; tampering breaks the signature |
| Service operator backdates a commitment | `registered_at` is server-side; additionally, beacon round must postdate it |
| Committer reveals only easy/favorable items voluntarily | Voluntary vs. selected reveals are distinguished in the reveal object; reviewers can weight accordingly |
| Server issues a receipt with randomness of its choosing | Verifier checks `randomness == SHA-256(signature)` and the BLS signature for the round (Section 10.5, step 2) |
| Committer registers several commitments and publishes one (with or without a colluding server) | Not prevented. A re-signed commitment over the same items has a new `commitment_hash` and is accepted; `signer_activity` reports a count, it is not a limit. A colluding server can also drop the records of unpublished attempts. Relying parties should require receipts from several independent servers and fix the expected `commitment_hash` or stream in advance |
| Server (or committer colluding with one) picks between per-item and batch selection after seeing the beacon output | Partly. The verifier reports `selection_mode_default` as a warning when the mode is not the reference rule's, and servers advertise `selection_threshold`; the mode is not committer-signed in this version |
| SSRF via file_urls verification | Servers SHOULD restrict `file_urls` fetches to HTTPS with public IPs, rejecting private/internal network ranges |

## 15. Canonical JSON

1. No whitespace
2. Object keys in the order specified per object type
3. Strings use minimal JSON escaping (RFC 8259)
4. UTF-8 encoding
5. No trailing commas, no BOM
6. Arrays preserve element order

Key order per object type:

**Manifest entry:** `name`, `type`, `hash`

**Commitment signing payload:** `spec_version`, `items`, `item_count`, `reveal_probability`, `beacon`, `committed_at`, `signing_key`

**Beacon object:** `type`, then type-specific fields in alphabetical order. For drand: `type`, `anchor_round` (only if present), `chain_hash`

Optional fields that are absent are omitted. They are never serialized as `null`.

**Reveal signing payload:** `spec_version`, `commitment_hash`, `selected_items`, `voluntary_items`, `revealed_at`, `signing_key`
