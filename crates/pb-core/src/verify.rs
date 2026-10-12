//! Offline verification pipeline (Spec Section 6.4).

use serde::{Serialize, Deserialize};
use crate::beacon::{anchor, drand, BeaconOutput, BeaconRef};
use crate::commitment::{self, Commitment};
use crate::reveal::{self, Reveal};
use crate::select;
use crate::hash;

/// Selection record produced after beacon fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRecord {
    pub commitment_hash: String,
    pub beacon_output: BeaconOutput,
    pub selection_mode: String,
    pub reveal_probability: f64,
    pub selected_items: Vec<String>,
    pub selected_count: usize,
    pub total_count: usize,
    pub computed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub name: String,
    /// "pass", "fail", "skip" (could not be run; result is at most "partial"),
    /// or "warn" (noted for the relying party; does not change the result).
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyResult {
    pub status: String, // "verified", "failed", "partial"
    pub checks: Vec<CheckResult>,
    pub items_checked: usize,
    pub items_passed: usize,
    pub items_failed: usize,
    pub items_missing: usize,
}

impl VerifyResult {
    fn new() -> Self {
        VerifyResult {
            status: "verified".into(),
            checks: vec![],
            items_checked: 0,
            items_passed: 0,
            items_failed: 0,
            items_missing: 0,
        }
    }
    fn add(&mut self, name: &str, status: &str, detail: Option<String>) {
        self.checks.push(CheckResult {
            name: name.into(),
            status: status.into(),
            detail,
        });
    }
}

/// Data item: hash + actual bytes.
pub struct DataItem<'a> {
    pub hash: String,
    pub data: &'a [u8],
}

/// Recompute the selection for a commitment given a beacon output.
pub fn compute_selection(
    c: &Commitment,
    beacon_out: &BeaconOutput,
    computed_at: &str,
) -> Result<SelectionRecord, String> {
    let randomness = beacon_out.randomness_bytes()?;
    let (selected, mode) = select::select_auto(
        &randomness, &c.commitment_hash, &c.items, c.reveal_probability,
    )?;

    Ok(SelectionRecord {
        commitment_hash: c.commitment_hash.clone(),
        beacon_output: beacon_out.clone(),
        selection_mode: mode.into(),
        reveal_probability: c.reveal_probability,
        selected_items: selected,
        selected_count: 0, // filled below
        total_count: c.item_count,
        computed_at: computed_at.into(),
        server_key: None,
        server_signature: None,
    })
    .map(|mut sr| { sr.selected_count = sr.selected_items.len(); sr })
}

/// Check name: `randomness == SHA-256(signature)`.
pub const CHECK_BEACON_RANDOMNESS: &str = "beacon_randomness";
/// Check name: the beacon signature verifies under the chain's public key.
pub const CHECK_BEACON_AUTHENTIC: &str = "beacon_authentic";
/// Check name: selection used the first round after `registered_at`.
pub const CHECK_BEACON_AFTER_REGISTRATION: &str = "beacon_after_registration";

fn check(name: &str, status: &str, detail: Option<String>) -> CheckResult {
    CheckResult { name: name.into(), status: status.into(), detail }
}

