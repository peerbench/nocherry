/**
 * Relying-party name check (spec v0.5 Section 14.5).
 *
 * A committer learns the selection as soon as the beacon round is public, so
 * it must not be the only party that reports whether a registration happened.
 * Otherwise it can drop a commitment whose draw looks bad, blame a server
 * timeout, and try again under a new name. Here the relying party asks each
 * required server directly which commitment, if any, it registered under the
 * pre-agreed name (signing_key, stream_id, sequence). Any committer-signed
 * commitment that a required server registered under that name binds the
 * name: the audit is that commitment, and if no complete bundle for it
 * appears, the audit has failed.
 */

import * as wasm from '@nocherry/pb-wasm';

export interface StreamName {
  signing_key: string;
  stream_id: string;
  sequence: number;
}

export interface NameServer {
  name?: string | null;
  url: string;
  /** Expected server did:key. When set, a listing signed by another key is rejected. */
  server_key?: string | null;
}

/** What one server returned: its signed stream listing and the commitment bodies it serves. */
export interface ServerAnswer {
  server: NameServer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listing?: any;
  /** Commitment bodies by commitment hash, for the hashes listed under the name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitments?: Record<string, any>;
  /** Set when the listing could not be fetched. */
  error?: string;
}

export interface ServerFinding {
  server: string;
  /**
   * `registered`: the server lists a commitment under the name and serves it, signed by the key.
   * `empty`: a valid signed listing with nothing under the name.
   * `unbacked`: the server lists a hash under the name but does not serve a matching signed commitment.
   * `unreachable`: no listing could be fetched.
   * `invalid`: the listing is unsigned, signed by the wrong key, or for another name.
   */
  status: 'registered' | 'empty' | 'unbacked' | 'unreachable' | 'invalid';
  commitment_hash?: string;
  detail?: string;
}

export interface NameCheck {
  /**
   * `bound`: exactly one committer-signed commitment is registered under the name.
   * `conflict`: the committer signed two or more commitments under the name; the audit fails.
   * `unused`: every required server answered and none registered anything under the name.
   * `inconclusive`: nothing registered was found, but at least one server did not give a valid answer.
   */
  status: 'bound' | 'conflict' | 'unused' | 'inconclusive';
  /** The binding commitment hash when `bound`; all distinct hashes when `conflict`. */
  commitment_hashes: string[];
  servers: ServerFinding[];
  detail: string;
}

