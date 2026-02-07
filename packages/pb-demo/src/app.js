/**
 * Demo app — Hono application with embedded pb-node + remote servers.
 */

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware } from './session.js';
import { createRemoteClient } from './remote-client.js';
import { createEmbeddedPublisher } from './embedded-publisher.js';

// Route handlers
import homeRoute from './routes/home.js';
import step1Route from './routes/step1-keypair.js';
import step2Route from './routes/step2-hash.js';
import step3Route from './routes/step3-commit.js';
import step4Route from './routes/step4-submit.js';
import step5Route from './routes/step5-selection.js';
import step6Route from './routes/step6-publish.js';
import step7Route from './routes/step7-reveal.js';
import step8Route from './routes/step8-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadServersJson() {
  try {
    const raw = readFileSync(resolve(__dirname, '..', '..', '..', 'servers.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return { servers: parsed.servers || [], revealPublishers: parsed.reveal_publishers || [] };
  } catch {
    return { servers: [], revealPublishers: [] };
  }
}

export async function createDemoApp(options) {
  const app = new Hono();

  // Always create embedded pb-node
  const pbNodeMod = await import('../../pb-node/src/app.js');
  const signingMod = await import('../../pb-node/src/signing.js');
  const storageMod = await import('pb-storage/sqlite');

  const pbStorage = storageMod.createSqliteStorage(':memory:');
  await signingMod.initServerKey(pbStorage);
  const embeddedApp = pbNodeMod.createApp(pbStorage);

  // Build full server lists: embedded + remotes
  const allPbServers = [
    { name: 'embedded', client: embeddedApp, environment: 'embedded' },
  ];

  // Embedded publish server (in-memory, no auth needed)
  const embeddedPublisher = createEmbeddedPublisher();
  app.route('/publish', embeddedPublisher);

  const port = process.env.PORT || 7421;
  const allPublishServers = [
    { name: 'embedded', url: `http://localhost:${port}/publish`, environment: 'embedded' },
  ];

  if (!options?.skipRemote) {
    const { servers: serversConfig, revealPublishers } = loadServersJson();
    for (const srv of serversConfig) {
      const url = srv.primary_url || srv.url;
      // Skip localhost entries — the embedded server handles local
      if (url && !url.includes('localhost')) {
        allPbServers.push({
          name: srv.name,
          client: createRemoteClient(url),
          url,
          environment: srv.environment,
        });
      }
    }
    for (const pub of revealPublishers) {
      const url = pub.primary_url || pub.url;
      if (url) {
        allPublishServers.push({ name: pub.name, url, environment: pub.environment });
      }
    }
  }

  // Session middleware
  app.use('*', sessionMiddleware());

  // Inject server arrays filtered by session demo mode
  app.use('*', async (c, next) => {
    const session = c.get('session');
    const mode = session._demoMode;

    if (mode === 'local') {
      c.set('pbServers', allPbServers.filter(s => s.environment === 'embedded'));
      c.set('publishServers', allPublishServers.filter(s => s.environment === 'embedded'));
    } else if (mode === 'live') {
      c.set('pbServers', allPbServers.filter(s => s.environment !== 'embedded'));
      c.set('publishServers', allPublishServers.filter(s => s.environment !== 'embedded'));
    } else {
      c.set('pbServers', allPbServers);
      c.set('publishServers', allPublishServers);
    }
    await next();
  });

  // Mount routes
  app.route('/', homeRoute);
  app.route('/steps/1', step1Route);
  app.route('/steps/2', step2Route);
  app.route('/steps/3', step3Route);
  app.route('/steps/4', step4Route);
  app.route('/steps/5', step5Route);
  app.route('/steps/6', step6Route);
  app.route('/steps/7', step7Route);
  app.route('/steps/8', step8Route);

  app.notFound((c) => c.html('<h1>404</h1><p>Not found</p>', 404));

  app.onError((err, c) => {
    console.error('Demo error:', err);
    return c.html(`<h1>Error</h1><pre>${err.message}</pre>`, 500);
  });

  return { app, pbStorage, pbServers: allPbServers };
}
