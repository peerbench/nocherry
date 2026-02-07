/**
 * GET /v1/data/:hash/* — Serve files from GCS bucket.
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';

const app = new Hono();

app.get('/:hash/*', async (c) => {
  const bucket = c.get('bucket');
  const hash = c.req.param('hash');
  const rest = c.req.path.replace(`/v1/data/${hash}/`, '');

  if (!hash || !rest) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const key = `${hash}/${rest}`;
  const file = bucket.file(key);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';

    c.header('Content-Type', contentType);
    if (metadata.size) {
      c.header('Content-Length', String(metadata.size));
    }

    return stream(c, async (s) => {
      const readStream = file.createReadStream();
      for await (const chunk of readStream) {
        await s.write(chunk);
      }
    });
  } catch (err) {
    if (err.code === 403 || err.message?.includes('billing')) {
      return c.json({ error: 'Storage temporarily unavailable. Try again later.' }, 503);
    }
    throw err;
  }
});

export default app;
