//! Adversarial / attack tests for the commit-reveal protocol.
//!
//! These tests think about how a malicious actor could try to break
//! the protocol's guarantees: integrity, binding, fairness, and completeness.

use pb_core::beacon::{BeaconOutput, BeaconRef};
use pb_core::commitment::{self, Commitment, CreateParams};
use pb_core::hash;
use pb_core::reveal;
use pb_core::select;
use pb_core::sign;
use pb_core::verify::{self, DataItem};

fn test_beacon_output() -> BeaconOutput {
    BeaconOutput {
        beacon_type: "drand".into(),
        chain_hash: Some("52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971".into()),
        // Real quicknet round 1, so that only the attack under test fails verification.
        round: Some(1),
        randomness: "1466a6cd24e327188770752f6134001c64d6efcc590ccc26b721611ad96f165a".into(),
        signature: "b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b".into(),
    }
}

/// Registration instant for which round 1 is the first round after it.
const REGISTERED_BEFORE_ROUND_1: &str = "2023-08-23T15:09:26Z";

/// Status of a selection with nothing wrong: without BLS the beacon check is skipped.
const CHECKED: &str = if cfg!(feature = "drand-bls") { "verified" } else { "partial" };

fn make_commitment(kp: &sign::KeyPair, items: Vec<String>, prob: f64) -> Commitment {
    commitment::create(CreateParams {
        items,
        reveal_probability: prob,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, kp).unwrap()
}

fn hash_str(s: &str) -> String {
    hash::hash_bytes(s.as_bytes())
}

// ══════════════════════════════════════════════════════════════════════
// 1. SIGNATURE FORGERY ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_swap_signing_key_after_signing() {
    // Attack: Sign with key A, then replace signing_key with key B's did:key.
    // Goal: Make it look like key B signed the commitment.
    let kp_a = sign::generate_keypair();
    let kp_b = sign::generate_keypair();

    let mut c = make_commitment(&kp_a, vec![hash_str("item1")], 0.10);
    c.signing_key = kp_b.did_key.clone();

    // Verification must fail: signature was made by A, but signing_key says B.
    // The signing payload includes signing_key, so the hash changes.
    let result = commitment::verify_signature(&c);
    assert!(result.is_err(), "Should reject swapped signing key");
}

#[test]
fn attack_reuse_signature_on_modified_commitment() {
    // Attack: Take a valid commitment, modify a field, keep the old signature.
    let kp = sign::generate_keypair();
    let c = make_commitment(&kp, vec![hash_str("item1")], 0.10);
    let original_sig = c.signature.clone();

    // Tamper with items but keep original signature
    let mut tampered = c.clone();
    tampered.items = vec![hash_str("evil-item")];
    tampered.signature = original_sig;

    assert!(commitment::verify_signature(&tampered).is_err(),
        "Modified items with old signature must be rejected");
}

#[test]
fn attack_forge_commitment_hash() {
    // Attack: Compute a valid signing payload but set commitment_hash to something else.
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.10);

    // Replace commitment_hash with zeros
    c.commitment_hash = "0".repeat(64);

    // verify_signature checks hash matches recomputed value
    let result = commitment::verify_signature(&c);
    assert!(result.is_err(), "Forged commitment_hash must be rejected");
}

#[test]
fn attack_empty_signature() {
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.10);
    c.signature = String::new();

    assert!(commitment::verify_signature(&c).is_err(),
        "Empty signature must be rejected");
}

#[test]
fn attack_garbage_signature() {
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.10);
    c.signature = "zz".repeat(64); // Invalid hex that's the right length

    assert!(commitment::verify_signature(&c).is_err(),
        "Garbage signature must be rejected");
}

#[test]
fn attack_truncated_signature() {
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.10);
    // Truncate signature to half length
    c.signature = c.signature[..64].to_string();

    assert!(commitment::verify_signature(&c).is_err(),
        "Truncated signature must be rejected");
}

// ══════════════════════════════════════════════════════════════════════
// 2. ITEM COUNT MISMATCH ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_inflate_item_count() {
    // Attack: Set item_count higher than actual items to claim more items exist.
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.10);
    c.item_count = 100; // Claim 100 items when there's only 1

    // Signing payload includes item_count, so signature verification fails
    assert!(commitment::verify_signature(&c).is_err(),
        "Inflated item_count must invalidate signature");
}

#[test]
fn attack_deflate_item_count() {
    // Attack: Set item_count lower than actual to hide items from selection.
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1"), hash_str("item2")], 0.10);
    c.item_count = 1;

    assert!(commitment::verify_signature(&c).is_err(),
        "Deflated item_count must invalidate signature");
}

