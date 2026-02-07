/**
 * Firestore Native mode storage adapter for Google Cloud Run.
 * Async mirror of the KyselyStorage / D1Storage interface.
 *
 * Collections: server_identity, commitments, selections, reveals, beacon_cache
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';

export class FirestoreStorage {
  /** @param {string} projectId @param {string} [databaseId] */
  constructor(projectId, databaseId) {
    const opts = { projectId };
    if (databaseId) opts.databaseId = databaseId;
    this.db = new Firestore(opts);
    this.serverIdentity = this.db.collection('server_identity');
    this.commitments = this.db.collection('commitments');
    this.selections = this.db.collection('selections');
    this.reveals = this.db.collection('reveals');
    this.beaconCache = this.db.collection('beacon_cache');
  }

  // ── Server identity ──

  async getServerIdentity() {
    const doc = await this.serverIdentity.doc('keypair').get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data().value);
  }

  async setServerIdentity(keypair) {
    await this.serverIdentity.doc('keypair').set({
      value: JSON.stringify(keypair),
    });
  }

  // ── Commitments ──

  async putCommitment(id, commitment, registeredAt) {
    try {
      await this.commitments.doc(id).create({
        signing_key: commitment.signing_key,
        body: JSON.stringify(commitment),
        registered_at: registeredAt,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      if (e.code === 6) {
        // ALREADY_EXISTS — Firestore create() throws gRPC code 6
        throw new Error('Commitment already exists');
      }
      throw e;
    }
  }

  async getCommitment(id) {
    const doc = await this.commitments.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
      commitment: JSON.parse(data.body),
      registered_at: data.registered_at,
    };
  }

  // ── Selections ──

  async putSelection(commitmentHash, selection, beaconRound) {
    await this.selections.doc(commitmentHash).set({
      beacon_round: beaconRound,
      body: JSON.stringify(selection),
      computed_at: new Date().toISOString(),
    });
  }

  async getSelection(commitmentHash) {
    const doc = await this.selections.doc(commitmentHash).get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data().body);
  }

  // ── Reveals ──

  async putReveal(id, commitmentHash, reveal, registeredAt) {
    await this.reveals.doc(id).set({
      commitment_hash: commitmentHash,
      body: JSON.stringify(reveal),
      registered_at: registeredAt,
    });
  }

  async getReveals(commitmentHash) {
    const snapshot = await this.reveals
      .where('commitment_hash', '==', commitmentHash)
      .get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { ...JSON.parse(data.body), registered_at: data.registered_at };
    });
  }

  // ── Anti-spam / Activity ──

  async countCommitmentsByKey(signingKey, since) {
    const snapshot = await this.commitments
      .where('signing_key', '==', signingKey)
      .where('registered_at', '>=', since)
      .count()
      .get();
    return snapshot.data().count;
  }

  async getSignerActivity(signingKey) {
    const now = new Date();
    const oneHourAgo = new Date(now - 3600 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

    const [hourCount, monthCount] = await Promise.all([
      this.countCommitmentsByKey(signingKey, oneHourAgo),
      this.countCommitmentsByKey(signingKey, thirtyDaysAgo),
    ]);

    return {
      commitments_past_hour: hourCount,
      commitments_past_month: monthCount,
    };
  }

  // ── Beacon cache ──

  async getCachedBeacon(beaconType, round) {
    const docId = `${beaconType}_${round}`;
    const doc = await this.beaconCache.doc(docId).get();
    if (!doc.exists) return null;
    return JSON.parse(doc.data().body);
  }

  async cacheBeacon(beaconType, round, output) {
    const docId = `${beaconType}_${round}`;
    await this.beaconCache.doc(docId).set({
      beacon_type: beaconType,
      round_number: round,
      body: JSON.stringify(output),
      fetched_at: new Date().toISOString(),
    });
  }

  // ── Retention ──

  async deleteOlderThan(cutoff) {
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

  // ── Lifecycle ──

  async close() {
    await this.db.terminate();
  }
}
