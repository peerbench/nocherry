/**
 * Outbound fetch for URLs supplied by clients (reveal `file_urls`).
 *
 * Spec 14.3 allows public HTTPS only. Checks applied to the initial URL and to
 * every redirect hop: https scheme, default port, no credentials, no IP-literal
 * or internal hostnames, and (where a resolver exists) no hostname that resolves
 * to a non-public address. The body is read as a stream with a byte cap so a
 * large or endless response cannot exhaust memory.
 *
 * Residual risk: a hostname can resolve differently between the check and the
 * connection (DNS rebinding). Deployments that hold cloud credentials should
 * also block metadata and private ranges at the network layer.
 */

export const DEFAULT_MAX_FETCH_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {}
export class ResponseTooLargeError extends Error {}

function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inRange(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
];

/** True for loopback, private, link-local, CGNAT, multicast, and reserved addresses. */
export function isNonPublicAddress(address: string): boolean {
  const addr = address.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = ipv4ToInt(addr);
  if (v4 !== null) return BLOCKED_V4.some(([base, bits]) => inRange(v4, base, bits));
  if (!addr.includes(':')) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isNonPublicAddress(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    return isNonPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (addr === '::' || addr === '::1') return true;
  const first = parseInt(addr.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (addr.startsWith('64:ff9b:')) return true; // NAT64 can reach IPv4 ranges
  return false;
}

/** Throws UnsafeUrlError unless `raw` is a public-looking https URL. */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('not a valid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('only https URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('URL must not contain credentials');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('only the default https port is allowed');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.replace(/^\[|\]$/g, '');
  if (ipv4ToInt(bare) !== null || bare.includes(':')) {
    throw new UnsafeUrlError('IP-literal hosts are not allowed');
  }
  if (!host.includes('.') || host === 'localhost' ||
      /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) {
    throw new UnsafeUrlError('internal hostnames are not allowed');
  }
  return url;
}

type Lookup = (host: string) => Promise<string[]>;
let cachedLookup: Lookup | null | undefined;

/** Resolver for runtimes that have one (Node, Deno); null on edge runtimes. */
async function getLookup(): Promise<Lookup | null> {
  if (cachedLookup !== undefined) return cachedLookup;
  try {
    // Non-literal specifier so edge bundlers do not try to resolve the module.
    const specifier = 'node:dns/promises';
    const dns = await import(specifier);
    cachedLookup = async (host) => (await dns.lookup(host, { all: true })).map((a: { address: string }) => a.address);
  } catch {
    cachedLookup = null;
  }
  return cachedLookup;
}

async function assertResolvesPublic(url: URL, lookup: Lookup | null): Promise<void> {
  if (!lookup) return;
  let addresses: string[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    throw new UnsafeUrlError('hostname does not resolve');
  }
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    throw new UnsafeUrlError('hostname resolves to a non-public address');
  }
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Skip URL and address checks (local development and tests only). */
  allowUnsafeUrls?: boolean;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  lookup?: Lookup | null;
}

/** Fetch a client-supplied URL and return its body, enforcing the rules above. */
export async function safeFetchBytes(rawUrl: string, opts: SafeFetchOptions = {}): Promise<{ status: number; ok: boolean; data: Uint8Array }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FETCH_BYTES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.allowUnsafeUrls ? null : opts.lookup !== undefined ? opts.lookup : await getLookup();
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15000);

  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    let url: URL;
    if (opts.allowUnsafeUrls) {
      url = new URL(current);
    } else {
      url = assertPublicHttpsUrl(current);
      await assertResolvesPublic(url, lookup);
    }
    const res = await fetchImpl(url, { signal, redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new UnsafeUrlError('redirect without location');
      if (hop >= MAX_REDIRECTS) throw new UnsafeUrlError('too many redirects');
      current = new URL(location, url).toString();
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      return { status: res.status, ok: false, data: new Uint8Array(0) };
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new ResponseTooLargeError(`response exceeds ${maxBytes} bytes`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ResponseTooLargeError(`response exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { status: res.status, ok: true, data };
  }
}