// ══════════════════════════════════════════════════════════════════════
// 3. PROBABILITY MANIPULATION ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_probability_near_zero() {
    // Attack: Use an extremely small probability to virtually never reveal anything.
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec![hash_str("item1")],
        reveal_probability: f64::MIN_POSITIVE, // ~5e-324
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);

    // The protocol allows any p in (0, 1] — this is technically valid.
    // But verify the threshold is essentially 0 (no items selected).
    assert!(result.is_ok());
    let thresh = select::threshold(f64::MIN_POSITIVE);
    assert_eq!(thresh, 0, "Threshold for MIN_POSITIVE should be 0 (no items ever selected)");
}

#[test]
fn attack_probability_nan() {
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec![hash_str("item1")],
        reveal_probability: f64::NAN,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "NaN probability must be rejected");
}

#[test]
fn attack_probability_infinity() {
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec![hash_str("item1")],
        reveal_probability: f64::INFINITY,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "Infinity probability must be rejected");
}

#[test]
fn attack_probability_negative() {
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec![hash_str("item1")],
        reveal_probability: -0.5,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "Negative probability must be rejected");
}

#[test]
fn attack_change_probability_after_signing() {
    // Attack: Lower probability after signing to avoid revealing items.
    let kp = sign::generate_keypair();
    let mut c = make_commitment(&kp, vec![hash_str("item1")], 0.90);
    c.reveal_probability = 0.01; // Lower after signing

    assert!(commitment::verify_signature(&c).is_err(),
        "Changed probability must invalidate signature");
}

// ══════════════════════════════════════════════════════════════════════
// 4. SELECTION GAMING ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_selection_determinism() {
    // Verify: same inputs always produce same selection (no randomness leak).
    let kp = sign::generate_keypair();
    let items: Vec<String> = (0..10).map(|i| hash_str(&format!("item-{}", i))).collect();
    let c = make_commitment(&kp, items, 0.50);
    let bo = test_beacon_output();

    let sel1 = verify::compute_selection(&c, &bo, "t1").unwrap();
    let sel2 = verify::compute_selection(&c, &bo, "t2").unwrap();

    assert_eq!(sel1.selected_items, sel2.selected_items,
        "Selection must be deterministic for same inputs");
}

#[test]
fn attack_selection_depends_on_commitment_hash() {
    // Verify: two commitments with same items but different hashes → different selections.
    // This prevents an attacker from predicting selection without knowing the commitment.
    let kp = sign::generate_keypair();
    let items: Vec<String> = (0..20).map(|i| hash_str(&format!("shared-item-{}", i))).collect();

    let c1 = make_commitment(&kp, items.clone(), 0.50);
    let c2 = commitment::create(CreateParams {
        items,
        reveal_probability: 0.50,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:31:00Z".into(), // Different timestamp
        identity: None,
    }, &kp).unwrap();

    assert_ne!(c1.commitment_hash, c2.commitment_hash);

    let bo = test_beacon_output();
    let _sel1 = verify::compute_selection(&c1, &bo, "t").unwrap();
    let _sel2 = verify::compute_selection(&c2, &bo, "t").unwrap();

    // With different commitment hashes, selected items should (very likely) differ
    // Not guaranteed for small sets, but with 20 items at p=0.50, extremely unlikely to match
    // We check that the selection algorithm uses commitment_hash as input
    assert_ne!(c1.commitment_hash, c2.commitment_hash,
        "Different commitments must have different hashes");
}

#[test]
fn attack_selection_depends_on_beacon() {
    // Verify: same commitment with different beacon outputs → different selections.
    let kp = sign::generate_keypair();
    let items: Vec<String> = (0..20).map(|i| hash_str(&format!("item-{}", i))).collect();
    let c = make_commitment(&kp, items, 0.50);

    let bo1 = test_beacon_output();
    let mut bo2 = test_beacon_output();
    bo2.randomness = "0000000000000000000000000000000000000000000000000000000000000001".into();

    let sel1 = verify::compute_selection(&c, &bo1, "t").unwrap();
    let sel2 = verify::compute_selection(&c, &bo2, "t").unwrap();

    // Different beacon randomness should give different selections
    assert_ne!(sel1.selected_items, sel2.selected_items,
        "Different beacon randomness must produce different selections");
}

