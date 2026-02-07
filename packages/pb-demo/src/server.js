/**
 * Demo server entry point.
 */

import { serve } from '@hono/node-server';
import { createDemoApp } from './app.js';

const { app, pbStorage, pbServers } = await createDemoApp();

serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || '7421', 10),
}, (info) => {
  console.log(`Demo server running at http://localhost:${info.port}`);
  console.log(`Connected to ${pbServers.length} server(s):`);
  for (const s of pbServers) {
    if (s.environment === 'embedded') {
      console.log(`  - ${s.name} (in-process)`);
    } else {
      console.log(`  - ${s.name} (${s.url})`);
    }
  }
  console.log('Walk through the commit-reveal protocol step by step.');
});

process.on('SIGINT', () => {
  if (pbStorage) pbStorage.close();
  process.exit(0);
});
