/**
 * Firestore Native mode storage adapter for Google Cloud Run.
 * Async mirror of the KyselyStorage / D1Storage interface.
 *
 * Collections: server_identity, commitments, selections, reveals, beacon_cache
 */

import { Firestore } from '@google-cloud/firestore';
import type { StorageInterface, Keypair } from '../../../../src/core/types.ts'

export class FirestoreStorage implements StorageInterface {
  private db: Firestore;
  private serverIdentity;
  private commitments;
  private selections;
  private reveals;
  private beaconCache;
  private streams;

  constructor(projectId: string, databaseId?: string) {
    const opts: { projectId: string; databaseId?: string } = { projectId };
    if (databaseId) opts.databaseId = databaseId;
    this.db = new Firestore(opts);
    this.serverIdentity = this.db.collection('server_identity');
    this.commitments = this.db.collection('commitments');
    this.selections = this.db.collection('selections');
    this.reveals = this.db.collection('reveals');
    this.beaconCache = this.db.collection('beacon_cache');
    this.streams = this.db.collection('streams');
  }

  // -- Server identity --

  async getServerIdentity(): Promise<Keypair | null> {
    const doc = await this.serverIdentity.doc('keypair').get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data()!.value);
  }

  async setServerIdentity(keypair: Keypair): Promise<void> {
    await this.serverIdentity.doc('keypair').set({
      value: JSON.stringify(keypair),
    });
  }

  // -- Commitments --

  /** Document id of the stream index entry for (signing_key, stream_id, sequence). */
  private streamDocId(signingKey: string, streamId: string, sequence: number): string {
    // Firestore ids cannot contain '/', and the three parts must stay separable.
    const enc = (s: string) => encodeURIComponent(s);
    return `${enc(signingKey)}|${enc(streamId)}|${sequence}`;
  }

  async putCommitment(id: string, commitment: any, registeredAt: string): Promise<void> {
    // Only a 0.5.0 commitment signs its stream name (spec v0.5 12.2). The
    // uniqueness of (signing_key, stream_id, sequence) is a create() of a
    // deterministic document in the same transaction as the commitment.
    const inStream = commitment.spec_version === '0.5.0' && typeof commitment.stream_id === 'string' && Number.isInteger(commitment.sequence);
    const data = {
      signing_key: commitment.signing_key,
      body: JSON.stringify(commitment),
      registered_at: registeredAt,
      created_at: new Date().toISOString(),
      stream_id: inStream ? commitment.stream_id : null,
      sequence: inStream ? commitment.sequence : null,
    };
    try {
      await this.db.runTransaction(async (tx) => {
        tx.create(this.commitments.doc(id), data);
        if (inStream) {
          tx.create(this.streams.doc(this.streamDocId(commitment.signing_key, commitment.stream_id, commitment.sequence)), {
            signing_key: commitment.signing_key,
            stream_id: commitment.stream_id,
            sequence: commitment.sequence,
            commitment_hash: id,
            registered_at: registeredAt,
          });
        }
      });
    } catch (e: any) {
      if (e.code === 6) {
        // ALREADY_EXISTS -- Firestore create() throws gRPC code 6
        throw new Error('Commitment already exists');
      }
      throw e;
    }
  }

  // -- Streams (spec v0.5 12.2, 12.9) --

  async findStreamCommitment(signingKey: string, streamId: string, sequence: number) {
    const doc = await this.streams.doc(this.streamDocId(signingKey, streamId, sequence)).get();
    if (!doc.exists) return null;
    const d = doc.data()!;
    return { sequence: Number(d.sequence), commitment_hash: d.commitment_hash as string, registered_at: d.registered_at as string };
  }

  async listStream(signingKey: string, streamId: string) {
    const snapshot = await this.streams
      .where('signing_key', '==', signingKey)
      .where('stream_id', '==', streamId)
      .orderBy('sequence', 'asc')
      .get();
    return snapshot.docs.map((doc) => {
      const d = doc.data();
      return { sequence: Number(d.sequence), commitment_hash: d.commitment_hash as string, registered_at: d.registered_at as string };
    });
  }

  async getCommitment(id: string): Promise<{ commitment: any; registered_at: string } | null> {
    const doc = await this.commitments.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    return {
      commitment: JSON.parse(data.body),
      registered_at: data.registered_at,
    };
  }

  // -- Selections --

  async putSelection(commitmentHash: string, selection: any, beaconRound: number): Promise<void> {
    await this.selections.doc(commitmentHash).set({
      beacon_round: beaconRound,
      body: JSON.stringify(selection),
      computed_at: new Date().toISOString(),
    });
  }

  async getSelection(commitmentHash: string): Promise<any> {
    const doc = await this.selections.doc(commitmentHash).get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data()!.body);
  }

  // -- Reveals --

  async putReveal(id: string, commitmentHash: string, reveal: any, registeredAt: string): Promise<void> {
    await this.reveals.doc(id).set({
      commitment_hash: commitmentHash,
      body: JSON.stringify(reveal),
      registered_at: registeredAt,
    });
  }

  async getReveals(commitmentHash: string): Promise<any[]> {
    const snapshot = await this.reveals
      .where('commitment_hash', '==', commitmentHash)
      .get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { ...JSON.parse(data.body), registered_at: data.registered_at };
    });
  }

  // -- Anti-spam / Activity --

  async countCommitmentsByKey(signingKey: string, since: string): Promise<number> {
    const snapshot = await this.commitments
      .where('signing_key', '==', signingKey)
      .where('registered_at', '>=', since)
      .count()
      .get();
    return snapshot.data().count;
  }

  async getSignerActivity(signingKey: string): Promise<{ commitments_past_hour: number; commitments_past_month: number }> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const [hourCount, monthCount] = await Promise.all([
      this.countCommitmentsByKey(signingKey, oneHourAgo),
      this.countCommitmentsByKey(signingKey, thirtyDaysAgo),
    ]);

    return {
      commitments_past_hour: hourCount,
      commitments_past_month: monthCount,
    };
  }

  // -- Beacon cache --

  async getCachedBeacon(beaconType: string, round: number): Promise<any> {
    const docId = `${beaconType}_${round}`;
    const doc = await this.beaconCache.doc(docId).get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data()!.body);
  }

  async cacheBeacon(beaconType: string, round: number, output: any): Promise<void> {
    const docId = `${beaconType}_${round}`;
    await this.beaconCache.doc(docId).set({
      beacon_type: beaconType,
      round_number: round,
      body: JSON.stringify(output),
      fetched_at: new Date().toISOString(),
    });
  }

  // -- Retention --

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const cutoffISO = cutoff.toISOString();
    let totalDeleted = 0;

    // Query old commitments
    const oldCommitments = await this.commitments
      .where('registered_at', '<', cutoffISO)
      .select()
      .get();

    // Delete in batches of 500 (Firestore batch limit)
    const hashes = oldCommitments.docs.map((doc) => doc.id);

    for (let i = 0; i < hashes.length; i += 500) {
      const batch = this.db.batch();
      const chunk = hashes.slice(i, i + 500);

      for (const hash of chunk) {
        batch.delete(this.commitments.doc(hash));
        batch.delete(this.selections.doc(hash));

        // Cascade: the stream index entry of this commitment, if any
        const streamEntries = await this.streams
          .where('commitment_hash', '==', hash)
          .select()
          .get();
        for (const entry of streamEntries.docs) {
          batch.delete(entry.ref);
        }

        // Cascade: query and delete reveals for this commitment
        const reveals = await this.reveals
          .where('commitment_hash', '==', hash)
          .select()
          .get();
        for (const revealDoc of reveals.docs) {
          batch.delete(revealDoc.ref);
        }
      }

      await batch.commit();
      totalDeleted += chunk.length;
    }

    return totalDeleted;
  }

  // -- Lifecycle --

  async close(): Promise<void> {
    await this.db.terminate();
  }
}
