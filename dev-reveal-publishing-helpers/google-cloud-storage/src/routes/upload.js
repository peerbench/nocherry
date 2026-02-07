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

  const db = c.get('db');
  const user = c.get('user');
  const isAnon = c.get('isAnon');

  if (isAnon) {
    // FIFO cap: delete oldest anon uploads if at capacity
    const countResult = db.prepare(
      'SELECT COUNT(*) as cnt FROM upload_logs WHERE signing_key = ? AND is_anon = 1'
    ).get(signingKey);

    if (countResult.cnt >= 1000) {
      const excess = countResult.cnt - 1000 + 1;
      const oldRows = db.prepare(
        'SELECT commitment_hash FROM upload_logs WHERE signing_key = ? AND is_anon = 1 ORDER BY created_at ASC LIMIT ?'
      ).all(signingKey, excess);

      for (const row of oldRows) {
        // Delete GCS objects for this commitment
        const [files] = await bucket.getFiles({ prefix: `${row.commitment_hash}/` });
        for (const file of files) {
          await file.delete().catch(() => {});
        }
        db.prepare(
          'DELETE FROM upload_logs WHERE commitment_hash = ? AND signing_key = ? AND is_anon = 1'
        ).run(row.commitment_hash, signingKey);
      }
    }

    // Anon rate limit (more generous for demo)
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const rateResult = db.prepare(
      'SELECT COUNT(*) as cnt FROM upload_logs WHERE signing_key = ? AND is_anon = 1 AND created_at > ?'
    ).get(signingKey, oneHourAgo);

    if (rateResult.cnt >= (config.anonRateLimitPerHour || 50)) {
      return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
    }
  } else {
    // Link signing key to authenticated user
    linkSigningKey(db, user.id, signingKey);

    // Rate limit check via SQLite (by user_id)
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const rateResult = db.prepare(
      'SELECT COUNT(*) as cnt FROM upload_logs WHERE signing_key IN (SELECT signing_key FROM user_keys WHERE user_id = ?) AND created_at > ?'
    ).get(user.id, oneHourAgo);

    if (rateResult.cnt >= config.rateLimitPerHour) {
      return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
    }
  }

  // Store files to GCS
  const baseUrl = new URL(c.req.url).origin;
  const uploadedFiles = [];

  for (const { name, hash, buffer } of fileHashes) {
    const key = `${commitmentHash}/${name}`;
    try {
      await bucket.file(key).save(buffer, {
        contentType: 'application/octet-stream',
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
  if (isAnon) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    db.prepare(
      'INSERT INTO upload_logs (commitment_hash, signing_key, file_count, total_bytes, is_anon, expires_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(commitmentHash, signingKey, files.length, totalBytes, expiresAt);
  } else {
    db.prepare(
      'INSERT INTO upload_logs (commitment_hash, signing_key, file_count, total_bytes) VALUES (?, ?, ?, ?)'
    ).run(commitmentHash, signingKey, files.length, totalBytes);
  }

  return c.json({
    commitment_hash: commitmentHash,
    files: uploadedFiles,
    uploaded_at: new Date().toISOString(),
  }, 201);
});

export default app;
