# TODO: Deterministic Beacon Round Across Multiple Servers

## The Problem

When a commitment is submitted to multiple servers in parallel, each server independently records a `registered_at` timestamp and computes the selection using `nextRoundAfter(registered_at)` — the first drand round strictly after its own timestamp.

drand quicknet ticks every **3 seconds**. If one server receives the commitment slightly before a tick and another slightly after, they use **different beacon rounds** for selection, producing **different reveal decisions**.

### Observed in Production (2026-02-07)

```
cloudflare-1:   registered 16:02:32.434Z → arrival round 25892262 → selection round 25892263
google-cloud-1: registered 16:02:32.270Z → arrival round 25892262 → selection round 25892263
supabase-1:     registered 16:02:34.321Z → arrival round 25892263 → selection round 25892264
                                                                     ^^^^^^^^^^^^^^^^^^^^^^^^
                                                                     DIFFERENT ROUND
```

Supabase was ~2 seconds slower and landed in a different beacon period. Cloudflare and GCP agree on round 25892263, but Supabase uses round 25892264.

### Why This Matters

- Different beacon randomness → different items selected for reveal
- A verifier cannot determine "the" selection without knowing which round to trust
- The demo currently takes the **union** of all selections (line 26-33 of `packages/pb-demo/src/routes/step5-selection.js`), which biases toward more reveals and is gameable
- An adversary could exploit network timing to get two different selections and pick the one that favors them

### Root Cause

The selection round is derived from each server's **local timestamp**, not from a value agreed upon before submission. With N servers, you get up to N different `registered_at` values, and any pair that straddles a 3-second drand boundary will disagree.

---

## Strategy Evaluation

### Strategy A: Client-Specified Anchor Round (RECOMMENDED)

The client observes the current drand round **before** submitting, includes it in the commitment as `anchor_round`, and all servers use `anchor_round + 1` for selection.

**Protocol change:**
```json
{
  "spec_version": "0.3.0",
  "items": [...],
  "reveal_probability": 0.5,
  "beacon": {
    "type": "drand",
    "chain_hash": "52db9ba...",
    "anchor_round": 25892262
  },
  ...
}
```

**Server behavior:**
1. Verify `anchor_round` is valid: its randomness must already be public (round time ≤ now)
2. Verify `anchor_round` is recent: must be within `MAX_ANCHOR_AGE` rounds of current (e.g., 3 rounds = 9 seconds)
3. Verify the selection round `anchor_round + 1` is not yet available at `registered_at` (with a margin for clock skew); reject otherwise. Without this check, step 2 alone lets a client commit after seeing the selection randomness
4. Use `anchor_round + 1` for selection (instead of `nextRoundAfter(registered_at)`)
5. Still record `arrival_beacon` and `registered_at` as independent timestamp evidence

**Cheat analysis:**
| Attack | Blocked? | Why |
|--------|----------|-----|
| Client uses anchor_round whose randomness they already know | Only with step 3 | Selection uses `anchor_round + 1`, which is unknown only if the server rejects when that round is already available |
| Client tries many commitments to find favorable selection (grinding) | No | Many commitments can share one anchor round and be evaluated against the same future output; `signer_activity` and rate limiting only make it visible per key. Open problem A7 in the paper dossier |
| Client sets anchor_round far in the future | Yes | Server rejects: round hasn't happened yet |
| Client sets anchor_round far in the past | Yes | Server rejects: exceeds MAX_ANCHOR_AGE |
| Client waits to see round R+1's randomness, then submits with anchor_round=R | Only with step 3 | The staleness check does not block this: with `MAX_ANCHOR_AGE` = 3 rounds, R is still accepted after R+1 is public. Server must reject because round R+1 is already available |

**Pros:**
- Fully deterministic — all servers use the same round, zero ambiguity
- Blocks known-randomness selection only if step 3 is enforced; does not stop grinding (see table above)
- Independently verifiable — anyone with the commitment can check anchor_round validity
- No timing tricks — client doesn't need to carefully time submissions
- Backward compatible — old commitments without anchor_round fall back to current behavior

**Cons:**
- Requires spec change (new field in beacon object)
- Client needs to fetch current drand round before committing (one extra HTTP call)
- Adds ~3 seconds latency (must wait for anchor_round + 1)

### Strategy B: Client-Side Timing Guard

Client checks position within current 3-second beacon period. If >66% through, wait for next tick before submitting.

**Pros:** No spec change, simple
**Cons:** Only reduces probability, doesn't eliminate it. Network latency is unpredictable. Client could deliberately submit at boundaries to game it.

**Verdict:** Useful as defense-in-depth alongside Strategy A, but insufficient alone.

### Strategy C: Wait 2 Periods (use arrival + 2)

Server uses `nextRoundAfter(registered_at) + 1` instead of `nextRoundAfter(registered_at)`.

**Pros:** Simple server-side change, more buffer
**Cons:** Servers can STILL disagree on `nextRoundAfter(registered_at)` — adding 1 to both sides doesn't help. Also adds 3s latency.

**Verdict:** Does not solve the problem.

### Strategy D: Majority Vote (client-side)

Client collects receipts, groups by beacon round, uses the round that majority agrees on.

**Pros:** Handles "one slow server" naturally
**Cons:** Not cheat-proof if client controls servers. Ambiguous on ties. Third-party verifiers can't reproduce without all receipts.

