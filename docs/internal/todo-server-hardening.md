# TODO: Server Hardening — Platform-Specific Edge Cases

## 1. GCP Firestore: Very long commitment hash causes 500

**Problem:** Sending a GET request to `/v1/commitments/<10000-char-string>` causes Firestore to throw an internal error (500) because document IDs have a max length of 1500 bytes.

**Impact:** Low — no real commitment hash would be this long (they are always 64 hex chars). The server doesn't crash permanently; only the single request fails.

**Fix:** Add commitment hash format validation middleware in all server `app.js` files. Reject any `:hash` path parameter that doesn't match `/^[0-9a-f]{64}$/` with a 400 response before it reaches the database layer. This protects all routes that take a commitment hash.

## 2. Supabase Gateway: SQL injection paths return 403

**Problem:** Supabase's API gateway intercepts requests containing SQL-like patterns (e.g., `'; DROP TABLE`) before they reach our Edge Function code. It returns 403 Forbidden instead of the 404 our code would return.

**Impact:** None — the request is still correctly rejected. The Supabase gateway provides an extra layer of defense. Our tests now accept any 4xx status code for these cases.

**Fix (optional):** Same hash validation middleware as above would reject these requests at the application level before the gateway even needs to intervene. But since the gateway already blocks them, this is defense-in-depth rather than a bug fix.

## Recommended Implementation

Add a shared validation middleware to all 4 server implementations:

```javascript
// Validate :hash path params are 64-char lowercase hex
const HASH_RE = /^[0-9a-f]{64}$/;

app.use('/v1/commitments/:hash/*', (c, next) => {
  if (!HASH_RE.test(c.req.param('hash'))) {
    return c.json({ error: 'Invalid commitment hash format' }, 400);
  }
  return next();
});

app.use('/v1/commitments/:hash', (c, next) => {
  if (!HASH_RE.test(c.req.param('hash'))) {
    return c.json({ error: 'Invalid commitment hash format' }, 400);
  }
  return next();
});
```

Files to update:
- `packages/pb-node/src/app.js`
- `deploy/cloudflare/src/app.js`
- `deploy/google-cloud/src/app.js`
- `deploy/supabase/supabase/functions/commit-reveal/app.ts`
