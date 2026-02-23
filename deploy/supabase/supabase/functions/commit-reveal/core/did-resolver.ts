/**
 * DID identity resolver — resolves DID documents and checks whether a signing key
 * is listed as a verification method.
 *
 * Supported DID methods: did:web, did:plc, did:webvh
 */

const RESOLVE_TIMEOUT_MS = 5000;

function isLocalhost(host: string): boolean {
  const hostname = host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function resolveIdentity(identity: string, signingKey: string): Promise<'matched' | 'mismatch' | 'error' | 'unsupported'> {
  const method = parseMethod(identity);
  if (!method) return 'unsupported';

  try {
    let doc: any;
    switch (method) {
      case 'web':
        doc = await resolveDidWeb(identity);
        break;
      case 'plc':
        doc = await resolveDidPlc(identity);
        break;
      case 'webvh':
        doc = await resolveDidWebVh(identity);
        break;
      default:
        return 'unsupported';
    }

    const keys = extractKeysFromDocument(doc);
    return keys.includes(signingKey) ? 'matched' : 'mismatch';
  } catch {
    return 'error';
  }
}

function parseMethod(did: string): string | null {
  if (typeof did !== 'string') return null;
  const match = did.match(/^did:(web|plc|webvh):/);
  return match ? match[1] : null;
}

async function resolveDidWeb(did: string): Promise<unknown> {
  const parts = did.replace('did:web:', '').split(':');
  const host = decodeURIComponent(parts[0]);
  const pathParts = parts.slice(1).map(decodeURIComponent);

  const scheme = isLocalhost(host) ? 'http' : 'https';
  let url: string;
  if (pathParts.length === 0) {
    url = `${scheme}://${host}/.well-known/did.json`;
  } else {
    url = `${scheme}://${host}/${pathParts.join('/')}/did.json`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:web fetch failed: ${res.status}`);
  return res.json();
}

async function resolveDidPlc(did: string): Promise<unknown> {
  const url = `https://plc.directory/${did}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:plc fetch failed: ${res.status}`);
  return res.json();
}

async function resolveDidWebVh(did: string): Promise<unknown> {
  const parts = did.replace('did:webvh:', '').split(':');
  const host = decodeURIComponent(parts[0]);
  const pathParts = parts.slice(1).map(decodeURIComponent);

  const scheme = isLocalhost(host) ? 'http' : 'https';
  let url: string;
  if (pathParts.length === 0) {
    url = `${scheme}://${host}/.well-known/did.json`;
  } else {
    url = `${scheme}://${host}/${pathParts.join('/')}/did.json`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:webvh fetch failed: ${res.status}`);
  return res.json();
}

function extractKeysFromDocument(doc: any): string[] {
  if (!doc || !Array.isArray(doc.verificationMethod)) return [];

  const keys: string[] = [];
  for (const vm of doc.verificationMethod) {
    if (vm.publicKeyMultibase) {
      keys.push(`did:key:${vm.publicKeyMultibase}`);
    }
  }
  return keys;
}
