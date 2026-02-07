/**
 * In-memory publish server for local demo.
 * Stores uploaded files in a Map — no auth, no database.
 */

import { Hono } from 'hono';
import * as wasm from 'pb-wasm';

export function createEmbeddedPublisher() {
  const app = new Hono();

  // In-memory file store: key = "commitmentHash/filename" → Buffer
  const store = new Map();

  app.post('/v1/upload', async (c) => {
    const body = await c.req.parseBody({ all: true });

    // Extract receipt
    const receiptRaw = body['receipt'];
    if (!receiptRaw) {
      return c.json({ error: 'Missing receipt field' }, 400);
    }

    let receipt;
    try {
      receipt = JSON.parse(typeof receiptRaw === 'string' ? receiptRaw : await receiptRaw.text());
    } catch {
      return c.json({ error: 'Invalid receipt JSON' }, 400);
    }

    // Collect files
    let rawFiles = body['files[]'];
    if (!rawFiles) {
      return c.json({ error: 'Missing files[] field' }, 400);
    }
    const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

    if (files.length === 0) {
      return c.json({ error: 'No files provided' }, 400);
    }

    // Read file buffers
    const fileBuffers = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      fileBuffers.push({ name: file.name, buffer: new Uint8Array(buffer) });
    }

    // Hash each file
    const fileHashes = fileBuffers.map(({ name, buffer }) => ({
      name,
      hash: wasm.hashBytes(buffer),
      buffer,
    }));

    // Verify receipt: commitment signature + file hashes in commitment
    const { commitment } = receipt;
    if (!commitment || typeof commitment !== 'object') {
      return c.json({ error: 'Invalid receipt: missing commitment' }, 400);
    }

    const commitmentJson = JSON.stringify(commitment);
    if (!wasm.verifyCommitment(commitmentJson)) {
      return c.json({ error: 'Commitment signature verification failed' }, 422);
    }

    const commitmentHash = commitment.commitment_hash;
    if (!commitmentHash) {
      return c.json({ error: 'Invalid commitment: missing commitment_hash' }, 400);
    }

    const committedItems = commitment.items;
    if (!Array.isArray(committedItems) || committedItems.length === 0) {
      return c.json({ error: 'Invalid commitment: missing or empty items' }, 400);
    }

    const committedHashSet = new Set(committedItems.map(item =>
      typeof item === 'string' ? item : item.hash
    ));

    for (const { name, hash } of fileHashes) {
      if (!committedHashSet.has(hash)) {
        return c.json({ error: `File "${name}" hash ${hash} not found in commitment items` }, 422);
      }
    }

    // Store files in memory
    const baseUrl = new URL(c.req.url).origin;
    const uploadedFiles = [];

    for (const { name, hash, buffer } of fileHashes) {
      const key = `${commitmentHash}/${name}`;
      store.set(key, Buffer.from(buffer));
      uploadedFiles.push({
        name,
        url: `${baseUrl}/publish/v1/data/${commitmentHash}/${name}`,
        hash,
      });
    }

    return c.json({
      commitment_hash: commitmentHash,
      files: uploadedFiles,
      uploaded_at: new Date().toISOString(),
    }, 201);
  });

  // Serve stored files
  app.get('/v1/data/:hash/:filename', (c) => {
    const { hash, filename } = c.req.param();
    const key = `${hash}/${filename}`;
    const data = store.get(key);

    if (!data) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    const types = {
      json: 'application/json',
      txt: 'text/plain',
      csv: 'text/csv',
      html: 'text/html',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    };
    const contentType = types[ext] || 'application/octet-stream';

    return new Response(data, {
      headers: { 'Content-Type': contentType },
    });
  });

  return app;
}
