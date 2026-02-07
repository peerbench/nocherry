/**
 * Bearer token authentication middleware for GCS service.
 * Validates token against SQLite auth_tokens table, sets user context.
 */

export function requireAuth() {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = header.slice(7);
    if (!token) {
      return c.json({ error: 'Missing bearer token' }, 401);
    }

    const db = c.get('db');
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
    await next();
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
