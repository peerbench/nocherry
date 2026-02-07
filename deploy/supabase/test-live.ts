/**
 * Live integration tests for the commit-reveal Supabase Edge Function.
 * Runs the same test logic as pb-node/test/api.test.js and attacks.test.js
 * but against a live HTTP endpoint via fetch().
 *
 * Usage:
 *   deno run --allow-read --allow-net --allow-env test-live.ts [BASE_URL]
 *
 * Default URL: https://zgyneuohwbzufajusohz.supabase.co/functions/v1/commit-reveal
 */

import {
  initWasm,
  generateKeypair,
  hashBytes,
  createCommitment,
  verifySignature,
  signMessage,
} from "./supabase/functions/commit-reveal/wasm/mod.ts";

await initWasm();

const BASE =
  Deno.args[0] ||
  "https://zgyneuohwbzufajusohz.supabase.co/functions/v1/commit-reveal";
const DRAND_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined && body !== null) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return fetch(`${BASE}${path}`, init);
}

function makeCommitment(
  kp: { private_key_hex: string; did_key: string },
  items: string[],
  opts: {
    reveal_probability?: number;
    beacon?: { type: string; chain_hash: string };
    committed_at?: string;
  } = {},
) {
  const params = {
    items,
    reveal_probability: opts.reveal_probability || 0.1,
    beacon: opts.beacon || { type: "drand", chain_hash: DRAND_CHAIN_HASH },
    committed_at: opts.committed_at || new Date().toISOString(),
  };
  return createCommitment(JSON.stringify(params), kp.private_key_hex);
}

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
      msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════
console.log(`\nRunning live tests against: ${BASE}\n`);

// ── Server API Tests (from api.test.js) ──
console.log("Server API:");

await test("GET /health returns ok", async () => {
  const res = await req("GET", "/health");
  assertEqual(res.status, 200, `health status ${res.status}`);
  const body = await res.json();
  assertEqual(body.status, "ok");
});

await test("GET /v1/server-info returns server metadata", async () => {
  const res = await req("GET", "/v1/server-info");
  assertEqual(res.status, 200);
  const body = await res.json();
  assert(body.server_key.startsWith("did:key:z"), "server_key format");
  assertEqual(body.spec_version, "0.2.0");
  assert(Array.isArray(body.beacon_types), "beacon_types is array");
  assert(!!body.retention, "has retention");
});

await test("POST /v1/commitments rejects missing fields", async () => {
  const res = await req("POST", "/v1/commitments", { foo: "bar" });
  assertEqual(res.status, 400);
  const body = await res.json();
  assert(body.error.includes("Missing"), `error: ${body.error}`);
});

await test("POST /v1/commitments rejects invalid signature", async () => {
  const kp = generateKeypair();
  const commitment = makeCommitment(kp, [
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  ]);
  const tampered = { ...commitment, signature: "00".repeat(64) };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test(
  "POST /v1/commitments accepts valid commitment and returns receipt",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(new TextEncoder().encode("live-api-test-1"));
    const commitment = makeCommitment(kp, [itemHash]);

    const res = await req("POST", "/v1/commitments", commitment);
    assertEqual(res.status, 201, `expected 201, got ${res.status}`);
    const body = await res.json();

    assertEqual(body.commitment_hash, commitment.commitment_hash);
    assert(!!body.registered_at, "has registered_at");
    assert(body.server_key.startsWith("did:key:z"), "server_key format");
    assert(!!body.server_signature, "has server_signature");
    assertEqual(body.commitment.signing_key, kp.did_key);
    assert(!!body.signer_activity, "has signer_activity");
  },
);

await test("POST /v1/commitments rejects duplicate", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-dup-test"));
  const commitment = makeCommitment(kp, [itemHash]);

  const res1 = await req("POST", "/v1/commitments", commitment);
  assertEqual(res1.status, 201);
  const res2 = await req("POST", "/v1/commitments", commitment);
  assertEqual(res2.status, 409);
});

await test("GET /v1/commitments/:hash returns stored commitment", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-get-test"));
  const commitment = makeCommitment(kp, [itemHash]);

  await req("POST", "/v1/commitments", commitment);
  const res = await req(
    "GET",
    `/v1/commitments/${commitment.commitment_hash}`,
  );
  assertEqual(res.status, 200);
  const body = await res.json();
  assertEqual(body.commitment_hash, commitment.commitment_hash);
  assert(!!body.server_key, "has server_key");
  assert(!!body.server_signature, "has server_signature");
});

