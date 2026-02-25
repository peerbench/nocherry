/**
 * Cloud Run configuration -- reads from process.env.
 * Cloud Run auto-sets PORT (8080) and GOOGLE_CLOUD_PROJECT.
 */

import type { Config } from '../../../src/core/types.ts'
import { BASE_CONFIG } from '../../../src/core/config.ts';

interface GoogleCloudConfig extends Config {
  port: number;
  projectId: string;
  firestoreDatabase: string;
}

export function getConfig(): GoogleCloudConfig {
  return {
    ...BASE_CONFIG,
    port: parseInt(process.env.PORT || '8080', 10),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || '',
    firestoreDatabase: process.env.FIRESTORE_DATABASE || '',
    retention: process.env.RETENTION || '30d',
    operator: process.env.OPERATOR || 'Commit-Reveal',
    verifyRevealData: process.env.VERIFY_REVEAL_DATA !== 'false',
  };
}

export type { GoogleCloudConfig };
