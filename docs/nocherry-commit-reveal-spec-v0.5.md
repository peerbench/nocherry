# NoCherry Commit-Reveal Protocol Specification

**Version:** 0.5.0-draft
**Status:** Draft for review
**Supersedes:** nocherry-commit-reveal-spec-v0.4.md for objects with `spec_version` `"0.5.0"`. Objects with `spec_version` `"0.2.0"` remain governed by v0.4 and keep verifying unchanged.

## 1. Overview

This document defines object format `0.5.0` of the commit-reveal protocol: a committer signs a list of hiding item commitments, independent servers attest a registration time, a public randomness beacon output selects the items that must be revealed, and anyone verifies the chain offline.

The object version now equals the document version. Formats `0.3.0` and `0.4.0` never existed on the wire: v0.3 and v0.4 of this document changed text, not signed payloads.

### 1.1 What changes from format 0.2.0

| # | Weakness of 0.2.0 | Change in 0.5.0 | Section |
|---|---|---|---|
| 1 | Server chooses per-item or batch selection by an unsigned threshold, so one beacon output has two candidate selections | `selection_mode` is a signed field of the commitment; a receipt in another mode fails verification | 7.1, 8.2, 10.5 |
| 2 | Batch selection is seeded by the beacon output alone; commitments with equal `n` select the same positions | Seed is `HMAC-SHA256(R, tag || commitment_hash)`; per-item input is also bound to the commitment hash | 8.4 |
| 3 | Item hashes are unsalted SHA-256 of the data and all are published, so anyone can test membership of a guessed item | Items are hiding commitments `SHA-256(tag || salt || item_hash)`; the salt is revealed with the item | 5, 10.3 |
| 4 | `stream_id` and `metadata` are outside the committer's signature | Both are signed; `stream_id` comes with a signed `sequence`; servers register at most one commitment per (key, stream, sequence) | 7.1, 7.4, 12.2 |
| 5 | Floating point in selection (`floor(p * 2^64)`, `ceil(p * n)`), `p = 1` skips an item with probability `2^-64`, modulo bias in the shuffle, hex-string concatenation in HMAC inputs | Probability is an integer in parts per million; thresholds and counts are exact integer arithmetic; `p = 1` selects everything; rejection sampling; all HMAC inputs are fixed-width bytes with domain tags; integers are big-endian | 8 |
| 6 | Unanchored commitments let servers disagree on the round | `beacon.anchor_round` is required | 7.1, 8.1 |
| 7 | Grinding: register several commitments, publish one | Signed stream identifier and sequence, one registration per (key, stream, sequence) per server, server-published stream state | 7.4, 12.2, 12.9, 14.4 |

### 1.2 Design priorities

Unchanged from v0.4 (determinism, standalone operation, offline verifiability, SHA-256 and Ed25519 only, minimal dependencies), plus:

7. **No floating point** in anything that affects a signed payload or a selection.
8. **Hiding by default.** A commitment reveals nothing about an item until the item is revealed.
9. **Two independent implementations** must agree on every byte. The encodings below are chosen so that this is easy to check.

### 1.3 Terminology

- **Item hash** `h`: the plain SHA-256 of a file, or the manifest hash of a directory (v0.4 Sections 3 and 4). Standard tools reproduce it. Not published before reveal.
- **Item salt** `s`: 32 bytes chosen by the committer per item, kept secret until reveal.
- **Item commitment** `c`: `SHA-256(tag || s || h)`. This is what the commitment lists and what selection operates on.
- **Opening**: the pair `(s, h)` that shows `c` was a commitment to `h`.
- **Reveal probability** `ppm`: an integer number of parts per million, `1 <= ppm <= 1000000`.
- **Stream**: a committer-chosen name for a sequence of commitments, for example one benchmark that is re-committed each month. A commitment in a stream carries a `sequence` number.

Other terms (commitment, beacon, selection, voluntary reveal, manifest) are as in v0.4 Section 1.2.

## 2. Hashing

Unchanged. Sections 2 to 4 of v0.4 (SHA-256, file hashing, directory manifests) apply to the item hash `h`. The `manifest.json` file written by the reference client is not a protocol object; see Section 10.6 for what it may contain in 0.5.0.

## 3. Primitives and encodings

- `SHA-256(x)`: FIPS 180-4, 32-byte output.
- `HMAC-SHA256(key, msg)`: RFC 2104 with SHA-256, 32-byte output.
- `uint64_be(x)`: `x` as 8 bytes, big-endian.
- `be_uint64(b)`: the first 8 bytes of `b` read as a big-endian unsigned integer.
- `hex(b)`: lowercase hexadecimal. Every hash, salt and signature on the wire is lowercase hex; an implementation MUST reject uppercase or odd-length hex in signed fields.
- `bytes(hexstring)`: the inverse of `hex`.
- `||`: byte concatenation.
- Ed25519 (RFC 8032) signatures over the exact bytes of a signing payload; public keys as `did:key` (multicodec `0xed01`, base58btc, prefix `z`).

### 3.1 Domain tags

All tags are ASCII, used as raw bytes without a length prefix (every input they prefix has fixed length, so parsing is unambiguous):

| Name | Bytes | Used in |
|---|---|---|
| `TAG_ITEM` | `NoCherry/0.5/item` | item commitment (Section 5) |
| `TAG_SALT` | `NoCherry/0.5/salt` | recommended salt derivation (Section 5.2) |
| `TAG_PER_ITEM` | `NoCherry/0.5/per-item` | per-item selection (Section 8.3) |
| `TAG_BATCH_SEED` | `NoCherry/0.5/batch-seed` | batch seed (Section 8.4) |

