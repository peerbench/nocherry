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
  };
}
