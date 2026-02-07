/**
 * Worker configuration — reads from Worker env bindings (c.env).
 */

export function getConfig(env) {
  return {
    maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '50', 10),
    rateLimitPerHour: parseInt(env.RATE_LIMIT_PER_HOUR || '20', 10),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY || '',
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleOAuthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || '',
  };
}
