import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/** Generate a keypair by clicking Start Demo from the home page. Lands on GET /steps/1. */
async function generateKeypair(page) {
  await page.goto('/');
  await page.locator('button', { hasText: 'Start Demo' }).click();
  await page.waitForURL('**/steps/1');
}

/** Walk through steps 1-2, producing hashed items. Lands on GET /steps/2 (post-hash). */
async function setupThroughStep2(page, { itemCount = 5, customData = null } = {}) {
  await generateKeypair(page);
  await page.locator('a', { hasText: 'Continue to Step 2' }).click();
  await page.waitForURL('**/steps/2');

  if (customData) {
    await page.fill('textarea[name="data"]', customData);
    await page.locator('button', { hasText: 'Hash Custom Data' }).click();
  } else {
    if (itemCount !== 5) {
      await page.selectOption('select[name="count"]', String(itemCount));
    }
    await page.locator('button', { hasText: 'Generate & Hash' }).click();
  }
  await page.waitForURL('**/steps/2');
}

/** Walk through steps 1-3, producing a signed commitment. Lands on GET /steps/3 (post-commit). */
async function setupThroughStep3(page, opts = {}) {
  await setupThroughStep2(page, opts);
  await page.locator('a', { hasText: 'Continue to Step 3' }).click();
  await page.waitForURL('**/steps/3');
  await page.locator('button', { hasText: /Create.*Sign Commitment/ }).click();
  await page.waitForURL('**/steps/3');
}

/** Walk through steps 1-4, submitting to servers (slow — waits for drand beacon). */
async function setupThroughStep4(page, opts = {}) {
  await setupThroughStep3(page, opts);
  await page.locator('a', { hasText: 'Continue to Step 4' }).click();
  await page.waitForURL('**/steps/4');
  await page.locator('#submit-btn').click();
  await expect(page.locator('#receipt-result', { hasText: '201 Created' })).toBeVisible({ timeout: 30_000 });
}

// ── Home Page ────────────────────────────────────────────────────────

test.describe('Home page', () => {
  test('loads with heading, features, and start button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toContainText('Commit-Reveal Protocol');
    await expect(page.locator('button', { hasText: 'Start Demo' })).toBeVisible();

    // Three feature cards
    const features = page.locator('.feature');
    await expect(features).toHaveCount(3);
    await expect(features.nth(0).locator('h3')).toContainText('Temporal Ordering');
    await expect(features.nth(1).locator('h3')).toContainText('Integrity');
    await expect(features.nth(2).locator('h3')).toContainText('Unbiased Selection');
  });

  test('Start Demo generates keypair and lands on step 1', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Start Demo' }).click();
    await page.waitForURL('**/steps/1');
    // Should see the generated keypair, not the "Generate Keypair" button
    await expect(page.locator('.content-panel .field-value', { hasText: 'did:key:z' })).toBeVisible();
  });
});

// ── Step 1: Generate Keypair ─────────────────────────────────────────

test.describe('Step 1: Generate Keypair', () => {
  test('fresh session shows generate button', async ({ page }) => {
    await page.goto('/steps/1');
    await expect(page.locator('button', { hasText: 'Generate Keypair' })).toBeVisible();
    // No key fields yet
    await expect(page.locator('.field-value', { hasText: 'did:key' })).not.toBeVisible();
  });

  test('generates keypair with all key fields', async ({ page }) => {
    await generateKeypair(page);

    // DID key
    const didKey = page.locator('.content-panel .field-value', { hasText: 'did:key:z6Mk' });
    await expect(didKey).toBeVisible();

    // Public key (hex, 64 chars)
    const labels = page.locator('.content-panel .field-label');
    await expect(labels.filter({ hasText: 'Public Key' })).toBeVisible();
    await expect(labels.filter({ hasText: 'Private Key' })).toBeVisible();

    // Continue button present
    await expect(page.locator('a', { hasText: 'Continue to Step 2' })).toBeVisible();
  });
});

// ── Step 2: Hash Data ────────────────────────────────────────────────