await test("GET /v1/commitments/:hash returns 404 for unknown", async () => {
  const res = await req("GET", "/v1/commitments/" + "0".repeat(64));
  assertEqual(res.status, 404);
});

await test("POST /v1/commitments rejects empty items", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-empty-items"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, items: [], item_count: 0 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("POST /v1/commitments rejects invalid item hashes", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-bad-hash"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, items: ["not-a-valid-hash"], item_count: 1 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test(
  "tracks signer activity across multiple commitments",
  async () => {
    const kp = generateKeypair();
    for (let i = 0; i < 3; i++) {
      const itemHash = hashBytes(
        new TextEncoder().encode(`live-activity-${Date.now()}-${i}`),
      );
      const commitment = makeCommitment(kp, [itemHash]);
      await req("POST", "/v1/commitments", commitment);
    }
    const itemHash = hashBytes(
      new TextEncoder().encode(`live-activity-final-${Date.now()}`),
    );
    const commitment = makeCommitment(kp, [itemHash]);
    const res = await req("POST", "/v1/commitments", commitment);
    const body = await res.json();
    assert(
      body.signer_activity.commitments_past_hour >= 4,
      `expected >=4, got ${body.signer_activity.commitments_past_hour}`,
    );
  },
);

// ── Attack Tests (from attacks.test.js) ──
console.log("\nAttack Tests:");

await test("rejects non-JSON body", async () => {
  const res = await fetch(`${BASE}/v1/commitments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "this is not json{{{",
  });
  assert(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
});

await test("rejects empty body", async () => {
  const res = await fetch(`${BASE}/v1/commitments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "",
  });
  assert(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
});

await test("rejects null body", async () => {
  const res = await req("POST", "/v1/commitments", null);
  assert(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
});

await test(
  "rejects commitment missing each required field individually",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(
      new TextEncoder().encode("live-missing-field"),
    );
    const valid = makeCommitment(kp, [itemHash]);

    const requiredFields = [
      "spec_version",
      "commitment_hash",
      "items",
      "item_count",
      "reveal_probability",
      "beacon",
      "committed_at",
      "signing_key",
      "signature",
    ];

    for (const field of requiredFields) {
      const tampered = { ...valid } as Record<string, unknown>;
      delete tampered[field];
      const res = await req("POST", "/v1/commitments", tampered);
      assert(
        res.status === 400,
        `Missing ${field} should 400, got ${res.status}`,
      );
    }
  },
);

await test("rejects wrong types for numeric fields", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-type-test"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, reveal_probability: "not-a-number" };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("handles SQL injection in commitment hash path", async () => {
  const sqlPayload = "'; DROP TABLE commitments; --";
  const res = await req(
    "GET",
    `/v1/commitments/${encodeURIComponent(sqlPayload)}`,
  );
  // 404 from our app or 403 from Supabase WAF — both are safe
  assert(res.status === 404 || res.status === 403, `expected 404 or 403, got ${res.status}`);
});

await test("handles SQL injection in reveal path", async () => {
  const sqlPayload = "' OR '1'='1";
  const res = await req(
    "GET",
    `/v1/commitments/${encodeURIComponent(sqlPayload)}/reveals`,
  );
  assert(res.status === 404 || res.status === 403, `expected 404 or 403, got ${res.status}`);
});

await test("handles very long commitment hash", async () => {
  const longHash = "a".repeat(10000);
  const res = await req("GET", `/v1/commitments/${longHash}`);
  assertEqual(res.status, 404);
});

await test(
  "rejects commitment with tampered items but original signature",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(new TextEncoder().encode("live-tamper-items"));
    const valid = makeCommitment(kp, [itemHash]);
    const evilHash = hashBytes(new TextEncoder().encode("live-evil"));
    const tampered = { ...valid, items: [evilHash] };
    const res = await req("POST", "/v1/commitments", tampered);
    assertEqual(res.status, 400);
  },
);

