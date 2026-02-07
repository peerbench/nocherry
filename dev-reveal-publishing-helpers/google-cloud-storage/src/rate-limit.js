/**
 * In-memory rate limiter with TTL.
 * Entries auto-expire after the window period. No external DB needed for dev infra.
 */

const WINDOW_MS = 3600_000; // 1 hour

/** @type {Map<string, { count: number, resetAt: number }>} */
const limits = new Map();

/**
 * Check and increment rate limit for a signing key.
 * @param {string} signingKey
 * @param {number} maxPerHour
 * @returns {boolean} true if allowed, false if rate limited
 */
export function checkRateLimit(signingKey, maxPerHour) {
  const now = Date.now();

  // Clean expired entries periodically
  if (Math.random() < 0.1) {
    for (const [key, entry] of limits) {
      if (now > entry.resetAt) limits.delete(key);
    }
  }

  const entry = limits.get(signingKey);

  if (!entry || now > entry.resetAt) {
    limits.set(signingKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= maxPerHour) {
    return false;
  }

  entry.count++;
  return true;
}