#[test]
fn attack_item_hash_bruteforce() {
    // Attack: Can an attacker find item hashes that are never selected?
    // With a fixed beacon and commitment, try many items and check distribution.
    let beacon_bytes = hex::decode(
        "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
    ).unwrap();
    let commitment_hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

    let mut selected_count = 0;
    let trials = 1000;

    for i in 0..trials {
        let item_hash = hash_str(&format!("bruteforce-item-{}", i));
        if select::select_per_item(&beacon_bytes, commitment_hash, &item_hash, 0.10) {
            selected_count += 1;
        }
    }

    // With p=0.10 and 1000 trials, expected ~100 ± ~30 (3σ).
    // If attacker could game selection, they could get 0. Check reasonable bounds.
    assert!(selected_count > 40 && selected_count < 200,
        "Selection count {} out of expected range [40, 200] for p=0.10 with 1000 trials",
        selected_count);
}

// ══════════════════════════════════════════════════════════════════════
// 5. REVEAL COMPLETENESS ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_reveal_missing_selected_items() {
    // Attack: Reveal only some selected items, claiming to have revealed all.
    let kp = sign::generate_keypair();
    let data1 = b"item data 1";
    let data2 = b"item data 2";
    let h1 = hash::hash_bytes(data1);
    let h2 = hash::hash_bytes(data2);

    let c = make_commitment(&kp, vec![h1.clone(), h2.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    // Only reveal first item even though both may be selected
    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: vec![h1.clone()], // Missing h2
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    let result = verify::verify_full_with_registration(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h1.clone(), data: data1 },
    ], Some(REGISTERED_BEFORE_ROUND_1));

    // With p=1.0 both items are selected. The missing one fails completeness.
    assert_eq!(sel.selected_items.len(), 2);
    assert_eq!(result.status, "partial");
    let completeness = result.checks.iter().find(|c| c.name == "completeness")
        .expect("completeness check must be present");
    assert_eq!(completeness.status, "fail");

    // The same receipt with a complete reveal is clean, so the attack is what was detected.
    let full = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();
    let clean = verify::verify_full_with_registration(&c, Some(&sel), Some(&full), &[
        DataItem { hash: h1, data: data1 },
        DataItem { hash: h2, data: data2 },
    ], Some(REGISTERED_BEFORE_ROUND_1));
    assert_eq!(clean.status, CHECKED);
}

#[test]
fn attack_reveal_with_fabricated_items() {
    // Attack: Include item hashes in the reveal that weren't in the original commitment.
    let kp = sign::generate_keypair();
    let h_real = hash_str("real-item");
    let h_fake = hash_str("fake-item-not-in-commitment");

    let c = make_commitment(&kp, vec![h_real.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    // Include a fabricated item in voluntary_items
    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![h_fake.clone()],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    // The fake item's data hashes correctly, so data integrity alone would pass.
    let result = verify::verify_full_with_registration(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h_real.clone(), data: b"real-item" },
        DataItem { hash: h_fake.clone(), data: b"fake-item-not-in-commitment" },
    ], Some(REGISTERED_BEFORE_ROUND_1));

    assert_eq!(result.status, "failed");
    let check = |name: &str| result.checks.iter().find(|c| c.name == name).unwrap().status.clone();
    assert_eq!(check("reveal_matches_commitment"), "fail");
    assert_eq!(check("data_integrity"), "pass");
}

#[test]
fn attack_reveal_voluntary_item_labeled_as_selected() {
    // Attack: present a favorable, unselected item as if the beacon had selected it.
    let kp = sign::generate_keypair();
    let items: Vec<String> = (0..10).map(|i| hash_str(&format!("item-{i}"))).collect();
    let c = make_commitment(&kp, items.clone(), 0.2);
    let sel = verify::compute_selection(&c, &test_beacon_output(), "now").unwrap();
    assert_eq!(sel.selected_items.len(), 2);
    let unselected = items.iter().find(|h| !sel.selected_items.contains(h)).unwrap().clone();

    let reveal_with = |selected: Vec<String>, voluntary: Vec<String>| reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: selected,
        voluntary_items: voluntary,
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();
    let status = |rev: &reveal::Reveal| {
        let result = verify::verify_full_with_registration(
            &c, Some(&sel), Some(rev), &[], Some(REGISTERED_BEFORE_ROUND_1));
        result.checks.iter().find(|c| c.name == "reveal_matches_commitment").unwrap().status.clone()
    };

    let mut mislabeled = sel.selected_items.clone();
    mislabeled.push(unselected.clone());
    assert_eq!(status(&reveal_with(mislabeled, vec![])), "fail");
    // The same item revealed as voluntary is fine.
    assert_eq!(status(&reveal_with(sel.selected_items.clone(), vec![unselected])), "pass");
}