Big-endian is used for every integer in this format, matching the `uint64_be(round)` that drand itself signs. Format 0.2.0 used little-endian; the two formats share no function, so there is no mixing.

## 4. Canonical JSON

Signed payloads are canonical JSON byte strings:

1. UTF-8, no byte order mark, no whitespace outside strings.
2. Object keys in the order this document lists for each object type. For `metadata` (Section 7.3) keys are sorted.
3. Strings: `"` as `\"`, `\` as `\\`, U+0008 as `\b`, U+000C as `\f`, U+000A as `\n`, U+000D as `\r`, U+0009 as `\t`, every other code point below U+0020 as `\u00xx` with lowercase hex digits. Every other code point, including U+007F, U+2028 and U+2029 and everything outside ASCII, is written literally in UTF-8. Lone surrogates are not valid input.
4. Integers: decimal, no leading zeros, no sign for zero, no fraction, no exponent. No other numbers appear in a 0.5.0 signing payload.
5. Optional fields that are absent are omitted, never written as `null`.

Rules 1 to 3 are what `JSON.stringify` (ECMAScript 2019 and later) and `serde_json` produce for strings; rule 4 excludes the one place where they could differ. On the wire a producer MUST write every integer field (`item_count`, `reveal_probability_ppm`, `anchor_round`, `sequence`, metadata integers) in that form. A consumer whose parser keeps the number text (serde_json) rejects `5.0` or `1e2`; one whose parser yields native numbers (`JSON.parse`) cannot tell them from `5` and `100` and canonicalizes to those. Both then check the same bytes; only the producer that wrote the odd form loses interoperability.

## 5. Item commitments

### 5.1 Definition

For an item with item hash `h` (32 bytes) and salt `s` (32 bytes):

```
c = SHA-256(TAG_ITEM || s || h)
```

`c` is listed in the commitment and is the identifier of the item in selection records and reveals. `s` and `h` are published only when the item is revealed.

Properties under the usual assumptions on SHA-256: **binding**, because a second opening `(s', h') != (s, h)` of the same `c` is a SHA-256 collision; **hiding**, because without `s` a party that guesses the item must try `2^256` salts to confirm the guess. The fixed widths of the three parts make the encoding injective.

Requirements:

- `s` MUST be 32 bytes with at least 128 bits of entropy unknown to any other party. A reused or low-entropy salt forfeits hiding for that item; it does not affect binding.
- The same `(s, h)` MUST NOT be used in two commitments. Reuse links the two commitments publicly.
- Two items of one commitment MUST have distinct `c`. Two identical files in one directory therefore need distinct salts, which Section 5.2 does not give; the reference client reports such a directory as an error.

### 5.2 Recommended salt derivation

A committer that keeps one 32-byte secret per commitment can recompute every salt from the files alone:

```
item_secret = 32 bytes from a cryptographically secure random source, fresh per commitment
s = HMAC-SHA256(item_secret, TAG_SALT || h)
```

This is a recommendation for storage, not a protocol rule: a verifier never sees `item_secret` and checks only `c = SHA-256(TAG_ITEM || s || h)`. `item_secret` MUST NOT be published or submitted anywhere; publishing it opens every item of the commitment.

### 5.3 Why salted hashes and not a Merkle root

A Merkle root would shrink the commitment from about 67 bytes per item to one hash and prove inclusion of revealed items with `log2(n)` siblings. It was not chosen for this version for three reasons. Per-item selection needs every leaf value, so the root alone supports only batch mode. The sibling hashes in an inclusion proof must themselves be hiding, so salts are needed anyway; the root saves bandwidth, not a primitive. And the selection record would have to name positions instead of item identifiers, which changes every object and every verifier. The scaling limit (commitment size) is real but is a performance problem, not a security problem, and is left for a later version. The salted list closes the membership leak with one new primitive and no change to the shape of the objects.

## 6. Mode of operation

As in v0.4 Section 6: the committer commits a list in one request with a reveal probability; the beacon round fixed by the anchor determines the selection.

## 7. Commitment

### 7.1 Commitment object

```json
{
  "spec_version": "0.5.0",
  "commitment_hash": "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826",
  "items": [
    "2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf",
    "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"
  ],
  "item_count": 2,
  "reveal_probability_ppm": 400000,
  "selection_mode": "batch",
  "beacon": {
    "type": "drand",
    "anchor_round": 25892262,
    "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
  },
  "stream_id": "bench-2026",
  "sequence": 7,
  "metadata": {"a": "x", "b": 1},
  "committed_at": "2026-02-06T14:30:00Z",
  "signing_key": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "identity": "did:web:alice.example.com",
  "signature": "..."
}
```

Fields (all signed unless stated otherwise):

- **`spec_version`** (string): `"0.5.0"`.
- **`commitment_hash`** (string): `hex(SHA-256(signing_payload))`. Derived, not signed. The global identifier of the commitment on every server.
- **`items`** (array of strings): item commitments `hex(c)` (Section 5), 64 lowercase hex characters each. At least 1. No duplicates. The order is the committed order and matters for batch selection.
- **`item_count`** (integer): length of `items`.
- **`reveal_probability_ppm`** (integer): reveal probability in parts per million, `1 <= ppm <= 1000000`. `100000` is 10 percent. `1000000` means every item is selected.
- **`selection_mode`** (string): `"per_item"` or `"batch"` (Section 8.2). Chosen by the committer and binding on every server and verifier.
- **`beacon`** (object): `type`, `anchor_round`, `chain_hash` in that key order. `anchor_round` is REQUIRED in 0.5.0 (Section 8.1); a 0.5.0 commitment without it is malformed. This version defines `type` `"drand"` with the quicknet `chain_hash` only.
- **`stream_id`** (string, optional): a committer-chosen stream name, 1 to 128 characters from `[A-Za-z0-9._-]`, so that it is a valid URL path segment as is (Section 12.9). Present together with `sequence` or not at all.
- **`sequence`** (integer, optional): position of this commitment in the stream, `0 <= sequence <= 2^53 - 1`. REQUIRED when `stream_id` is present, forbidden otherwise.
- **`metadata`** (object): committer data in canonical form (Section 7.3). REQUIRED; `{}` when there is nothing to say.
- **`committed_at`** (string): RFC 3339 timestamp set by the committer; `Z` is conventional, a numeric offset is accepted. Informational.
- **`signing_key`** (string): the committer's `did:key`.
- **`identity`** (string, optional): identity claim as in v0.4 (a DID whose document should list `signing_key`).
- **`signature`** (string): Ed25519 signature over the signing payload, 128 lowercase hex characters (uppercase is malformed, so one signed object has one wire form). Not signed.

A field not listed here MUST NOT appear in the signing payload. Implementations MUST reject a 0.5.0 commitment that has `reveal_probability` (the 0.2.0 float field) instead of `reveal_probability_ppm`.

### 7.2 Signing payload and commitment hash

```
signing_payload = canonical_json({
  "spec_version": "0.5.0",
  "items": [...],
  "item_count": n,
  "reveal_probability_ppm": ppm,
  "selection_mode": "...",
  "beacon": {"type": "drand", "anchor_round": a, "chain_hash": "..."},
  "stream_id": "...",          // only if present
  "sequence": k,               // only if present
  "metadata": {...},           // canonical, Section 7.3
  "committed_at": "...",
  "signing_key": "...",
  "identity": "..."            // only if present
})
signature       = Ed25519_Sign(private_key, signing_payload)
commitment_hash = hex(SHA-256(signing_payload))
```

Excluded from the payload: `commitment_hash`, `signature`. Nothing else is excluded; in 0.2.0 `stream_id` and `metadata` were, which is weakness 4.

### 7.3 Canonical metadata

`metadata` is a JSON object serialized with these rules on top of Section 4:

- Object keys are sorted by Unicode code point of the key (the order of the UTF-8 bytes). Duplicate keys are malformed.
- Values are strings, `true`, `false`, `null`, integers with `|x| <= 2^53 - 1`, arrays, or objects, nested without limit. A number with a fraction or exponent, `-0`, or an integer outside that range is malformed.
- The canonical serialization is at most 4096 bytes.

A commitment whose `metadata` violates a rule is malformed and MUST be rejected by servers and failed by verifiers (check `commitment_wellformed`). A verifier re-serializes the metadata it parsed and checks the signature over the result; a producer that signed a non-canonical form therefore produced an invalid signature.

Number text is the one place where parsers differ: a parser that keeps the lexeme (serde_json) sees `1e2` or `1.0` and MUST reject it; a parser that yields a native number (`JSON.parse`) cannot tell them from `100` and `1`, accepts the input, and canonicalizes to `100` and `1`. Both then check the same bytes. A producer MUST write integers as plain decimals so that every parser accepts its commitment.

### 7.4 Streams and sequence numbers

A committer that will commit repeatedly (a benchmark re-committed each release, a log committed daily) names the stream and numbers its commitments. The two fields are signed, so a relying party can demand "the commitment of key `K` for stream `X` with sequence `N`" and a committer cannot present another commitment under that name without a signature over the other name.

Servers enforce uniqueness: a server registers at most one commitment per `(signing_key, stream_id, sequence)` (Section 12.2), and keeps the name taken after the commitment body itself has left its retention window. A relying party that requires receipts from a fixed set of servers `S` therefore knows that a `(K, X, N)` with receipts from all of `S` is the first commitment registered under that name at each of them; a second commitment under the same name can obtain receipts only from servers that had not seen the first, never from all of `S`. What this does and does not achieve is analyzed in Section 14.4.

Sequence numbers need not be consecutive; a gap is visible in the per-stream listing (Section 12.9) and is for the relying party to judge. A relying party SHOULD require consecutive sequences from an agreed start and treat a gap as an unexplained registration.

### 7.5 Well-formedness

A 0.5.0 commitment is well formed if all of the following hold. Servers MUST reject (HTTP 400) and verifiers MUST fail the check `commitment_wellformed` otherwise, before any signature check:

1. `spec_version` is `"0.5.0"`.
2. `items` is a non-empty array of distinct 64-character lowercase hex strings and `item_count` equals its length.
3. `reveal_probability_ppm` is an integer in `[1, 1000000]`.
4. `selection_mode` is `"per_item"` or `"batch"`.
5. `beacon.type` is `"drand"`, `beacon.chain_hash` is the quicknet chain hash, `beacon.anchor_round` is an integer in `[1, 2^53 - 1]` whose selection round has a representable scheduled time (an implementation MAY reject rounds beyond what its time arithmetic holds; for 64-bit milliseconds that is about `3 * 10^15`, millions of years out).
6. `stream_id` and `sequence` are both present or both absent, and satisfy Section 7.1.
7. `metadata` is canonical (Section 7.3).
8. `committed_at` parses as RFC 3339.
9. `signing_key` is a `did:key` of an Ed25519 key; `identity`, if present, is a non-empty string of at most 1024 bytes.
10. `commitment_hash` is 64 lowercase hex characters and `signature` is 128 lowercase hex characters.

Servers MAY impose an upper bound on `item_count` and MUST advertise it in `GET /v1/server-info` as `max_items`.

### 7.6 Immutability

Unchanged: a registered commitment cannot be changed. Create a new commitment, with the next `sequence` if it is in a stream.

## 8. Selection

### 8.1 Selection round

`beacon.anchor_round` is required. The selection round is

```
selection_round = anchor_round + ANCHOR_SELECTION_DELAY      // ANCHOR_SELECTION_DELAY = 2
```

and the registration rule, constants, client behavior and error codes of v0.4 Section 8.1.1 apply unchanged (`round_time(anchor_round) <= registered_at + 1 s` and `round_time(anchor_round + 2) > registered_at + 1 s`, else reject). The unanchored rule of v0.4 Section 8.1 does not exist in 0.5.0: a server that receives a 0.5.0 commitment without an anchor rejects it as malformed; a verifier fails it.

### 8.2 Selection mode

The committer fixes the mode in the signed commitment:

| `selection_mode` | Result | Use |
|---|---|---|
| `per_item` | each item independently with probability `ppm / 10^6`; the number selected is random | single items, streams of one item each, callers that want independence across items |
| `batch` | exactly `m = ceil(ppm * n / 10^6)` items, a uniformly random `m`-subset | the common case: a fixed audit size |

A server MUST select in the commitment's mode. A verifier MUST fail the check `selection_mode` when the selection record names another mode, and MUST recompute in the commitment's mode. There is no default, no threshold and no advertised constant. The reference client uses `per_item` for `n = 1` and `batch` otherwise unless told otherwise; this is a client default, not part of the protocol.

### 8.3 Per-item selection

Let `R` be the 32-byte randomness of the selection round, `hc = bytes(commitment_hash)` and `c_i = bytes(items[i])`.

```
threshold T = floor(ppm * 2^64 / 10^6)           // exact integer; T = 2^64 when ppm = 10^6
v_i = be_uint64(HMAC-SHA256(key = R, msg = TAG_PER_ITEM || hc || c_i))
item i is selected  iff  v_i < T
```

`selected_items` lists the selected `items[i]` in committed order.

`T` is computed in integer arithmetic (128-bit integers, or arbitrary precision). For `ppm = 10^6`, `T = 2^64` exceeds every 64-bit `v_i`, so every item is selected; an implementation that stores `T` in 64 bits MUST special-case this. The selection probability is `T / 2^64`, which differs from `ppm / 10^6` by less than `2^-64`.

### 8.4 Batch selection

```
m = ceil(ppm * n / 10^6) = (ppm * n + 999999) div 10^6     // integer arithmetic, 1 <= m <= n
seed = HMAC-SHA256(key = R, msg = TAG_BATCH_SEED || hc)
draw(counter) = be_uint64(HMAC-SHA256(key = seed, msg = uint64_be(counter)))

