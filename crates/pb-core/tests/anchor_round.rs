//! `beacon.anchor_round` (Spec Section 8.1.1): signing payload, backward
//! compatibility of unanchored commitments, and verifier checks.

use ed25519_dalek::SigningKey;
use pb_core::beacon::anchor::{self, ANCHOR_SELECTION_DELAY};
use pb_core::beacon::{drand, BeaconOutput, BeaconRef};
use pb_core::commitment::{self, Commitment, CreateParams};
use pb_core::sign;
use pb_core::verify::{self, CHECK_ANCHOR_REGISTRATION_TIME, CHECK_ANCHOR_SELECTION_ROUND};

// RFC 8032 section 7.1 test 1 secret key.
const TEST_KEY: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ANCHOR: u64 = 25_892_262;

// Spec Section 13.6: produced by the implementation before anchor_round existed.
const VECTOR_HASH: &str = "39b23208e0f65e4e2e5c0cd52e7eacb26047aaf9b4d89bb1280c3b78a21b33ac";
const VECTOR_SIGNATURE: &str = "5516f721b6f71554c8bacc6b3458a2427db9fd4d2367a0722e6fa2e08366e1c59cc1aba2cec6563a61a80026a58b155746951b3e74fb662a3891dde4994aaa07";
const VECTOR_PAYLOAD: &str = r#"{"spec_version":"0.2.0","items":["2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8","32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"],"item_count":2,"reveal_probability":0.1,"beacon":{"type":"drand","chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"}"#;

// Spec Section 13.7: the same commitment with anchor_round = 25892262.
const ANCHORED_VECTOR_HASH: &str = "d3e6d24523acbbae6c586378da650bbcf2b3419974a938e7fa3aeb5051d9a59b";
const ANCHORED_VECTOR_SIGNATURE: &str = "f52fd33cdedd906ba795aa06fe13e7b944bac5506d058846eae8407cbfa2c9dc452695f57c06035f8175bda4809a4bb2a96893de6b8ec48dc641984a570f5e07";

fn test_kp() -> sign::KeyPair {
    let bytes: [u8; 32] = hex::decode(TEST_KEY).unwrap().try_into().unwrap();
    let signing_key = SigningKey::from_bytes(&bytes);
    let verifying_key = signing_key.verifying_key();
    sign::KeyPair { did_key: sign::encode_did_key(&verifying_key), signing_key, verifying_key }
}

fn vector_commitment(beacon: BeaconRef) -> Commitment {
    commitment::create(CreateParams {
        items: vec![
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8".into(),
            "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2".into(),
        ],
        reveal_probability: 0.10,
        beacon,
        metadata: None,
        stream_id: None,
        committed_at: "2026-02-06T14:30:00Z".into(),
        identity: None,
    }, &test_kp()).unwrap()
}

fn beacon_output(round: u64) -> BeaconOutput {
    BeaconOutput {
        beacon_type: "drand".into(),
        chain_hash: Some(drand::QUICKNET_CHAIN_HASH.into()),
        round: Some(round),
        randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6".into(),
        signature: "abc".into(),
    }
}

/// RFC 3339 timestamp `offset_ms` away from the start of `round`.
fn at(round: u64, offset_ms: i64) -> String {
    let ms = anchor::round_time_ms(round).unwrap() + offset_ms;
    let (secs, millis) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since epoch.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600, rem % 3600 / 60, rem % 60)
}

fn check<'a>(result: &'a verify::VerifyResult, name: &str) -> Option<&'a verify::CheckResult> {
    result.checks.iter().find(|c| c.name == name)
}

// ── Backward compatibility ──

#[test]
fn unanchored_vector_hash_and_signature_unchanged() {
    let c = vector_commitment(BeaconRef::drand_quicknet());
    assert_eq!(String::from_utf8(commitment::signing_payload(&c)).unwrap(), VECTOR_PAYLOAD);
    assert_eq!(c.commitment_hash, VECTOR_HASH);
    assert_eq!(c.signature, VECTOR_SIGNATURE);
    assert!(commitment::verify_signature(&c).is_ok());
}

#[test]
fn unanchored_payload_omits_anchor_round() {
    let c = vector_commitment(BeaconRef::drand_quicknet());
    let payload = String::from_utf8(commitment::signing_payload(&c)).unwrap();
    assert!(!payload.contains("anchor_round"));
    assert!(!payload.contains("null"));
    let full = serde_json::to_string(&c).unwrap();
    assert!(!full.contains("anchor_round"));
}

#[test]
fn stored_unanchored_commitment_still_verifies() {
    // A commitment serialized before the field existed.
    let json = format!(
        r#"{{"spec_version":"0.2.0","commitment_hash":"{VECTOR_HASH}","items":["2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8","32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"],"item_count":2,"reveal_probability":0.1,"beacon":{{"type":"drand","chain_hash":"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"}},"metadata":{{}},"committed_at":"2026-02-06T14:30:00Z","signing_key":"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw","signature":"{VECTOR_SIGNATURE}"}}"#
    );
    let c: Commitment = serde_json::from_str(&json).unwrap();
    assert_eq!(c.beacon.anchor_round, None);
    assert!(commitment::verify_signature(&c).is_ok());
}

