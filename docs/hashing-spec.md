# Hashing Specification

**Version:** 0.3.0-draft
**Status:** Draft for review

## 1. Overview

This specification defines how benchmark datasets are hashed — the deterministic process of turning files and directories into SHA-256 hashes. These hashes serve as inputs to the Commit-Reveal Service (see separate specification), which handles temporal ordering, randomized selection, and verification.

This spec covers the **hashing layer only**: files → hashes. Everything about commitments, reveals, drand, and verification lives in the Commit-Reveal Service Specification.

### 1.1 Design Priorities

1. **Determinism** -- identical inputs always produce identical hashes, regardless of implementation language, OS, or filesystem
2. **Simplicity** -- zero configuration knobs; one way to do everything
3. **File-native** -- all committed data is files in directories; binary formats like Parquet are acceptable only when partial reveal is not required
4. **Git-compatible distribution** -- revealed data can be published as a git repo on GitHub or HuggingFace, but git is a delivery mechanism, not part of the verification layer
5. **Minimal dependencies** -- hashing requires only SHA-256 and JSON; no IPFS, no CID encoding, no multiformat overhead

### 1.2 Architecture Layers

This spec covers the **canonical layer** -- the files, hashes, commitments, and reveals that are cryptographically verified. Two other layers exist but are out of scope:

- **Index layer**: Ingests committed/revealed files into Postgres with full-text search, parsed/structured views for browsing and comparison. Derived from the canonical layer; can always be regenerated.
- **Raw archive**: The original files, always accessible via link from the index layer. When a reviewer sees a nicely parsed SWE-bench log in the web UI, they can click through to the actual raw file.

The index layer never participates in hashing or verification.

### 1.3 Data Structure Requirement

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

Per-file hashing is trivial -- each file has its own SHA-256. Reveal by publishing selected files. Verification is `sha256sum` on each file, checked against the manifest. No serialization ambiguity.

Monolithic formats (Parquet, JSONL) are acceptable for fully-public data or result submissions where partial reveal is not needed, but they cannot support per-item reveal. A single Parquet file with a SHA-256 hash and a signed commitment is valid for full-dataset publication.

## 2. Hash Algorithm

- **Algorithm:** SHA-256 (always, no alternatives)
- **Output:** 32 bytes (256 bits) raw binary internally
- **String encoding:** lowercase hex (64 characters) for display, storage, and JSON serialization

Example: `a1b2c3d4e5f6...` (64 hex chars)

### 2.1 Why Not CID?

CID wraps the hash with multibase + multicodec + multihash metadata. In a closed system with a single hash algorithm and encoding, these bytes are constant overhead that encodes a choice we already made. If future interop with IPFS/IPLD is needed, a CID envelope can be added as a compatibility layer without changing the underlying hash.

### 2.2 Why Not Git Hashing?

Git blob hashes include a `blob <size>\0` header, so `SHA-256(file_bytes)` ≠ `git hash-object file`. Git tree hashes encode Unix file modes (100644/40000/120000), so the same file with different executable bits produces different tree hashes. Git is currently transitioning from SHA-1 to SHA-256, with limited SHA-256 repo support on major hosts. This protocol uses raw SHA-256 of file bytes so that `sha256sum myfile.json` matches the hash in the manifest -- no git-specific tooling required.

### 2.3 String Encoding

Hex is universally supported, unambiguous, and easy to debug. The cost is length (64 chars vs ~44 for base64), but these hashes are machine-consumed identifiers, not URLs or DNS labels where brevity matters.

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

A directory hash is computed from a **manifest** -- a canonical JSON representation of the directory's contents, then hashed with SHA-256.

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

- **`name`** (string): the filename (basename only, no path separators). Must be valid UTF-8.
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
- Entries named `.DS_Store` or `Thumbs.db`
- Entries named `.git` (directories)
- Entries starting with `.commit-reveal` (reserved for protocol metadata)

Hidden files (other dotfiles) ARE included by default. Implementations MAY accept an additional exclusion list.

### 4.5 Empty Directory

An empty directory has manifest `[]`, hash: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`

### 4.6 Recursion

Subdirectories are hashed depth-first. Implementations SHOULD warn on depths exceeding 100 levels.

## 5. Producing Item Hashes for Commit-Reveal

When preparing a benchmark dataset for the Commit-Reveal Service, each leaf file becomes one "item" with a SHA-256 hash. The hashes from this spec become the `items` array in a commitment object (see Commit-Reveal Service Specification).

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

## 6. Reference Implementation Notes

### 6.1 JavaScript (Node.js)

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

### 6.2 Python

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

### 6.3 Canonical JSON Cross-Language Notes

Both implementations MUST produce identical JSON bytes. In JavaScript, `JSON.stringify` preserves insertion order. In Python, `json.dumps` with `separators=(',',':')` and `ensure_ascii=False` does the same (dicts are insertion-ordered since Python 3.7). Keys must be constructed in the specified order before serialization.

## 7. Interop Test Vectors

Implementations MUST pass all test cases.

### 7.1 File Hashes

| Input | Expected Hash |
|-------|--------------|
| Empty file (0 bytes) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `hello\n` (6 bytes) | `5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03` |
| `hello` (5 bytes, no newline) | `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` |

### 7.2 Directory Hashes

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

## 8. CLI Command Reference

```bash
# Hash a directory or file
cr hash .
cr hash dataset.parquet

# Hash and list all items (for commit-reveal)
cr hash --items .
# Output: sorted list of (path, hash) pairs
```

## 9. Future Considerations

- **CID wrapping:** raw SHA-256 hashes can be wrapped in CIDv1 without changing the underlying computation
- **Hash algorithm migration:** a `spec_version` bump would indicate the new algorithm; old hashes remain valid under their version
- **Chunked Merkle hashing:** for partial verification of individual large files (>1GB), a chunked scheme can be added in a future version
