#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
/**
 * Test DID identity match for both did:web and did:plc against live server.
 *
 * Uses the fixed test keypair:
 *   did_key:         did:key:z6MkfCH4zUChzYzAufNRaf2BWBgup8bLUMn3fYofxZfbehRg
 *   private_key_hex: cc82e06ff672eeae9fcd7fd979dcf32755f9b8e877fbf8e790b4b2b147309872
 *
 * did:web is served by Cloudflare Worker at commit-reveal.orgtopus.workers.dev
 * did:plc was registered at plc.directory: did:plc:gc4o2abyvharj4sids3dfmkb
 *
 * Usage:
 *   deno run --allow-read --allow-net test-did-match.ts [BASE_URL]
 */

import {
  initWasm,
  hashBytes,
  createCommitment,
} from "./supabase/functions/commit-reveal/wasm/mod.ts";

await initWasm();

const BASE =
  Deno.args[0] ||
  "https://zgyneuohwbzufajusohz.supabase.co/functions/v1/commit-reveal";
const DRAND_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

// Fixed test keypair
const TEST_KP = {
  did_key: "did:key:z6MkfCH4zUChzYzAufNRaf2BWBgup8bLUMn3fYofxZfbehRg",
  private_key_hex:
    "cc82e06ff672eeae9fcd7fd979dcf32755f9b8e877fbf8e790b4b2b147309872",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    const msg = (e as Error).message;
    failures.push(`${name}: ${msg}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${msg}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: unknown, expected: unknown, msg?: string) {
  if (actual !== expected) {
    throw new Error(
      msg ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function makeCommitment(
  identity: string | undefined,
  suffix: string,
) {
  const itemHash = hashBytes(
    new TextEncoder().encode(`did-match-test-${suffix}-${Date.now()}`),
  );
  const params = {
    items: [itemHash],
    reveal_probability: 0.1,
    beacon: { type: "drand", chain_hash: DRAND_CHAIN_HASH },
    committed_at: new Date().toISOString(),
    ...(identity ? { identity } : {}),
  };
  return createCommitment(JSON.stringify(params), TEST_KP.private_key_hex);
}

console.log(`\nDID Match Tests against: ${BASE}\n`);

// ── did:web match ──
console.log("did:web identity match:");

await test(
  "did:web:commit-reveal.orgtopus.workers.dev → matched",
  async () => {
    const commitment = makeCommitment(
      "did:web:commit-reveal.orgtopus.workers.dev",
      "didweb",
    );
    const res = await fetch(`${BASE}/v1/commitments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitment),
    });
    assertEqual(res.status, 201, `status ${res.status}`);
    const body = await res.json();
    assertEqual(
      body.key_matches_identity,
      "matched",
      `key_matches_identity: ${body.key_matches_identity}`,
    );
  },
);

await test(
  "did:web with wrong domain → mismatch",
  async () => {
    const commitment = makeCommitment(
      "did:web:example.com",
      "didweb-wrong",
    );
    const res = await fetch(`${BASE}/v1/commitments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitment),
    });
    // Should succeed (201) but identity should not match
    assertEqual(res.status, 201, `status ${res.status}`);
    const body = await res.json();
    assert(
      body.key_matches_identity !== "matched",
      `expected non-match, got: ${body.key_matches_identity}`,
    );
  },
);

// ── did:plc match ──
console.log("\ndid:plc identity match:");

await test(
  "did:plc:gc4o2abyvharj4sids3dfmkb → matched",
  async () => {
    const commitment = makeCommitment(
      "did:plc:gc4o2abyvharj4sids3dfmkb",
      "didplc",
    );
    const res = await fetch(`${BASE}/v1/commitments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitment),
    });
    assertEqual(res.status, 201, `status ${res.status}`);
    const body = await res.json();
    assertEqual(
      body.key_matches_identity,
      "matched",
      `key_matches_identity: ${body.key_matches_identity}`,
    );
  },
);

await test(
  "did:plc:z72i7hdynmk6r22z27h6tvur (bsky.app) → mismatch",
  async () => {
    const commitment = makeCommitment(
      "did:plc:z72i7hdynmk6r22z27h6tvur",
      "didplc-wrong",
    );
    const res = await fetch(`${BASE}/v1/commitments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitment),
    });
    assertEqual(res.status, 201, `status ${res.status}`);
    const body = await res.json();
    assertEqual(
      body.key_matches_identity,
      "mismatch",
      `key_matches_identity: ${body.key_matches_identity}`,
    );
  },
);

// ── no identity (null) ──
console.log("\nNo identity:");

await test("no identity field → null", async () => {
  const commitment = makeCommitment(undefined, "no-identity");
  const res = await fetch(`${BASE}/v1/commitments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commitment),
  });
  assertEqual(res.status, 201, `status ${res.status}`);
  const body = await res.json();
  assertEqual(
    body.key_matches_identity,
    null,
    `key_matches_identity: ${body.key_matches_identity}`,
  );
});

// ── Summary ──
console.log(`\n${"═".repeat(50)}`);
console.log(
  `Results: ${passed} passed, ${failed} failed, ${passed + failed} total`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  \x1b[31m✗\x1b[0m ${f}`);
  }
}
console.log();

Deno.exit(failed > 0 ? 1 : 0);
