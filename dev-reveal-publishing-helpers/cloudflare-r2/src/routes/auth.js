/**
 * Auth routes: sign-up page with Turnstile captcha + Google OAuth.
 *
 * GET  /auth/signup   — Render sign-up page (Turnstile + "Sign in with Google" button)
 * GET  /auth/begin    — Verify Turnstile token, redirect to Google OAuth
 * GET  /auth/callback — Exchange OAuth code, upsert user, issue bearer token
 */

import { Hono } from 'hono';
import { html } from 'hono/html';

const app = new Hono();

// ── GET /auth/signup ────────────────────────────────────────────────
app.get('/signup', async (c) => {
  const config = c.get('config');
  const signingKey = c.req.query('signing_key') || '';

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Reveal Publisher — Sign Up</title>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
        h1 { font-size: 1.5rem; }
        .btn { display: inline-block; padding: 12px 24px; background: #4285f4; color: #fff; text-decoration: none; border-radius: 6px; font-size: 1rem; border: none; cursor: pointer; }
        .btn:hover { background: #3367d6; }
        .note { margin-top: 24px; font-size: 0.85rem; color: #666; }
        #error { color: #d93025; margin-top: 12px; display: none; }
      </style>
    </head>
    <body>
      <h1>Reveal Publisher</h1>
      <p>Sign in with your Google account to get a publish token.</p>

      <form id="authForm" action="/auth/begin" method="GET">
        <input type="hidden" name="signing_key" value="${signingKey}">
        <div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}" data-callback="onTurnstile"></div>
        <input type="hidden" name="cf-turnstile-response" id="cfToken">
        <br>
        <button type="submit" class="btn" id="submitBtn" disabled>Sign in with Google</button>
      </form>

      <div id="error"></div>

      <p class="note">
        We use Cloudflare Turnstile to verify you're human. Your Google email is used
        to create your publisher account. <!-- TODO: GitHub OAuth coming soon -->
      </p>

      <script>
        function onTurnstile(token) {
          document.getElementById('cfToken').value = token;
          document.getElementById('submitBtn').disabled = false;
        }
      </script>
    </body>
    </html>
  `);
});

// ── GET /auth/begin ─────────────────────────────────────────────────
app.get('/begin', async (c) => {
  const config = c.get('config');
  const turnstileToken = c.req.query('cf-turnstile-response');
  const signingKey = c.req.query('signing_key') || '';

  if (!turnstileToken) {
    return c.json({ error: 'Captcha verification required' }, 400);
  }

  // Verify Turnstile token
  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: config.turnstileSecretKey,
      response: turnstileToken,
    }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyData.success) {
    return c.json({ error: 'Captcha verification failed' }, 403);
  }

  // Build Google OAuth redirect
  const state = JSON.stringify({ signing_key: signingKey });
  const params = new URLSearchParams({
    client_id: config.googleOAuthClientId,
    redirect_uri: config.googleOAuthRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    state,
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── GET /auth/callback ──────────────────────────────────────────────
app.get('/callback', async (c) => {
  const config = c.get('config');
  const db = c.env.DB;

  const code = c.req.query('code');
  const stateRaw = c.req.query('state') || '{}';

  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  let state;
  try {
    state = JSON.parse(stateRaw);
  } catch {
    state = {};
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleOAuthClientId,
      client_secret: config.googleOAuthClientSecret,
      redirect_uri: config.googleOAuthRedirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.id_token) {
    return c.json({ error: 'OAuth token exchange failed' }, 502);
  }

  // Decode ID token (JWT payload — second segment, base64url)
  const payload = JSON.parse(atob(tokenData.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const { email, name, sub: providerId } = payload;

  if (!email) {
    return c.json({ error: 'Google account has no email' }, 422);
  }

  // Upsert user
  let user = await db.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    const result = await db.prepare(
      'INSERT INTO users (email, name, provider, provider_id) VALUES (?, ?, ?, ?)'
    ).bind(email, name || '', 'google', providerId).run();
    user = { id: result.meta.last_row_id, email, name };
  }

  // Link signing key if provided
  if (state.signing_key) {
    await db.prepare(
      'INSERT OR IGNORE INTO user_keys (user_id, signing_key) VALUES (?, ?)'
    ).bind(user.id, state.signing_key).run();
  }

  // Generate opaque bearer token (32 bytes = 64 hex chars)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const bearerToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.prepare(
    'INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)'
  ).bind(bearerToken, user.id).run();

  // Success page
  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Reveal Publisher — Token Issued</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 560px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
        h1 { font-size: 1.5rem; }
        .token-box { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 16px; font-family: monospace; word-break: break-all; font-size: 0.9rem; }
        .copy-btn { margin-top: 8px; padding: 6px 14px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
        .copy-btn:hover { background: #3367d6; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.85rem; }
        pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 0.85rem; }
      </style>
    </head>
    <body>
      <h1>Token Issued</h1>
      <p>Welcome, <strong>${name || email}</strong>. Your bearer token:</p>

      <div class="token-box" id="tokenValue">${bearerToken}</div>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('tokenValue').textContent)">Copy to clipboard</button>

      <h3>Save your token</h3>
      <p>Add it to <code>~/.nocherry/publisher-tokens.json</code>:</p>
      <pre>{
  "${new URL(c.req.url).origin}": "${bearerToken}"
}</pre>

      <p>Or set it as an environment variable:</p>
      <pre>export PUBLISHER_TOKEN=${bearerToken}</pre>

      <p style="margin-top:24px; font-size:0.85rem; color:#666;">
        Keep this token secret. You can revoke it by signing in again.
      </p>
    </body>
    </html>
  `);
});

export default app;