function label(server: NameServer): string {
  return server.name ?? server.url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listingSignatureValid(listing: any): boolean {
  if (!listing || typeof listing.server_key !== 'string' || typeof listing.server_signature !== 'string') return false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { server_signature, ...signed } = listing;
  try {
    return wasm.verifySignature(listing.server_key, new TextEncoder().encode(JSON.stringify(signed)), server_signature);
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function commitmentMatches(commitment: any, name: StreamName, hash: string): boolean {
  if (!commitment || commitment.commitment_hash !== hash) return false;
  if (commitment.signing_key !== name.signing_key) return false;
  if (commitment.stream_id !== name.stream_id || commitment.sequence !== name.sequence) return false;
  try {
    return wasm.verifyCommitment(JSON.stringify(commitment)) === true;
  } catch {
    return false;
  }
}

function judgeServer(name: StreamName, answer: ServerAnswer): ServerFinding {
  const server = label(answer.server);
  if (answer.error !== undefined || answer.listing === undefined) {
    return { server, status: 'unreachable', detail: answer.error ?? 'no listing' };
  }
  const listing = answer.listing;
  if (!listingSignatureValid(listing)) {
    return { server, status: 'invalid', detail: 'listing signature missing or invalid' };
  }
  if (answer.server.server_key && listing.server_key !== answer.server.server_key) {
    return { server, status: 'invalid', detail: `listing signed by ${listing.server_key}, expected ${answer.server.server_key}` };
  }
  if (listing.signing_key !== name.signing_key || listing.stream_id !== name.stream_id || !Array.isArray(listing.commitments)) {
    return { server, status: 'invalid', detail: 'listing is for another name' };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = listing.commitments.filter((e: any) => e && e.sequence === name.sequence);
  if (entries.length === 0) return { server, status: 'empty' };
  if (entries.length > 1) {
    return { server, status: 'invalid', detail: `listing has ${entries.length} entries for sequence ${name.sequence}` };
  }
  const hash: string = entries[0].commitment_hash;
  if (!commitmentMatches(answer.commitments?.[hash], name, hash)) {
    return { server, status: 'unbacked', commitment_hash: hash, detail: 'listed commitment is not served or not signed by the key under this name' };
  }
  return { server, status: 'registered', commitment_hash: hash };
}

/**
 * Decide, from the answers of the relying party's required servers, which
 * commitment the name (signing_key, stream_id, sequence) is bound to. Pure:
 * no network access, so the same answers always give the same result.
 */
export function evaluateName(name: StreamName, answers: ServerAnswer[]): NameCheck {
  const servers = answers.map((a) => judgeServer(name, a));
  const hashes = [...new Set(servers.filter((s) => s.status === 'registered').map((s) => s.commitment_hash!))].sort();
  const id = `${name.signing_key} / ${name.stream_id} / ${name.sequence}`;

  if (hashes.length > 1) {
    return {
      status: 'conflict', commitment_hashes: hashes, servers,
      detail: `the key signed ${hashes.length} different commitments under ${id}; the audit fails`,
    };
  }
  if (hashes.length === 1) {
    return {
      status: 'bound', commitment_hashes: hashes, servers,
      detail: `${id} is bound to ${hashes[0]}; without a complete bundle for it the audit fails`,
    };
  }
  const silent = servers.filter((s) => s.status !== 'empty');
  if (silent.length > 0) {
    return {
      status: 'inconclusive', commitment_hashes: [], servers,
      detail: `no registration found under ${id}, but ${silent.map((s) => `${s.server} (${s.status})`).join(', ')} gave no valid answer`,
    };
  }
  return {
    status: 'unused', commitment_hashes: [], servers,
    detail: `no required server registered anything under ${id}`,
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}

async function getJson(url: string, timeoutMs: number, fetchImpl: NonNullable<FetchNameOptions['fetch']>): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export interface FetchNameOptions {
  timeoutMs?: number;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Fetch the signed stream listing of one server and the commitment bodies listed under the name. */
export async function fetchServerAnswer(name: StreamName, server: NameServer, opts: FetchNameOptions = {}): Promise<ServerAnswer> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const fetchImpl = opts.fetch ?? fetch;
  const path = `/v1/streams/${encodeURIComponent(name.signing_key)}/${encodeURIComponent(name.stream_id)}`;
  let listing: unknown;
  try {
    const res = await getJson(joinUrl(server.url, path), timeoutMs, fetchImpl);
    if (res.status !== 200) return { server, error: `listing returned HTTP ${res.status} (server may not support format 0.5.0 streams)` };
    if (res.body === null || typeof res.body !== 'object') return { server, error: 'response is not a JSON stream listing (server may not support format 0.5.0 streams)' };
    listing = res.body;
  } catch (e: unknown) {
    return { server, error: e instanceof Error ? e.message : String(e) };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = Array.isArray((listing as any)?.commitments) ? (listing as any).commitments : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hashes: string[] = entries.filter((e: any) => e?.sequence === name.sequence && typeof e.commitment_hash === 'string')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.commitment_hash);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commitments: Record<string, any> = {};
  for (const hash of hashes) {
    if (!/^[0-9a-f]{64}$/.test(hash)) continue;
    try {
      const res = await getJson(joinUrl(server.url, `/v1/commitments/${hash}`), timeoutMs, fetchImpl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (res.status === 200 && (res.body as any)?.commitment) commitments[hash] = (res.body as any).commitment;
    } catch {
      // The body stays missing; evaluateName reports the entry as unbacked.
    }
  }
  return { server, listing, commitments };
}

/** Ask every required server about the name, in parallel, and evaluate the answers. */
export async function checkName(name: StreamName, servers: NameServer[], opts: FetchNameOptions = {}): Promise<NameCheck> {
  const answers = await Promise.all(servers.map((s) => fetchServerAnswer(name, s, opts)));
  return evaluateName(name, answers);
}
