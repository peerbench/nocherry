/**
 * POST /v1/upload — Accept revealed files with receipt, verify, store to GCS.
 */

import { Hono } from 'hono';
import { verifyUpload } from '../verify.js';
import { requireAuth, linkSigningKey } from '../middleware/auth.js';
import * as wasm from '../wasm/pb_wasm.js';

const app = new Hono();

app.post('/upload', requireAuth(), async (c) => {
  const config = c.get('config');
  const bucket = c.get('bucket');

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
    fileBuffers.push({ name: file.name, buffer: Buffer.from(buffer) });
  }

  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (totalBytes > maxBytes) {
    return c.json({ error: `Total upload size ${totalBytes} exceeds limit of ${maxBytes} bytes` }, 413);
  }

  // Hash each file
  const fileHashes = fileBuffers.map(({ name, buffer }) => ({
    name,
    hash: wasm.hashBytes(new Uint8Array(buffer)),
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
  const db = c.get('db');
  const user = c.get('user');
  linkSigningKey(db, user.id, signingKey);

  // Rate limit check via SQLite (by user_id)
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const rateResult = db.prepare(
    'SELECT COUNT(*) as cnt FROM upload_logs WHERE signing_key IN (SELECT signing_key FROM user_keys WHERE user_id = ?) AND created_at > ?'
  ).get(user.id, oneHourAgo);

  if (rateResult.cnt >= config.rateLimitPerHour) {
    return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
  }

  // Store files to GCS
  const baseUrl = new URL(c.req.url).origin;
  const uploadedFiles = [];

  for (const { name, hash, buffer } of fileHashes) {
    const key = `${commitmentHash}/${name}`;
    try {
      await bucket.file(key).save(buffer, {
        contentType: guessContentType(name),
      });
    } catch (err) {
      if (err.code === 403 || err.message?.includes('billing')) {
        return c.json({ error: 'Storage temporarily unavailable (billing issue). Try again later.' }, 503);
      }
      throw err;
    }
    uploadedFiles.push({
      name,
      url: `${baseUrl}/v1/data/${commitmentHash}/${name}`,
      hash,
    });
  }

  // Log upload to SQLite
  db.prepare(
    'INSERT INTO upload_logs (commitment_hash, signing_key, file_count, total_bytes) VALUES (?, ?, ?, ?)'
  ).run(commitmentHash, signingKey, files.length, totalBytes);

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
