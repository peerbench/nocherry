/**
 * DID identity resolver — resolves DID documents and checks whether a signing key
 * is listed as a verification method.
 *
 * Supported DID methods: did:web, did:plc, did:webvh
 */

const RESOLVE_TIMEOUT_MS = 5000;

function isLocalhost(host) {
  const hostname = host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Resolve a DID identity and check if the signing key is listed in its DID document.
 *
 * @param {string} identity - The DID to resolve (e.g. "did:web:example.com")
 * @param {string} signingKey - The did:key to look for (e.g. "did:key:z6Mk...")
 * @returns {Promise<"matched"|"mismatch"|"error"|"unsupported">}
 */
export async function resolveIdentity(identity, signingKey) {
  const method = parseMethod(identity);
  if (!method) return 'unsupported';

  try {
    let doc;
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

/**
 * Parse the DID method from a DID string.
 * @returns {string|null} The method name or null if unsupported/invalid.
 */
function parseMethod(did) {
  if (typeof did !== 'string') return null;
  const match = did.match(/^did:(web|plc|webvh):/);
  return match ? match[1] : null;
}

/**
 * did:web resolution — transforms DID to HTTPS URL and fetches the DID document.
 * Per the DID Web spec, localhost/127.0.0.1 may use HTTP.
 *
 * did:web:example.com → https://example.com/.well-known/did.json
 * did:web:example.com:path:to → https://example.com/path/to/did.json
 */
async function resolveDidWeb(did) {
  const parts = did.replace('did:web:', '').split(':');
  const host = decodeURIComponent(parts[0]);
  const pathParts = parts.slice(1).map(decodeURIComponent);

  const scheme = isLocalhost(host) ? 'http' : 'https';
  let url;
  if (pathParts.length === 0) {
    url = `${scheme}://${host}/.well-known/did.json`;
  } else {
    url = `${scheme}://${host}/${pathParts.join('/')}/did.json`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:web fetch failed: ${res.status}`);
  return res.json();
}

/**
 * did:plc resolution — queries the PLC directory.
 *
 * did:plc:abc123 → GET https://plc.directory/did:plc:abc123
 */
async function resolveDidPlc(did) {
  const url = `https://plc.directory/${did}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:plc fetch failed: ${res.status}`);
  return res.json();
}

/**
 * did:webvh resolution — same URL transform as did:web.
 */
async function resolveDidWebVh(did) {
  const parts = did.replace('did:webvh:', '').split(':');
  const host = decodeURIComponent(parts[0]);
  const pathParts = parts.slice(1).map(decodeURIComponent);

  const scheme = isLocalhost(host) ? 'http' : 'https';
  let url;
  if (pathParts.length === 0) {
    url = `${scheme}://${host}/.well-known/did.json`;
  } else {
    url = `${scheme}://${host}/${pathParts.join('/')}/did.json`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`did:webvh fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Extract verification method keys from a DID document and convert to did:key format.
 *
 * Supports publicKeyMultibase (Ed25519, multicodec prefix 0xed01) only for now.
 *
 * @param {object} doc - The DID document
 * @returns {string[]} Array of did:key strings
 */
function extractKeysFromDocument(doc) {
  if (!doc || !Array.isArray(doc.verificationMethod)) return [];

  const keys = [];
  for (const vm of doc.verificationMethod) {
    if (vm.publicKeyMultibase) {
      // publicKeyMultibase is a multibase-encoded key.
      // For Ed25519 keys this is typically z-base58btc with 0xed01 prefix.
      // The full string IS the did:key identifier (with the z prefix).
      keys.push(`did:key:${vm.publicKeyMultibase}`);
    }
  }
  return keys;
}
