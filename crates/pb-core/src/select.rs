//! Selection algorithms (Commit-Reveal Spec Sections 4.2-4.4).
//!
//! PRNG: HMAC-SHA256(key=seed, msg=uint64_le(index)) → le_uint64(first 8 bytes)
//! Per-item: Bernoulli trial using HMAC of commitment_hash||item_hash
//! Batch: Fisher-Yates partial shuffle using PRNG

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Compute the next PRNG value.
///
/// `prng_next(seed, index) = le_uint64(HMAC-SHA256(seed, uint64_le(index))[0..8])`
pub fn prng_next(seed: &[u8], index: u64) -> u64 {
    let msg = index.to_le_bytes();
    let mut mac = HmacSha256::new_from_slice(seed)
        .expect("HMAC can accept any key length");
    mac.update(&msg);
    let result = mac.finalize().into_bytes();
    u64::from_le_bytes(result[..8].try_into().unwrap())
}

/// Like `prng_next` but also returns the full HMAC as hex (for test vectors).
pub fn prng_next_detail(seed: &[u8], index: u64) -> (u64, String) {
    let msg = index.to_le_bytes();
    let mut mac = HmacSha256::new_from_slice(seed)
        .expect("HMAC can accept any key length");
    mac.update(&msg);
    let result = mac.finalize().into_bytes();
    let val = u64::from_le_bytes(result[..8].try_into().unwrap());
    (val, hex::encode(&result))
}

/// Compute `floor(p × 2^64)`. For p >= 1.0, returns u64::MAX.
pub fn threshold(p: f64) -> u64 {
    if p >= 1.0 { return u64::MAX; }
    if p <= 0.0 { return 0; }
    // p * 2^64 via ldexp: multiply mantissa by 2^64
    (p * ((1u64 << 63) as f64) * 2.0) as u64
}

/// Per-item selection: is this item selected?
///
/// ```text
/// msg = commitment_hash || item_hash   (UTF-8 concat of hex strings)
/// decision = HMAC-SHA256(key=beacon_randomness, msg=msg)
/// value = le_uint64(decision[0..8])
/// selected = value < threshold
/// ```
pub fn select_per_item(
    beacon_randomness: &[u8],
    commitment_hash: &str,
    item_hash: &str,
    reveal_probability: f64,
) -> bool {
    let thresh = threshold(reveal_probability);
    let msg = format!("{}{}", commitment_hash, item_hash);
    let mut mac = HmacSha256::new_from_slice(beacon_randomness)
        .expect("HMAC can accept any key length");
    mac.update(msg.as_bytes());
    let result = mac.finalize().into_bytes();
    let value = u64::from_le_bytes(result[..8].try_into().unwrap());
    value < thresh
}

/// Like `select_per_item` but returns (selected, hmac_hex, value, threshold).
pub fn select_per_item_detail(
    beacon_randomness: &[u8],
    commitment_hash: &str,
    item_hash: &str,
    reveal_probability: f64,
) -> (bool, String, u64, u64) {
    let thresh = threshold(reveal_probability);
    let msg = format!("{}{}", commitment_hash, item_hash);
    let mut mac = HmacSha256::new_from_slice(beacon_randomness)
        .expect("HMAC can accept any key length");
    mac.update(msg.as_bytes());
    let result = mac.finalize().into_bytes();
    let value = u64::from_le_bytes(result[..8].try_into().unwrap());
    (value < thresh, hex::encode(&result), value, thresh)
}

/// Per-item selection applied to all items. Returns selected item hashes.
pub fn select_per_item_batch(
    beacon_randomness: &[u8],
    commitment_hash: &str,
    items: &[String],
    reveal_probability: f64,
) -> Vec<String> {
    items.iter()
        .filter(|h| select_per_item(beacon_randomness, commitment_hash, h, reveal_probability))
        .cloned()
        .collect()
}

/// Batch selection via Fisher-Yates partial shuffle (spec Section 4.4).
///
/// Selects exactly `count` items using a seeded shuffle.
pub fn select_batch(
    items: &[String],
    beacon_randomness: &[u8],
    count: usize,
) -> Result<Vec<String>, String> {
    if count > items.len() {
        return Err(format!("count {} exceeds item count {}", count, items.len()));
    }
    if count == 0 {
        return Ok(vec![]);
    }

    let mut pool: Vec<String> = items.to_vec();
    for i in 0..count {
        let range = (pool.len() - i) as u64;
        let rand_val = prng_next(beacon_randomness, i as u64);
        let j = i + (rand_val % range) as usize;
        pool.swap(i, j);
    }
    Ok(pool[..count].to_vec())
}

/// Batch selection with reveal_probability: count = ceil(p × item_count).
pub fn select_batch_by_probability(
    items: &[String],
    beacon_randomness: &[u8],
    reveal_probability: f64,
) -> Result<Vec<String>, String> {
    let count = (reveal_probability * items.len() as f64).ceil() as usize;
    let count = count.min(items.len());
    select_batch(items, beacon_randomness, count)
}

/// Determine selection mode based on item count (spec Section 4.5).
/// Default threshold: 20.
pub fn selection_mode(item_count: usize) -> &'static str {
    selection_mode_with_threshold(item_count, 20)
}

pub fn selection_mode_with_threshold(item_count: usize, batch_threshold: usize) -> &'static str {
    if item_count > batch_threshold { "batch" } else { "per_item" }
}

