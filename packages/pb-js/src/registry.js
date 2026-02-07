/**
 * Server registry — loads servers.json and provides lookup helpers.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let _cache = null;

export function loadRegistry() {
  if (_cache) return _cache;
  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = join(here, '..', '..', '..', 'servers.json');
  _cache = JSON.parse(readFileSync(filePath, 'utf-8'));
  return _cache;
}

export function getServers(env) {
  const { servers } = loadRegistry();
  if (!env) return servers;
  return servers.filter(s => s.environment === env);
}

export function resolveServer(nameOrUrl) {
  const servers = getServers();

  if (!nameOrUrl) {
    return servers.find(s => s.environment === 'dev') || servers[0];
  }

  // Try matching by name first
  const byName = servers.find(s => s.name === nameOrUrl);
  if (byName) return byName;

  // Try matching by URL
  const byUrl = servers.find(s => s.url === nameOrUrl);
  if (byUrl) return byUrl;

  // Ad-hoc server from a raw URL
  return { name: null, url: nameOrUrl, server_key: null, operator: null, environment: null };
}

export function getRevealPublishers(env) {
  const { reveal_publishers } = loadRegistry();
  if (!reveal_publishers) return [];
  if (!env) return reveal_publishers;
  return reveal_publishers.filter(p => p.environment === env);
}

export function resolveRevealPublisher(nameOrUrl) {
  const publishers = getRevealPublishers();

  if (!nameOrUrl) {
    return publishers.find(p => p.environment === 'dev') || publishers[0];
  }

  const byName = publishers.find(p => p.name === nameOrUrl);
  if (byName) return byName;

  const byUrl = publishers.find(p => p.url === nameOrUrl);
  if (byUrl) return byUrl;

  return { name: null, url: nameOrUrl, operator: null, environment: null };
}
