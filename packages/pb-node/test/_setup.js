/**
 * Shared test setup — provides either a local in-memory app or a remote
 * client depending on the SERVER_URL environment variable.
 *
 *   SERVER_URL not set  → local mode (Hono app + in-memory SQLite)
 *   SERVER_URL=https://… → remote mode (real fetch against live server)
 */

import { createApp } from '../src/app.js';
import { initServerKey } from '../src/signing.js';
import { createSqliteStorage } from 'pb-storage/sqlite';

const SERVER_URL = process.env.SERVER_URL;

export const isRemote = !!SERVER_URL;

/**
 * Minimal remote client — mirrors Hono's app.request(url, init) interface.
 * Rewrites http://localhost/path → SERVER_URL/path so the same test helpers work.
 */
function createRemoteClient(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async request(localUrl, init) {
      const path = new URL(localUrl).pathname;
      return fetch(`${base}${path}`, init);
    },
  };
}

let _app = null;
let _storage = null;

export async function getApp() {
  if (_app) return _app;

  if (isRemote) {
    console.log(`  [remote mode] Testing against ${SERVER_URL}`);
    _app = createRemoteClient(SERVER_URL);
  } else {
    _storage = createSqliteStorage(':memory:');
    await initServerKey(_storage);
    _app = createApp(_storage);
  }
  return _app;
}

export async function cleanup() {
  if (_storage) {
    await _storage.close();
    _storage = null;
  }
  _app = null;
}
