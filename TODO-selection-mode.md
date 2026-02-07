# TODO: Selection Mode — Default to Batch, Allow User Choice

## Problem

The selection mechanism currently uses **per_item** (independent coin flip) for 1-20 items and **batch** (Fisher-Yates shuffle) for 21+. The web demo creates 5 items → uses per_item → selected count is random (could be 0 to 5), which is confusing. Users expect a deterministic "50% of items" selection.

## Design

1. **Change default**: 1 item → per_item (coin flip), 2+ items → batch (Fisher-Yates shuffle, exact count = `ceil(p × n)`)
2. **Add optional `selection_mode` field to the commitment** so users can explicitly choose `"per_item"` or `"batch"`
3. Servers respect the commitment's choice, falling back to the new default
4. Backward compatible: old commitments without `selection_mode` still verify (field is skipped in signing payload when absent via `skip_serializing_if`)

## Changes

### Rust Core

**`crates/pb-core/src/select.rs`**
- Change `selection_mode()` threshold from 20 to 2
- Update `select_auto()` to accept optional mode override: `requested_mode: Option<&str>`

**`crates/pb-core/src/commitment.rs`**
- Add `selection_mode: Option<String>` to `Commitment` struct (with `skip_serializing_if = "Option::is_none"`)
- Add `selection_mode: Option<String>` to `CreateParams`
- Add `selection_mode: Option<&'a str>` to `SigningPayload` (after `reveal_probability`, before `beacon`, with `skip_serializing_if`)

**`crates/pb-core/src/verify.rs`**
- Pass `commitment.selection_mode` through to `select_auto()`

**`crates/pb-wasm/src/lib.rs`**
- Pass `selection_mode` from JSON params through to `CreateParams`

### Servers (4 × 2 files)

**All 4 `beacon.js`/`beacon.ts`**:
- `packages/pb-node/src/beacon.js`
- `deploy/cloudflare/src/beacon.js`
- `deploy/google-cloud/src/beacon.js`
- `deploy/supabase/.../beacon.ts`

Replace hardcoded `if (itemCount >= 20)` with:
```javascript
const mode = commitment.selection_mode
  || (itemCount === 1 ? 'per_item' : 'batch');
```

**All 4 commitment routes** — add validation:
```javascript
if (body.selection_mode !== undefined
    && body.selection_mode !== 'per_item'
    && body.selection_mode !== 'batch') {
  return c.json({ error: 'selection_mode must be "per_item" or "batch"' }, 400);
}
```

### CLI

**`packages/pb-js/src/cli.js`** — add `--selection-mode batch|per_item` flag to `pb commit`

### Spec

**`docs/commit-reveal-spec.md`** — update Section 4.5:
| Scenario | Default mode | Rationale |
|----------|-------------|-----------|
| 1 item | per_item | Bernoulli trial: selected or not |
| 2+ items | batch | Exact count via shuffle is predictable |

Add note: "The commitment may include an optional `selection_mode` field to override the default."

### Tests

- Rust: update `selection_mode_threshold` test (1→per_item, 2→batch), add mode override test
- pb-node: verify 5-item commitment uses batch, explicit per_item override works, invalid mode rejected
- CLI: `--selection-mode` flag test
- Playwright: run existing (demo 5 items → now batch → deterministic count)

## Build Order

1. Rust core changes + `cargo test`
2. WASM rebuild (`wasm-pack build`)
3. Server beacon.js + commitment route changes
4. CLI flag
5. Run all tests: pb-node, CLI, Playwright
