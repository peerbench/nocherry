/**
 * Cloud Run configuration — reads from process.env.
 * Cloud Run auto-sets PORT (8080) and GOOGLE_CLOUD_PROJECT.
 */

export function getConfig() {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || '',
    firestoreDatabase: process.env.FIRESTORE_DATABASE || '',
    retention: process.env.RETENTION || '30d',
    operator: process.env.OPERATOR || 'PeerBench',
    beaconTypes: ['drand'],
    specVersion: '0.2.0',
    version: '0.2.0',
    batchThreshold: 20,
    activityWindows: ['1h', '30d'],
    verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
  };
}
