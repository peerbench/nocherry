/**
 * Cloudflare Worker entry point for reveal publishing helper.
 */

import { createApp } from './app.js';

const app = createApp();

export default {
  fetch: app.fetch,
};