**Verdict:** Reasonable fallback for old commitments, but not a primary solution.

### Strategy E: Earliest-Round-Wins (client-side)

Client uses the earliest (lowest) beacon round among all receipts.

**Pros:** Simple deterministic tiebreaker, strongest temporal guarantee
**Cons:** A malicious server could claim early arrival to force a specific round. Not reproducible without receipts.

**Verdict:** Good tiebreaker rule for legacy/fallback scenarios.

---

## Recommended Implementation Plan

### Phase 1: Anchor Round in Commitment (spec change)

1. **Update spec** — Add `anchor_round` as an optional field in the `beacon` object
2. **Update `pb-wasm` / Rust core** — Include `anchor_round` in commitment signing payload when present
3. **Update client (`pb-js`)** — Before committing:
   - Fetch current drand round from relay
   - Include `anchor_round: currentRound` in beacon object
   - This round's randomness is already public (provably "before" the commitment)
4. **Update servers (`pb-node` + all deploy targets)** — When `anchor_round` is present:
   - Validate it (recent, not future)
   - Use `anchor_round + 1` for selection instead of `nextRoundAfter(registered_at)`
   - When `anchor_round` is absent, fall back to current behavior (backward compat)
5. **Update receipt verification** — Verifier checks that `anchor_round` in commitment matches `selection.beacon_output.round - 1`

### Phase 2: Client-Side Timing Guard (defense-in-depth)

Even with anchor_round, add a timing guard so the anchor_round is fresh:

```javascript
// Before committing, ensure we're early in a beacon period
const currentRound = await fetchCurrentDrandRound();
const roundTime = drandRoundTime(currentRound);
const nextRoundTime = drandRoundTime(currentRound + 1);
const elapsed = Date.now() / 1000 - roundTime;
const period = nextRoundTime - roundTime; // 3 seconds

if (elapsed > period * 0.7) {
  // Too close to boundary — wait for next round
  await sleep((period - elapsed + 0.5) * 1000);
  currentRound += 1;
}
```

### Phase 3: Fix Demo Selection Union Bug

The demo's union approach (`step5-selection.js:26-33`) is wrong. With anchor_round, all servers agree on the same selection, so the union is unnecessary. But for robustness:

- If all servers agree → use that selection (the common case with anchor_round)
- If servers disagree (legacy commitments) → use earliest-round-wins as tiebreaker
- Never take the union — it inflates the selection and is gameable

### Phase 4: Verifier CLI Update

`pb verify-receipt` should check:
- If `anchor_round` present: verify `selection.beacon_output.round == anchor_round + 1`
- If `anchor_round` absent: verify `selection.beacon_output.round == nextRoundAfter(registered_at)`
- Flag receipts from multiple servers that disagree on beacon round

---

## Constants

```
MAX_ANCHOR_AGE = 3 rounds (9 seconds)  — reject if anchor_round is too old
MIN_ANCHOR_FRESHNESS = must be ≤ current_round  — reject if in the future
DRAND_PERIOD = 3 seconds
```

The `MAX_ANCHOR_AGE` of 3 rounds (9 seconds) gives comfortable buffer for:
- Client fetching the current round (~500ms)
- Client creating and signing the commitment (~100ms)
- Network latency to all servers (~1-3 seconds)
- Server processing time (~100ms)

This buffer is the source of the flaw noted in the correction at the top: an anchor up to 3 rounds old means `anchor_round + 1` may already be public. Either require `anchor_round` to equal the current round, or select with `anchor_round + d` where d covers `MAX_ANCHOR_AGE` plus clock skew, and have late servers reject.

---

## Summary

| Approach | Deterministic? | Cheat-proof? | Spec change? | Chosen? |
|----------|---------------|-------------|-------------|---------|
| A: Client anchor round | Yes | Only with the selection-round-not-yet-available check; not against grinding | Yes (minor) | PRIMARY |
| B: Timing guard | No | No | No | SUPPLEMENT |
| C: Wait 2 periods | No | N/A | No | REJECTED |
| D: Majority vote | Mostly | Partially | No | LEGACY FALLBACK |
| E: Earliest-round-wins | Yes | Partially | No | TIEBREAKER |

**The anchor round approach is the only strategy that is fully deterministic.** It prevents known-randomness selection only when servers reject commitments whose selection round is already available, and it does not address grinding. All others either leave room for disagreement or can be gamed. The timing guard and earliest-round-wins serve as defense-in-depth layers.

---

## Implementation Status (2026-10-04)

`beacon.anchor_round` is implemented, with two changes to Strategy A as written above:

- Selection uses `anchor_round + 2` (`ANCHOR_SELECTION_DELAY`), not `anchor_round + 1`.
- There is no `MAX_ANCHOR_AGE`. A server accepts an anchored commitment only if the selection round is not yet available at `registered_at`: `round_time(anchor_round + 2) > registered_at + 1 s`, and the anchor round is not in the future. An age limit alone would let a client register after the selection randomness is public.

The normative text is Section 8.1.1 of `docs/nocherry-commit-reveal-spec-v0.4.md`, with test vectors in Sections 13.6 to 13.8. The field is optional: commitments without it keep the per-server `nextRoundAfter(registered_at)` behavior, including the disagreement described in this document.

Anchoring does not stop a committer from registering several commitments against the same future round and publishing one. That needs a separate mechanism.