/// Beacon checks (Spec Section 10.5, step 2) for the output used in a selection.
///
/// Implemented for drand quicknet. For any other beacon `beacon_authentic` is
/// reported as "skip". It is also "skip" when built without `drand-bls`.
pub fn check_beacon(beacon_ref: &BeaconRef, out: &BeaconOutput) -> Vec<CheckResult> {
    let same_chain = match (&beacon_ref.chain_hash, &out.chain_hash) {
        (Some(want), Some(got)) => want.eq_ignore_ascii_case(got),
        (Some(_), None) => false,
        (None, _) => true,
    };
    if out.beacon_type != beacon_ref.beacon_type || !same_chain {
        return vec![check(CHECK_BEACON_AUTHENTIC, "fail",
            Some("beacon output is not from the beacon named in the commitment".into()))];
    }
    let is_quicknet = beacon_ref.beacon_type == "drand"
        && beacon_ref.chain_hash.as_deref()
            .is_some_and(|h| h.eq_ignore_ascii_case(drand::QUICKNET_CHAIN_HASH));
    if !is_quicknet {
        let detail = match (beacon_ref.beacon_type.as_str(), &beacon_ref.chain_hash) {
            ("drand", None) => "commitment names no drand chain_hash".to_string(),
            ("drand", Some(chain)) => format!("no verifier for drand chain {chain}"),
            (other, _) => format!("no verifier for beacon type {other}"),
        };
        return vec![check(CHECK_BEACON_AUTHENTIC, "skip", Some(detail))];
    }

    let randomness = match drand::randomness_from_signature(&out.signature) {
        Ok(expected) if expected.eq_ignore_ascii_case(&out.randomness) =>
            check(CHECK_BEACON_RANDOMNESS, "pass", None),
        Ok(_) => check(CHECK_BEACON_RANDOMNESS, "fail",
            Some("randomness is not SHA-256(signature)".into())),
        Err(e) => check(CHECK_BEACON_RANDOMNESS, "fail", Some(e)),
    };

    #[cfg(feature = "drand-bls")]
    let authentic = match out.round {
        None => check(CHECK_BEACON_AUTHENTIC, "fail", Some("beacon output has no round".into())),
        Some(round) => match drand::verify_signature(round, &out.signature) {
            Ok(()) => check(CHECK_BEACON_AUTHENTIC, "pass", None),
            Err(e) => check(CHECK_BEACON_AUTHENTIC, "fail", Some(e)),
        },
    };
    #[cfg(not(feature = "drand-bls"))]
    let authentic = check(CHECK_BEACON_AUTHENTIC, "skip",
        Some("built without BLS verification (feature drand-bls)".into()));

    vec![randomness, authentic]
}

/// Timing check for a commitment without `anchor_round` (Spec Section 8.1):
/// the selection round is the first one strictly after `registered_at`,
/// taken at whole-second resolution as servers do. Reported as "skip" when
/// `registered_at` is not supplied.
pub fn check_registration_round(beacon_round: Option<u64>, registered_at: Option<&str>) -> CheckResult {
    let name = CHECK_BEACON_AFTER_REGISTRATION;
    let Some(ts) = registered_at else {
        return check(name, "skip", Some("registered_at not supplied".into()));
    };
    let Some(registered_ms) = anchor::parse_rfc3339_ms(ts) else {
        return check(name, "fail", Some(format!("cannot parse registered_at: {ts}")));
    };
    let expected = drand::next_round_after(registered_ms.div_euclid(1000));
    match beacon_round {
        Some(round) if round == expected => check(name, "pass", None),
        Some(round) if round < expected => check(name, "fail", Some(format!(
            "selection round {round} was already public at registered_at {ts}"))),
        Some(round) => check(name, "fail", Some(format!(
            "selection round {round} is not the first round after registered_at {ts}, want {expected}"))),
        None => check(name, "fail", Some(format!("selection beacon output has no round, want {expected}"))),
    }
}

/// Check name: the reveal names this commitment, only committed items, and
/// labels as selected only items that were selected.
pub const CHECK_REVEAL_MATCHES_COMMITMENT: &str = "reveal_matches_commitment";

/// Check name: the recorded `selection_mode` is the reference rule's mode.
pub const CHECK_SELECTION_MODE_DEFAULT: &str = "selection_mode_default";

/// Whether the recorded selection mode is the one the reference rule gives for
/// this item count. The threshold between the modes is a server setting that
/// the committer does not sign, so another mode is not an error. It is
/// reported as "warn": a server free to pick the mode has two candidate
/// selections for one beacon output.
pub fn check_selection_mode(selection_mode: &str, item_count: usize) -> CheckResult {
    let default_mode = select::selection_mode(item_count);
    if selection_mode == default_mode {
        check(CHECK_SELECTION_MODE_DEFAULT, "pass", None)
    } else {
        check(CHECK_SELECTION_MODE_DEFAULT, "warn", Some(format!(
            "receipt uses {selection_mode} selection; the reference rule gives {default_mode} for {item_count} items")))
    }
}

/// Check name: selection used round `anchor_round + ANCHOR_SELECTION_DELAY`.
pub const CHECK_ANCHOR_SELECTION_ROUND: &str = "anchor_selection_round";
/// Check name: `registered_at` precedes the selection round's time.
pub const CHECK_ANCHOR_REGISTRATION_TIME: &str = "anchor_registration_time";

