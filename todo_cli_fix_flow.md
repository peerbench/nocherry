# CLI `pb go` Flow Fix Plan

## Problem

The `pb go` wizard in `packages/pb-js/src/cli.js` (lines 1222-1474) has two bugs:

1. **Reveals all items** — it adds every non-selected item as `voluntary_items` (line 1386). Should only reveal `selected_items`.
2. **Reveal happens before publish** — Step 4 creates+submits the reveal, Step 5 publishes. This is backwards: you need to publish data first so the reveal can reference where the data lives.
3. **No publish-server upload** — the publish step only supports GitHub and HuggingFace git repos, never uploads to the project's own R2/GCS publish servers listed in `servers.json` → `reveal_publishers`.

## Correct Step Order

```
Step 1: Hash          (unchanged)
Step 2: Commit        (unchanged)
Step 3: Submit        (unchanged)
Step 4: Publish       (was Step 5 — move up, make mandatory, add publish-server upload)
Step 5: Reveal        (was Step 4 — move down, only reveal selected items)
```

## Detailed Changes

### File: `packages/pb-js/src/cli.js`

#### Change 1: Swap Steps 4 and 5

Move the publish block (current lines 1453-1463) to run BEFORE the reveal block (current lines 1372-1451). Update step numbering from "Step X of 5" accordingly.

#### Change 2: Make publish mandatory, not optional

Current code (line 1457-1460):
```js
const publishAnswer = await prompt('  Publish now? [y/N] ');
if (publishAnswer.toLowerCase() === 'y') {
```

Change to always publish (no prompt). The step description should say:
```
Step 4 of 5 — Publish
Publish your data and protocol evidence to GitHub and a publish server.
```

#### Change 3: Publish to GitHub AND try one publish server

After the GitHub publish succeeds, also attempt to upload to one of the `reveal_publishers` from `servers.json`.

The publish server upload should:
1. Load publishers via `getRevealPublishers()` from `packages/pb-js/src/registry.js` (line 59)
2. Pick the first available publisher (e.g. `dev-cloudflare`)
3. Upload files via `POST /v1/upload` (multipart form: `receipt` JSON field + `files[]` file fields)
   - See upload API at `dev-reveal-publishing-helpers/cloudflare-r2/src/routes/upload.js`
   - The receipt is `server-receipts.json` or `receipt.json` from the dir
   - The files are the actual data files (not protocol files)
4. **Only error/exit if the GitHub upload fails** — publish server failure should log a warning but continue
5. If the publish server upload succeeds, register its returned URLs as an additional mirror (using existing `registerMirrorWithServers()` at line 543)

Pseudocode for the new publish step:
```js
// ── Step 4: Publish ──
console.log('  Step 4 of 5 — Publish');
console.log('  Publish your data and protocol evidence to GitHub and a publish server.');
await waitForEnter();

// 4a. GitHub publish (required — error if fails)
await cmdPublishGithub(dirPath);

// 4b. Publish server upload (best-effort — warn if fails)
try {
  const publishers = getRevealPublishers();
  if (publishers.length > 0) {
    const publisher = publishers[0];
    // Build multipart form with receipt + data files
    // POST to publisher.url + '/v1/upload'
    // On success: register mirror with commit-reveal servers
    // On failure: console.log warning, continue
  }
} catch (err) {
  console.log(`  ⚠ Publish server upload failed: ${err.message}`);
  console.log('  (continuing — GitHub publish succeeded)');
}
```

#### Change 4: Only reveal selected items

Current code (line 1386-1393):
```js
const voluntaryItems = commitment.items.filter(h => !selectedItems.includes(h));
const revealPayload = {
  ...
  selected_items: selectedItems,
  voluntary_items: voluntaryItems,
  ...
};
```

Change to:
```js
const revealPayload = {
  spec_version: '0.2.0',
  commitment_hash: commitment.commitment_hash,
  selected_items: selectedItems,
  voluntary_items: [],          // <-- empty, only reveal what was selected
  revealed_at: new Date().toISOString(),
  signing_key: key.did || key.did_key,
};
```

Also update the log line (line 1403) to not mention voluntary count:
```js
console.log(`  ✓ Revealing ${selectedItems.length} selected item${selectedItems.length !== 1 ? 's' : ''}`);
```

#### Change 5: Update step descriptions

- Step 4 text: `"Publish your data and protocol evidence to GitHub and a publish server."`
- Step 5 text: `"Sign and submit reveal for the randomly selected items."`
- Step 5 outputs: `"→ reveal.json, reveal-receipts.json"`

#### Change 6: Update summary section

The summary (lines 1465-1473) should reflect the new order and mention `publication.json` (which `cmdPublishGithub` already writes):
```
  Done! Evidence chain in ${dirPath}:
    manifest.json        file hashes
    commitment.json      signed commitment
    server-receipts.json server timestamps
    publication.json     publish receipts
    reveal.json          signed reveal
    reveal-receipts.json server confirmations
```

## Files to Modify

| File | What |
|------|------|
| `packages/pb-js/src/cli.js` lines 1222-1474 | `cmdGo()` — reorder steps, fix reveal scope, add publish server |

## Files to Reference (read-only)

| File | Why |
|------|-----|
| `packages/pb-js/src/registry.js` | `getRevealPublishers()` helper (line 59) |
| `servers.json` | `reveal_publishers` array with R2/GCS URLs |
| `dev-reveal-publishing-helpers/cloudflare-r2/src/routes/upload.js` | Upload API shape (multipart: receipt + files[]) |
| `dev-reveal-publishing-helpers/cloudflare-r2/src/middleware/auth.js` | Auth requirements for upload |

## Important Notes

- The `cmdPublishGithub()` function (line 780) already handles: git push, mirror registration, publication verification, and writing `publication.json`. No changes needed there.
- The publish server upload is a NEW addition — there's no existing function for it. You'll need to build the multipart form upload inline or as a small helper.
- The publish server requires auth (bearer token via `requireAuth()` middleware). Check `dev-reveal-publishing-helpers/cloudflare-r2/src/middleware/auth.js` for auth details. If no auth token is available, skip the publish server upload with a warning.
- `getRevealPublishers` is already exported from `registry.js` but not currently imported in `cli.js` — add it to the import.
