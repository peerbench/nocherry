# DID Identity Verification — Spec Addendum

**Status:** Draft
**Applies to:** Spec v0.2.0+

## Overview

Nocherry commit servers currently verify that a commitment's Ed25519 signature
matches its `signing_key` (a `did:key`). This proves "this key signed this data"
but says nothing about **who** owns the key.

This addendum introduces an optional `identity` field (e.g.
`did:web:alice.example.com`) so the server can resolve the DID document and
confirm the signing key is listed there — proving "this key belongs to this
identity at this time."

## The `identity` Field

| Property | Value |
|----------|-------|
| **Field name** | `identity` |
| **Location** | Commitment object, sibling to `signing_key` |
| **Required** | No — commitments without `identity` behave identically to before |
| **Type** | DID string (e.g. `did:web:example.com`, `did:plc:abc123`) |
| **Signed** | Yes — included in the signing payload (tamper-proof) |

When present, `identity` is placed **after** `signing_key` in the canonical
signing payload key order.

### Updated Signing Payload Key Order

```
spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key, identity
```

When `identity` is `None`/absent, it is **completely omitted** from the signing
payload (not serialized as `null`). This means existing commitments without an
identity field produce the exact same signing payload and commitment hash as
before — full backward compatibility.

## Supported DID Methods

| Method | Resolution |
|--------|------------|
| `did:web` | Transform DID to HTTPS URL, fetch `did.json` |
| `did:plc` | `GET https://plc.directory/{did}` |
| `did:webvh` | Same URL transform as `did:web`, fetch DID document |

### Resolution Details

**`did:web`** resolution follows the [DID Web spec](https://w3c-ccg.github.io/did-method-web/):
- `did:web:example.com` → `https://example.com/.well-known/did.json`
- `did:web:example.com:path:to` → `https://example.com/path/to/did.json`

**`did:plc`** resolution queries the PLC directory:
- `did:plc:abc123` → `GET https://plc.directory/did:plc:abc123`

**`did:webvh`** resolution uses the same URL transform as `did:web`.

## Server Behavior

### DID Resolution

- Resolution happens **server-side** and is **asynchronous**
- The resolution promise is fired immediately after signature verification,
  then runs in parallel with beacon waiting and selection computation
- Resolution has a **5-second timeout** — it never blocks `registered_at` or
  the drand flow
- Any error (network, parse, timeout, unsupported method) is gracefully handled

### Receipt Field: `key_matches_identity`

The server adds `key_matches_identity` to the receipt with one of these values:

| Value | Meaning |
|-------|---------|
| `"matched"` | DID document was resolved and contains the `signing_key` |
| `"mismatch"` | DID document was resolved but does **not** contain the `signing_key` |
| `"error"` | Resolution failed (network error, timeout, invalid document) |
| `"unsupported"` | DID method is not supported by this server |
| `null` | No `identity` field was provided in the commitment |

**Important:** `key_matches_identity` is an **informational, point-in-time check**.
The server does not store DID document snapshots, and does not re-resolve on
`GET /v1/commitments/:hash` — that endpoint returns `key_matches_identity: null`.

## Key Matching

The server extracts verification methods from the resolved DID document:

1. Iterate over `verificationMethod` array in the DID document
2. For each method, extract the public key (`publicKeyMultibase` or `publicKeyJwk`)
3. Convert each key to `did:key` format
4. Compare against the commitment's `signing_key`
5. If any match → `"matched"`, otherwise → `"mismatch"`

## Backward Compatibility

- Commitments without `identity` work identically to before
- The signing payload is unchanged when `identity` is absent
- Existing commitment hashes remain valid
- `key_matches_identity` is `null` when no identity is provided
- No existing API contracts are broken
