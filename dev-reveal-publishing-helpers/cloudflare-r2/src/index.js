/**
 * Cloudflare Worker entry point for reveal publishing helper.
 */

import { createApp } from './app.js';

const app = createApp();

export default {
  fetch: app.fetch,

  async scheduled(event, env, ctx) {
    const db = env.DB;
    const bucket = env.DATA_BUCKET;

    // Find expired anonymous uploads
    const expired = await db.prepare(
      "SELECT commitment_hash FROM upload_logs WHERE is_anon = 1 AND expires_at < datetime('now')"
    ).all();

    if (!expired.results.length) return;

    for (const row of expired.results) {
      // Delete R2 objects for this commitment
      const listed = await bucket.list({ prefix: `${row.commitment_hash}/` });
      for (const obj of listed.objects) {
        await bucket.delete(obj.key);
      }
      // Delete DB row
      await db.prepare(
        'DELETE FROM upload_logs WHERE commitment_hash = ? AND is_anon = 1'
      ).bind(row.commitment_hash).run();
    }
  },
};