/// Auto-select using the appropriate algorithm.
/// Returns (selected_items, mode).
pub fn select_auto(
    beacon_randomness: &[u8],
    commitment_hash: &str,
    items: &[String],
    reveal_probability: f64,
) -> Result<(Vec<String>, &'static str), String> {
    let mode = selection_mode(items.len());
    let selected = match mode {
        "per_item" => select_per_item_batch(beacon_randomness, commitment_hash, items, reveal_probability),
        "batch" => select_batch_by_probability(items, beacon_randomness, reveal_probability)?,
        _ => unreachable!(),
    };
    Ok((selected, mode))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_hex(s: &str) -> Vec<u8> {
        hex::decode(s).unwrap()
    }

    // -- Spec test vectors: Section 10.1 (PRNG) --

    #[test]
    fn prng_spec_vectors() {
        let seed = decode_hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

        let (val0, mac0) = prng_next_detail(&seed, 0);
        assert_eq!(mac0, "8bc1aab00ed4423c741ed6670d50d4ab95e7207fc4a81f4aa09b8e2ba20b5658");
        assert_eq!(val0, 4342266150297190795);

        let (val1, mac1) = prng_next_detail(&seed, 1);
        assert_eq!(mac1, "4d0d8aedaf2ddd700fcdcad9c566103a29ee40c3b317a30d04916df298ac7a80");
        assert_eq!(val1, 8132706735728758093);

        let (val2, mac2) = prng_next_detail(&seed, 2);
        assert_eq!(mac2, "a95b16931142b70abdc2fc01f651e9ad201cc86a780d719c892e58950809196b");
        assert_eq!(val2, 772158504366922665);
    }

    // -- Spec test vectors: Section 10.2 (Per-Item Selection) --

    #[test]
    fn threshold_010() {
        assert_eq!(threshold(0.10), 1844674407370955264);
    }

    #[test]
    fn threshold_edge_cases() {
        assert_eq!(threshold(1.0), u64::MAX);
        assert_eq!(threshold(0.0), 0);
        assert_eq!(threshold(0.5), 1u64 << 63);
    }

    #[test]
    fn per_item_spec_selected() {
        let beacon = decode_hex("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6");
        let commitment_hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
        let item_hash = "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2";

        let (selected, hmac_hex, value, thresh) =
            select_per_item_detail(&beacon, commitment_hash, item_hash, 0.10);

        assert_eq!(hmac_hex, "b42355774698a415dc125b565996db6c002f5f006d2f7d0f1ee0dba4b2d72b57");
        assert_eq!(value, 1559538799394235316);
        assert_eq!(thresh, 1844674407370955264);
        assert!(selected, "item should be selected");
    }

    #[test]
    fn per_item_spec_not_selected() {
        let beacon = decode_hex("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6");
        let commitment_hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
        let item_hash = "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8";

        let (selected, hmac_hex, value, thresh) =
            select_per_item_detail(&beacon, commitment_hash, item_hash, 0.10);

        assert_eq!(hmac_hex, "e5cb6f092a341da003cd8ae1deadd933a772b411d474dafe5a72dadb2ca5e2a1");
        assert_eq!(value, 11537435175544671205);
        assert_eq!(thresh, 1844674407370955264);
        assert!(!selected, "item should NOT be selected");
    }

    // -- Spec test vectors: Section 10.3 (Batch Selection) --

    #[test]
    fn batch_spec_vector() {
        let beacon = decode_hex("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6");
        let items: Vec<String> = vec![
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8".into(),
            "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2".into(),
            "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da".into(),
            "4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030".into(),
            "57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b".into(),
        ];

        // Verify PRNG values
        assert_eq!(prng_next(&beacon, 0), 6916673916840581544);
        assert_eq!(prng_next(&beacon, 1), 9911365303496060051);

        // Verify swap indices
        assert_eq!(0 + (6916673916840581544u64 % 5) as usize, 4); // step 0: j=4
        assert_eq!(1 + (9911365303496060051u64 % 4) as usize, 4); // step 1: j=4

        let selected = select_batch(&items, &beacon, 2).unwrap();
        assert_eq!(selected, vec![
            "57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
        ]);
    }

    #[test]
    fn batch_via_probability() {
        let beacon = decode_hex("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6");
        let items: Vec<String> = vec![
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8".into(),
            "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2".into(),
            "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da".into(),
            "4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030".into(),
            "57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b".into(),
        ];
        // ceil(0.40 * 5) = 2
        let selected = select_batch_by_probability(&items, &beacon, 0.40).unwrap();
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0], "57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b");
        assert_eq!(selected[1], "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8");
    }

    #[test]
    fn batch_does_not_mutate() {
        let beacon = decode_hex("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6");
        let items: Vec<String> = vec!["a".into(), "b".into(), "c".into()];
        let original = items.clone();
        let _ = select_batch(&items, &beacon, 2).unwrap();
        assert_eq!(items, original);
    }

    #[test]
    fn batch_count_exceeds() {
        let seed = decode_hex("0000000000000000000000000000000000000000000000000000000000000000");
        let items: Vec<String> = vec!["a".into(), "b".into()];
        assert!(select_batch(&items, &seed, 5).is_err());
    }

    #[test]
    fn selection_mode_threshold() {
        assert_eq!(selection_mode(1), "per_item");
        assert_eq!(selection_mode(20), "per_item");
        assert_eq!(selection_mode(21), "batch");
        assert_eq!(selection_mode(100), "batch");
    }

    #[test]
    fn prng_deterministic() {
        let seed = decode_hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(prng_next(&seed, 42), prng_next(&seed, 42));
    }

    #[test]
    fn per_item_p100_always_selects() {
        let seed = decode_hex("0000000000000000000000000000000000000000000000000000000000000000");
        assert!(select_per_item(&seed, "aabb", "ccdd", 1.0));
    }
}
