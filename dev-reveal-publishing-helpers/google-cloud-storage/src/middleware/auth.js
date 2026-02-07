/**
 * Authentication middleware for GCS service.
 * Supports two auth methods:
 *   1. Bearer token:  Authorization: Bearer <token>
 *   2. Ed25519 signature: Authorization: Ed25519 <public_key_hex> <unix_ts> <signature_hex>
 *      Signature is over the message "upload:<unix_ts>" — proves ownership of a linked signing key.
 */

import { verifySignature, encodeDIDKey } from '../wasm/pb_wasm.js';

export function requireAuth() {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header) {
      return c.json({ error: 'Missing Authorization header. Use Bearer <token> or Ed25519 <key> <ts> <sig>' }, 401);
    }

    const db = c.get('db');

    // ── Bearer token auth ──────────────────────────────────────────
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7);
      if (!token) {
        return c.json({ error: 'Missing bearer token' }, 401);
      }

      const row = db.prepare(
        `SELECT t.token, t.user_id, t.expires_at, u.id, u.email, u.name
         FROM auth_tokens t JOIN users u ON t.user_id = u.id
         WHERE t.token = ?`
      ).get(token);

      if (!row) {
        return c.json({ error: 'Invalid token' }, 401);
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return c.json({ error: 'Token expired' }, 401);
      }

      // Update last_used_at
      db.prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token = ?')
        .run(new Date().toISOString(), token);

      c.set('user', { id: row.user_id, email: row.email, name: row.name });
      return next();
    }

    // ── Ed25519 signature auth ─────────────────────────────────────
    if (header.startsWith('Ed25519 ')) {
      const parts = header.slice(8).split(' ');
      if (parts.length !== 3) {
        return c.json({ error: 'Ed25519 auth format: Ed25519 <public_key_hex> <unix_ts> <signature_hex>' }, 401);
      }

      const [publicKeyHex, timestamp, signatureHex] = parts;

      // Check timestamp freshness (5 minute window)
      const ts = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (isNaN(ts) || Math.abs(now - ts) > 300) {
        return c.json({ error: 'Signature timestamp expired or invalid (5 min window)' }, 401);
      }

      // Verify the signing key is linked to a user
      const row = db.prepare(
        `SELECT k.user_id, u.email, u.name
         FROM user_keys k JOIN users u ON k.user_id = u.id
         WHERE k.signing_key = ?`
      ).get(publicKeyHex);

      // Verify Ed25519 signature over "upload:<timestamp>"
      const message = `upload:${timestamp}`;
      const messageBytes = new TextEncoder().encode(message);
      let didKey;
      try {
        didKey = encodeDIDKey(publicKeyHex);
      } catch {
        return c.json({ error: 'Invalid public key' }, 401);
      }

      let valid;
      try {
        valid = verifySignature(didKey, messageBytes, signatureHex);
      } catch {
        valid = false;
      }

      if (!valid) {
        return c.json({ error: 'Signature verification failed' }, 401);
      }

      if (row) {
        c.set('user', { id: row.user_id, email: row.email, name: row.name });
      } else {
        // Unlinked key — allow as anonymous/debug upload
        c.set('user', { id: null, isAnon: true, signingKey: publicKeyHex });
        c.set('isAnon', true);
      }
      return next();
    }

    return c.json({ error: 'Unsupported auth method. Use Bearer or Ed25519.' }, 401);
  };
}

/**
 * Link a signing key to the authenticated user if not already linked.
 */
export function linkSigningKey(db, userId, signingKey) {
  db.prepare(
    'INSERT OR IGNORE INTO user_keys (user_id, signing_key) VALUES (?, ?)'
  ).run(userId, signingKey);
}