pool = copy of items (committed order); counter = 0
for i from 0 to m - 1 inclusive:
  range = n - i
  limit = 2^64 - (2^64 mod range)           // largest multiple of range that fits
  repeat:
    v = draw(counter); counter = counter + 1
  until v < limit
  j = i + (v mod range)
  swap pool[i], pool[j]
selected_items = pool[0], ..., pool[m - 1]   // the first m entries, in this order
```

The counter runs over all draws, including rejected ones, so two implementations that reject the same values read the same next value. A draw is rejected with probability `(2^64 mod range) / 2^64 < range / 2^64`, which for a million items is below `2^-44` per step; the loop is nevertheless normative, because without it the selection is not exactly uniform and the two implementations would still have to agree on the biased result. `limit` is `2^64` itself when `range` is a power of two; implementations with 64-bit integers compute the comparison in 128 bits or treat `2^64 mod range == 0` as "accept every value".

Seeding with `hc` makes the shuffle a function of the commitment: two commitments in the same round, with the same `n` or even the same items in another order, get independent selections (weakness 2). This matches the `Hash(S || R)` sampling construction in the NIST beacon guidance, with `R` as the HMAC key.

### 8.5 Selection record

```json
{
  "commitment_hash": "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826",
  "beacon_output": {
    "type": "drand",
    "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    "round": 25892264,
    "randomness": "5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108",
    "signature": "8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8"
  },
  "selection_mode": "batch",
  "reveal_probability_ppm": 400000,
  "selected_items": ["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf", "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"],
  "selected_count": 2,
  "total_count": 5,
  "computed_at": "2026-02-07T16:02:37Z"
}
```

`selection_mode` and `reveal_probability_ppm` repeat the commitment's values for readers; a verifier takes both from the commitment and fails the check `selection_mode` if the record disagrees on either, or carries a 0.2.0 `reveal_probability`. Everything in the record other than `computed_at` is recomputable.

## 9. Randomness beacons

Unchanged: v0.4 Section 9 (drand quicknet parameters, `randomness = SHA-256(signature)`, BLS verification of `uint64_be(round)` under the chain key).

## 10. Reveal

### 10.1 What must be revealed, 10.2 voluntary reveals

Unchanged from v0.4.

### 10.3 Reveal object

```json
{
  "spec_version": "0.5.0",
  "commitment_hash": "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826",
  "selected_items": ["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf"],
  "voluntary_items": ["5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d"],
  "openings": [
    {"item": "2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf",
     "salt": "e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b",
     "hash": "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"},
    {"item": "5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d",
     "salt": "b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533",
     "hash": "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da"}
  ],
  "data_url": "https://github.com/myorg/benchmark-reveal",
  "file_urls": {"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf": "https://cdn.example.com/items/q1.json"},
  "revealed_at": "2026-02-07T10:00:00Z",
  "signing_key": "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
  "signature": "..."
}
```

- **`selected_items`**, **`voluntary_items`**: item commitments, as in v0.4. Together they MUST have no duplicates.
- **`openings`** (array of objects, signed): exactly one entry per entry of `selected_items` followed by `voluntary_items`, in that order. Each object has keys `item`, `salt`, `hash` in that order, each 64 lowercase hex characters, with `item` equal to the corresponding entry and `bytes(item) == SHA-256(TAG_ITEM || bytes(salt) || bytes(hash))`.
- **`data_url`**, **`file_urls`**: unsigned, informational, as in v0.4. `file_urls` is keyed by item commitment.
- **`revealed_at`**, **`signing_key`**, **`signature`**: as in v0.4. The reveal may be signed by a key other than the commitment's; the openings, not the key, tie the reveal to the commitment.

### 10.4 Reveal signing payload

```
signing_payload = canonical_json({
  "spec_version": "0.5.0",
  "commitment_hash": "...",
  "selected_items": [...],
  "voluntary_items": [...],
  "openings": [{"item": "...", "salt": "...", "hash": "..."}, ...],
  "revealed_at": "...",
  "signing_key": "..."
})
```

Excluded: `data_url`, `file_urls`, `signature`.

### 10.5 Verification

Given a receipt (commitment, `registered_at`, selection record), optionally a reveal, and the data of revealed items. A verifier dispatches on `commitment.spec_version`: `"0.2.0"` runs v0.4 Section 10.5 unchanged; `"0.5.0"` runs the checks below; any other value fails with check `spec_version`. Each check is reported by name with status `pass`, `fail` or `skip`. A `fail` fails the result, with two exceptions that make it `partial` instead, because they describe what the committer has not (yet) supplied rather than a contradiction: `completeness` (step 11) and `data_integrity` when data is missing rather than wrong (step 10). A `skip` makes the result at most `partial`.

1. `commitment_wellformed` (Section 7.5).
2. `commitment_signature`: `commitment_hash == hex(SHA-256(signing_payload))` and the Ed25519 signature verifies under `signing_key`.
3. `beacon_randomness`, `beacon_authentic`: as v0.4 (`randomness == SHA-256(signature)`; BLS signature of the round under the quicknet key; `skip` when BLS is unavailable).
4. `anchor_selection_round`: `beacon_output.round == anchor_round + 2`. `anchor_registration_time`: `registered_at` precedes `round_time(anchor_round + 2)`; `skip` without `registered_at`.
5. `selection_mode`: the record's `selection_mode` and `reveal_probability_ppm` equal the commitment's (Section 8.5).
6. `selection_correct`: the record is for this `commitment_hash`, and recomputing Section 8.3 or 8.4 in the commitment's mode from the commitment and the beacon randomness yields exactly the record's `selected_items`, in order.
7. `reveal_signature`: the reveal's signature verifies under its `signing_key`.
8. `reveal_matches_commitment`: the reveal's `commitment_hash` is the commitment's; every entry of `selected_items` and `voluntary_items` is one of the commitment's `items`; the two lists are disjoint; every entry of the reveal's `selected_items` is in the record's `selected_items`.
9. `item_openings`: `openings` has one entry per revealed item in the required order, each entry's `item` matches, and each recomputes to its item commitment (Section 5.1).
10. `data_integrity`: for each revealed item, the SHA-256 of the data (or the manifest hash for a directory) equals the opening's `hash`. Data for an item that is not provided counts as missing (`partial`); data that hashes to something else fails.
11. `completeness`: every item in the record's `selected_items` appears in the reveal's `selected_items`; a missing item is reported and the result is at most `partial`. A relying party should count a selected item without a reveal as failed.

Steps 1 to 11 run offline. A receipt also carries a server signature over the receipt JSON; the reference verifier checks it as `server_signature` and treats a receipt whose `commitment_hash` differs from its commitment's as failed, as before.

### 10.6 Files on the committer's side

Not protocol objects, but the reference client's layout matters for what leaks:

- `commitment-secret.json` holds `item_secret` (Section 5.2). It stays with the committer. It is excluded from hashing like the other protocol files (v0.4 Section 4.4) and MUST NOT be copied into a published reveal folder.
- `manifest.json` written for a 0.5.0 commitment maps paths to item commitments only (`{"path": ..., "item": ...}`). It MUST NOT list plain item hashes: a published manifest with plain hashes would reintroduce the membership test for every unrevealed item.
- Published reveal folders contain the selected (and voluntary) files, `reveal.json` with the openings, the receipts, and a `manifest.json` reduced to the entries of revealed items. The paths of unrevealed items are as telling as their hashes (a benchmark's file names are often its question ids) and stay private.

## 11. Server trust model and discovery

Unchanged from v0.4 Section 11, with one addition: a relying party that wants the stream guarantee of Section 7.4 fixes its set of required servers in advance and requires every receipt to come from that set.

## 12. Service API

Endpoints and receipt envelope are as in v0.4 Section 12. Differences for 0.5.0:

### 12.1 Server info

`GET /v1/server-info` gains:

```json
{
  "spec_versions_accepted": ["0.2.0", "0.5.0"],
  "max_items": 100000,
  "max_metadata_bytes": 4096,
  ...
}
```

A client reads `spec_versions_accepted` and does not send a format the server does not list. `spec_version` (the server's default) and `anchor_selection_delay` stay. `selection_threshold` is no longer meaningful for 0.5.0 and MAY be omitted once a server stops accepting 0.2.0.

### 12.2 Submit commitment

`POST /v1/commitments` with a 0.5.0 commitment. The server:

1. Checks well-formedness (Section 7.5), the signature and `commitment_hash`; rejects with 400 otherwise, naming the failed rule.
2. Applies the anchor registration rule at its `registered_at`; rejects with 400 and the v0.4 error codes otherwise.
3. If `stream_id` is present: if it already holds a commitment with the same `signing_key`, `stream_id` and `sequence` and a different `commitment_hash`, rejects with 409:
   ```json
   {"error": "a commitment with this signing_key, stream_id and sequence is already registered",
    "error_code": "stream_sequence_taken",
    "existing_commitment_hash": "...", "existing_registered_at": "..."}
   ```
   The same `commitment_hash` is answered with 409 and `error_code` `"commitment_exists"` as before. The uniqueness check and the insert MUST be atomic (a stream index keyed by the three values, written in the same transaction as the commitment). The stream index entry is NOT subject to the retention of commitment bodies (12.2.1 of v0.4): a name stays taken, and stays listed, after the commitment it names has been purged. The entry is about 200 bytes.
4. Records `registered_at`, `arrival_beacon`, waits for round `anchor_round + 2`, computes the selection in the commitment's mode, and returns the signed receipt.

The receipt gains, when the commitment is in a stream:

```json
"stream_activity": {"commitments": 8, "highest_sequence": 7}
```

the number of commitments this server holds for `(signing_key, stream_id)` including this one, and the highest sequence among them. Like `signer_activity` this is context, signed by the server, not a limit.

### 12.3 Submit reveal

`POST /v1/commitments/{commitment_hash}/reveals` with a 0.5.0 reveal. In addition to the v0.4 checks the server verifies `openings` (Section 10.3, including that each recomputes). When it fetches `file_urls` it compares the SHA-256 of the fetched bytes with the opening's `hash`, not with the item commitment.

### 12.9 Stream listings

```
GET /v1/streams/{signing_key}/{stream_id}