#[test]
fn null_anchor_round_is_absent() {
    let beacon: BeaconRef = serde_json::from_str(
        r#"{"type":"drand","anchor_round":null,"chain_hash":"abc"}"#).unwrap();
    assert_eq!(beacon.anchor_round, None);
    assert_eq!(serde_json::to_string(&beacon).unwrap(), r#"{"type":"drand","chain_hash":"abc"}"#);
}

// ── Anchored signing payload ──

#[test]
fn anchored_vector() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let payload = String::from_utf8(commitment::signing_payload(&c)).unwrap();
    let expected = VECTOR_PAYLOAD.replace(
        r#""beacon":{"type":"drand","#,
        r#""beacon":{"type":"drand","anchor_round":25892262,"#,
    );
    assert_eq!(payload, expected);
    assert_eq!(c.commitment_hash, ANCHORED_VECTOR_HASH);
    assert_eq!(c.signature, ANCHORED_VECTOR_SIGNATURE);
    assert_ne!(c.commitment_hash, VECTOR_HASH);
    assert!(commitment::verify_signature(&c).is_ok());
}

#[test]
fn anchored_commitment_roundtrips_through_json() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let parsed: Commitment = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
    assert_eq!(parsed.beacon.anchor_round, Some(ANCHOR));
    assert!(commitment::verify_signature(&parsed).is_ok());
}

#[test]
fn anchor_round_is_signed() {
    let mut c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    c.beacon.anchor_round = Some(ANCHOR + 1);
    assert!(commitment::verify_signature(&c).is_err(), "changed anchor must fail");

    let mut c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    c.beacon.anchor_round = None;
    assert!(commitment::verify_signature(&c).is_err(), "stripped anchor must fail");

    let mut c = vector_commitment(BeaconRef::drand_quicknet());
    c.beacon.anchor_round = Some(ANCHOR);
    assert!(commitment::verify_signature(&c).is_err(), "added anchor must fail");
}

#[test]
fn anchor_round_rejects_non_integers() {
    for bad in [r#""5""#, "1.5", "-1", "true", "18446744073709551616"] {
        let json = format!(r#"{{"type":"drand","anchor_round":{bad}}}"#);
        assert!(serde_json::from_str::<BeaconRef>(&json).is_err(), "{bad}");
    }
}

// ── Verifier ──

#[test]
fn verifier_passes_anchored_receipt() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let sel = verify::compute_selection(&c, &beacon_output(ANCHOR + ANCHOR_SELECTION_DELAY), "t").unwrap();
    let registered_at = at(ANCHOR, 1_500);

    let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some(&registered_at));
    assert_eq!(result.status, "verified");
    assert_eq!(check(&result, CHECK_ANCHOR_SELECTION_ROUND).unwrap().status, "pass");
    assert_eq!(check(&result, CHECK_ANCHOR_REGISTRATION_TIME).unwrap().status, "pass");
}

#[test]
fn verifier_fails_wrong_selection_round() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let registered_at = at(ANCHOR, 1_500);

    for round in [ANCHOR, ANCHOR + 1, ANCHOR + 3] {
        let sel = verify::compute_selection(&c, &beacon_output(round), "t").unwrap();
        let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some(&registered_at));
        assert_eq!(result.status, "failed", "round {round}");
        assert_eq!(check(&result, CHECK_ANCHOR_SELECTION_ROUND).unwrap().status, "fail");
    }
}

#[test]
fn verifier_fails_missing_selection_round() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let mut output = beacon_output(ANCHOR + 2);
    output.round = None;
    let sel = verify::compute_selection(&c, &output, "t").unwrap();
    let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some(&at(ANCHOR, 0)));
    assert_eq!(result.status, "failed");
    assert_eq!(check(&result, CHECK_ANCHOR_SELECTION_ROUND).unwrap().status, "fail");
}

#[test]
fn verifier_fails_registration_at_or_after_selection_round() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let sel = verify::compute_selection(&c, &beacon_output(ANCHOR + 2), "t").unwrap();

    for registered_at in [at(ANCHOR + 2, 0), at(ANCHOR + 2, 1), at(ANCHOR + 50, 0)] {
        let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some(&registered_at));
        assert_eq!(result.status, "failed", "{registered_at}");
        assert_eq!(check(&result, CHECK_ANCHOR_SELECTION_ROUND).unwrap().status, "pass");
        assert_eq!(check(&result, CHECK_ANCHOR_REGISTRATION_TIME).unwrap().status, "fail");
    }

    let just_before = at(ANCHOR + 2, -1);
    let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some(&just_before));
    assert_eq!(check(&result, CHECK_ANCHOR_REGISTRATION_TIME).unwrap().status, "pass");
}

