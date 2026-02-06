/**
 * Demo server entry point.
 */

import { serve } from '@hono/node-server';
import { createDemoApp } from './app.js';

const { app, pbStorage } = createDemoApp();

serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || '7421', 10),
}, (info) => {
  console.log(`Demo server running at http://localhost:${info.port}`);
  console.log('Walk through the commit-reveal protocol step by step.');
});

process.on('SIGINT', () => {
  pbStorage.close();
  process.exit(0);
});
