# Archived Spec Content

Content removed from `nochery-commit-reveal-spec-v0.4.md` during trimming.
These sections were cut because they describe unimplemented features, design rationale
that doesn't belong in a normative spec, or aspirational architecture.

---

## Design Priorities (removed items)

6. **File-native** — all committed data is files in directories; binary formats like Parquet are acceptable only when partial reveal is not required
7. **Git-compatible distribution** — revealed data can be published as a git repo on GitHub or HuggingFace, but git is a delivery mechanism, not part of the verification layer

---

## Architecture Layers (removed section 1.3)

This spec covers the **canonical layer** — the files, hashes, commitments, and reveals that are cryptographically verified. Two other layers exist but are out of scope:

- **Index layer**: Ingests committed/revealed files into Postgres with full-text search, parsed/structured views for browsing and comparison. Derived from the canonical layer; can always be regenerated.
- **Raw archive**: The original files, always accessible via link from the index layer. When a reviewer sees a nicely parsed SWE-bench log in the web UI, they can click through to the actual raw file.

The index layer never participates in hashing or verification.

---

## Why Not CID? (removed section 2.1)

CID wraps the hash with multibase + multicodec + multihash metadata. In a closed system with a single hash algorithm and encoding, these bytes are constant overhead that encodes a choice we already made. If future interop with IPFS/IPLD is needed, a CID envelope can be added as a compatibility layer without changing the underlying hash.

---

## Why Not Git Hashing? (removed section 2.2)

Git blob hashes include a `blob <size>\0` header, so `SHA-256(file_bytes)` ≠ `git hash-object file`. Git tree hashes encode Unix file modes (100644/40000/120000), so the same file with different executable bits produces different tree hashes. Git is currently transitioning from SHA-1 to SHA-256, with limited SHA-256 repo support on major hosts. This protocol uses raw SHA-256 of file bytes so that `sha256sum myfile.json` matches the hash in the manifest — no git-specific tooling required.

---

## String Encoding Rationale (removed section 2.3)

Hex is universally supported, unambiguous, and easy to debug. The cost is length (64 chars vs ~44 for base64), but these hashes are machine-consumed identifiers, not URLs or DNS labels where brevity matters.

---

## Data Structure Requirement (removed section 5.1)

Benchmark datasets intended for partial reveal MUST be structured as one file per logical unit (test case, question, code sample, etc.):

```
my-benchmark/
  case_001.json
  case_002.json
  ...
  case_500.json
```

Or with subdirectories for organizational clarity:

```
my-benchmark/
  easy/
    case_001.json
    case_002.json
  hard/
    case_101.json
    case_102.json
```

Per-file hashing is trivial — each file has its own SHA-256. Reveal by publishing selected files. Verification is `sha256sum` on each file, checked against the manifest. No serialization ambiguity.

Monolithic formats (Parquet, JSONL) are acceptable for fully-public data or result submissions where partial reveal is not needed, but they cannot support per-item reveal. A single Parquet file with a SHA-256 hash and a signed commitment is valid for full-dataset publication.

---

## Item Hash Ordering (removed section 5.2)

For a flat benchmark directory:
```
my-benchmark/
  case_001.json   →  SHA-256 → hash_001
  case_002.json   →  SHA-256 → hash_002
  ...
  case_500.json   →  SHA-256 → hash_500
```

The commitment's `items` array is `[hash_001, hash_002, ..., hash_500]`, sorted in the same lexicographic order as the filenames.

For nested directories, items are the leaf files with paths flattened using `/` as separator, sorted lexicographically:
```
easy/case_001.json  →  hash
easy/case_002.json  →  hash
hard/case_101.json  →  hash
```

The directory hashing (Section 4) can additionally be used to produce a single root hash for the entire dataset, which higher-level systems may use for integrity checking of the complete tree.

---

## stream_id field (removed from section 7.1)

- **`stream_id`** (string, optional): an opaque identifier for grouping related commitments (e.g., `s_benchmark-2026-q1`). Not part of the signed payload. Useful for organizing commitments into logical series.

---

## Why HMAC-SHA256 instead of a standard library? (removed section 8.2)

Built-in PRNGs (`Math.random()` in JS, `random.shuffle()` in Python) use different algorithms internally (xorshift128+ vs. Mersenne Twister) and cannot produce identical outputs across languages from the same seed.

The closest standard is **HMAC_DRBG** from NIST SP 800-90A — a standardized CSPRNG built on HMAC. Our construction is a simplified variant of its generate phase: `HMAC-SHA256(seed, counter)` is the core operation, but we skip the instantiation ceremony (deriving initial K/V state), reseeding, and prediction resistance tracking that HMAC_DRBG requires for long-lived generators. We don't need any of that — we seed once with a beacon output and draw a small number of values.

The result is 5 lines of code per language, uses only HMAC-SHA256 (which every crypto library provides), and is fully specified with no hidden implementation details. The Python and JavaScript reference implementations produce bit-identical outputs for all test vectors.

---

## NIST Randomness Beacon (removed section 9.3)

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

**Status:** Specified but not yet implemented. Current implementations support drand only.

---

## Adding New Beacon Types (removed section 9.4)

New beacon types can be added by implementing the beacon interface (Section 9.1). The `beacon.type` string must be registered in the service configuration. Commitments are permanently bound to their beacon type — the same commitment cannot be evaluated against a different beacon.

---

## Beacon Liveness — retired beacons (removed partial section 9.5)