/// Anchor checks for a commitment with `beacon.anchor_round` (Spec Section 10.5, step 2a).
///
/// - `anchor_selection_round`: the beacon round used for selection must equal
///   `anchor_round + ANCHOR_SELECTION_DELAY`.
/// - `anchor_registration_time`: `registered_at` must precede the time of that
///   round, otherwise the selection randomness was public at registration.
///   Reported as "skip" when `registered_at` is not supplied.
pub fn check_anchor(
    anchor_round: u64,
    beacon_round: Option<u64>,
    registered_at: Option<&str>,
) -> Vec<CheckResult> {
    let check = |name: &str, status: &str, detail: Option<String>| CheckResult {
        name: name.into(),
        status: status.into(),
        detail,
    };

    let Some(expected) = anchor::selection_round(anchor_round) else {
        let detail = format!("anchor_round {anchor_round} is not a usable round number");
        return vec![
            check(CHECK_ANCHOR_SELECTION_ROUND, "fail", Some(detail.clone())),
            check(CHECK_ANCHOR_REGISTRATION_TIME, "fail", Some(detail)),
        ];
    };

    let round_check = match beacon_round {
        Some(round) if round == expected => check(CHECK_ANCHOR_SELECTION_ROUND, "pass", None),
        Some(round) => check(CHECK_ANCHOR_SELECTION_ROUND, "fail", Some(format!(
            "selection used beacon round {round}, want anchor_round + {} = {expected}",
            anchor::ANCHOR_SELECTION_DELAY
        ))),
        None => check(CHECK_ANCHOR_SELECTION_ROUND, "fail",
            Some(format!("selection beacon output has no round, want {expected}"))),
    };

    let time_check = match registered_at {
        None => check(CHECK_ANCHOR_REGISTRATION_TIME, "skip",
            Some("registered_at not supplied".into())),
        Some(ts) => match (anchor::parse_rfc3339_ms(ts), anchor::round_time_ms(expected)) {
            (Some(registered_ms), Some(selection_ms)) if registered_ms < selection_ms =>
                check(CHECK_ANCHOR_REGISTRATION_TIME, "pass", None),
            (Some(_), Some(_)) => check(CHECK_ANCHOR_REGISTRATION_TIME, "fail", Some(format!(
                "registered_at {ts} does not precede selection round {expected}"
            ))),
            _ => check(CHECK_ANCHOR_REGISTRATION_TIME, "fail",
                Some(format!("cannot parse registered_at: {ts}"))),
        },
    };

    vec![round_check, time_check]
}

/// Full verification pipeline (Spec Section 6.4).
///
/// With a selection record the timing check is skipped because no
/// `registered_at` is supplied, and the result is at best "partial". Use
/// `verify_full_with_registration`.
pub fn verify_full(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    data: &[DataItem],
) -> VerifyResult {
    verify_full_with_registration(c, sel, rev, data, None)
}

