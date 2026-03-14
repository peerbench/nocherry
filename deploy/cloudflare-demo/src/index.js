/**
 * Cloudflare Worker entry point for the demo app.
 * Runs in live-only mode — no embedded server, talks to remote servers.
 */

import { createDemoApp } from './app.js';

const { app } = createDemoApp();

export default {
  fetch: app.fetch,
};
