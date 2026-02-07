/**
 * Worker configuration — reads from Worker env bindings (c.env).
 */

export function getConfig(env) {
  return {
    maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '50', 10),
    rateLimitPerHour: parseInt(env.RATE_LIMIT_PER_HOUR || '20', 10),
  };
}