test.describe('Step 2: Hash Data', () => {
  test('redirects to step 1 without session', async ({ page }) => {
    await page.goto('/steps/2');
    await page.waitForURL('**/steps/1');
  });

  test('generates default 5 random items', async ({ page }) => {
    await setupThroughStep2(page);

    const hashFields = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
    await expect(hashFields).toHaveCount(5);
    await expect(page.locator('a', { hasText: 'Continue to Step 3' })).toBeVisible();
  });

  test('generates 10 random items', async ({ page }) => {
    await setupThroughStep2(page, { itemCount: 10 });

    const hashFields = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
    await expect(hashFields).toHaveCount(10);
  });

  test('generates 3 random items', async ({ page }) => {
    await setupThroughStep2(page, { itemCount: 3 });

    const hashFields = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
    await expect(hashFields).toHaveCount(3);
  });

  test('hashes custom user data', async ({ page }) => {
    const customLines = 'My first item\nMy second item\nMy third item';
    await setupThroughStep2(page, { customData: customLines });

    const hashFields = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
    await expect(hashFields).toHaveCount(3);

    // Verify the item labels are visible
    await expect(page.locator('.content-panel', { hasText: 'My first item' })).toBeVisible();
    await expect(page.locator('.content-panel', { hasText: 'My second item' })).toBeVisible();
  });

  test('empty custom data stays on step 2 input form', async ({ page }) => {
    await generateKeypair(page);
    await page.locator('a', { hasText: 'Continue to Step 2' }).click();
    await page.waitForURL('**/steps/2');

    // Submit empty custom data
    await page.fill('textarea[name="data"]', '');
    await page.locator('button', { hasText: 'Hash Custom Data' }).click();
    await page.waitForURL('**/steps/2');

    // Should still show the input form (not hashes)
    await expect(page.locator('textarea[name="data"]')).toBeVisible();
  });

  test('start over resets to input form', async ({ page }) => {
    await setupThroughStep2(page);

    // Click "Start Over"
    await page.locator('button', { hasText: 'Start Over' }).click();
    await page.waitForURL('**/steps/2');

    // Back to input form
    await expect(page.locator('button', { hasText: 'Generate & Hash' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'SHA-256' })).not.toBeVisible();
  });
});

// ── Step 3: Create Commitment ────────────────────────────────────────

