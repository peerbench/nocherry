//! Offline verification pipeline (Spec Section 6.4).

use serde::Serialize;
use crate::beacon::BeaconOutput;
use crate::commitment::{self, Commitment};
use crate::reveal::{self, Reveal};
use crate::select;
use crate::hash;

/// Selection record produced after beacon fires.
#[derive(Debug, Clone, Serialize)]
pub struct SelectionRecord {
    pub commitment_hash: String,
    pub beacon_output: BeaconOutput,
    pub selection_mode: String,
    pub reveal_probability: f64,
    pub selected_items: Vec<String>,
    pub selected_count: usize,
    pub total_count: usize,
    pub computed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub name: String,
    pub status: String, // "pass", "fail", "skip"
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

/// Full verification pipeline (Spec Section 6.4).
pub fn verify_full(
    c: &Commitment,
    sel: Option<&SelectionRecord>,
    rev: Option<&Reveal>,
    data: &[DataItem],
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

    // Step 2: Beacon verification (external).
    result.add("beacon_authentic", "skip",
        Some("beacon signature verification requires external library".into()));

    // Step 3: Verify selection.
    if let Some(sel) = sel {
        match sel.beacon_output.randomness_bytes() {
            Ok(randomness) => {
                match select::select_auto(
                    &randomness, &c.commitment_hash, &c.items, c.reveal_probability,
                ) {
                    Ok((recomputed, _mode)) => {
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

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sign;
    use crate::beacon::BeaconRef;

    fn test_beacon_output() -> BeaconOutput {
        BeaconOutput {
            beacon_type: "drand".into(),
            chain_hash: Some(crate::beacon::drand::QUICKNET_CHAIN_HASH.into()),
            round: Some(1),
            randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6".into(),
            signature: "abc".into(),
        }
    }

    fn make_commitment(kp: &sign::KeyPair, items: Vec<String>, prob: f64) -> Commitment {
        commitment::create(commitment::CreateParams {
            items,
            reveal_probability: prob,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
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

        let result = verify_full(&c, Some(&sel), Some(&rev), &[
            DataItem { hash: h1, data: data1 },
            DataItem { hash: h2, data: data2 },
        ]);

        assert_eq!(result.status, "verified");
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
}
