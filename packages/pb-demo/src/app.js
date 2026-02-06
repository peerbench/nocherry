/**
 * Demo app — Hono application with embedded pb-node server.
 */

import { Hono } from 'hono';
import { sessionMiddleware } from './session.js';

// Import pb-node's createApp to embed it in-process
import { createApp as createPbNodeApp } from '../../pb-node/src/app.js';
import { SQLiteStorage } from '../../pb-node/src/storage/sqlite.js';

// Route handlers
import homeRoute from './routes/home.js';
import step1Route from './routes/step1-keypair.js';
import step2Route from './routes/step2-hash.js';
import step3Route from './routes/step3-commit.js';
import step4Route from './routes/step4-submit.js';
import step5Route from './routes/step5-selection.js';
import step6Route from './routes/step6-reveal.js';
import step7Route from './routes/step7-verify.js';

export function createDemoApp() {
  const app = new Hono();

  // Create an in-process pb-node server for the demo to call
  const pbStorage = new SQLiteStorage(':memory:');
  const pbNodeApp = createPbNodeApp(pbStorage);

  // Session middleware
  app.use('*', sessionMiddleware());

  // Inject the pb-node app into every request context
  app.use('*', async (c, next) => {
    c.set('pbNode', pbNodeApp);
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

  app.notFound((c) => c.html('<h1>404</h1><p>Not found</p>', 404));

  app.onError((err, c) => {
    console.error('Demo error:', err);
    return c.html(`<h1>Error</h1><pre>${err.message}</pre>`, 500);
  });

  return { app, pbStorage };
}
