/**
 * Shared type definitions for the commit-reveal protocol.
 * All deployment targets import from here.
 */

export interface Keypair {
  did_key: string;
  private_key_hex: string;
  public_key_hex: string;
}

export interface Config {
  retention: string;
  operator: string;
  beaconTypes: string[];
  specVersion: string;
  version: string;
  activityWindows: string[];
  verifyRevealData: boolean;
  /** Byte cap per fetched reveal file. Defaults to DEFAULT_MAX_FETCH_BYTES. */
  maxRevealFileBytes?: number;
  /**
   * Skip the public-HTTPS checks on reveal `file_urls`. For local development
   * and tests only (e.g. a file server on 127.0.0.1); never set in production,
   * it re-opens server-side request forgery.
   */
  allowUnsafeRevealUrls?: boolean;
  /** Clock used for `registered_at`. Defaults to the system clock. */
  now?: () => Date;
}

export interface StorageInterface {
  getServerIdentity(): Promise<Keypair | null>;
  setServerIdentity(keypair: Keypair): Promise<void>;
  putCommitment(id: string, commitment: any, registeredAt: string): Promise<void>;
  getCommitment(id: string): Promise<{ commitment: any; registered_at: string } | null>;
  putSelection(commitmentHash: string, selection: any, beaconRound: number): Promise<void>;
  getSelection(commitmentHash: string): Promise<any>;
  putReveal(id: string, commitmentHash: string, reveal: any, registeredAt: string): Promise<void>;
  getReveals(commitmentHash: string): Promise<any[]>;
  getSignerActivity(signingKey: string): Promise<{ commitments_past_hour: number; commitments_past_month: number }>;
  getCachedBeacon(beaconType: string, round: number): Promise<any>;
  cacheBeacon(beaconType: string, round: number, output: any): Promise<void>;
}

export type AppEnv = {
  Variables: {
    storage: StorageInterface;
    config: Config;
  };
};

export interface WasmInterface {
  anchorSelectionDelay(): number;
  anchoredSelectionRound(anchor_round: bigint): bigint;
  checkAnchorRegistration(anchor_round: bigint, registered_at_ms: bigint): any;
  createCommitment(params_json: string, private_key_hex: string): any;
  drandNextRoundAfter(unix_time: bigint): bigint;
  drandRoundTime(round: bigint): bigint;
  drandTimeToRound(unix_time: bigint): bigint;
  encodeDIDKey(public_key_hex: string): string;
  generateKeypair(): any;
  hashBytes(data: Uint8Array): string;
  hashManifest(manifest_json: string): string;
  prngNext(seed_hex: string, index: bigint): any;
  selectBatch(items_json: string, beacon_randomness_hex: string, count: number): any;
  selectPerItem(beacon_randomness_hex: string, commitment_hash: string, item_hash: string, reveal_probability: number): boolean;
  signMessage(private_key_hex: string, message: Uint8Array): string;
  threshold(p: number): string;
  verifyCommitment(commitment_json: string): boolean;
  verifySignature(did_key: string, message: Uint8Array, signature_hex: string): boolean;
}
