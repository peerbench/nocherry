/**
 * End-to-end test: walk through all 7 demo steps programmatically.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApp } from '../src/app.js';

let app;
let pbStorage;
let cookie = '';

async function req(method, path, followRedirect = false) {
  const init = { method, headers: {} };
  if (cookie) init.headers.cookie = cookie;

  const res = await app.request(`http://localhost${path}`, init);

  // Capture Set-Cookie
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }

  // Follow redirect
  if (followRedirect && (res.status === 302 || res.status === 301)) {
    const location = res.headers.get('location');
    return req('GET', location);
  }
  return res;
}

describe('Demo walkthrough', () => {
  before(async () => {
    const result = await createDemoApp({ skipRemote: true });
    app = result.app;
    pbStorage = result.pbStorage;
  });

  after(() => {
    if (pbStorage) pbStorage.close();
  });

  it('GET / renders home page', async () => {
    const res = await req('GET', '/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Commit-Reveal Protocol'));
    assert.ok(html.includes('Local Demo'));
  });

  it('Step 1: generate keypair', async () => {
    // GET shows button
    let res = await req('GET', '/steps/1');
    assert.equal(res.status, 200);
    let html = await res.text();
    assert.ok(html.includes('Generate Keypair'));

    // POST generates key and redirects
    res = await req('POST', '/steps/1', true);
    html = await res.text();
    assert.ok(html.includes('did:key:z'));
    assert.ok(html.includes('Continue to Step 2'));
  });

  it('Step 2: hash data', async () => {
    let res = await req('POST', '/steps/2', true);
    const html = await res.text();
    assert.ok(html.includes('SHA-256'));
    assert.ok(html.includes('Continue to Step 3'));
  });

  it('Step 3: create commitment', async () => {
    let res = await req('POST', '/steps/3', true);
    const html = await res.text();
    assert.ok(html.includes('commitment_hash'));
    assert.ok(html.includes('Continue to Step 4'));
  });

  it('Step 4: submit to server', async () => {
    let res = await req('POST', '/steps/4', true);
    const html = await res.text();
    assert.ok(html.includes('201 Created'));
    assert.ok(html.includes('server_key'));
    assert.ok(html.includes('Continue to Step 5'));
  });

  it('Step 5: view selection', async () => {
    let res = await req('GET', '/steps/5');
    const html = await res.text();
    assert.ok(html.includes('Selection Result'));
    assert.ok(html.includes('drand'));
    assert.ok(html.includes('Continue to Step 6'));
  });

  it('Step 6: create reveal', async () => {
    let res = await req('POST', '/steps/6', true);
    const html = await res.text();
    assert.ok(html.includes('Reveal'));
    assert.ok(html.includes('Continue to Step 7'));
  });

  it('Step 7: publish & register mirrors', async () => {
    let res = await req('POST', '/steps/7', true);
    const html = await res.text();
    assert.ok(html.includes('mirror'));
    assert.ok(html.includes('Continue to Step 8'));
  });

  it('Step 8: verify', async () => {
    let res = await req('POST', '/steps/8', true);
    const html = await res.text();
    assert.ok(html.includes('Commitment Signature'));
    assert.ok(html.includes('Data Integrity'));
    assert.ok(html.includes('Completeness'));
    // Check that all passed
    assert.ok(html.includes('All checks passed'));
  });
});