#[test]
fn verifier_fails_unparseable_registered_at() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let sel = verify::compute_selection(&c, &beacon_output(ANCHOR + 2), "t").unwrap();
    let result = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some("yesterday"));
    assert_eq!(result.status, "failed");
    assert_eq!(check(&result, CHECK_ANCHOR_REGISTRATION_TIME).unwrap().status, "fail");
}

#[test]
fn verifier_without_registered_at_is_partial() {
    let c = vector_commitment(BeaconRef::drand_quicknet_anchored(ANCHOR));
    let sel = verify::compute_selection(&c, &beacon_output(ANCHOR + 2), "t").unwrap();
    let result = verify::verify_full(&c, Some(&sel), None, &[]);
    assert_eq!(result.status, "partial");
    assert_eq!(check(&result, CHECK_ANCHOR_SELECTION_ROUND).unwrap().status, "pass");
    assert_eq!(check(&result, CHECK_ANCHOR_REGISTRATION_TIME).unwrap().status, "skip");
}

#[test]
fn verifier_unanchored_behavior_unchanged() {
    let c = vector_commitment(BeaconRef::drand_quicknet());
    let sel = verify::compute_selection(&c, &beacon_output(1), "t").unwrap();

    let plain = verify::verify_full(&c, Some(&sel), None, &[]);
    let with_time = verify::verify_full_with_registration(&c, Some(&sel), None, &[], Some("garbage"));
    for result in [&plain, &with_time] {
        assert_eq!(result.status, "verified");
        assert!(check(result, CHECK_ANCHOR_SELECTION_ROUND).is_none());
        assert!(check(result, CHECK_ANCHOR_REGISTRATION_TIME).is_none());
        let names: Vec<&str> = result.checks.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["commitment_signature", "beacon_authentic", "selection_correct"]);
    }
}

#[test]
fn verifier_fails_unusable_anchor() {
    let checks = verify::check_anchor(0, Some(2), Some("2026-02-06T14:30:00Z"));
    assert!(checks.iter().all(|c| c.status == "fail"));
    let checks = verify::check_anchor(u64::MAX, Some(1), None);
    assert!(checks.iter().all(|c| c.status == "fail"));
}

#[test]
fn timestamp_helper_roundtrips() {
    let ts = at(ANCHOR, 250);
    assert_eq!(anchor::parse_rfc3339_ms(&ts), Some(anchor::round_time_ms(ANCHOR).unwrap() + 250));
}

// ── Spec Section 13.8 ──

#[test]
fn spec_13_8_registration_table() {
    use anchor::AnchorRejection::{AnchorInFuture, SelectionRoundAvailable};
    assert_eq!(drand::round_time(ANCHOR), 1_770_480_150);
    assert_eq!(anchor::parse_rfc3339_ms("2026-02-07T16:02:30Z"), anchor::round_time_ms(ANCHOR));

    let rows = [
        ("2026-02-07T16:02:28.999Z", Err(AnchorInFuture)),
        ("2026-02-07T16:02:29.000Z", Ok(ANCHOR + 2)),
        ("2026-02-07T16:02:32.800Z", Ok(ANCHOR + 2)),
        ("2026-02-07T16:02:33.200Z", Ok(ANCHOR + 2)),
        ("2026-02-07T16:02:34.999Z", Ok(ANCHOR + 2)),
        ("2026-02-07T16:02:35.000Z", Err(SelectionRoundAvailable)),
        ("2026-02-07T16:02:36.000Z", Err(SelectionRoundAvailable)),
    ];
    for (registered_at, expected) in rows {
        let ms = anchor::parse_rfc3339_ms(registered_at).unwrap();
        assert_eq!(anchor::check_registration(ANCHOR, ms), expected, "{registered_at}");
    }
}

#[test]
fn spec_13_8_verifier_table() {
    let rows = [
        (ANCHOR + 2, Some("2026-02-07T16:02:31.500Z"), "pass", "pass"),
        (ANCHOR + 1, Some("2026-02-07T16:02:31.500Z"), "fail", "pass"),
        (ANCHOR + 2, Some("2026-02-07T16:02:36.000Z"), "pass", "fail"),
        (ANCHOR + 2, None, "pass", "skip"),
    ];
    for (round, registered_at, round_status, time_status) in rows {
        let checks = verify::check_anchor(ANCHOR, Some(round), registered_at);
        assert_eq!(checks[0].name, CHECK_ANCHOR_SELECTION_ROUND);
        assert_eq!(checks[0].status, round_status, "{round} {registered_at:?}");
        assert_eq!(checks[1].name, CHECK_ANCHOR_REGISTRATION_TIME);
        assert_eq!(checks[1].status, time_status, "{round} {registered_at:?}");
    }
}
