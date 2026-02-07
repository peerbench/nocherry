/**
 * Cloudflare Worker entry point.
 */

import { createApp } from './app.js';

const app = createApp();

export default {
  fetch: app.fetch,
};
