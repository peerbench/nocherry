/**
 * Stream listing (spec v0.5 Section 12.9):
 *   GET /v1/streams/:signing_key/:stream_id
 *
 * Everything this server holds for (signing_key, stream_id), ordered by
 * sequence, signed so that it can be kept as evidence of what the server
 * showed at the time. An empty list is a valid answer.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.ts'
import { signResponse } from '../signing.ts'

const route = new Hono<AppEnv>();

const MAX_STREAM_ID_BYTES = 128;

route.get('/:signing_key/:stream_id', async (c) => {
  const storage = c.get('storage');
  const signingKey = c.req.param('signing_key');
  const streamId = c.req.param('stream_id');
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(signingKey)) {
    return c.json({ error: 'signing_key must be a did:key' }, 400);
  }
  if (streamId.length === 0 || new TextEncoder().encode(streamId).length > MAX_STREAM_ID_BYTES) {
    return c.json({ error: `stream_id must be 1 to ${MAX_STREAM_ID_BYTES} bytes` }, 400);
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