Response (200):
{
  "signing_key": "did:key:...",
  "stream_id": "bench-2026",
  "commitments": [
    {"sequence": 0, "commitment_hash": "...", "registered_at": "..."},
    {"sequence": 1, "commitment_hash": "...", "registered_at": "..."}
  ],
  "listed_at": "...",
  "server_key": "did:key:...",
  "server_signature": "..."
}

GET /v1/streams/{signing_key}

Response (200):
{
  "signing_key": "did:key:...",
  "streams": [
    {"stream_id": "bench-2026", "commitments": 2, "highest_sequence": 1}
  ],
  "listed_at": "...",
  "server_key": "did:key:...",
  "server_signature": "..."
}
```

The first lists every entry of one stream, ordered by `sequence`; the second lists every stream name this server has ever registered for the key, with counts. Both come from the stream index, which outlives retention (Section 12.2), so an entry whose commitment body has been purged is still listed. An empty list is a valid answer. Both are signed so that they can be kept as evidence of what the server showed at the time; `listed_at` is the server's clock at the time of the answer.

## 13. Test vectors

Sections 13.1 to 13.8 of v0.4 remain the vectors for format 0.2.0 and for hashing. The vectors below are for 0.5.0. They were computed by an implementation written only from this text (Python, hashlib and hmac); the Rust core and the pure-JavaScript implementation must reproduce every value. Signing key: RFC 8032 section 7.1 test 1, secret `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`, `did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw`.

### 13.9 Item commitments and salt derivation

`item_secret` (hex): `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`. The item hashes are those of v0.4 Section 13.5.

| item hash `h` | salt `s = HMAC-SHA256(item_secret, TAG_SALT || h)` | item commitment `c = SHA-256(TAG_ITEM || s || h)` |
|---|---|---|
| `2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8` | `e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b` | `2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf` |
| `32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2` | `6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323` | `da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a` |
| `6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da` | `b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533` | `5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d` |
| `4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030` | `7d5ffda6bb923cb45d11e7a4aba3cbd7bdf13d44e8542177f976b4c0a5c951ca` | `47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e` |
| `57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b` | `a03fb4699c682592c28bb330257a09222fc4f864a3e49474fa940319b20a5b4e` | `7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c` |

### 13.10 Threshold and count

```
threshold(1)       = 18446744073709
threshold(70000)   = 1291272085159668613
threshold(100000)  = 1844674407370955161
threshold(500000)  = 9223372036854775808
threshold(999999)  = 18446725626965477906
threshold(1000000) = 18446744073709551616   (= 2^64, every item selected)

