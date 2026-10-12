/**
 * Stream listings (spec v0.5 Section 12.9):
 *   GET /v1/streams/:signing_key                every stream name of a key, with counts
 *   GET /v1/streams/:signing_key/:stream_id     every entry of one stream, by sequence
 *
 * Both are signed so that they can be kept as evidence of what the server
 * showed at the time. An empty list is a valid answer. Entries come from the
 * stream index, which is not purged with the commitment bodies.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.ts'
import { signResponse } from '../signing.ts'

const route = new Hono<AppEnv>();

const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;
const STREAM_ID = /^[A-Za-z0-9._-]{1,128}$/;

route.get('/:signing_key', async (c) => {
  const storage = c.get('storage');
  const signingKey = c.req.param('signing_key');
  if (!DID_KEY.test(signingKey)) {
    return c.json({ error: 'signing_key must be a did:key' }, 400);
  }
  const streams = await storage.listStreams(signingKey);
  return c.json(signResponse({
    signing_key: signingKey,
    streams,
    listed_at: (c.get('config')?.now?.() ?? new Date()).toISOString(),
  }));
});

route.get('/:signing_key/:stream_id', async (c) => {
  const storage = c.get('storage');
  const signingKey = c.req.param('signing_key');
  const streamId = c.req.param('stream_id');
  if (!DID_KEY.test(signingKey)) {
    return c.json({ error: 'signing_key must be a did:key' }, 400);
  }
  if (!STREAM_ID.test(streamId)) {
    return c.json({ error: 'stream_id must be 1 to 128 characters from [A-Za-z0-9._-]' }, 400);
  }
  const commitments = await storage.listStream(signingKey, streamId);
  return c.json(signResponse({
    signing_key: signingKey,
    stream_id: streamId,
    commitments,
    listed_at: (c.get('config')?.now?.() ?? new Date()).toISOString(),
  }));
});

export default route;
