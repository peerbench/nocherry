/**
 * POST /v1/upload — Accept revealed files with receipt, verify, store to R2.
 */

import { Hono } from 'hono';
import { verifyUpload } from '../verify.js';
import { requireAuth, linkSigningKey } from '../middleware/auth.js';
import * as wasm from '../wasm/pb_wasm.js';

const app = new Hono();

app.post('/upload', requireAuth(), async (c) => {
  const config = c.get('config');
  const db = c.env.DB;
  const bucket = c.env.DATA_BUCKET;

  // Parse multipart form data
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

  // Collect files — handle single file or array
  let rawFiles = body['files[]'];
  if (!rawFiles) {
    return c.json({ error: 'Missing files[] field' }, 400);
  }
  const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

  if (files.length === 0) {
    return c.json({ error: 'No files provided' }, 400);
  }

  // Size check
  let totalBytes = 0;
  const fileBuffers = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    totalBytes += buffer.byteLength;
    fileBuffers.push({ name: file.name, buffer: new Uint8Array(buffer) });
  }

  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (totalBytes > maxBytes) {
    return c.json({ error: `Total upload size ${totalBytes} exceeds limit of ${maxBytes} bytes` }, 413);
  }

  // Hash each file
  const fileHashes = fileBuffers.map(({ name, buffer }) => ({
    name,
    hash: wasm.hashBytes(buffer),
    buffer,
  }));

  // Verify receipt and file hashes
  let verified;
  try {
    verified = verifyUpload(receipt, fileHashes);
  } catch (err) {
    return c.json({ error: err.message }, 422);
  }

  const { commitmentHash, signingKey } = verified;

  // Link signing key to authenticated user
  const user = c.get('user');
  await linkSigningKey(db, user.id, signingKey);

  // Rate limit check via D1 (by user_id)
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const rateResult = await db.prepare(
    'SELECT COUNT(*) as cnt FROM upload_logs WHERE signing_key IN (SELECT signing_key FROM user_keys WHERE user_id = ?) AND created_at > ?'
  ).bind(user.id, oneHourAgo).first();

  if (rateResult.cnt >= config.rateLimitPerHour) {
    return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
  }

  // Store files to R2
  const baseUrl = new URL(c.req.url).origin;
  const uploadedFiles = [];

  for (const { name, hash, buffer } of fileHashes) {
    const key = `${commitmentHash}/${name}`;
    await bucket.put(key, buffer, {
      httpMetadata: { contentType: guessContentType(name) },
    });
    uploadedFiles.push({
      name,
      url: `${baseUrl}/v1/data/${commitmentHash}/${name}`,
      hash,
    });
  }

  // Log upload to D1
  await db.prepare(
    'INSERT INTO upload_logs (commitment_hash, signing_key, file_count, total_bytes) VALUES (?, ?, ?, ?)'
  ).bind(commitmentHash, signingKey, files.length, totalBytes).run();

  return c.json({
    commitment_hash: commitmentHash,
    files: uploadedFiles,
    uploaded_at: new Date().toISOString(),
  }, 201);
});

function guessContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types = {
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    xml: 'application/xml',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    gz: 'application/gzip',
  };
  return types[ext] || 'application/octet-stream';
}

export default app;