batch_count(ppm=70000,   n=100)     = 7     (0.07 * 100 in IEEE double gives 8)
batch_count(ppm=100000,  n=17)      = 2
batch_count(ppm=100000,  n=2)       = 1
batch_count(ppm=1,       n=1)       = 1
batch_count(ppm=1,       n=1000000) = 1
batch_count(ppm=1000000, n=5)       = 5
batch_count(ppm=333333,  n=3)       = 1
batch_count(ppm=500000,  n=1)       = 1
```

Rejection limits `2^64 - (2^64 mod range)`:

```
range 1: 18446744073709551616    range 2: 18446744073709551616
range 3: 18446744073709551615    range 5: 18446744073709551615
range 7: 18446744073709551614    range 10: 18446744073709551610
range 1000: 18446744073709551000 range 2^32: 18446744073709551616
range 2^64 - 1: 18446744073709551615
```

### 13.11 Metadata canonicalization

Input, as a producer might hold it: `{"b": 1, "a": "x", "nested": {"z": [true, null], "y": "é\n"}}`

Canonical: `{"a":"x","b":1,"nested":{"y":"é\n","z":[true,null]}}` (the `é` is the two bytes `c3 a9`, the newline is the two characters `\` `n`).

### 13.12 Commitment A (batch mode, stream, metadata)

Items: the five item commitments of 13.9 in table order. `reveal_probability_ppm` 400000, `selection_mode` `batch`, `anchor_round` 25892262, `stream_id` `bench-2026`, `sequence` 7, metadata of 13.11, `committed_at` `2026-02-06T14:30:00Z`.

```
signing_payload (one line):
{"spec_version":"0.5.0","items":["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a","5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d","47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e","7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c"],"item_count":5,"reveal_probability_ppm":400000,"selection_mode":"batch","beacon":{"type":"drand","anchor_round":25892262,"chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"stream_id":"bench-2026","sequence":7,"metadata":{"a":"x","b":1,"nested":{"y":"é\n","z":[true,null]}},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}

commitment_hash = a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826
signature       = a399931bbae7c576b95cff32710726f2151043afaa462fe48e83d1a3454da7158851f10097707b0acbe0bfe03094346ccdddab9fdedf2c45177051c6e410880c
```

### 13.13 Batch selection of commitment A

Selection round 25892264 (real quicknet output; `randomness = SHA-256(signature)` holds):

```
R         = 5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108
signature = 8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8
m    = ceil(400000 * 5 / 10^6) = 2
seed = HMAC-SHA256(R, TAG_BATCH_SEED || bytes(commitment_hash)) = 9e38917f1c3657cca52685846e670bdf0ab59f8b9f6b9522cafc69f311fb42e6

step 0: counter 0, v = 4766462977800624865,  range 5, limit 18446744073709551615, j = 0 + (v mod 5) = 0, swap pool[0], pool[0]
step 1: counter 1, v = 17118077862470312844, range 4, limit 18446744073709551616, j = 1 + (v mod 4) = 1, swap pool[1], pool[1]

selected_items = ["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf",
                  "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"]
```

For illustration only (a receipt with this round would fail `anchor_selection_round`), the same commitment against the output of round 25892265, `R = 981853163a6078ace4ab02d83913000181990ec0042b7de1752c31bb25fcd4c0`:

```
seed = 65b8d9782a88951e6c60d0bd038949bdf0293c0386b92bcd28a0205288704fce
step 0: counter 0, v = 18092864662774502750, range 5, j = 0
step 1: counter 1, v = 4964423873904502846,  range 4, j = 1 + 2 = 3, swap pool[1], pool[3]
selected_items = ["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf",
                  "47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e"]
```

### 13.14 Commitment B (per-item mode) and its selection

The first two item commitments of 13.9, `reveal_probability_ppm` 100000, `selection_mode` `per_item`, `anchor_round` 25892262, no stream, `metadata` `{}`.

```
signing_payload (one line):
{"spec_version":"0.5.0","items":["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"],"item_count":2,"reveal_probability_ppm":100000,"selection_mode":"per_item","beacon":{"type":"drand","anchor_round":25892262,"chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"metadata":{},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}

commitment_hash = d92fb2774202942e3a838d7c8cbb00d6e4de3b46af0a6ac67f74db7529627efa
signature       = 60d2b1c846fd95e9bb2b48db87d19e88cee9373ac0306a429b07e359fd6a0531592d4834f9cf0bbff22c411af18c968884223fbdff3fa3cf4ef46af947b5230c

R (round 25892264) = 5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108
threshold(100000)  = 1844674407370955161

item 2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf
  HMAC-SHA256(R, TAG_PER_ITEM || hc || c) = 033866e12c9af0f37e4f3e4c7192a790b87437b9324b213b2c1c0463d17dc39a
  v = 232048498111607027  < threshold  -> selected
item da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a
  HMAC-SHA256(R, TAG_PER_ITEM || hc || c) = 2d5f8ed2ef1627bfa8f359d623020ca8356a3bc9c5c73503c7a96ff8a5ee3360
  v = 3269488891099752383 >= threshold -> not selected

selected_items = ["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf"]
```

### 13.15 Reveal of commitment A

Selected items of 13.13 revealed, plus the third item voluntarily, signed by the committer's key.

```
signing_payload (one line):
{"spec_version":"0.5.0","commitment_hash":"a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826","selected_items":["2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"],"voluntary_items":["5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d"],"openings":[{"item":"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf","salt":"e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b","hash":"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"},{"item":"da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a","salt":"6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323","hash":"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"},{"item":"5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d","salt":"b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533","hash":"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da"}],"revealed_at":"2026-02-07T10:00:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}

signature = e145fb61ab8b828c773806c1bdf6731c9b82cd2b63bbcf85ff2933dca40400fc36aa8e3bee7d719e129ba45289af0a2d2873c5a0a89d00244139592c3e920c0e
```

### 13.16 Verifier outcomes

For a receipt of commitment A with `registered_at` `2026-02-07T16:02:31.500Z` and the round 25892264 output:

| Change to the receipt | Check that fails |
|---|---|
| none | (verified) |
| `selection.selection_mode` set to `per_item` with the per-item result | `selection_mode` |
| `selection.selected_items` replaced by the round 25892265 result | `selection_correct` |
| `commitment.stream_id` changed to `bench-2027` | `commitment_signature` |
| `commitment.sequence` changed to `8` | `commitment_signature` |
| `commitment.metadata` changed to `{"a":"y"}` | `commitment_signature` |
| `commitment.metadata` re-serialized as `{"b":1,"a":"x",...}` (non-canonical order) | none on parse (objects are unordered); a producer that signed the non-canonical bytes fails `commitment_signature` |
| `commitment.beacon.anchor_round` removed | `commitment_wellformed` |
| `commitment.reveal_probability_ppm` set to `0` or `1000001` | `commitment_wellformed` |
| a reveal whose opening for the first item has another salt | `item_openings` |
| a reveal whose first revealed file is replaced by other bytes | `data_integrity` |

## 14. Security properties

### 14.1 What this proves

As v0.4 Section 14.1 (pre-commitment, unbiased selection, integrity), and in addition:

- **Hiding.** Before reveal, the published commitment discloses only `n`, `ppm`, the mode, the stream name and sequence, and the metadata. No party can test whether a given item is in the set (Section 5.1).
- **One selection per commitment.** For a fixed commitment and beacon output there is exactly one correct selection record; neither the server nor the committer has a choice (Sections 8.2 to 8.4).
- **Named commitments.** A commitment's stream name and sequence are the committer's signed statement; a relying party can ask for `(key, stream, sequence)` and reject anything else.

### 14.2 What this does not prove

As v0.4 Section 14.2 (existence, quality, author identity beyond key control, completeness of the committed set, reveal compliance).

### 14.3 Threat model

| Threat | 0.5.0 |
|---|---|
| Committer cherry-picks reveals | Prevented (beacon selection) |
| Committer changes items after commitment | Prevented (item commitment binding) |
| Commitment registered after the output is public | Prevented under the server clock assumption (anchor rule) |
| Servers disagree on the round | Prevented (anchor required) |
| Server picks between two selection modes | Prevented (`selection_mode` signed, verifier fails a mismatch) |
| Correlated selections across commitments; reordering items to move the selection predictably | Prevented (seed bound to `commitment_hash`) |
| Membership test on a guessed item | Prevented (hiding item commitments) |
| Stream name or metadata stripped or changed | Prevented (signed) |
| Two commitments under one `(key, stream, sequence)` | Each correct server registers only the first; a relying party requiring a fixed server set sees at most one with full receipts |
| Grinding under one key with different sequences or streams | Visible in the per-stream and per-key listings and in `stream_activity`; not prevented (Section 14.4) |
| Grinding under fresh keys (Sybil) | Not prevented; deployment requirement (Section 15) |
| Server backdates `registered_at` | Not prevented; requires named servers and trust in at least one |
| Forged beacon output | Prevented (randomness and BLS check) |
| Server (or the committer through a colluding server) drops a stream entry from the listing | Not prevented; the listing is one server's word (Section 15) |

### 14.4 Grinding with streams: what the mechanism gives

Let a relying party fix a server set `S` and demand receipts from every server in `S` for `(K, X, N)`. Assume every server in `S` follows Section 12.2 and the committer controls one key `K`.

- If the committer registers commitment `A` under `(K, X, N)` at all of `S`, then any later `B` under the same name is rejected by all of `S`. `A` is the only commitment that can satisfy the relying party. The committer may still refuse to publish `A`; that is a visible refusal, not a hidden draw.
- If the committer registers `A` at a subset of `S` and `B` at the rest, neither has receipts from all of `S`; the relying party rejects both.
- The committer can register `(K, X, N)`, `(K, X, N+1)`, `(K, X', N)` and publish the best. The per-key listing of Section 12.9 shows every stream name the server holds for `K` with counts, the per-stream listing shows every sequence of `X`, and `stream_activity` in the published receipt shows the count for `X`; a relying party that required consecutive sequences from an agreed start, or that pre-announced which `(K, X, N)` it expects (pre-registration), detects this. A relying party that accepts any name from `K` is not protected by this mechanism.
- The stream index is kept beyond the retention of commitment bodies, so waiting out the retention window does not free a name. A server that discards its index is a server that does not follow Section 12.2, which is the collusion case below.

The mechanism therefore turns "did the committer draw more than once" from an unanswerable question into "does the name I demanded have receipts from the servers I named, and do the listings show other names". It rests on the servers in `S` and on `K` being the committer's only key.

## 15. What remains open

Stated plainly, in order of weight:

1. **Sybil resistance.** With free keys, grinding moves to fresh keys and nothing above links the attempts. The protocol provides the identity hook (`identity`, `key_matches_identity`) and nothing more. Every deployment must bind submitters to identities that are costly or attributable to create. Out of scope for the protocol.
2. **Colluding servers.** A server that drops entries from its stream listing, registers a second commitment under a taken name, or backdates `registered_at` is not detected by any check on receipts. The defense is the relying party's choice of servers. A public append-only log of all registrations (transparency log) would make omissions detectable and is the natural next step; it is not part of this version.
3. **Pre-registration is a convention, not a message.** The relying party announcing `(K, X, N)` in advance happens outside the protocol. A signed "expectation" object that servers could store and echo in receipts would make it checkable offline; deferred.
4. **Commitment size.** About 67 bytes per item. A Merkle variant (Section 5.3) would fix this for batch mode at the cost of positional selection records and inclusion proofs; deferred.
5. **Registration time without trusting a server.** Including the output of round `anchor_round` in the signed commitment would prove that signing happened after `T(anchor_round)` without a server; it shortens the usable window because the client must first obtain that output from a relay, and is deferred. An external timestamping service would bound the time from above; also deferred.
6. **Repeated audits of one private set** disclose a growing share of it. Not a protocol problem, but a policy one (how many rounds a private benchmark sustains).
7. **Reveal refusal and nonexistent data** remain visible but unenforceable.
8. **Beacons other than drand quicknet** are not defined for 0.5.0. `beacon.type` is kept so that another beacon with a fixed round schedule can be added without a new object layout.

## 16. Rollout and compatibility

- A verifier dispatches on `spec_version`. Existing 0.2.0 commitments, receipts and reveals verify exactly as under v0.4; the 0.2.0 test vectors stay in force.
- Servers accept both formats during rollout and list them in `spec_versions_accepted`. A server built before this version answers a 0.5.0 commitment with `Missing required field: reveal_probability` (it checks its own field list before the signature), so servers are deployed before clients default to 0.5.0.
- A client picks the newest format every target server lists, or the format the user asked for.
- Deployment order: core and WASM, then every server target with its regenerated WASM glue and the storage migration for the stream index, then clients.
