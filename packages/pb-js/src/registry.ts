/**
 * Server registry — loads servers.json and provides lookup helpers.
 */

// Bundler inlines the JSON, so the registry survives both file:-style
// dev installs and npm tarball consumption (no fs path resolution).
import serversJson from '../servers.json' with { type: 'json' };

let _cache: Registry | null = null;

/** Map primary_url → url for backward compatibility with all downstream code. */
function normalizeEntry(entry: ServerEntry): ServerEntry {
  if (entry.primary_url && !entry.url) {
    return { ...entry, url: entry.primary_url };
  }
  return entry;
}

export function loadRegistry(): Registry {
  if (_cache) return _cache;
  const raw = serversJson as { servers?: ServerEntry[]; reveal_publishers?: ServerEntry[] };
  _cache = {
    servers: (raw.servers || []).map(normalizeEntry),
    reveal_publishers: (raw.reveal_publishers || []).map(normalizeEntry),
  };
  return _cache!;
}

export function getServers(env?: string): ServerEntry[] {
  const { servers } = loadRegistry();
  if (!env) return servers;
  return servers.filter(s => s.environment === env);
}

export function resolveServer(nameOrUrl?: string): ServerEntry {
  const servers = getServers();

  if (!nameOrUrl) {
    return servers.find(s => s.environment === 'dev') || servers[0];
  }

  // Try matching by name first
  const byName = servers.find(s => s.name === nameOrUrl);
  if (byName) return byName;

  // Try matching by primary or alternative URL
  const byUrl = servers.find(s =>
    s.url === nameOrUrl || s.primary_url === nameOrUrl || s.alternative_url === nameOrUrl
  );
  if (byUrl) return byUrl;

  // Ad-hoc server from a raw URL
  return { name: null, url: nameOrUrl, server_key: null, operator: null, environment: null };
}

export function getRevealPublishers(env?: string): ServerEntry[] {
  const { reveal_publishers } = loadRegistry();
  if (!reveal_publishers) return [];
  if (!env) return reveal_publishers;
  return reveal_publishers.filter(p => p.environment === env);
}

export function resolveRevealPublisher(nameOrUrl?: string): ServerEntry {
  const publishers = getRevealPublishers();

  if (!nameOrUrl) {
    return publishers.find(p => p.environment === 'dev') || publishers[0];
  }

  const byName = publishers.find(p => p.name === nameOrUrl);
  if (byName) return byName;

  const byUrl = publishers.find(p =>
    p.url === nameOrUrl || p.primary_url === nameOrUrl || p.alternative_url === nameOrUrl
  );
  if (byUrl) return byUrl;

  return { name: null, url: nameOrUrl, operator: null, environment: null };
}

interface ServerEntry {
  name: string | null;
  url: string;
  primary_url?: string;
  alternative_url?: string;
  server_key?: string | null;
  operator: string | null;
  environment: string | null;
}

interface Registry {
  servers: ServerEntry[];
  reveal_publishers: ServerEntry[];
}
