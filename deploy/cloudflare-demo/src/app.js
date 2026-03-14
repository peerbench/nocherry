/**
 * Demo app for Cloudflare Workers — live mode only, no embedded server.
 */

import { Hono } from 'hono';
import { sessionMiddleware } from './session.js';
import { createRemoteClient } from './remote-client.js';

import homeRoute from './routes/home.js';
import step1Route from './routes/step1-keypair.js';
import step2Route from './routes/step2-hash.js';
import step3Route from './routes/step3-commit.js';
import step4Route from './routes/step4-submit.js';
import step5Route from './routes/step5-selection.js';
import step6Route from './routes/step6-publish.js';
import step7Route from './routes/step7-reveal.js';
import step8Route from './routes/step8-verify.js';

const SERVERS = [
  {
    name: 'cloudflare-1',
    url: 'https://commit-reveal-cloudflare-dev.peerbench.ai',
    environment: 'dev',
  },
  {
    name: 'supabase-1',
    url: 'https://zgyneuohwbzufajusohz.supabase.co/functions/v1/commit-reveal',
    environment: 'dev',
  },
  {
    name: 'google-cloud-1',
    url: 'https://commit-reveal-323104702830.us-central1.run.app',
    environment: 'dev',
  },
];

const PUBLISH_SERVERS = [
  {
    name: 'dev-cloudflare',
    url: 'https://publish-cloudflare-dev.peerbench.ai',
    environment: 'dev',
  },
  {
    name: 'dev-gcp',
    url: 'https://reveal-gcs-323104702830.us-central1.run.app',
    environment: 'dev',
  },
];

export function createDemoApp() {
  const app = new Hono();

  const pbServers = SERVERS.map(s => ({
    ...s,
    client: createRemoteClient(s.url),
  }));

  const publishServers = PUBLISH_SERVERS;

  app.use('*', sessionMiddleware());

  // Inject servers into context (live mode only)
  app.use('*', async (c, next) => {
    c.set('pbServers', pbServers);
    c.set('publishServers', publishServers);
    await next();
  });

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

  return { app, pbServers };
}
