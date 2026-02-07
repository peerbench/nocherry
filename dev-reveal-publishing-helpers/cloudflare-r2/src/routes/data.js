/**
 * GET /v1/data/:hash/* — Serve files from R2 bucket.
 */

import { Hono } from 'hono';

const app = new Hono();

app.get('/:hash/*', async (c) => {
  const hash = c.req.param('hash');
  const rest = c.req.path.replace(`/v1/data/${hash}/`, '');

  if (!hash || !rest) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const key = `${hash}/${rest}`;
  const object = await c.env.DATA_BUCKET.get(key);

  if (!object) {
    return c.json({ error: 'Not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default app;