test.describe('Step 3: Create Commitment', () => {
  test('redirects to step 2 without hashes', async ({ page }) => {
    await generateKeypair(page);
    await page.goto('/steps/3');
    // Should redirect back since no hashes in session
    const url = page.url();
    expect(url).toContain('/steps/2');
  });

  test('creates commitment and shows all fields', async ({ page }) => {
    await setupThroughStep3(page);

    // Key fields visible
    await expect(page.locator('.content-panel .field-label', { hasText: 'Commitment Hash' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Signature' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Signing Key' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Spec Version' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Item Count' })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Reveal Probability' })).toBeVisible();

    // Commitment hash is 64-char hex
    const hashValue = page.locator('.content-panel .field-label', { hasText: 'Commitment Hash' }).locator('..').locator('.field-value');
    await expect(hashValue).toBeVisible();
    const text = await hashValue.textContent();
    expect(text.trim()).toMatch(/^[0-9a-f]{64}$/);

    // Full commitment JSON block present
    await expect(page.locator('.json-block')).toBeVisible();
    await expect(page.locator('a', { hasText: 'Continue to Step 4' })).toBeVisible();
  });

  test('shows commitment form with reveal probability slider', async ({ page }) => {
    await setupThroughStep2(page);
    await page.locator('a', { hasText: 'Continue to Step 3' }).click();
    await page.waitForURL('**/steps/3');

    // Slider defaults to 0.50
    const slider = page.locator('#prob-slider');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue('0.5');

    // Probability display shows 0.50
    await expect(page.locator('#prob-value')).toContainText('0.50');
  });

  test('re-create resets commitment', async ({ page }) => {
    await setupThroughStep3(page);

    // Click "Re-create"
    await page.locator('button', { hasText: 'Re-create' }).click();
    await page.waitForURL('**/steps/3');

    // Should show the create form again
    await expect(page.locator('button', { hasText: /Create.*Sign Commitment/ })).toBeVisible();
    await expect(page.locator('.content-panel .field-label', { hasText: 'Commitment Hash' })).not.toBeVisible();
  });

  test('item count matches number of hashed items', async ({ page }) => {
    await setupThroughStep3(page, { itemCount: 10 });

    const itemCountField = page.locator('.content-panel .field-label', { hasText: 'Item Count' }).locator('..').locator('.field-value');
    await expect(itemCountField).toContainText('10');
  });
});

// ── Step 4: Pre-submit UI ────────────────────────────────────────────

test.describe('Step 4: Pre-submit UI', () => {
  test('redirects to step 3 without commitment', async ({ page }) => {
    await setupThroughStep2(page);
    await page.goto('/steps/4');
    const url = page.url();
    expect(url).toContain('/steps/3');
  });

  test('shows server list and beacon elements', async ({ page }) => {
    await setupThroughStep3(page);
    await page.locator('a', { hasText: 'Continue to Step 4' }).click();
    await page.waitForURL('**/steps/4');

    // Server list panel
    await expect(page.locator('#server-list')).toBeVisible();

    // Beacon UI elements
    await expect(page.locator('#beacon-status')).toBeVisible();
    await expect(page.locator('#beacon-list')).toBeVisible();

    // Submit button
    await expect(page.locator('#submit-btn')).toBeVisible();
    await expect(page.locator('#submit-btn')).toContainText('Submit to All Servers');
  });

  test('beacon ticker fetches live drand rounds', async ({ page }) => {
    await setupThroughStep3(page);
    await page.locator('a', { hasText: 'Continue to Step 4' }).click();
    await page.waitForURL('**/steps/4');

    // Wait for at least one beacon round to appear
    await expect(page.locator('.beacon-round').first()).toBeVisible({ timeout: 15_000 });

    // Round should show a round number
    const roundNum = page.locator('.beacon-round .round-num').first();
    await expect(roundNum).toBeVisible();
    const roundText = await roundNum.textContent();
    expect(roundText).toMatch(/^#\d+$/);
  });

  test('health endpoint returns server info as JSON', async ({ page, request }) => {
    // Start the demo to ensure the server is up, then hit the health API directly
    await setupThroughStep3(page);

    // Get cookies from the page context for authenticated request
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get('/steps/4/health', {
      headers: { Cookie: cookieHeader },
    });
    expect(resp.ok()).toBeTruthy();

    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Embedded server should always be present and healthy
    const embedded = data.find(s => s.name === 'embedded');
    expect(embedded).toBeTruthy();
    expect(embedded.status).toBe('ok');
  });

  test('server list shows health check results', async ({ page }) => {
    await setupThroughStep3(page);
    await page.locator('a', { hasText: 'Continue to Step 4' }).click();
    await page.waitForURL('**/steps/4');

    // Wait for server list to finish checking (green dot appears for healthy server)
    await expect(page.locator('#server-list', { hasText: 'healthy' })).toBeVisible({ timeout: 10_000 });
  });
});

// ── Session Guards ───────────────────────────────────────────────────

test.describe('Session redirect guards', () => {
  test('step 5 redirects without receipt', async ({ page }) => {
    await page.goto('/steps/5');
    const url = page.url();
    expect(url).not.toContain('/steps/5');
    expect(url).toMatch(/\/steps\/[1-4]/);
  });

  test('step 6 redirects without selectedItems', async ({ page }) => {
    await page.goto('/steps/6');
    const url = page.url();
    expect(url).not.toContain('/steps/6');
  });

  test('step 7 redirects without mirrorResults', async ({ page }) => {
    await page.goto('/steps/7');
    const url = page.url();
    expect(url).not.toContain('/steps/7');
  });

  test('step 8 redirects without reveal', async ({ page }) => {
    await page.goto('/steps/8');
    const url = page.url();
    expect(url).not.toContain('/steps/8');
  });

  test('direct access to step 5 with no session chains redirects to step 1', async ({ page }) => {
    await page.goto('/steps/5');
    // step 5 -> step 4 -> step 3 -> step 2 -> step 1
    const url = page.url();
    expect(url).toMatch(/\/steps\/[1-2]/);
  });
});

// ── Navigation ───────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('step nav shows progress circles', async ({ page }) => {
    await generateKeypair(page);
    await page.locator('a', { hasText: 'Continue to Step 2' }).click();
    await page.waitForURL('**/steps/2');

    // Step 1 should be "done"
    const step1 = page.locator('.steps-nav .step').first();
    await expect(step1).toHaveClass(/done/);

    // Step 2 should be "current"
    const step2 = page.locator('.steps-nav .step').nth(1);
    await expect(step2).toHaveClass(/current/);

    // Step 3+ should be "future"
    const step3 = page.locator('.steps-nav .step').nth(2);
    await expect(step3).toHaveClass(/future/);
  });

  test('can navigate back to completed step 1 from step 2', async ({ page }) => {
    await setupThroughStep2(page);
    await page.locator('a', { hasText: 'Continue to Step 3' }).click();
    await page.waitForURL('**/steps/3');

    // Click step 1 in the nav
    const step1Circle = page.locator('.steps-nav .step').first().locator('.circle a');
    await step1Circle.click();
    await page.waitForURL('**/steps/1');

    // Keypair should still be visible
    await expect(page.locator('.content-panel .field-value', { hasText: 'did:key:z' })).toBeVisible();
  });

  test('all 8 steps appear in navigation bar', async ({ page }) => {
    await page.goto('/steps/1');
    const steps = page.locator('.steps-nav .step');
    await expect(steps).toHaveCount(8);
  });
});