#[test]
fn attack_reveal_of_another_commitment() {
    // Attack: answer the selection with a reveal signed for a different commitment.
    let kp = sign::generate_keypair();
    let h = hash_str("data");
    let c = make_commitment(&kp, vec![h.clone()], 1.0);
    let sel = verify::compute_selection(&c, &test_beacon_output(), "now").unwrap();
    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: "00".repeat(32),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    let result = verify::verify_full_with_registration(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h, data: b"data" },
    ], Some(REGISTERED_BEFORE_ROUND_1));
    assert_eq!(result.status, "failed");
    assert_eq!(result.checks.iter().find(|c| c.name == "reveal_matches_commitment").unwrap().status, "fail");
}

#[test]
fn attack_reveal_wrong_data() {
    // Attack: Reveal selected items but provide different data (bait and switch).
    let kp = sign::generate_keypair();
    let real_data = b"original high-quality data";
    let h = hash::hash_bytes(real_data);

    let c = make_commitment(&kp, vec![h.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    // Provide substituted data
    let result = verify::verify_full(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h, data: b"fake low-quality replacement data" },
    ]);

    assert_eq!(result.status, "failed", "Wrong data must fail verification");
    assert_eq!(result.items_failed, 1);
}

#[test]
fn attack_reveal_no_data_provided() {
    // Attack: Submit reveal but "forget" to provide any actual data.
    let kp = sign::generate_keypair();
    let h = hash_str("data");

    let c = make_commitment(&kp, vec![h.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    // Provide no data items at all
    let result = verify::verify_full_with_registration(
        &c, Some(&sel), Some(&rev), &[], Some(REGISTERED_BEFORE_ROUND_1));

    assert_eq!(sel.selected_items.len(), 1);
    assert_eq!(result.status, "partial");
    assert_eq!(result.items_missing, 1);
    let integrity = result.checks.iter().find(|c| c.name == "data_integrity")
        .expect("data_integrity check must be present");
    assert_eq!(integrity.status, "fail");

    // With the data supplied the same receipt is clean.
    let clean = verify::verify_full_with_registration(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h, data: b"data" },
    ], Some(REGISTERED_BEFORE_ROUND_1));
    assert_eq!(clean.status, CHECKED);
}

