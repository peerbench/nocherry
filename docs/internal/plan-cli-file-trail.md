# Plan: CLI Protocol File Trail

Every CLI step should produce a local file. After a full workflow, the user's directory contains a complete, self-contained evidence chain that anyone can verify offline.

## Current State

Today the CLI mostly prints to stdout and relies on the user to redirect output:

| Command | Output | Saves File? |
|---------|--------|-------------|
| `pb hash dir <dir>` | JSON to stdout | No |
| `pb commit <dir>` | JSON to stdout | No |
| `pb submit <commitment.json>` | JSON to stdout | No |
| `pb publish github <dir>` | Console logs | Yes (`publication.json`) |

## Target State

| Step | Command | File Created | Contents |
|------|---------|-------------|----------|
| 1 | `pb hash dir <dir>` | `<dir>/manifest.json` | `{ spec_version, items: [{path, hash}], root_hash, created_at }` |
| 2 | `pb commit <dir>` | `<dir>/commitment.json` | Signed commitment (same JSON as today's stdout, saved to disk) |
| 3 | `pb submit <dir>` | `<dir>/server-receipts.json` | `{ receipts: [{ server, receipt }] }` — one entry per server |
| 4 | `pb reveal <dir>` | `<dir>/reveal.json` + `<dir>/reveal-receipts.json` | Reveal payload + server responses |
| 5 | `pb publish github <dir>` | `<dir>/publication.json` | Mirror URLs, attestations (already exists) |

After step 5, the directory looks like:

```
my-benchmark/
├── result-01.json          # user's data
├── result-02.json
├── result-03.json
├── manifest.json           # step 1: file hashes
├── commitment.json         # step 2: signed commitment
├── server-receipts.json    # step 3: server timestamps
├── reveal.json             # step 4: reveal payload
├── reveal-receipts.json    # step 4: server reveal confirmations
└── publication.json        # step 5: mirror URLs + attestations
```

All protocol files also get copied into the GitHub repo and summarized in a human-readable README.

---

## Implementation Details

### 0. Protocol File Exclusion

`walkDir()` must skip protocol files at the root level so re-running `pb hash dir` after saving `manifest.json` doesn't include it:

```javascript
const PROTOCOL_FILES = new Set([
  'manifest.json', 'commitment.json', 'server-receipts.json',
  'reveal.json', 'reveal-receipts.json', 'publication.json',
  'receipt.json', 'verify.sh', 'README.md',
]);

function walkDir(dir, rootDir = dir) {
  // When processing rootDir entries, skip PROTOCOL_FILES
  for (const entry of entries) {
    if (dir === rootDir && PROTOCOL_FILES.has(entry.name)) continue;
    // ... rest unchanged
  }
}
```

### 1. `pb hash dir <dir>` → manifest.json

Current: prints `{ hash, items }` to stdout.

Change:
- Build the same item list as today
- Save `manifest.json` to the directory:
  ```json
  {
    "spec_version": "0.2.0",
    "root_hash": "<hash>",
    "items": [
      { "path": "result-01.json", "hash": "<sha256>" },
      { "path": "result-02.json", "hash": "<sha256>" }
    ],
    "created_at": "<ISO timestamp>"
  }
  ```
- Still print the root hash + item count to stdout (unchanged behavior)
- Print `Saved manifest.json` to stderr

### 2. `pb commit <dir>` → commitment.json

Current: prints full commitment JSON to stdout, user pipes to file.

Change:
- After creating the commitment, write it to `<dir>/commitment.json`
- Still print the full JSON to stdout (backwards compatible — existing pipes still work)
- Print `Saved commitment.json` to stderr

### 3. `pb submit <dir>` → server-receipts.json (directory mode)

Current: `pb submit <commitment.json>` takes a single file, submits to one server, prints receipt to stdout.

Change — add directory mode:
- `pb submit <dir>` detects a directory, reads `commitment.json` from it
- Submits to ALL servers in registry (parallel, like the demo does)
- Saves `server-receipts.json`:
  ```json
  {
    "spec_version": "0.2.0",
    "commitment_hash": "<hash>",
    "submitted_at": "<ISO timestamp>",
    "receipts": [
      {
        "server_name": "nocherry-dev-1",
        "server_url": "https://...",
        "receipt": { ... full receipt ... }
      }
    ]
  }
  ```
- Also saves `receipt.json` (the first successful receipt) for backwards compatibility
- Print summary to stdout, details to stderr
- Keep single-file mode (`pb submit commitment.json`) working as before

### 4. New command: `pb reveal <dir>`

This command doesn't exist yet. Currently reveal is only done in the web demo (step 6).

- Read `server-receipts.json` (or `receipt.json`) to get beacon round + selection
- Compute which items are selected
- Create the reveal payload (selected item hashes)
- Sign it
- Submit reveal to all servers
- Save `reveal.json` (the reveal payload) and `reveal-receipts.json` (server responses)

### 5. `pb publish github <dir>` — enhanced

Current: copies data + receipt.json + commitment.json to GitHub, writes publication.json.

Change:
- Copy ALL protocol files (manifest.json, commitment.json, server-receipts.json, reveal.json, reveal-receipts.json, publication.json) into the GitHub repo
- Generate a comprehensive `README.md` in the reveal folder with human-readable tables:

```markdown
# Commitment Reveal: <hash-prefix>

## Protocol Evidence

### Commitment
| Field | Value |
|-------|-------|
| Hash | `abc123...` |
| Items | 3 files |
| Reveal probability | 50% |
| Signing key | `did:key:z...` |
| Created | 2026-02-07T... |

### Server Receipts
| Server | Beacon Round | Received At |
|--------|-------------|-------------|
| nocherry-dev-1 | 12345678 | 2026-02-07T... |
| nocherry-dev-2 | 12345678 | 2026-02-07T... |

### Random Selection
| # | File | Hash | Selected? |
|---|------|------|-----------|
| 1 | result-01.json | `abc...` | Yes |
| 2 | result-02.json | `def...` | No |
| 3 | result-03.json | `ghi...` | Yes |

### Publication Verification
| Server | Verified Items | All Match? | Verified At |
|--------|---------------|------------|-------------|
| nocherry-dev-1 | 2/3 | Yes | 2026-02-07T... |

## Verify Yourself
\`\`\`bash
./verify.sh
\`\`\`
```

### 6. stderr for status messages

All "Saved X" messages go to stderr so stdout remains clean JSON for piping:
```javascript
console.error('Saved manifest.json');      // stderr
console.log(JSON.stringify(manifest));      // stdout (parseable)
```

---

## Test Plan

### Unit tests (packages/pb-js/test/cli.test.js)

- `pb hash dir` creates manifest.json in directory
- `pb commit <dir>` creates commitment.json in directory
- `pb submit <dir>` creates server-receipts.json (needs mock server or real test server)
- Re-running `pb hash dir` after saving manifest.json produces same hash (protocol files excluded)
- manifest.json contains correct paths and hashes

### E2E tests (packages/pb-node/test/e2e.test.js)

- Full cycle with file trail: hash → commit → submit → reveal → publish → verify
- All protocol files exist and contain valid JSON
- Protocol files round-trip: can load each file and use it for next step

---

## Order of Implementation

1. Add `PROTOCOL_FILES` exclusion to `walkDir()`
2. `pb hash dir` → save manifest.json
3. `pb commit <dir>` → save commitment.json
4. `pb submit <dir>` → directory mode + save server-receipts.json
5. `pb reveal <dir>` → new command
6. Update `pb publish github` to copy all protocol files + generate README tables
7. Update tests
8. Run full test suite