await test(
  "rejects commitment with modified probability but original signature",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(new TextEncoder().encode("live-prob-tamper"));
    const valid = makeCommitment(kp, [itemHash], {
      reveal_probability: 0.5,
    });
    const tampered = { ...valid, reveal_probability: 0.01 };
    const res = await req("POST", "/v1/commitments", tampered);
    assertEqual(res.status, 400);
  },
);

await test("rejects commitment with forged commitment_hash", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-hash-forge"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, commitment_hash: "0".repeat(64) };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects commitment with empty signature", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-empty-sig"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, signature: "" };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects commitment with all-zeros signature", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-zero-sig"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, signature: "00".repeat(64) };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test(
  "rejects commitment signed by key A claiming key B",
  async () => {
    const kp_a = generateKeypair();
    const kp_b = generateKeypair();
    const itemHash = hashBytes(new TextEncoder().encode("live-key-swap"));
    const valid = makeCommitment(kp_a, [itemHash]);
    const tampered = { ...valid, signing_key: kp_b.did_key };
    const res = await req("POST", "/v1/commitments", tampered);
    assertEqual(res.status, 400);
  },
);

await test("rejects items array with non-strings", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-type-item"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, items: [42, null, true], item_count: 3 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects uppercase hex item hashes", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-upper-hex"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = {
    ...valid,
    items: [
      "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2",
    ],
    item_count: 1,
  };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects duplicate items", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-dup-item"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = {
    ...valid,
    items: [itemHash, itemHash],
    item_count: 2,
  };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects item_count mismatch", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-count-mismatch"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, item_count: 999 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects probability = 0", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-p-zero"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, reveal_probability: 0 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects negative probability", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-p-neg"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, reveal_probability: -0.5 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

await test("rejects probability > 1", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-p-over"));
  const valid = makeCommitment(kp, [itemHash]);
  const tampered = { ...valid, reveal_probability: 1.5 };
  const res = await req("POST", "/v1/commitments", tampered);
  assertEqual(res.status, 400);
});

// ── Reveal Tests ──
console.log("\nReveal Tests:");

await test("rejects reveal for nonexistent commitment", async () => {
  const kp = generateKeypair();
  const fakeHash = "0".repeat(64);
  const res = await req("POST", `/v1/commitments/${fakeHash}/reveals`, {
    spec_version: "0.2.0",
    commitment_hash: fakeHash,
    selected_items: [],
    voluntary_items: [],
    revealed_at: new Date().toISOString(),
    signing_key: kp.did_key,
    signature: "00".repeat(64),
  });
  assertEqual(res.status, 404);
});

await test(
  "rejects reveal with mismatched commitment_hash in body vs URL",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(
      new TextEncoder().encode("live-reveal-mismatch"),
    );
    const commitment = makeCommitment(kp, [itemHash]);
    await req("POST", "/v1/commitments", commitment);

    const res = await req(
      "POST",
      `/v1/commitments/${commitment.commitment_hash}/reveals`,
      {
        spec_version: "0.2.0",
        commitment_hash: "f".repeat(64),
        selected_items: [],
        voluntary_items: [],
        revealed_at: new Date().toISOString(),
        signing_key: kp.did_key,
        signature: "00".repeat(64),
      },
    );
    assertEqual(res.status, 400);
    const body = await res.json();
    assert(body.error.includes("does not match"), `error: ${body.error}`);
  },
);

await test(
  "rejects reveal with items not in original commitment",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(
      new TextEncoder().encode("live-reveal-extra"),
    );
    const commitment = makeCommitment(kp, [itemHash]);
    await req("POST", "/v1/commitments", commitment);

    const fakeItem = hashBytes(
      new TextEncoder().encode("live-not-committed"),
    );
    const revealPayload = JSON.stringify({
      spec_version: "0.2.0",
      commitment_hash: commitment.commitment_hash,
      selected_items: [fakeItem],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
    });
    const sig = signMessage(
      kp.private_key_hex,
      new TextEncoder().encode(revealPayload),
    );
    const revealBody = { ...JSON.parse(revealPayload), signature: sig };

    const res = await req(
      "POST",
      `/v1/commitments/${commitment.commitment_hash}/reveals`,
      revealBody,
    );
    assertEqual(res.status, 400);
    const body = await res.json();
    assert(
      body.error.includes("not in original commitment"),
      `error: ${body.error}`,
    );
  },
);

