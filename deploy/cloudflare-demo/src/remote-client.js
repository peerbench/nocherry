/**
 * Remote client — mimics Hono's app.request(url, init) interface
 * using real fetch() against a remote pb-node server.
 */

export function createRemoteClient(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');

  return {
    async request(localUrl, init = {}) {
      const path = new URL(localUrl).pathname;
      const remoteUrl = `${base}${path}`;
      return fetch(remoteUrl, {
        ...init,
        signal: AbortSignal.timeout(15000),
      });
    },
  };
}
