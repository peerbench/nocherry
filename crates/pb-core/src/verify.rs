//! Offline verification pipeline (Spec v0.4 Section 10.5 for 0.2.0 objects,
//! Spec v0.5 Section 10.5 for 0.5.0 objects). The verifier dispatches on the
//! commitment's `spec_version`; the 0.2.0 path is unchanged.

use serde::{Serialize, Deserialize};
use crate::beacon::{anchor, drand, BeaconOutput, BeaconRef};
use crate::commitment::{self, Commitment};
use crate::reveal::{self, Reveal};
use crate::select;
use crate::select_v5;
use crate::sign;
use crate::hash;

/// Selection record produced after beacon fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRecord {
    pub commitment_hash: String,
    pub beacon_output: BeaconOutput,
    pub selection_mode: String,
    /// 0.2.0 records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_probability: Option<f64>,
    /// 0.5.0 records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_probability_ppm: Option<u64>,
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
    fn fail(&mut self, name: &str, detail: String) {
        self.add(name, "fail", Some(detail));
        self.status = "failed".into();
    }
    fn pass(&mut self, name: &str) {
        self.add(name, "pass", None);
    }
    fn partial(&mut self) {
        if self.status != "failed" { self.status = "partial".into(); }
    }
    /// Record a check and fold its status into the result.
    fn push(&mut self, check: CheckResult) {
        match check.status.as_str() {
            "fail" => self.status = "failed".into(),
            "skip" => self.partial(),
            _ => {}
        }
        self.checks.push(check);
    }
}

/// Data item: hash + actual bytes.
pub struct DataItem<'a> {
    pub hash: String,
    pub data: &'a [u8],
}

/// Recompute the selection for a commitment given a beacon output, in the
/// format and (for 0.5.0) the mode of the commitment.
pub fn compute_selection(
    c: &Commitment,
    beacon_out: &BeaconOutput,
    computed_at: &str,
) -> Result<SelectionRecord, String> {
    let randomness = beacon_out.randomness_bytes()?;
    let (selected, mode) = if c.is_v5() {
        commitment::validate_v5(c)?;
        let mode = c.selection_mode.clone().expect("validated");
        let ppm = c.reveal_probability_ppm.expect("validated") as u32;
        let hc = crate::item::decode_hash32(&c.commitment_hash, "commitment_hash")?;
        (select_v5::select(&mode, &randomness, &hc, &c.items, ppm)?, mode)
    } else {
        let p = c.reveal_probability.ok_or("0.2.0 commitment has no reveal_probability")?;
        let (selected, mode) = select::select_auto(&randomness, &c.commitment_hash, &c.items, p)?;
        (selected, mode.to_string())
    };

    Ok(SelectionRecord {
        commitment_hash: c.commitment_hash.clone(),
        beacon_output: beacon_out.clone(),
        selection_mode: mode,
        reveal_probability: if c.is_v5() { None } else { c.reveal_probability },
        reveal_probability_ppm: if c.is_v5() { c.reveal_probability_ppm } else { None },
        selected_count: selected.len(),
        selected_items: selected,
        total_count: c.item_count,
        computed_at: computed_at.into(),
        server_key: None,
        server_signature: None,
    })
}

/// Check name: the commitment's `spec_version` is one this verifier knows.
pub const CHECK_SPEC_VERSION: &str = "spec_version";
/// Check name: a 0.5.0 commitment satisfies Spec v0.5 Section 7.5.
pub const CHECK_COMMITMENT_WELLFORMED: &str = "commitment_wellformed";
/// Check name: `randomness == SHA-256(signature)`.
pub const CHECK_BEACON_RANDOMNESS: &str = "beacon_randomness";
/// Check name: the beacon signature verifies under the chain's public key.
pub const CHECK_BEACON_AUTHENTIC: &str = "beacon_authentic";
/// Check name: selection used the first round after `registered_at`.
pub const CHECK_BEACON_AFTER_REGISTRATION: &str = "beacon_after_registration";
/// Check name (0.5.0): the record's mode is the commitment's signed mode.
pub const CHECK_SELECTION_MODE: &str = "selection_mode";
/// Check name (0.5.0): every revealed item has a valid opening.
pub const CHECK_ITEM_OPENINGS: &str = "item_openings";

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
    let computed: std::collections::HashMap<String, String> = data.iter()
        .map(|d| (d.hash.clone(), hash::hash_bytes(d.data)))
        .collect();
    verify_full_with_hashes(c, sel, rev, &computed, registered_at)
}

