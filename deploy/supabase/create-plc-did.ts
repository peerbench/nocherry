#!/usr/bin/env -S deno run --allow-net
/**
 * Create a static did:plc test identity at plc.directory.
 *
 * PLC requires secp256k1/P-256 rotation keys, so we use a deterministic
 * secp256k1 key for rotation and list our Ed25519 test key as the
 * verification method (which is what commit-reveal checks).
 *
 * Both private keys are intentionally public — this identity exists
 * solely for automated DID match testing.
 *
 * Run once:  deno run --allow-net create-plc-did.ts
 */

import { encode as dagCborEncode } from "npm:@ipld/dag-cbor@9";
import { secp256k1 } from "npm:@noble/curves@1/secp256k1";
import { sha256 } from "npm:@noble/hashes@1/sha256";
import { base58btc } from "npm:multiformats@13/bases/base58";

// ── Fixed Ed25519 test keypair (verification method — what commit-reveal checks) ──
const ED25519_DID_KEY =
  "did:key:z6MkfCH4zUChzYzAufNRaf2BWBgup8bLUMn3fYofxZfbehRg";

// ── Deterministic secp256k1 rotation key (for PLC document management) ──
const rotationSeed = sha256(
  new TextEncoder().encode("commit-reveal-plc-test-rotation-key"),
);
const rotationPubKey = secp256k1.getPublicKey(rotationSeed); // 33 bytes compressed

// Encode as did:key (multicodec secp256k1-pub varint = 0xe7 0x01)
const rotationMulticodec = new Uint8Array(2 + rotationPubKey.length);
rotationMulticodec[0] = 0xe7;
rotationMulticodec[1] = 0x01;
rotationMulticodec.set(rotationPubKey, 2);
const ROTATION_DID_KEY = `did:key:${base58btc.encode(rotationMulticodec)}`;

// ── Helpers ──

function base64url(bytes: Uint8Array): string {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base32lower(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 0x1f];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Build unsigned genesis PLC operation ──

const unsignedOp = {
  type: "plc_operation" as const,
  rotationKeys: [ROTATION_DID_KEY],
  verificationMethods: {
    atproto: ED25519_DID_KEY,
  },
  alsoKnownAs: ["at://static-did-plc-auth-test-user.test"],
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer",
      endpoint: "https://example.com",
    },
  },
  prev: null,
};

console.log("=== Creating did:plc test identity ===\n");
console.log("Rotation key (secp256k1):", ROTATION_DID_KEY);
console.log("Rotation seed (hex):", bytesToHex(rotationSeed));
console.log("Verification key (ed25519):", ED25519_DID_KEY);
console.log("\nUnsigned operation:");
console.log(JSON.stringify(unsignedOp, null, 2));

// ── DAG-CBOR encode, SHA-256 hash, sign with secp256k1 ──

const unsignedCbor = dagCborEncode(unsignedOp);
console.log(`\nDAG-CBOR encoded: ${unsignedCbor.length} bytes`);

const msgHash = sha256(unsignedCbor);
const sig = secp256k1.sign(msgHash, rotationSeed);
const sigBytes = sig.toCompactRawBytes(); // 64 bytes (r || s), low-S normalized
const sigB64 = base64url(sigBytes);
console.log(`Signature (base64url): ${sigB64}`);

// ── Build signed operation ──

const signedOp = {
  sig: sigB64,
  prev: null,
  type: "plc_operation",
  services: unsignedOp.services,
  alsoKnownAs: unsignedOp.alsoKnownAs,
  rotationKeys: unsignedOp.rotationKeys,
  verificationMethods: unsignedOp.verificationMethods,
};

// ── Compute DID: did:plc:<base32lower(sha256(dag-cbor(signedOp))[0:15])> ──

const signedCbor = dagCborEncode(signedOp);
const hashBuf = await crypto.subtle.digest("SHA-256", signedCbor);
const hash = new Uint8Array(hashBuf);
const truncated = hash.slice(0, 15); // 15 bytes → 24 base32 chars
const did = `did:plc:${base32lower(truncated)}`;

console.log(`\nComputed DID: ${did}`);

// ── Submit genesis operation to plc.directory ──

console.log(`\nPOSTing to https://plc.directory/${did} ...`);
const res = await fetch(`https://plc.directory/${did}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(signedOp),
});

console.log(`Response: ${res.status} ${res.statusText}`);
const body = await res.text();
if (body) console.log(`Body: ${body}`);

if (res.ok) {
  console.log(`\nVerifying: GET https://plc.directory/${did} ...`);
  await new Promise((r) => setTimeout(r, 1000));
  const verify = await fetch(`https://plc.directory/${did}`, {
    headers: { Accept: "application/json" },
  });
  if (verify.ok) {
    const doc = await verify.json();
    console.log("\nResolved DID Document:");
    console.log(JSON.stringify(doc, null, 2));
    console.log(`\n✅ did:plc created successfully: ${did}`);
    console.log("\nPublishable keys:");
    console.log(
      `  Rotation (secp256k1): ${bytesToHex(rotationSeed)}`,
    );
    console.log(
      "  Verification (ed25519): cc82e06ff672eeae9fcd7fd979dcf32755f9b8e877fbf8e790b4b2b147309872",
    );
  } else {
    console.log(`\n⚠️  Created but verify returned ${verify.status}`);
  }
} else {
  console.error(`\n❌ Failed: ${res.status}`);
  if (body) console.error(body);
}