If a beacon is permanently retired, existing commitments bound to it remain valid as long as historical outputs are archived. The service SHOULD maintain a cache of beacon outputs for all commitments it has processed.

---

## Server Discovery — fetchable list and example (removed from section 11.3)

2. **Fetchable list.** A JSON document at a well-known URL (e.g. `https://cr.example.com/servers.json`) provides the current server list. The client fetches this on startup and caches it. The document is signed so it can be verified even if served through a CDN.

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
      "contact": "ops@ethz.ch"
    },
    {
      "url": "https://cr.cloudflare.com",
      "operator": "Cloudflare",
      "server_key": "did:key:z6Mkr...",
      "retention": "30d",
      "contact": "ops@cloudflare.com"
    },
    {
      "url": "https://cr.example.com",
      "operator": "Example Operator",
      "server_key": "did:key:z6Mks...",
      "retention": "forever",
      "contact": "ops@example.com"
    }
  ],
  "signature": "..."
}
```

Each server has its own Ed25519 signing key, used to sign responses (including `signer_activity` counts and `registered_at` timestamps). The server's public key is published in the server list and at `GET /v1/server-info` on the server itself.

---

## Multi-Submit ASCII diagram (removed from section 11.4)

```
Client                    Server A          Server B          Server C
  |---POST /v1/commit--->|                  |                  |
  |---POST /v1/commit--->|----------------->|                  |
  |---POST /v1/commit--->|----------------->|----------------->|
  |<--201 {hash, reg_a}--|                  |                  |
  |<--201 {hash, reg_b}--|------------------|                  |
  |<--201 {hash, reg_c}--|------------------|------------------|
```

---

## Data Retention server-info example (removed from section 12.2.1)

```json
{
  "operator": "ETH Zürich",
  "server_key": "did:key:z6Mkq...",
  "retention": "30d",
  "signer_activity_windows": ["1h", "30d"],
  "beacon_types": ["drand"],
  "spec_version": "0.2.0",
  "version": "0.2.0"
}
```

- **`retention`**: a duration string (`30d`, `90d`, `forever`).
- **`signer_activity_windows`**: which time windows appear in `signer_activity` — servers with longer retention may include additional windows like `365d`.
- **`beacon_types`**: which beacon types the server supports. Currently `["drand"]`.
- **`spec_version`**: the spec version the server implements.
- **`version`**: the server software version.

---

## Verification Service (removed section 13)

### Why Separate

Commit-reveal servers are lightweight receipt printers. Full verification requires downloading potentially large datasets, hashing every file, and confirming matches. These are fundamentally different workloads with different resource profiles and different trust implications. Bundling them would make it harder to run a commit-reveal server (higher bandwidth/compute requirements) and would conflate two roles: "I recorded when this commitment was made" vs. "I checked that the revealed data is legit."

Note: the `verify-publication` endpoint (Section 12.8) provides limited server-side verification of data at specific URLs. Full verification — including commitment signature, beacon authenticity, selection correctness, and data integrity — is the domain of the verification service or CLI tooling.

### Who Runs It

Anyone can run a verification service. An operator may choose to host one at a well-known URL (e.g. `https://verify.example.com`) as a convenience, but this is not guaranteed to remain available and should not be treated as authoritative. Users who care about verification should run it themselves or use the CLI tooling.

### Verification API

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

### CLI Verification

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

---

## Hashing Reference Implementations (removed section 14)

### JavaScript (Node.js)

```javascript
const crypto = require('crypto');
const fs = require('fs');

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function canonicalJson(obj) {
  return JSON.stringify(obj);
  // Keys must be inserted in correct order before serialization
}
```

### Python

```python
import hashlib
import json

def hash_file(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def canonical_json(obj) -> bytes:
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    # Dicts must have keys in correct order: name, type, hash
```

### Canonical JSON Cross-Language Notes

Both implementations MUST produce identical JSON bytes. In JavaScript, `JSON.stringify` preserves insertion order. In Python, `json.dumps` with `separators=(',',':')` and `ensure_ascii=False` does the same (dicts are insertion-ordered since Python 3.7). Keys must be constructed in the specified order before serialization.

---

## CLI Command Reference (removed section 18)

```bash
# Hash a directory or file
commit-reveal hash .
commit-reveal hash dataset.parquet

# Hash and list all items (for commit-reveal)
commit-reveal hash --items .
# Output: sorted list of (path, hash) pairs
```

---

## Future Considerations (removed section 19)

- **Timelock encryption:** drand quicknet supports timelock encryption. Items could be encrypted such that they automatically become readable when the beacon round occurs — eliminating the need for active participation in reveals.
- **CID wrapping:** raw SHA-256 hashes can be wrapped in CIDv1 without changing the underlying computation.
- **Hash algorithm migration:** a `spec_version` bump would indicate the new algorithm; old hashes remain valid under their version.
- **Chunked Merkle hashing:** for partial verification of individual large files (>1GB), a chunked scheme can be added in a future version.
- **Merkle commitments:** for very large item sets (>100k), a Merkle root over sorted hashes could replace the full list, with Merkle proofs for individual items.
- **Witness cosigning:** third parties cosign commitments for independent timestamps.
- **Commitment chaining:** linking a new commitment to a previous one (dataset versioning) via a `supersedes` field.
- **Selection receipts:** beacon nodes or third-party witnesses could sign selection records for additional non-repudiation.
- **NIST beacon implementation:** the NIST Randomness Beacon v2.0 is specified (Section 9.3) but not yet implemented in the reference codebase.