/// Full verification pipeline with the server-attested `registered_at`
/// (RFC 3339) from the receipt.
pub fn verify_full_with_registration(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    data: &[DataItem],
    registered_at: Option<&str>,
) -> VerifyResult {
    let mut result = VerifyResult::new();

    // Step 1: Verify commitment signature.
    match commitment::verify_signature(c) {
        Ok(()) => result.add("commitment_signature", "pass", None),
        Err(e) => {
            result.add("commitment_signature", "fail", Some(e));
            result.status = "failed".into();
        }
    }

    // Step 2: Beacon output is authentic.
    let mut unchecked = false;
    if let Some(sel) = sel {
        let mut checks = check_beacon(&c.beacon, &sel.beacon_output);
        // Step 2a: the selection round is the one the commitment was bound to.
        match c.beacon.anchor_round {
            Some(anchor_round) =>
                checks.extend(check_anchor(anchor_round, sel.beacon_output.round, registered_at)),
            None if c.beacon.beacon_type == "drand" =>
                checks.push(check_registration_round(sel.beacon_output.round, registered_at)),
            None => {}
        }
        for check in checks {
            match check.status.as_str() {
                "fail" => result.status = "failed".into(),
                "skip" => unchecked = true,
                _ => {}
            }
            result.checks.push(check);
        }
    }

    // Step 3: Verify selection.
    if let Some(sel) = sel.filter(|sel| sel.commitment_hash != c.commitment_hash) {
        result.add("selection_correct", "fail", Some(format!(
            "selection record is for commitment {}", sel.commitment_hash)));
        result.status = "failed".into();
    } else if let Some(sel) = sel {
        result.checks.push(check_selection_mode(&sel.selection_mode, c.items.len()));
        match sel.beacon_output.randomness_bytes() {
            Ok(randomness) => {
                // The per-item / batch threshold is a deployment setting, so the
                // mode comes from the selection record (Spec Section 8.4).
                let recomputed = match sel.selection_mode.as_str() {
                    "per_item" => Ok(select::select_per_item_batch(
                        &randomness, &c.commitment_hash, &c.items, c.reveal_probability)),
                    "batch" => select::select_batch_by_probability(
                        &c.items, &randomness, c.reveal_probability),
                    other => Err(format!("unknown selection_mode: {other}")),
                };
                match recomputed {
                    Ok(recomputed) => {
                        if recomputed == sel.selected_items {
                            result.add("selection_correct", "pass", None);
                        } else {
                            result.add("selection_correct", "fail",
                                Some("recomputed selection does not match".into()));
                            result.status = "failed".into();
                        }
                    }
                    Err(e) => {
                        result.add("selection_correct", "fail", Some(e));
                        result.status = "failed".into();
                    }
                }
            }
            Err(e) => {
                result.add("selection_correct", "fail", Some(e));
                result.status = "failed".into();
            }
        }
    }

    // Step 4: Verify reveal signature.
    if let Some(rev) = rev {
        match reveal::verify_signature(rev) {
            Ok(()) => result.add("reveal_signature", "pass", None),
            Err(e) => {
                result.add("reveal_signature", "fail", Some(e));
                result.status = "failed".into();
            }
        }
    }

    // Step 4a: The reveal is about this commitment and its items.
    if let Some(rev) = rev {
        let committed: std::collections::HashSet<&str> = c.items.iter().map(|s| s.as_str()).collect();
        let uncommitted = rev.selected_items.iter().chain(rev.voluntary_items.iter())
            .filter(|h| !committed.contains(h.as_str()))
            .count();
        let not_selected = sel.map_or(0, |sel| rev.selected_items.iter()
            .filter(|h| !sel.selected_items.contains(h))
            .count());
        let problem = if rev.commitment_hash != c.commitment_hash {
            Some(format!("reveal is for commitment {}", rev.commitment_hash))
        } else if uncommitted > 0 {
            Some(format!("{uncommitted} revealed items are not in the commitment"))
        } else if not_selected > 0 {
            Some(format!("{not_selected} items are listed as selected but were not selected"))
        } else {
            None
        };
        match problem {
            None => result.add(CHECK_REVEAL_MATCHES_COMMITMENT, "pass", None),
            Some(detail) => {
                result.add(CHECK_REVEAL_MATCHES_COMMITMENT, "fail", Some(detail));
                result.status = "failed".into();
            }
        }
    }

    // Step 5: Verify data integrity.
    let data_map: std::collections::HashMap<&str, &[u8]> =
        data.iter().map(|d| (d.hash.as_str(), d.data)).collect();

    if let Some(rev) = rev {
        let all_items: Vec<&str> = rev.selected_items.iter()
            .chain(rev.voluntary_items.iter())
            .map(|s| s.as_str())
            .collect();

        for item_hash in &all_items {
            result.items_checked += 1;
            match data_map.get(item_hash) {
                Some(bytes) => {
                    let computed = hash::hash_bytes(bytes);
                    if computed == *item_hash {
                        result.items_passed += 1;
                    } else {
                        result.items_failed += 1;
                    }
                }
                None => {
                    result.items_missing += 1;
                }
            }
        }

        if result.items_failed > 0 {
            result.add("data_integrity", "fail",
                Some(format!("{}/{} items failed hash check", result.items_failed, result.items_checked)));
            result.status = "failed".into();
        } else if result.items_missing > 0 {
            result.add("data_integrity", "fail",
                Some(format!("{}/{} items missing data", result.items_missing, result.items_checked)));
            if result.status != "failed" { result.status = "partial".into(); }
        } else if result.items_checked > 0 {
            result.add("data_integrity", "pass",
                Some(format!("{}/{} items verified", result.items_passed, result.items_checked)));
        }
    }

    // Step 6: Check completeness.
    if let (Some(sel), Some(rev)) = (sel, rev) {
        let revealed: std::collections::HashSet<&str> =
            rev.selected_items.iter().map(|s| s.as_str()).collect();
        let missing: usize = sel.selected_items.iter()
            .filter(|h| !revealed.contains(h.as_str()))
            .count();

        if missing > 0 {
            result.add("completeness", "fail",
                Some(format!("{}/{} selected items not revealed", missing, sel.selected_items.len())));
            if result.status != "failed" { result.status = "partial".into(); }
        } else {
            result.add("completeness", "pass",
                Some(format!("all {} selected items revealed", sel.selected_items.len())));
        }
    }

    // A selection whose beacon or timing could not be checked is not fully verified.
    if unchecked && result.status == "verified" {
        result.status = "partial".into();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sign;
    use crate::beacon::BeaconRef;

    // Real quicknet round 1000, scheduled at 2023-08-23T15:59:24Z.
    const REGISTERED_BEFORE_ROUND_1000: &str = "2023-08-23T15:59:23.400Z";

    fn test_beacon_output() -> BeaconOutput {
        BeaconOutput {
            beacon_type: "drand".into(),
            chain_hash: Some(crate::beacon::drand::QUICKNET_CHAIN_HASH.into()),
            round: Some(1000),
            randomness: "fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd".into(),
            signature: "b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39".into(),
        }
    }

    /// Best status a selection can reach: without BLS the beacon check is skipped.
    const CHECKED: &str = if cfg!(feature = "drand-bls") { "verified" } else { "partial" };

    fn status_of<'a>(result: &'a VerifyResult, name: &str) -> &'a str {
        result.checks.iter().find(|c| c.name == name)
            .map(|c| c.status.as_str()).unwrap_or("absent")
    }

    /// Receipt-level verification of a one-item commitment with the given beacon output.
    fn verify_selection(bo: &BeaconOutput, registered_at: Option<&str>) -> VerifyResult {
        let kp = sign::generate_keypair();
        let c = make_commitment(&kp, vec![hash::hash_bytes(b"data")], 1.0);
        let sel = compute_selection(&c, bo, "now").unwrap();
        verify_full_with_registration(&c, Some(&sel), None, &[], registered_at)
    }

    fn make_commitment(kp: &sign::KeyPair, items: Vec<String>, prob: f64) -> Commitment {
        commitment::create(commitment::CreateParams {
            items,
            reveal_probability: prob,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, kp).unwrap()
    }

    #[test]
    fn full_verify_success() {
        let kp = sign::generate_keypair();
        let data1 = b"test data item 1";
        let data2 = b"test data item 2";
        let h1 = hash::hash_bytes(data1);
        let h2 = hash::hash_bytes(data2);

        let c = make_commitment(&kp, vec![h1.clone(), h2.clone()], 1.0);
        let bo = test_beacon_output();
        let sel = compute_selection(&c, &bo, "2026-02-06T14:30:03Z").unwrap();

        let rev = reveal::create(reveal::CreateParams {
            commitment_hash: c.commitment_hash.clone(),
            selected_items: sel.selected_items.clone(),
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).unwrap();

        let result = verify_full_with_registration(&c, Some(&sel), Some(&rev), &[
            DataItem { hash: h1, data: data1 },
            DataItem { hash: h2, data: data2 },
        ], Some(REGISTERED_BEFORE_ROUND_1000));

        assert_eq!(result.status, CHECKED);
        assert_eq!(result.items_passed, 2);
        assert_eq!(result.items_failed, 0);
    }

    #[test]
    fn tampered_commitment() {
        let kp = sign::generate_keypair();
        let h = hash::hash_bytes(b"data");
        let mut c = make_commitment(&kp, vec![h], 1.0);
        c.reveal_probability = 0.5;

        let result = verify_full(&c, None, None, &[]);
        assert_eq!(result.status, "failed");
    }

    #[test]
    fn wrong_data() {
        let kp = sign::generate_keypair();
        let h = hash::hash_bytes(b"original");
        let c = make_commitment(&kp, vec![h.clone()], 1.0);
        let bo = test_beacon_output();
        let sel = compute_selection(&c, &bo, "now").unwrap();

        let rev = reveal::create(reveal::CreateParams {
            commitment_hash: c.commitment_hash.clone(),
            selected_items: sel.selected_items.clone(),
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "now".into(),
        }, &kp).unwrap();

        let result = verify_full(&c, Some(&sel), Some(&rev), &[
            DataItem { hash: h, data: b"tampered" },
        ]);
        assert_eq!(result.status, "failed");
        assert_eq!(result.items_failed, 1);
    }

    #[test]
    fn selection_deterministic() {
        let kp = sign::generate_keypair();
        let h = hash::hash_bytes(b"data");
        let c = make_commitment(&kp, vec![h], 0.10);
        let bo = test_beacon_output();

        let sel1 = compute_selection(&c, &bo, "t1").unwrap();
        let sel2 = compute_selection(&c, &bo, "t2").unwrap();
        assert_eq!(sel1.selected_items, sel2.selected_items);
    }

    #[test]
    fn beacon_checks_pass_for_real_round() {
        let result = verify_selection(&test_beacon_output(), Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, CHECKED);
        assert_eq!(status_of(&result, CHECK_BEACON_RANDOMNESS), "pass");
        assert_eq!(status_of(&result, CHECK_BEACON_AFTER_REGISTRATION), "pass");
        #[cfg(feature = "drand-bls")]
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "pass");
    }

    #[test]
    fn chosen_randomness_is_rejected() {
        let mut bo = test_beacon_output();
        bo.randomness = "00".repeat(32);
        let result = verify_selection(&bo, Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_BEACON_RANDOMNESS), "fail");
    }

    // Randomness consistent with a signature the beacon never produced.
    #[cfg(feature = "drand-bls")]
    #[test]
    fn forged_signature_is_rejected() {
        let mut bo = test_beacon_output();
        bo.signature = "ab".repeat(48);
        bo.randomness = drand::randomness_from_signature(&bo.signature).unwrap();
        let result = verify_selection(&bo, Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_BEACON_RANDOMNESS), "pass");
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "fail");
    }

    // A genuine output presented under another round number.
    #[cfg(feature = "drand-bls")]
    #[test]
    fn signature_of_another_round_is_rejected() {
        let mut bo = test_beacon_output();
        bo.round = Some(1001);
        let result = verify_selection(&bo, Some("2023-08-23T15:59:26Z"));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "fail");
    }

    #[test]
    fn beacon_of_another_chain_is_rejected() {
        let mut bo = test_beacon_output();
        bo.chain_hash = Some("00".repeat(32));
        let result = verify_selection(&bo, Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "fail");
    }

    #[test]
    fn registration_round_boundaries() {
        let bo = test_beacon_output();
        let cases = [
            ("2023-08-23T15:59:21Z", "pass"),      // previous tick: round 1000 is next
            ("2023-08-23T15:59:23.999Z", "pass"),
            ("2023-08-23T15:59:24Z", "fail"),      // round 1000 is public at this instant
            ("2023-08-23T17:59:30+02:00", "fail"), // registered after the round
            ("2023-08-23T15:59:20.999Z", "fail"),  // round 999 was the first one after
            ("not a time", "fail"),
        ];
        for (registered_at, want) in cases {
            let result = verify_selection(&bo, Some(registered_at));
            assert_eq!(status_of(&result, CHECK_BEACON_AFTER_REGISTRATION), want, "{registered_at}");
            assert_eq!(result.status, if want == "pass" { CHECKED } else { "failed" }, "{registered_at}");
        }
    }

    #[test]
    fn missing_registered_at_is_partial() {
        let result = verify_selection(&test_beacon_output(), None);
        assert_eq!(status_of(&result, CHECK_BEACON_AFTER_REGISTRATION), "skip");
        assert_eq!(result.status, "partial");
    }

    #[test]
    fn selection_is_recomputed_in_the_recorded_mode() {
        let kp = sign::generate_keypair();
        let items: Vec<String> = (0..5u8).map(|i| hash::hash_bytes(&[i])).collect();
        let c = make_commitment(&kp, items, 0.5);
        let bo = test_beacon_output();
        let randomness = bo.randomness_bytes().unwrap();
        let mut sel = compute_selection(&c, &bo, "now").unwrap();
        let verify = |sel: &SelectionRecord| status_of(
            &verify_full_with_registration(&c, Some(sel), None, &[], Some(REGISTERED_BEFORE_ROUND_1000)),
            "selection_correct").to_string();

        assert_eq!(sel.selection_mode, "batch");
        assert_eq!(verify(&sel), "pass");

        // A server configured for per-item selection of small commitments.
        sel.selection_mode = "per_item".into();
        assert_eq!(verify(&sel), "fail", "batch result presented as per-item");
        sel.selected_items = select::select_per_item_batch(
            &randomness, &c.commitment_hash, &c.items, c.reveal_probability);
        assert_eq!(verify(&sel), "pass");

        sel.selection_mode = "favorite".into();
        assert_eq!(verify(&sel), "fail");
    }

    #[test]
    fn selection_of_another_commitment_is_rejected() {
        let kp = sign::generate_keypair();
        let c = make_commitment(&kp, vec![hash::hash_bytes(b"data")], 1.0);
        let mut sel = compute_selection(&c, &test_beacon_output(), "now").unwrap();
        sel.commitment_hash = "00".repeat(32);
        let result = verify_full_with_registration(&c, Some(&sel), None, &[], Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, "selection_correct"), "fail");
    }

    #[test]
    fn non_default_selection_mode_is_reported_not_failed() {
        let kp = sign::generate_keypair();
        let items: Vec<String> = (0..5u8).map(|i| hash::hash_bytes(&[i])).collect();
        let c = make_commitment(&kp, items, 0.5);
        let bo = test_beacon_output();
        let mut sel = compute_selection(&c, &bo, "now").unwrap();
        let run = |sel: &SelectionRecord|
            verify_full_with_registration(&c, Some(sel), None, &[], Some(REGISTERED_BEFORE_ROUND_1000));

        let result = run(&sel);
        assert_eq!(status_of(&result, CHECK_SELECTION_MODE_DEFAULT), "pass");
        assert_eq!(result.status, CHECKED);

        sel.selection_mode = "per_item".into();
        sel.selected_items = select::select_per_item_batch(
            &bo.randomness_bytes().unwrap(), &c.commitment_hash, &c.items, c.reveal_probability);
        let result = run(&sel);
        assert_eq!(status_of(&result, CHECK_SELECTION_MODE_DEFAULT), "warn");
        assert_eq!(status_of(&result, "selection_correct"), "pass");
        assert_eq!(result.status, CHECKED);
    }

    #[test]
    fn beacon_edge_cases() {
        let ok = Some(REGISTERED_BEFORE_ROUND_1000);
        let upper = |s: &str| s.to_uppercase();

        // Hex case does not matter.
        let mut bo = test_beacon_output();
        bo.randomness = upper(&bo.randomness);
        bo.signature = upper(&bo.signature);
        bo.chain_hash = bo.chain_hash.map(|h| upper(&h));
        assert_eq!(verify_selection(&bo, ok).status, CHECKED);

        // Round missing, zero, or absurd.
        for round in [None, Some(0), Some(u64::MAX)] {
            let mut bo = test_beacon_output();
            bo.round = round;
            assert_eq!(verify_selection(&bo, ok).status, "failed", "{round:?}");
        }

        // Output without a chain hash cannot be tied to the commitment's chain.
        let mut bo = test_beacon_output();
        bo.chain_hash = None;
        let result = verify_selection(&bo, ok);
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "fail");

        // Equivalent spellings of the registration instant.
        for registered_at in ["2023-08-23T15:59:23.400+00:00", "2023-08-23T17:59:23.4+02:00"] {
            assert_eq!(verify_selection(&test_beacon_output(), Some(registered_at)).status, CHECKED, "{registered_at}");
        }
    }

    #[test]
    fn commitment_without_chain_hash_is_partial() {
        let kp = sign::generate_keypair();
        let beacon = BeaconRef { chain_hash: None, ..BeaconRef::drand_quicknet() };
        let c = commitment::create(commitment::CreateParams {
            items: vec![hash::hash_bytes(b"data")],
            reveal_probability: 1.0,
            beacon,
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp).unwrap();
        let sel = compute_selection(&c, &test_beacon_output(), "now").unwrap();
        let result = verify_full_with_registration(&c, Some(&sel), None, &[], Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(status_of(&result, CHECK_BEACON_AUTHENTIC), "skip");
        assert_eq!(result.status, "partial");
        let detail = result.checks.iter().find(|c| c.name == CHECK_BEACON_AUTHENTIC).unwrap().detail.clone().unwrap();
        assert!(detail.contains("chain_hash"), "{detail}");
    }
}