await test("rejects reveal with forged signature", async () => {
  const kp = generateKeypair();
  const itemHash = hashBytes(new TextEncoder().encode("live-reveal-forge"));
  const commitment = makeCommitment(kp, [itemHash]);
  await req("POST", "/v1/commitments", commitment);

  const res = await req(
    "POST",
    `/v1/commitments/${commitment.commitment_hash}/reveals`,
    {
      spec_version: "0.2.0",
      commitment_hash: commitment.commitment_hash,
      selected_items: [itemHash],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
      signature: "00".repeat(64),
    },
  );
  assertEqual(res.status, 400);
});

await test("rejects reveal signed by wrong key", async () => {
  const kp = generateKeypair();
  const kp_evil = generateKeypair();
  const itemHash = hashBytes(
    new TextEncoder().encode("live-reveal-wrong-key"),
  );
  const commitment = makeCommitment(kp, [itemHash]);
  await req("POST", "/v1/commitments", commitment);

  const revealPayload = JSON.stringify({
    spec_version: "0.2.0",
    commitment_hash: commitment.commitment_hash,
    selected_items: [itemHash],
    voluntary_items: [],
    revealed_at: new Date().toISOString(),
    signing_key: kp.did_key,
  });
  const sig = signMessage(
    kp_evil.private_key_hex,
    new TextEncoder().encode(revealPayload),
  );
  const revealBody = { ...JSON.parse(revealPayload), signature: sig };

  const res = await req(
    "POST",
    `/v1/commitments/${commitment.commitment_hash}/reveals`,
    revealBody,
  );
  assertEqual(res.status, 400);
});

await test(
  "rejects reveal missing each required field",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(
      new TextEncoder().encode("live-reveal-fields"),
    );
    const commitment = makeCommitment(kp, [itemHash]);
    await req("POST", "/v1/commitments", commitment);

    const baseReveal = {
      spec_version: "0.2.0",
      commitment_hash: commitment.commitment_hash,
      selected_items: [],
      voluntary_items: [],
      revealed_at: new Date().toISOString(),
      signing_key: kp.did_key,
      signature: "00".repeat(64),
    };

    const requiredFields = [
      "spec_version",
      "commitment_hash",
      "selected_items",
      "voluntary_items",
      "revealed_at",
      "signing_key",
      "signature",
    ];

    for (const field of requiredFields) {
      const tampered = { ...baseReveal } as Record<string, unknown>;
      delete tampered[field];
      const res = await req(
        "POST",
        `/v1/commitments/${commitment.commitment_hash}/reveals`,
        tampered,
      );
      assert(
        res.status === 400,
        `Missing ${field} should 400, got ${res.status}`,
      );
    }
  },
);

// ── Selection Tests ──
console.log("\nSelection Tests:");

await test(
  "GET /v1/commitments/:hash/selection returns selection with beacon",
  async () => {
    const kp = generateKeypair();
    const itemHash = hashBytes(
      new TextEncoder().encode("live-selection-test"),
    );
    const commitment = makeCommitment(kp, [itemHash]);
    await req("POST", "/v1/commitments", commitment);

    const res = await req(
      "GET",
      `/v1/commitments/${commitment.commitment_hash}/selection`,
    );
    assertEqual(res.status, 200);
    const body = await res.json();
    assertEqual(body.commitment_hash, commitment.commitment_hash);
    assert(!!body.beacon_output, "has beacon_output");
    assert(body.beacon_output.type === "drand", "beacon is drand");
    assert(typeof body.selected_count === "number", "has selected_count");
    assert(typeof body.total_count === "number", "has total_count");
    assert(!!body.server_key, "has server_key");
    assert(!!body.server_signature, "has server_signature");
  },
);

// ── Large payload test ──
console.log("\nStress Tests:");

await test("handles commitment with 100 items", async () => {
  const kp = generateKeypair();
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push(hashBytes(new TextEncoder().encode(`live-large-${Date.now()}-${i}`)));
  }
  const commitment = makeCommitment(kp, items);
  const res = await req("POST", "/v1/commitments", commitment);
  assert(res.status < 500, `should not crash, got ${res.status}`);
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