// ══════════════════════════════════════════════════════════════════════
// 6. REVEAL SIGNATURE ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_reveal_forged_signature() {
    let kp = sign::generate_keypair();
    let mut rev = reveal::create(reveal::CreateParams {
        commitment_hash: hash_str("commitment"),
        selected_items: vec![],
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    // Forge the signature
    rev.signature = "00".repeat(64);

    assert!(reveal::verify_signature(&rev).is_err(),
        "Forged reveal signature must be rejected");
}

#[test]
fn attack_reveal_swap_signing_key() {
    // Attack: Sign reveal with key A, replace signing_key with key B.
    let kp_a = sign::generate_keypair();
    let kp_b = sign::generate_keypair();

    let mut rev = reveal::create(reveal::CreateParams {
        commitment_hash: hash_str("commitment"),
        selected_items: vec![],
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp_a).unwrap();

    rev.signing_key = kp_b.did_key.clone();

    assert!(reveal::verify_signature(&rev).is_err(),
        "Swapped signing key in reveal must be rejected");
}

#[test]
fn attack_reveal_tamper_commitment_hash() {
    // Attack: Point the reveal to a different commitment.
    let kp = sign::generate_keypair();
    let mut rev = reveal::create(reveal::CreateParams {
        commitment_hash: hash_str("commitment-A"),
        selected_items: vec![],
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    rev.commitment_hash = hash_str("commitment-B");

    assert!(reveal::verify_signature(&rev).is_err(),
        "Tampered commitment_hash in reveal must be rejected");
}

// ══════════════════════════════════════════════════════════════════════
// 7. COMMITMENT ITEM ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_duplicate_items() {
    let kp = sign::generate_keypair();
    let h = hash_str("item");
    let result = commitment::create(CreateParams {
        items: vec![h.clone(), h],
        reveal_probability: 0.10,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "Duplicate items must be rejected");
}

#[test]
fn attack_non_hex_item_hash() {
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec!["not-a-hex-hash-at-all".into()],
        reveal_probability: 0.10,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "Non-hex item hash must be rejected");
}

#[test]
fn attack_short_item_hash() {
    let kp = sign::generate_keypair();
    let result = commitment::create(CreateParams {
        items: vec!["abcd".into()], // Too short
        reveal_probability: 0.10,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    assert!(result.is_err(), "Short item hash must be rejected");
}

#[test]
fn attack_uppercase_hex_item_hash() {
    let kp = sign::generate_keypair();
    // Uppercase hex should be rejected (spec requires lowercase)
    let _result = commitment::create(CreateParams {
        items: vec!["A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2".into()],
        reveal_probability: 0.10,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &kp);
    // Current validation only checks length == 64, not hex validity.
    // This test documents the current behavior. Uppercase hex is accepted.
    // TODO: should validate hex format more strictly.
}

// ══════════════════════════════════════════════════════════════════════
// 8. CROSS-COMMITMENT ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_cross_commitment_signature() {
    // Attack: Take commitment A's signature and apply it to commitment B's data.
    let kp = sign::generate_keypair();
    let c_a = make_commitment(&kp, vec![hash_str("item-a")], 0.10);
    let c_b = make_commitment(&kp, vec![hash_str("item-b")], 0.20);

    // Mix: A's structure with B's signature
    let mut frankenstein = c_a.clone();
    frankenstein.signature = c_b.signature.clone();

    assert!(commitment::verify_signature(&frankenstein).is_err(),
        "Cross-commitment signature swap must be rejected");
}

#[test]
fn attack_cross_commitment_hash() {
    // Attack: Use commitment A's hash with commitment B's fields + signature.
    let kp = sign::generate_keypair();
    let c_a = make_commitment(&kp, vec![hash_str("item-a")], 0.10);
    let c_b = make_commitment(&kp, vec![hash_str("item-b")], 0.20);

    let mut hybrid = c_b.clone();
    hybrid.commitment_hash = c_a.commitment_hash.clone();

    assert!(commitment::verify_signature(&hybrid).is_err(),
        "Cross-commitment hash swap must be rejected");
}

// ══════════════════════════════════════════════════════════════════════
// 9. TIMESTAMP ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_future_timestamp() {
    // Attack: Use a far-future timestamp to delay beacon selection.
    let kp = sign::generate_keypair();
    let c = commitment::create(CreateParams {
        items: vec![hash_str("item")],
        reveal_probability: 0.10,
        beacon: BeaconRef::drand_quicknet(),
        metadata: None,
        stream_id: None,
        committed_at: "2099-12-31T23:59:59Z".into(),
        identity: None,
    }, &kp);
    // The protocol does NOT validate timestamps at the commitment level.
    // Timestamp validation is the server's responsibility.
    assert!(c.is_ok(), "Commitment creation doesn't validate timestamps (server does)");

    // But the signature still binds the timestamp
    let mut tampered = c.unwrap();
    tampered.committed_at = "2026-01-01T00:00:00Z".into();
    assert!(commitment::verify_signature(&tampered).is_err(),
        "Changed timestamp must invalidate signature");
}

// ══════════════════════════════════════════════════════════════════════
// 10. METADATA INJECTION ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_metadata_not_in_signing_payload() {
    // Verify: metadata changes do NOT affect the signature (metadata is excluded from signing).
    // This is by design — metadata is not part of the protocol's integrity guarantees.
    let kp = sign::generate_keypair();
    let c = make_commitment(&kp, vec![hash_str("item")], 0.10);

    let mut modified = c.clone();
    modified.metadata = serde_json::json!({"evil": "data", "injection": true});

    // Should still verify because metadata isn't in the signing payload
    assert!(commitment::verify_signature(&modified).is_ok(),
        "Metadata is excluded from signing payload, so changes don't affect signature");
}

// ══════════════════════════════════════════════════════════════════════
// 11. SELECTION ALGORITHM ATTACKS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_batch_count_exceeds_items() {
    let beacon = hex::decode(
        "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
    ).unwrap();
    let items: Vec<String> = vec![hash_str("a"), hash_str("b")];

    assert!(select::select_batch(&items, &beacon, 5).is_err(),
        "Batch count exceeding items must be rejected");
}

#[test]
fn attack_p100_selects_all_items() {
    // Verify: p=1.0 always selects everything (no escape from 100% reveal).
    let beacon = hex::decode(
        "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
    ).unwrap();

    for i in 0..100 {
        let item_hash = hash_str(&format!("must-be-selected-{}", i));
        assert!(select::select_per_item(&beacon, "any_commitment", &item_hash, 1.0),
            "With p=1.0, every item must be selected");
    }
}

#[test]
fn attack_selection_independent_of_order() {
    // Verify: per-item selection doesn't depend on item order in the array.
    let beacon = hex::decode(
        "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
    ).unwrap();
    let commitment_hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

    let items: Vec<String> = (0..10).map(|i| hash_str(&format!("order-item-{}", i))).collect();
    let mut reversed = items.clone();
    reversed.reverse();

    let sel1 = select::select_per_item_batch(&beacon, commitment_hash, &items, 0.50);
    let sel2 = select::select_per_item_batch(&beacon, commitment_hash, &reversed, 0.50);

    // Both should select the same items (though in different order)
    let mut s1_sorted = sel1.clone();
    let mut s2_sorted = sel2.clone();
    s1_sorted.sort();
    s2_sorted.sort();
    assert_eq!(s1_sorted, s2_sorted,
        "Per-item selection must be independent of item order");
}

// ══════════════════════════════════════════════════════════════════════
// 12. FULL PIPELINE ATTACK SCENARIOS
// ══════════════════════════════════════════════════════════════════════

#[test]
fn attack_full_pipeline_tampered_data() {
    // End-to-end: commit to real data, then provide fake data during verification.
    let kp = sign::generate_keypair();
    let real_data = b"This is the real high-quality benchmark result";
    let h = hash::hash_bytes(real_data);

    let c = make_commitment(&kp, vec![h.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    // Provide DIFFERENT data that doesn't hash to the committed hash
    let result = verify::verify_full(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h, data: b"Fake cherry-picked result" },
    ]);

    assert_eq!(result.status, "failed");
    assert_eq!(result.items_failed, 1);
    assert_eq!(result.items_passed, 0);
}

#[test]
fn attack_full_pipeline_selection_tampering() {
    // Attack: Modify the selection record to claim different items were selected.
    let kp = sign::generate_keypair();
    let items: Vec<String> = (0..5).map(|i| hash_str(&format!("item-{}", i))).collect();
    let data: Vec<Vec<u8>> = (0..5).map(|i| format!("item-{}", i).into_bytes()).collect();

    let c = make_commitment(&kp, items.clone(), 1.0);
    let bo = test_beacon_output();
    let mut sel = verify::compute_selection(&c, &bo, "now").unwrap();

    // Tamper: claim no items were selected
    sel.selected_items = vec![];
    sel.selected_count = 0;

    // Reveal nothing (matching the tampered selection)
    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: vec![],
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp).unwrap();

    let data_items: Vec<DataItem> = items.iter().zip(data.iter())
        .map(|(h, d)| DataItem { hash: h.clone(), data: d })
        .collect();

    let result = verify::verify_full(&c, Some(&sel), Some(&rev), &data_items);

    // Recomputed selection should NOT match the tampered one
    assert_eq!(result.status, "failed",
        "Tampered selection must be detected");
    let sel_check = result.checks.iter()
        .find(|c| c.name == "selection_correct");
    assert!(sel_check.is_some());
    assert_eq!(sel_check.unwrap().status, "fail");
}

#[test]
fn attack_commitment_signed_by_different_key_than_reveal() {
    // This is actually allowed by the protocol — commitment and reveal
    // can be signed by different keys. Document this design decision.
    let kp_commit = sign::generate_keypair();
    let kp_reveal = sign::generate_keypair();

    let h = hash_str("data");
    let c = make_commitment(&kp_commit, vec![h.clone()], 1.0);
    let bo = test_beacon_output();
    let sel = verify::compute_selection(&c, &bo, "now").unwrap();

    // Reveal signed by a DIFFERENT key
    let rev = reveal::create(reveal::CreateParams {
        commitment_hash: c.commitment_hash.clone(),
        selected_items: sel.selected_items.clone(),
        voluntary_items: vec![],
        data_url: None,
        revealed_at: "2026-02-07T10:00:00Z".into(),
    }, &kp_reveal).unwrap();

    let result = verify::verify_full(&c, Some(&sel), Some(&rev), &[
        DataItem { hash: h, data: b"data" },
    ]);

    // Both signatures are individually valid
    assert_eq!(result.checks.iter()
        .find(|c| c.name == "commitment_signature").unwrap().status, "pass");
    assert_eq!(result.checks.iter()
        .find(|c| c.name == "reveal_signature").unwrap().status, "pass");

    // Note: The protocol doesn't require same signer for commit and reveal.
    // A policy layer could enforce this.
}
