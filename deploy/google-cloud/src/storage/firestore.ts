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

  constructor(projectId: string, databaseId?: string) {
    const opts: { projectId: string; databaseId?: string } = { projectId };
    if (databaseId) opts.databaseId = databaseId;
    this.db = new Firestore(opts);
    this.serverIdentity = this.db.collection('server_identity');
    this.commitments = this.db.collection('commitments');
    this.selections = this.db.collection('selections');
    this.reveals = this.db.collection('reveals');
    this.beaconCache = this.db.collection('beacon_cache');
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

  async putCommitment(id: string, commitment: any, registeredAt: string): Promise<void> {
    try {
      await this.commitments.doc(id).create({
        signing_key: commitment.signing_key,
        body: JSON.stringify(commitment),
        registered_at: registeredAt,
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      if (e.code === 6) {
        // ALREADY_EXISTS -- Firestore create() throws gRPC code 6
        throw new Error('Commitment already exists');
      }
      throw e;
    }
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