/// Like `verify_full_with_registration`, for callers that hash the revealed
/// data themselves: `computed` maps each revealed item (the plain item hash in
/// 0.2.0, the item commitment in 0.5.0) to the hash the caller computed from
/// the data it holds (file bytes, or a directory manifest). An item without an
/// entry counts as missing data.
pub fn verify_full_with_hashes(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    computed: &std::collections::HashMap<String, String>,
    registered_at: Option<&str>,
) -> VerifyResult {
    match c.spec_version.as_str() {
        commitment::SPEC_VERSION => verify_v2(c, sel, rev, computed, registered_at),
        commitment::SPEC_VERSION_V5 => verify_v5(c, sel, rev, computed, registered_at),
        other => {
            let mut result = VerifyResult::new();
            result.fail(CHECK_SPEC_VERSION, format!("unsupported spec_version {other}; this verifier knows {}",
                commitment::SUPPORTED_SPEC_VERSIONS.join(", ")));
            result
        }
    }
}

/// The 0.2.0 pipeline (Spec v0.4 Section 10.5), unchanged.
fn verify_v2(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    computed: &std::collections::HashMap<String, String>,
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
        match (sel.beacon_output.randomness_bytes(), c.reveal_probability) {
            (Ok(randomness), Some(p)) => {
                // The per-item / batch threshold is a deployment setting, so the
                // mode comes from the selection record (Spec Section 8.4).
                let recomputed = match sel.selection_mode.as_str() {
                    "per_item" => Ok(select::select_per_item_batch(
                        &randomness, &c.commitment_hash, &c.items, p)),
                    "batch" => select::select_batch_by_probability(
                        &c.items, &randomness, p),
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
            (Err(e), _) => {
                result.add("selection_correct", "fail", Some(e));
                result.status = "failed".into();
            }
            (Ok(_), None) => {
                result.add("selection_correct", "fail", Some("0.2.0 commitment has no reveal_probability".into()));
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
    if let Some(rev) = rev {
        for item_hash in rev.selected_items.iter().chain(rev.voluntary_items.iter()) {
            result.items_checked += 1;
            match computed.get(item_hash) {
                Some(actual) if actual.eq_ignore_ascii_case(item_hash) => result.items_passed += 1,
                Some(_) => result.items_failed += 1,
                None => result.items_missing += 1,
            }
        }
        data_integrity_summary(&mut result);
    }

    // Step 6: Check completeness.
    if let (Some(sel), Some(rev)) = (sel, rev) {
        completeness(&mut result, sel, rev);
    }

    // A selection whose beacon or timing could not be checked is not fully verified.
    if unchecked && result.status == "verified" {
        result.status = "partial".into();
    }

    result
}

fn data_integrity_summary(result: &mut VerifyResult) {
    if result.items_failed > 0 {
        result.add("data_integrity", "fail",
            Some(format!("{}/{} items failed hash check", result.items_failed, result.items_checked)));
        result.status = "failed".into();
    } else if result.items_missing > 0 {
        result.add("data_integrity", "fail",
            Some(format!("{}/{} items missing data", result.items_missing, result.items_checked)));
        result.partial();
    } else if result.items_checked > 0 {
        result.add("data_integrity", "pass",
            Some(format!("{}/{} items verified", result.items_passed, result.items_checked)));
    }
}

fn completeness(result: &mut VerifyResult, sel: &SelectionRecord, rev: &Reveal) {
    let revealed: std::collections::HashSet<&str> =
        rev.selected_items.iter().map(|s| s.as_str()).collect();
    let missing: usize = sel.selected_items.iter()
        .filter(|h| !revealed.contains(h.as_str()))
        .count();

    if missing > 0 {
        result.add("completeness", "fail",
            Some(format!("{}/{} selected items not revealed", missing, sel.selected_items.len())));
        result.partial();
    } else {
        result.add("completeness", "pass",
            Some(format!("all {} selected items revealed", sel.selected_items.len())));
    }
}

/// The 0.5.0 pipeline (Spec v0.5 Section 10.5).
fn verify_v5(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    computed: &std::collections::HashMap<String, String>,
    registered_at: Option<&str>,
) -> VerifyResult {
    let mut result = VerifyResult::new();

    // Step 1: well formed. The remaining steps use the fields it checked, so a
    // malformed commitment also fails them; nothing else is attempted on it.
    let wellformed = match commitment::validate_v5(c) {
        Ok(()) => { result.pass(CHECK_COMMITMENT_WELLFORMED); true }
        Err(e) => { result.fail(CHECK_COMMITMENT_WELLFORMED, e); false }
    };

    // Step 2: committer signature and commitment hash.
    match commitment::verify_signature(c) {
        Ok(()) => result.pass("commitment_signature"),
        Err(e) => result.fail("commitment_signature", e),
    }

    if let Some(sel) = sel {
        // Steps 3 and 4: beacon output and anchor.
        for check in check_beacon(&c.beacon, &sel.beacon_output) {
            result.push(check);
        }
        match c.beacon.anchor_round {
            Some(anchor_round) => for check in check_anchor(anchor_round, sel.beacon_output.round, registered_at) {
                result.push(check);
            },
            None => {
                result.fail(CHECK_ANCHOR_SELECTION_ROUND, "0.5.0 commitment has no anchor_round".into());
                result.fail(CHECK_ANCHOR_REGISTRATION_TIME, "0.5.0 commitment has no anchor_round".into());
            }
        }

        // Step 5: the record uses the signed mode.
        let mode = c.selection_mode.clone().unwrap_or_default();
        if sel.selection_mode == mode {
            result.pass(CHECK_SELECTION_MODE);
        } else {
            result.fail(CHECK_SELECTION_MODE, format!(
                "selection record uses {} but the commitment signs {}", sel.selection_mode, mode));
        }

        // Step 6: recompute in the commitment's mode.
        if sel.commitment_hash != c.commitment_hash {
            result.fail("selection_correct", format!("selection record is for commitment {}", sel.commitment_hash));
        } else if !wellformed {
            result.fail("selection_correct", "commitment is malformed".into());
        } else {
            let recomputed = sel.beacon_output.randomness_bytes().and_then(|randomness| {
                let hc = crate::item::decode_hash32(&c.commitment_hash, "commitment_hash")?;
                let ppm = c.reveal_probability_ppm.expect("validated") as u32;
                select_v5::select(&mode, &randomness, &hc, &c.items, ppm)
            });
            match recomputed {
                Ok(items) if items == sel.selected_items => result.pass("selection_correct"),
                Ok(_) => result.fail("selection_correct", "recomputed selection does not match".into()),
                Err(e) => result.fail("selection_correct", e),
            }
        }
    }

    if let Some(rev) = rev {
        // Step 7: reveal signature over the reveal's own payload.
        let signed = match reveal::signing_payload(rev)
            .and_then(|payload| sign::verify(&rev.signing_key, &payload, &rev.signature)) {
            Ok(()) => { result.pass("reveal_signature"); true }
            Err(e) => { result.fail("reveal_signature", e); false }
        };

        // Step 8: the reveal is about this commitment and its items.
        let committed: std::collections::HashSet<&str> = c.items.iter().map(|s| s.as_str()).collect();
        let uncommitted = rev.revealed_items().filter(|h| !committed.contains(h.as_str())).count();
        let selected_set: std::collections::HashSet<&str> = rev.selected_items.iter().map(|s| s.as_str()).collect();
        let overlap = rev.voluntary_items.iter().filter(|h| selected_set.contains(h.as_str())).count();
        let not_selected = sel.map_or(0, |sel| rev.selected_items.iter()
            .filter(|h| !sel.selected_items.contains(h))
            .count());
        let problem = if rev.commitment_hash != c.commitment_hash {
            Some(format!("reveal is for commitment {}", rev.commitment_hash))
        } else if uncommitted > 0 {
            Some(format!("{uncommitted} revealed items are not in the commitment"))
        } else if overlap > 0 {
            Some(format!("{overlap} items are listed both as selected and as voluntary"))
        } else if not_selected > 0 {
            Some(format!("{not_selected} items are listed as selected but were not selected"))
        } else {
            None
        };
        match problem {
            None => result.pass(CHECK_REVEAL_MATCHES_COMMITMENT),
            Some(detail) => result.fail(CHECK_REVEAL_MATCHES_COMMITMENT, detail),
        }

        // Step 9: openings.
        let openings_ok = if !rev.is_v5() {
            result.fail(CHECK_ITEM_OPENINGS, format!(
                "reveal is format {}; a 0.5.0 commitment needs a 0.5.0 reveal with openings", rev.spec_version));
            false
        } else {
            match reveal::validate_v5(rev) {
                Ok(()) => { result.pass(CHECK_ITEM_OPENINGS); true }
                Err(e) => { result.fail(CHECK_ITEM_OPENINGS, e); false }
            }
        };
        let _ = signed;

        // Step 10: data integrity against the opened plain hashes.
        for item in rev.revealed_items() {
            result.items_checked += 1;
            let expected = if openings_ok { rev.opening_of(item).map(|o| o.hash.as_str()) } else { None };
            match (computed.get(item), expected) {
                (Some(actual), Some(want)) if actual.eq_ignore_ascii_case(want) => result.items_passed += 1,
                (Some(_), Some(_)) => result.items_failed += 1,
                (Some(_), None) => result.items_failed += 1,
                (None, _) => result.items_missing += 1,
            }
        }
        data_integrity_summary(&mut result);
    }

    // Step 11: completeness.
    if let (Some(sel), Some(rev)) = (sel, rev) {
        completeness(&mut result, sel, rev);
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
        c.reveal_probability = Some(0.5);

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
            &randomness, &c.commitment_hash, &c.items, c.reveal_probability.unwrap());
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
            &bo.randomness_bytes().unwrap(), &c.commitment_hash, &c.items, c.reveal_probability.unwrap());
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

    // ── 0.5.0 ──

    // Real quicknet rounds 25892263 to 25892265 (2026-02-07T16:02:33Z, 36Z, 39Z).
    fn round(n: u64) -> BeaconOutput {
        let (randomness, signature) = match n {
            25892263 => ("cb5e3ee37912e328e8497cef8e845e7ea5e12f23e679e993bc63427a8dbfecf5", "89d9074bd1ad018acd9b85fd99dba90b784fc9b62632f3b762cf7078c417e4c72895804e372e1a8cb201eb2c9e60a51d"),
            25892264 => ("5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108", "8f6c972e765d19007dd206108747b34e4caeb62e0e9c3cac48b2f60f7d53c61baa38b85c8a60b7b4cc41d757380724d8"),
            25892265 => ("981853163a6078ace4ab02d83913000181990ec0042b7de1752c31bb25fcd4c0", "a1b4b3885bbeaf23047dfd38ed5b64a9141e96de4f8de30b16be4fff9ff8a0eb6682a7cf95c26e9a035b1630728258d7"),
            _ => panic!("no fixture for round {n}"),
        };
        BeaconOutput {
            beacon_type: "drand".into(),
            chain_hash: Some(drand::QUICKNET_CHAIN_HASH.into()),
            round: Some(n),
            randomness: randomness.into(),
            signature: signature.into(),
        }
    }
    const ANCHOR: u64 = 25892262;
    const REGISTERED_OK: &str = "2026-02-07T16:02:31.500Z";

    fn rfc8032_kp() -> sign::KeyPair {
        let bytes: [u8; 32] = hex::decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").unwrap().try_into().unwrap();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();
        sign::KeyPair { signing_key, verifying_key, did_key: sign::encode_did_key(&verifying_key) }
    }

    /// Five files, their plain hashes, salts and item commitments under one secret.
    struct Fixture {
        kp: sign::KeyPair,
        data: Vec<Vec<u8>>,
        hashes: Vec<String>,
        salts: Vec<String>,
        items: Vec<String>,
    }

    fn fixture() -> Fixture {
        let kp = rfc8032_kp();
        let data: Vec<Vec<u8>> = (0..5u8).map(|i| format!("question {i}\n").into_bytes()).collect();
        let hashes: Vec<String> = data.iter().map(|d| hash::hash_bytes(d)).collect();
        let secret = [7u8; 32];
        let (items, salts) = commitment::commit_items(&secret, &hashes).unwrap();
        Fixture { kp, data, hashes, salts, items }
    }

    fn make_v5(f: &Fixture, mode: &str, ppm: u64) -> Commitment {
        commitment::create_v5(commitment::CreateParamsV5 {
            items: f.items.clone(),
            reveal_probability_ppm: ppm,
            selection_mode: mode.into(),
            anchor_round: ANCHOR,
            stream_id: Some("bench".into()),
            sequence: Some(1),
            metadata: Some(serde_json::json!({"set": "law-2026"})),
            committed_at: "2026-02-07T16:02:30Z".into(),
            identity: None,
        }, &f.kp).unwrap()
    }

    fn opening(f: &Fixture, item: &str) -> reveal::Opening {
        let i = f.items.iter().position(|x| x == item).unwrap();
        reveal::Opening { item: item.into(), salt: f.salts[i].clone(), hash: f.hashes[i].clone() }
    }

    fn make_reveal(f: &Fixture, c: &Commitment, selected: &[String], voluntary: &[String]) -> Reveal {
        let openings = selected.iter().chain(voluntary.iter()).map(|it| opening(f, it)).collect();
        reveal::create_v5(reveal::CreateParamsV5 {
            commitment_hash: c.commitment_hash.clone(),
            selected_items: selected.to_vec(),
            voluntary_items: voluntary.to_vec(),
            openings,
            data_url: None,
            revealed_at: "2026-02-08T10:00:00Z".into(),
        }, &f.kp).unwrap()
    }

    /// `computed` map as a CLI would build it: item commitment to the hash of the file it holds.
    fn computed_for(f: &Fixture, items: &[String]) -> std::collections::HashMap<String, String> {
        items.iter().map(|it| {
            let i = f.items.iter().position(|x| x == it).unwrap();
            (it.clone(), hash::hash_bytes(&f.data[i]))
        }).collect()
    }

    fn v5_check_names(result: &VerifyResult) -> Vec<&str> {
        result.checks.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn v5_receipt_verifies_in_batch_mode() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        assert_eq!(sel.selection_mode, "batch");
        assert_eq!(sel.selected_items.len(), 2);
        assert_eq!(sel.reveal_probability_ppm, Some(400000));
        assert!(sel.reveal_probability.is_none());
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(result.status, CHECKED, "{:?}", result.checks);
        assert_eq!(v5_check_names(&result), vec![
            CHECK_COMMITMENT_WELLFORMED, "commitment_signature", CHECK_BEACON_RANDOMNESS, CHECK_BEACON_AUTHENTIC,
            CHECK_ANCHOR_SELECTION_ROUND, CHECK_ANCHOR_REGISTRATION_TIME, CHECK_SELECTION_MODE, "selection_correct",
        ]);
    }

    #[test]
    fn v5_receipt_verifies_in_per_item_mode() {
        let f = fixture();
        let c = make_v5(&f, "per_item", 500000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        assert_eq!(sel.selection_mode, "per_item");
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(result.status, CHECKED, "{:?}", result.checks);
    }

    #[test]
    fn v5_server_cannot_pick_the_other_mode() {
        // The attack 0.2.0 only warned about: a server computes the selection in
        // the mode that suits it. In 0.5.0 the mode is signed.
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let bo = round(ANCHOR + 2);
        let mut sel = compute_selection(&c, &bo, "now").unwrap();
        let hc = crate::item::decode_hash32(&c.commitment_hash, "hc").unwrap();
        sel.selection_mode = "per_item".into();
        sel.selected_items = select_v5::select("per_item", &bo.randomness_bytes().unwrap(), &hc, &c.items, 400000).unwrap();
        sel.selected_count = sel.selected_items.len();
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_SELECTION_MODE), "fail");
        assert_eq!(status_of(&result, "selection_correct"), "fail", "recomputed in the signed mode");
        assert_eq!(status_of(&result, CHECK_SELECTION_MODE_DEFAULT), "absent", "no warn-only check in 0.5.0");
    }

    #[test]
    fn v5_selection_of_another_round_or_items_fails() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let other = compute_selection(&c, &round(ANCHOR + 3), "now").unwrap();
        let mut sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        // Round a+3 output presented as the selection: wrong round.
        let result = verify_full_with_hashes(&c, Some(&other), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(status_of(&result, CHECK_ANCHOR_SELECTION_ROUND), "fail");
        // Right round, but the items of the other round's shuffle.
        sel.selected_items = other.selected_items.clone();
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(status_of(&result, "selection_correct"), "fail");
        assert_eq!(result.status, "failed");
    }

    #[test]
    fn v5_registration_after_the_round_fails() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some("2026-02-07T16:02:36.000Z"));
        assert_eq!(status_of(&result, CHECK_ANCHOR_REGISTRATION_TIME), "fail");
        assert_eq!(result.status, "failed");
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), None);
        assert_eq!(status_of(&result, CHECK_ANCHOR_REGISTRATION_TIME), "skip");
        assert_eq!(result.status, "partial");
    }

    #[test]
    fn v5_malformed_commitment_fails_wellformed_and_nothing_panics() {
        let f = fixture();
        let mut c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        c.beacon.anchor_round = None;
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_COMMITMENT_WELLFORMED), "fail");
        assert_eq!(status_of(&result, "commitment_signature"), "fail");
        assert_eq!(status_of(&result, CHECK_ANCHOR_SELECTION_ROUND), "fail");
        assert_eq!(status_of(&result, "selection_correct"), "fail");

        let mut c = make_v5(&f, "batch", 400000);
        c.reveal_probability_ppm = Some(0);
        let result = verify_full_with_hashes(&c, Some(&sel), None, &Default::default(), Some(REGISTERED_OK));
        assert_eq!(status_of(&result, CHECK_COMMITMENT_WELLFORMED), "fail");
    }

    #[test]
    fn v5_unknown_version_fails_spec_version() {
        let f = fixture();
        let mut c = make_v5(&f, "batch", 400000);
        c.spec_version = "0.3.0".into();
        let result = verify_full_with_hashes(&c, None, None, &Default::default(), None);
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_SPEC_VERSION), "fail");
    }

    #[test]
    fn v5_reveal_bundle_verifies_end_to_end() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let voluntary: Vec<String> = f.items.iter().filter(|it| !sel.selected_items.contains(it)).take(1).cloned().collect();
        let rev = make_reveal(&f, &c, &sel.selected_items, &voluntary);
        let revealed: Vec<String> = rev.revealed_items().cloned().collect();
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed_for(&f, &revealed), Some(REGISTERED_OK));
        assert_eq!(result.status, CHECKED, "{:?}", result.checks);
        assert_eq!((result.items_checked, result.items_passed), (3, 3));
        for name in ["reveal_signature", CHECK_REVEAL_MATCHES_COMMITMENT, CHECK_ITEM_OPENINGS, "data_integrity", "completeness"] {
            assert_eq!(status_of(&result, name), "pass", "{name}");
        }
    }

    #[test]
    fn v5_wrong_opening_fails_item_openings_not_data() {
        // The committer reveals a file whose hash does not open the commitment:
        // caught by the opening check, whatever bytes are supplied.
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let mut rev = make_reveal(&f, &c, &sel.selected_items, &[]);
        let unselected = f.items.iter().position(|it| !sel.selected_items.contains(it)).unwrap();
        // Swap in the hash of another (unselected) file with the right salt for that file.
        let o = &mut rev.openings.as_mut().unwrap()[0];
        o.hash = f.hashes[unselected].clone();
        o.salt = f.salts[unselected].clone();
        rev.signature = sign::sign(&f.kp.signing_key, &reveal::signing_payload(&rev).unwrap());
        let mut computed = computed_for(&f, &sel.selected_items);
        computed.insert(sel.selected_items[0].clone(), f.hashes[unselected].clone());
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed, Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, "reveal_signature"), "pass", "the committer did sign it");
        assert_eq!(status_of(&result, CHECK_ITEM_OPENINGS), "fail");
    }

    #[test]
    fn v5_changed_data_fails_data_integrity() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let rev = make_reveal(&f, &c, &sel.selected_items, &[]);
        let mut computed = computed_for(&f, &sel.selected_items);
        computed.insert(sel.selected_items[0].clone(), hash::hash_bytes(b"other bytes"));
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed, Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_ITEM_OPENINGS), "pass");
        assert_eq!(status_of(&result, "data_integrity"), "fail");
        assert_eq!(result.items_failed, 1);
    }

    #[test]
    fn v5_missing_data_and_missing_items_are_partial() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let rev = make_reveal(&f, &c, &sel.selected_items, &[]);
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed_for(&f, &sel.selected_items[..1]), Some(REGISTERED_OK));
        assert_eq!(result.status, "partial");
        assert_eq!(result.items_missing, 1);

        let rev = make_reveal(&f, &c, &sel.selected_items[..1], &[]);
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed_for(&f, &sel.selected_items[..1]), Some(REGISTERED_OK));
        assert_eq!(result.status, "partial");
        assert_eq!(status_of(&result, "completeness"), "fail");
    }

    #[test]
    fn v5_unselected_item_as_selected_and_uncommitted_items_fail() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let unselected: Vec<String> = f.items.iter().filter(|it| !sel.selected_items.contains(it)).take(1).cloned().collect();
        let mut all = sel.selected_items.clone();
        all.extend(unselected.clone());
        let rev = make_reveal(&f, &c, &all, &[]);
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed_for(&f, &all), Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_REVEAL_MATCHES_COMMITMENT), "fail");

        // An item that was never committed, with a valid opening of its own.
        let bytes = b"never committed".to_vec();
        let h = hash::hash_bytes(&bytes);
        let salt = hex::encode([9u8; 32]);
        let extra = crate::item::item_commitment_hex(&salt, &h).unwrap();
        let mut openings: Vec<reveal::Opening> = sel.selected_items.iter().map(|it| opening(&f, it)).collect();
        openings.push(reveal::Opening { item: extra.clone(), salt, hash: h.clone() });
        let rev = reveal::create_v5(reveal::CreateParamsV5 {
            commitment_hash: c.commitment_hash.clone(),
            selected_items: sel.selected_items.clone(),
            voluntary_items: vec![extra.clone()],
            openings,
            data_url: None,
            revealed_at: "2026-02-08T10:00:00Z".into(),
        }, &f.kp).unwrap();
        let mut computed = computed_for(&f, &sel.selected_items);
        computed.insert(extra, h);
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed, Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_REVEAL_MATCHES_COMMITMENT), "fail");
        assert_eq!(status_of(&result, CHECK_ITEM_OPENINGS), "pass");
    }

    #[test]
    fn v5_commitment_needs_a_v5_reveal() {
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let sel = compute_selection(&c, &round(ANCHOR + 2), "now").unwrap();
        let rev = reveal::create(reveal::CreateParams {
            commitment_hash: c.commitment_hash.clone(),
            selected_items: sel.selected_items.clone(),
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-08T10:00:00Z".into(),
        }, &f.kp).unwrap();
        let result = verify_full_with_hashes(&c, Some(&sel), Some(&rev), &computed_for(&f, &sel.selected_items), Some(REGISTERED_OK));
        assert_eq!(result.status, "failed");
        assert_eq!(status_of(&result, CHECK_ITEM_OPENINGS), "fail");
    }

    #[test]
    fn v5_published_commitment_does_not_leak_item_hashes() {
        // The membership test of 0.2.0: hash a guessed item and look for it.
        let f = fixture();
        let c = make_v5(&f, "batch", 400000);
        let json = serde_json::to_string(&c).unwrap();
        for h in &f.hashes {
            assert!(!json.contains(h), "plain item hash {h} appears in the commitment");
        }
        for s in &f.salts {
            assert!(!json.contains(s));
        }
    }

    #[test]
    fn v2_and_v5_bundles_coexist_in_one_verifier() {
        // A 0.2.0 bundle verifies through the same entry point and reports the 0.2.0 checks.
        let kp = sign::generate_keypair();
        let c = make_commitment(&kp, vec![hash::hash_bytes(b"data")], 1.0);
        let sel = compute_selection(&c, &test_beacon_output(), "now").unwrap();
        let result = verify_full_with_registration(&c, Some(&sel), None, &[], Some(REGISTERED_BEFORE_ROUND_1000));
        assert_eq!(result.status, CHECKED);
        assert_eq!(status_of(&result, CHECK_SELECTION_MODE_DEFAULT), "pass");
        assert_eq!(status_of(&result, CHECK_COMMITMENT_WELLFORMED), "absent");
    }
}
