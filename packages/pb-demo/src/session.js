/**
 * In-memory session store, keyed by cookie.
 */

import { randomBytes } from 'node:crypto';

const sessions = new Map();
const COOKIE_NAME = 'pb-demo-session';

export function sessionMiddleware() {
  return async (c, next) => {
    let sid = getCookie(c, COOKIE_NAME);
    if (!sid || !sessions.has(sid)) {
      sid = randomBytes(16).toString('hex');
      sessions.set(sid, {});
    }
    c.set('session', sessions.get(sid));
    c.set('sessionId', sid);
    await next();
    // Set cookie on every response
    c.header('Set-Cookie', `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  };
}

function getCookie(c, name) {
  const header = c.req.header('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

export function resetSession(c) {
  const sid = c.get('sessionId');
  sessions.set(sid, {});
  return sessions.get(sid);
}