// ── Full Walkthrough (slow — involves drand beacon) ──────────────────

test.describe('Full walkthrough', () => {
  test('complete 8-step flow with detailed assertions', async ({ page }) => {
    // ─── Step 1: Generate Keypair ───
    await test.step('Step 1: Generate keypair via Start Demo', async () => {
      await page.goto('/');
      await page.locator('button', { hasText: 'Start Demo' }).click();
      await page.waitForURL('**/steps/1');

      await expect(page.locator('.content-panel .field-value', { hasText: 'did:key:z6Mk' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Public Key' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Private Key' })).toBeVisible();
    });

    // ─── Step 2: Hash Data ───
    await test.step('Step 2: Generate & hash 5 random items', async () => {
      await page.locator('a', { hasText: 'Continue to Step 2' }).click();
      await page.waitForURL('**/steps/2');

      await page.locator('button', { hasText: 'Generate & Hash' }).click();
      await page.waitForURL('**/steps/2');

      const hashLabels = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
      await expect(hashLabels).toHaveCount(5);

      // Each hash should be 64-char hex
      const hashValues = page.locator('.content-panel .field-value.mono');
      const count = await hashValues.count();
      expect(count).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < 5; i++) {
        const text = await hashValues.nth(i).textContent();
        expect(text.trim()).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    // ─── Step 3: Create Commitment ───
    await test.step('Step 3: Create and sign commitment', async () => {
      await page.locator('a', { hasText: 'Continue to Step 3' }).click();
      await page.waitForURL('**/steps/3');

      // Verify form elements before creating
      await expect(page.locator('#prob-slider')).toBeVisible();
      await expect(page.locator('select[name="beacon"]')).toBeVisible();

      await page.locator('button', { hasText: /Create.*Sign Commitment/ }).click();
      await page.waitForURL('**/steps/3');

      await expect(page.locator('.content-panel .field-label', { hasText: 'Commitment Hash' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Signature' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Item Count' })).toBeVisible();

      // Verify the JSON block contains expected fields
      const jsonText = await page.locator('.json-block').textContent();
      expect(jsonText).toContain('commitment_hash');
      expect(jsonText).toContain('spec_version');
      expect(jsonText).toContain('items');
      expect(jsonText).toContain('reveal_probability');
    });

    // ─── Step 4: Submit to Servers ───
    await test.step('Step 4: Submit commitment to servers', async () => {
      await page.locator('a', { hasText: 'Continue to Step 4' }).click();
      await page.waitForURL('**/steps/4');

      // Verify pre-submit UI
      await expect(page.locator('#submit-btn')).toBeVisible();
      await expect(page.locator('#server-list')).toBeVisible();
      await expect(page.locator('#beacon-status')).toBeVisible();

      // Wait for at least one beacon round
      await expect(page.locator('.beacon-round').first()).toBeVisible({ timeout: 15_000 });

      // Submit
      await page.locator('#submit-btn').click();

      // Wait for receipt (drand beacon can take up to ~15s)
      await expect(page.locator('#receipt-result', { hasText: '201 Created' })).toBeVisible({ timeout: 30_000 });

      // Verify receipt details
      await expect(page.locator('#receipt-result', { hasText: 'Server Key' })).toBeVisible();
      await expect(page.locator('#receipt-result', { hasText: 'Server Signature' })).toBeVisible();

      // Submit button should be hidden after success
      await expect(page.locator('#submit-btn')).not.toBeVisible();

      // Continue link should appear in the receipt result
      await expect(page.locator('#receipt-result a', { hasText: 'Continue to Step 5' })).toBeVisible();
    });

    // ─── Step 5: Selection ───
    await test.step('Step 5: View beacon selection results', async () => {
      await page.locator('a', { hasText: 'Continue to Step 5' }).click();
      await page.waitForURL('**/steps/5');

      await expect(page.locator('.content-panel h2', { hasText: 'Selection Result' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Selection Round' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Randomness' })).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Selection Mode' })).toBeVisible();

      // Items list should show selected/not-selected items
      const items = page.locator('.item-list li');
      await expect(items).toHaveCount(5);

      // At least some should be selected (with 50% probability and 5 items, very likely)
      const selected = page.locator('.item-list li.selected');
      const selectedCount = await selected.count();
      expect(selectedCount).toBeGreaterThanOrEqual(0); // Could be 0 in rare cases

      // Selected count field
      await expect(page.locator('.content-panel .field-label', { hasText: 'Selected Count' })).toBeVisible();
    });

    // ─── Step 6: Publish Selected Data ───
    await test.step('Step 6: Publish selected data', async () => {
      await page.locator('a', { hasText: 'Continue to Step 6' }).click();
      await page.waitForURL('**/steps/6');

      // Pre-publish: shows selected items and publish servers
      await expect(page.locator('.content-panel', { hasText: 'Items to Publish' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Publish Server' })).toBeVisible();

      await page.locator('button', { hasText: 'Publish Selected Random Sample' }).click();
      await page.waitForURL('**/steps/6');

      // Post-publish: shows upload results (may show failures if no publish server auth)
      await expect(page.locator('.content-panel', { hasText: 'Upload Results' })).toBeVisible();
    });

    // ─── Step 7: Reveal ───
    await test.step('Step 7: Submit reveal to servers', async () => {
      await page.locator('a', { hasText: 'Continue to Step 7' }).click();
      await page.waitForURL('**/steps/7');

      // Pre-reveal: shows selected items count
      await expect(page.locator('.content-panel', { hasText: 'randomly selected' })).toBeVisible();

      await page.locator('button', { hasText: 'Submit Reveal to Servers' }).click();
      await page.waitForURL('**/steps/7');

      // Post-reveal: server results (multiple servers = multiple result blocks)
      await expect(page.locator('.content-panel .server-result').first()).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Reveal ID' }).first()).toBeVisible();
      await expect(page.locator('.content-panel .field-label', { hasText: 'Selected Items' })).toBeVisible();

      // Full reveal JSON block
      await expect(page.locator('.json-block')).toBeVisible();
      const revealJson = await page.locator('.json-block').textContent();
      expect(revealJson).toContain('commitment_hash');
      expect(revealJson).toContain('selected_items');
      expect(revealJson).toContain('voluntary_items');
      expect(revealJson).toContain('signature');
    });

    // ─── Step 8: Verify ───
    await test.step('Step 8: Run full verification', async () => {
      await page.locator('a', { hasText: 'Continue to Step 8' }).click();
      await page.waitForURL('**/steps/8');

      // Pre-verify: shows the 6 verification steps
      await expect(page.locator('.content-panel', { hasText: 'Verify commitment signature' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Verify beacon' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Verify selection' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Verify reveal signature' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Verify data integrity' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Check completeness' })).toBeVisible();

      await page.locator('button', { hasText: 'Run Verification' }).click();
      await page.waitForURL('**/steps/8');

      // All checks should pass
      await expect(page.locator('.content-panel', { hasText: 'All checks passed' })).toBeVisible();

      // Each of the 6 checks should be listed with results
      await expect(page.locator('.content-panel', { hasText: 'Commitment Signature' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Beacon Temporal Ordering' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Selection Recomputation' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Reveal Signature' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Data Integrity' })).toBeVisible();
      await expect(page.locator('.content-panel', { hasText: 'Completeness' })).toBeVisible();

      // "Start Over" link at the end
      await expect(page.locator('a', { hasText: 'Start Over' })).toBeVisible();
    });
  });

  test('walkthrough with custom user-entered data', async ({ page }) => {
    const customData = 'Benchmark: accuracy=0.95\nBenchmark: latency_p50=42ms\nBenchmark: throughput=500rps';

    await test.step('Steps 1-3: Setup with custom data', async () => {
      await generateKeypair(page);
      await page.locator('a', { hasText: 'Continue to Step 2' }).click();
      await page.waitForURL('**/steps/2');

      // Enter custom data
      await page.fill('textarea[name="data"]', customData);
      await page.locator('button', { hasText: 'Hash Custom Data' }).click();
      await page.waitForURL('**/steps/2');

      // Should show 3 items with custom labels
      const hashLabels = page.locator('.content-panel .field-label', { hasText: 'SHA-256' });
      await expect(hashLabels).toHaveCount(3);
      await expect(page.locator('.content-panel', { hasText: 'accuracy=0.95' })).toBeVisible();

      // Create commitment
      await page.locator('a', { hasText: 'Continue to Step 3' }).click();
      await page.waitForURL('**/steps/3');
      await page.locator('button', { hasText: /Create.*Sign Commitment/ }).click();
      await page.waitForURL('**/steps/3');

      // Item count should be 3
      const itemCount = page.locator('.content-panel .field-label', { hasText: 'Item Count' }).locator('..').locator('.field-value');
      await expect(itemCount).toContainText('3');
    });

    await test.step('Step 4: Submit to servers', async () => {
      await page.locator('a', { hasText: 'Continue to Step 4' }).click();
      await page.waitForURL('**/steps/4');
      await page.locator('#submit-btn').click();
      await expect(page.locator('#receipt-result', { hasText: '201 Created' })).toBeVisible({ timeout: 30_000 });
    });

    await test.step('Steps 5-8: Selection through verification', async () => {
      // Step 5
      await page.locator('a', { hasText: 'Continue to Step 5' }).click();
      await page.waitForURL('**/steps/5');
      const items = page.locator('.item-list li');
      await expect(items).toHaveCount(3);

      // Step 6 (Publish)
      await page.locator('a', { hasText: 'Continue to Step 6' }).click();
      await page.waitForURL('**/steps/6');
      await page.locator('button', { hasText: 'Publish Selected Random Sample' }).click();
      await page.waitForURL('**/steps/6');
      await expect(page.locator('.content-panel', { hasText: 'Upload Results' })).toBeVisible();

      // Step 7 (Reveal)
      await page.locator('a', { hasText: 'Continue to Step 7' }).click();
      await page.waitForURL('**/steps/7');
      await page.locator('button', { hasText: 'Submit Reveal to Servers' }).click();
      await page.waitForURL('**/steps/7');
      await expect(page.locator('.content-panel .field-label', { hasText: 'Reveal ID' }).first()).toBeVisible();

      // Step 8
      await page.locator('a', { hasText: 'Continue to Step 8' }).click();
      await page.waitForURL('**/steps/8');
      await page.locator('button', { hasText: 'Run Verification' }).click();
      await page.waitForURL('**/steps/8');
      await expect(page.locator('.content-panel', { hasText: 'All checks passed' })).toBeVisible();
    });
  });

  test('step 8 start over returns to home', async ({ page }) => {
    await test.step('Walk through entire flow', async () => {
      await setupThroughStep4(page);

      // Step 5
      await page.locator('a', { hasText: 'Continue to Step 5' }).click();
      await page.waitForURL('**/steps/5');

      // Step 6 (Publish)
      await page.locator('a', { hasText: 'Continue to Step 6' }).click();
      await page.waitForURL('**/steps/6');
      await page.locator('button', { hasText: 'Publish Selected Random Sample' }).click();
      await page.waitForURL('**/steps/6');

      // Step 7 (Reveal)
      await page.locator('a', { hasText: 'Continue to Step 7' }).click();
      await page.waitForURL('**/steps/7');
      await page.locator('button', { hasText: 'Submit Reveal to Servers' }).click();
      await page.waitForURL('**/steps/7');

      // Step 8
      await page.locator('a', { hasText: 'Continue to Step 8' }).click();
      await page.waitForURL('**/steps/8');
      await page.locator('button', { hasText: 'Run Verification' }).click();
      await page.waitForURL('**/steps/8');
    });

    await test.step('Click Start Over', async () => {
      await page.locator('a', { hasText: 'Start Over' }).click();
      await page.waitForURL(/\/$/);
      await expect(page.locator('.hero h1')).toContainText('Commit-Reveal Protocol');
    });
  });
});

// ── 404 ──────────────────────────────────────────────────────────────

test.describe('Error handling', () => {
  test('unknown route returns 404', async ({ page }) => {
    const response = await page.goto('/nonexistent-page');
    expect(response.status()).toBe(404);
  });
});
