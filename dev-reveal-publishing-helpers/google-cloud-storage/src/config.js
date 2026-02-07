/**
 * Cloud Run configuration — reads from process.env.
 */

export function getConfig() {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    gcsBucket: process.env.GCS_BUCKET || '',
    projectId: process.env.GOOGLE_CLOUD_PROJECT || '',
    maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '50', 10),
    rateLimitPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '20', 10),
    anonRateLimitPerHour: parseInt(process.env.ANON_RATE_LIMIT_PER_HOUR || '50', 10),
    dbPath: process.env.DB_PATH || './data/reveal.db',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY || '',
    googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
  };
}
