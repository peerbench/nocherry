/**
 * Auth routes: sign-up page with reCAPTCHA v3 + Google OAuth.
 *
 * GET  /auth/signup   — Render sign-up page (reCAPTCHA v3 + "Sign in with Google" button)
 * GET  /auth/begin    — Verify reCAPTCHA token, redirect to Google OAuth
 * GET  /auth/callback — Exchange OAuth code, upsert user, issue bearer token
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import crypto from 'node:crypto';

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
      <title>PeerBench Publisher — Sign Up</title>
      <script src="https://www.google.com/recaptcha/api.js?render=${config.recaptchaSiteKey}"></script>
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
      <h1>PeerBench Publisher</h1>
      <p>Sign in with your Google account to get a publish token.</p>

      <form id="authForm" action="/auth/begin" method="GET">
        <input type="hidden" name="signing_key" value="${signingKey}">
        <input type="hidden" name="recaptcha_token" id="recaptchaToken">
        <button type="submit" class="btn" id="submitBtn" disabled>Sign in with Google</button>
      </form>

      <div id="error"></div>

      <p class="note">
        This site is protected by reCAPTCHA and the Google
        <a href="https://policies.google.com/privacy">Privacy Policy</a> and
        <a href="https://policies.google.com/terms">Terms of Service</a> apply.
        <!-- TODO: GitHub OAuth coming soon -->
      </p>

      <script>
        grecaptcha.ready(function() {
          grecaptcha.execute('${config.recaptchaSiteKey}', { action: 'signup' }).then(function(token) {
            document.getElementById('recaptchaToken').value = token;
            document.getElementById('submitBtn').disabled = false;
          });
        });
      </script>
    </body>
    </html>
  `);
});

// ── GET /auth/begin ─────────────────────────────────────────────────
app.get('/begin', async (c) => {
  const config = c.get('config');
  const recaptchaToken = c.req.query('recaptcha_token');
  const signingKey = c.req.query('signing_key') || '';

  if (!recaptchaToken) {
    return c.json({ error: 'Captcha verification required' }, 400);
  }

  // Verify reCAPTCHA v3 token
  const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: config.recaptchaSecretKey,
      response: recaptchaToken,
    }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyData.success || (verifyData.score !== undefined && verifyData.score < 0.5)) {
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
  const db = c.get('db');

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
  const payloadB64 = tokenData.id_token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  const { email, name, sub: providerId } = payload;

  if (!email) {
    return c.json({ error: 'Google account has no email' }, 422);
  }

  // Upsert user
  let user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
  if (!user) {
    const result = db.prepare(
      'INSERT INTO users (email, name, provider, provider_id) VALUES (?, ?, ?, ?)'
    ).run(email, name || '', 'google', providerId);
    user = { id: result.lastInsertRowid, email, name };
  }

  // Link signing key if provided
  if (state.signing_key) {
    db.prepare(
      'INSERT OR IGNORE INTO user_keys (user_id, signing_key) VALUES (?, ?)'
    ).run(user.id, state.signing_key);
  }

  // Generate opaque bearer token (32 bytes = 64 hex chars)
  const bearerToken = crypto.randomBytes(32).toString('hex');

  db.prepare(
    'INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)'
  ).run(bearerToken, user.id);

  const origin = new URL(c.req.url).origin;

  // Success page
  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>PeerBench Publisher — Token Issued</title>
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
      <p>Add it to <code>~/.peerbench/publisher-tokens.json</code>:</p>
      <pre>{
  "${origin}": "${bearerToken}"
}</pre>

      <p>Or set it as an environment variable:</p>
      <pre>export PEERBENCH_PUBLISHER_TOKEN=${bearerToken}</pre>

      <p style="margin-top:24px; font-size:0.85rem; color:#666;">
        Keep this token secret. You can revoke it by signing in again.
      </p>
    </body>
    </html>
  `);
});

export default app;
