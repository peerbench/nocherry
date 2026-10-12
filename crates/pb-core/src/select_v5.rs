//! Selection for object format 0.5.0 (Spec v0.5 Section 8).
//!
//! Probability is an integer in parts per million; thresholds and counts are
//! exact integer arithmetic; HMAC inputs are fixed-width bytes behind a domain
//! tag; integers are big-endian; the shuffle uses rejection sampling. Format
//! 0.2.0 selection lives in `select` and is not touched.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Domain tag of the per-item decision input.
pub const TAG_PER_ITEM: &[u8] = b"NoCherry/0.5/per-item";
/// Domain tag of the batch seed.
pub const TAG_BATCH_SEED: &[u8] = b"NoCherry/0.5/batch-seed";

/// Denominator of `reveal_probability_ppm`.
pub const PPM: u64 = 1_000_000;

const TWO_64: u128 = 1u128 << 64;

pub const MODE_PER_ITEM: &str = "per_item";
pub const MODE_BATCH: &str = "batch";

/// `reveal_probability_ppm` is valid in `[1, PPM]`.
pub fn validate_ppm(ppm: u64) -> Result<u32, String> {
    if ppm == 0 || ppm > PPM {
        return Err(format!("reveal_probability_ppm must be in [1, {PPM}], got {ppm}"));
    }
    Ok(ppm as u32)
}

/// `floor(ppm * 2^64 / 10^6)`. Equals `2^64` for `ppm = 10^6`, so the result is u128.
pub fn threshold(ppm: u32) -> u128 {
    (ppm as u128 * TWO_64) / PPM as u128
}

/// `ceil(ppm * n / 10^6)` for a non-empty list: at least 1, at most `n`.
pub fn batch_count(ppm: u32, n: usize) -> usize {
    let count = (ppm as u128 * n as u128 + (PPM as u128 - 1)) / PPM as u128;
    count as usize
}

fn hmac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().into()
}

fn be_u64(bytes: &[u8]) -> u64 {
    u64::from_be_bytes(bytes[..8].try_into().expect("8 bytes"))
}

/// Per-item decision value `be_uint64(HMAC-SHA256(R, TAG_PER_ITEM || hc || c))`
/// together with the full MAC (for vectors).
pub fn per_item_value(randomness: &[u8], commitment_hash: &[u8; 32], item: &[u8; 32]) -> (u64, [u8; 32]) {
    let mac = hmac(randomness, &[TAG_PER_ITEM, commitment_hash, item]);
    (be_u64(&mac), mac)
}

/// Per-item selection of one item.
pub fn select_per_item(randomness: &[u8], commitment_hash: &[u8; 32], item: &[u8; 32], ppm: u32) -> bool {
    let (value, _) = per_item_value(randomness, commitment_hash, item);
    (value as u128) < threshold(ppm)
}

/// Per-item selection over hex item commitments; selected items in committed order.
pub fn select_per_item_all(
    randomness: &[u8],
    commitment_hash: &[u8; 32],
    items: &[String],
    ppm: u32,
) -> Result<Vec<String>, String> {
    let mut selected = Vec::new();
    for item in items {
        let c = crate::item::decode_hash32(item, "item commitment")?;
        if select_per_item(randomness, commitment_hash, &c, ppm) {
            selected.push(item.clone());
        }
    }
    Ok(selected)
}

/// `HMAC-SHA256(R, TAG_BATCH_SEED || hc)`.
pub fn batch_seed(randomness: &[u8], commitment_hash: &[u8; 32]) -> [u8; 32] {
    hmac(randomness, &[TAG_BATCH_SEED, commitment_hash])
}

/// `draw(counter) = be_uint64(HMAC-SHA256(seed, uint64_be(counter)))`.
pub fn draw(seed: &[u8; 32], counter: u64) -> u64 {
    be_u64(&hmac(seed, &[&counter.to_be_bytes()]))
}

/// `2^64 - (2^64 mod range)`: the largest multiple of `range` that is at most `2^64`.
pub fn rejection_limit(range: u64) -> u128 {
    TWO_64 - TWO_64 % range as u128
}

/// One uniform draw below `range` from a stream of 64-bit values, rejecting
/// values at or above `rejection_limit(range)`. Returns the index and the
/// number of values consumed. Generic over the source so that the rejection
/// branch can be tested with chosen values.
pub fn draw_below(range: u64, mut next: impl FnMut() -> u64) -> (u64, u64) {
    let limit = rejection_limit(range);
    let mut consumed = 0u64;
    loop {
        let v = next();
        consumed += 1;
        if (v as u128) < limit {
            return (v % range, consumed);
        }
    }
}

/// Batch selection: partial Fisher-Yates shuffle of `items` driven by the
/// commitment-bound seed. Returns `pool[0..count]` in shuffle order.
pub fn select_batch(
    items: &[String],
    randomness: &[u8],
    commitment_hash: &[u8; 32],
    count: usize,
) -> Result<Vec<String>, String> {
    if count > items.len() {
        return Err(format!("count {} exceeds item count {}", count, items.len()));
    }
    let seed = batch_seed(randomness, commitment_hash);
    let mut pool: Vec<String> = items.to_vec();
    let mut counter = 0u64;
    for i in 0..count {
        let range = (pool.len() - i) as u64;
        let (offset, consumed) = draw_below(range, || {
            let v = draw(&seed, counter);
            counter += 1;
            v
        });
        let _ = consumed;
        pool.swap(i, i + offset as usize);
    }
    Ok(pool[..count].to_vec())
}

/// Selection in the commitment's mode.
pub fn select(
    mode: &str,
    randomness: &[u8],
    commitment_hash: &[u8; 32],
    items: &[String],
    ppm: u32,
) -> Result<Vec<String>, String> {
    match mode {
        MODE_PER_ITEM => select_per_item_all(randomness, commitment_hash, items, ppm),
        MODE_BATCH => select_batch(items, randomness, commitment_hash, batch_count(ppm, items.len())),
        other => Err(format!("unknown selection_mode: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h32(s: &str) -> [u8; 32] { crate::item::decode_hash32(s, "test").unwrap() }

    const R: &str = "5c00d32a5dd9adf1f2f3ff730d16003ab3f9621d5c7ad64950001ee2ca153108";
    const HC_A: &str = "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826";
    const HC_B: &str = "d92fb2774202942e3a838d7c8cbb00d6e4de3b46af0a6ac67f74db7529627efa";
    const ITEMS: [&str; 5] = [
        "2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf",
        "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a",
        "5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d",
        "47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e",
        "7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c",
    ];
    fn items() -> Vec<String> { ITEMS.iter().map(|s| s.to_string()).collect() }

    // Spec 13.10.
    #[test]
    fn threshold_vectors() {
        assert_eq!(threshold(1), 18446744073709);
        assert_eq!(threshold(70000), 1291272085159668613);
        assert_eq!(threshold(100000), 1844674407370955161);
        assert_eq!(threshold(500000), 9223372036854775808);
        assert_eq!(threshold(999999), 18446725626965477906);
        assert_eq!(threshold(1000000), 18446744073709551616);
        assert_eq!(threshold(1000000), TWO_64);
    }

    #[test]
    fn batch_count_vectors() {
        assert_eq!(batch_count(70000, 100), 7);
        assert_eq!(batch_count(100000, 17), 2);
        assert_eq!(batch_count(100000, 2), 1);
        assert_eq!(batch_count(1, 1), 1);
        assert_eq!(batch_count(1, 1_000_000), 1);
        assert_eq!(batch_count(1_000_000, 5), 5);
        assert_eq!(batch_count(333333, 3), 1);
        assert_eq!(batch_count(500000, 1), 1);
    }

    #[test]
    fn batch_count_is_always_in_range() {
        for ppm in [1u32, 2, 70000, 333333, 500000, 999999, 1_000_000] {
            for n in [1usize, 2, 3, 7, 100, 1_000_001] {
                let m = batch_count(ppm, n);
                assert!(m >= 1 && m <= n, "ppm={ppm} n={n} m={m}");
                // ceil: m-1 < ppm*n/10^6 <= m
                assert!((m as u128 - 1) * (PPM as u128) < ppm as u128 * n as u128);
                assert!(ppm as u128 * n as u128 <= m as u128 * PPM as u128);
            }
        }
    }

    #[test]
    fn rejection_limit_vectors() {
        assert_eq!(rejection_limit(1), 18446744073709551616);
        assert_eq!(rejection_limit(2), 18446744073709551616);
        assert_eq!(rejection_limit(3), 18446744073709551615);
        assert_eq!(rejection_limit(5), 18446744073709551615);
        assert_eq!(rejection_limit(7), 18446744073709551614);
        assert_eq!(rejection_limit(10), 18446744073709551610);
        assert_eq!(rejection_limit(1000), 18446744073709551000);
        assert_eq!(rejection_limit(1 << 32), 18446744073709551616);
        assert_eq!(rejection_limit(u64::MAX), 18446744073709551615);
    }

    #[test]
    fn draw_below_rejects_and_consumes_the_next_value() {
        // range 10: the top six values of the 64-bit space are rejected.
        // u64::MAX and u64::MAX - 5 (= limit) are rejected, u64::MAX - 6 is accepted.
        let mut values = vec![u64::MAX, u64::MAX - 5, u64::MAX - 6, 7].into_iter();
        let (idx, consumed) = draw_below(10, || values.next().unwrap());
        assert_eq!(consumed, 3, "two rejected values then one accepted");
        assert_eq!(idx, (u64::MAX - 6) % 10);
        assert_eq!(idx, 9);
        assert_eq!(values.next(), Some(7), "the value after the accepted one is untouched");
        // Power-of-two range never rejects.
        let (idx, consumed) = draw_below(1 << 32, || u64::MAX);
        assert_eq!((idx, consumed), (u64::MAX % (1 << 32), 1));
        // Range 1 always gives 0 from one draw.
        assert_eq!(draw_below(1, || 12345), (0, 1));
    }

    // Spec 13.13.
    #[test]
    fn batch_vector_round_25892264() {
        let r = hex::decode(R).unwrap();
        let hc = h32(HC_A);
        assert_eq!(hex::encode(batch_seed(&r, &hc)), "9e38917f1c3657cca52685846e670bdf0ab59f8b9f6b9522cafc69f311fb42e6");
        let seed = batch_seed(&r, &hc);
        assert_eq!(draw(&seed, 0), 4766462977800624865);
        assert_eq!(draw(&seed, 1), 17118077862470312844);
        let selected = select_batch(&items(), &r, &hc, batch_count(400000, 5)).unwrap();
        assert_eq!(selected, vec![ITEMS[0].to_string(), ITEMS[1].to_string()]);
        assert_eq!(select(MODE_BATCH, &r, &hc, &items(), 400000).unwrap(), selected);
    }

    #[test]
    fn batch_vector_round_25892265() {
        let r = hex::decode("981853163a6078ace4ab02d83913000181990ec0042b7de1752c31bb25fcd4c0").unwrap();
        let hc = h32(HC_A);
        let seed = batch_seed(&r, &hc);
        assert_eq!(hex::encode(seed), "65b8d9782a88951e6c60d0bd038949bdf0293c0386b92bcd28a0205288704fce");
        assert_eq!(draw(&seed, 0), 18092864662774502750);
        assert_eq!(draw(&seed, 1), 4964423873904502846);
        let selected = select_batch(&items(), &r, &hc, 2).unwrap();
        assert_eq!(selected, vec![ITEMS[0].to_string(), ITEMS[3].to_string()]);
        let all = select_batch(&items(), &r, &hc, 5).unwrap();
        assert_eq!(all, [ITEMS[0], ITEMS[3], ITEMS[2], ITEMS[1], ITEMS[4]].map(String::from).to_vec());
    }

    // Spec 13.14.
    #[test]
    fn per_item_vector() {
        let r = hex::decode(R).unwrap();
        let hc = h32(HC_B);
        let (v0, mac0) = per_item_value(&r, &hc, &h32(ITEMS[0]));
        assert_eq!(hex::encode(mac0), "033866e12c9af0f37e4f3e4c7192a790b87437b9324b213b2c1c0463d17dc39a");
        assert_eq!(v0, 232048498111607027);
        let (v1, mac1) = per_item_value(&r, &hc, &h32(ITEMS[1]));
        assert_eq!(hex::encode(mac1), "2d5f8ed2ef1627bfa8f359d623020ca8356a3bc9c5c73503c7a96ff8a5ee3360");
        assert_eq!(v1, 3269488891099752383);
        let two: Vec<String> = ITEMS[..2].iter().map(|s| s.to_string()).collect();
        assert_eq!(select(MODE_PER_ITEM, &r, &hc, &two, 100000).unwrap(), vec![ITEMS[0].to_string()]);
    }

    #[test]
    fn ppm_one_million_selects_everything_in_both_modes() {
        let r = hex::decode(R).unwrap();
        let hc = h32(HC_A);
        let per_item = select(MODE_PER_ITEM, &r, &hc, &items(), 1_000_000).unwrap();
        assert_eq!(per_item, items());
        let batch = select(MODE_BATCH, &r, &hc, &items(), 1_000_000).unwrap();
        let mut sorted = batch.clone();
        sorted.sort();
        let mut want = items();
        want.sort();
        assert_eq!(sorted, want);
        assert_eq!(batch.len(), 5);
    }

    #[test]
    fn seed_depends_on_the_commitment_hash() {
        let r = hex::decode(R).unwrap();
        let a = select_batch(&items(), &r, &h32(HC_A), 5).unwrap();
        let b = select_batch(&items(), &r, &h32(HC_B), 5).unwrap();
        assert_ne!(a, b, "two commitments over the same items must not share a shuffle");
    }

    #[test]
    fn per_item_depends_on_the_commitment_hash() {
        let r = hex::decode(R).unwrap();
        let many: Vec<String> = (0..200u32).map(|i| crate::hash::hash_bytes(&i.to_be_bytes())).collect();
        let a = select_per_item_all(&r, &h32(HC_A), &many, 500000).unwrap();
        let b = select_per_item_all(&r, &h32(HC_B), &many, 500000).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn batch_does_not_mutate_and_checks_count() {
        let r = hex::decode(R).unwrap();
        let hc = h32(HC_A);
        let original = items();
        let _ = select_batch(&original, &r, &hc, 3).unwrap();
        assert_eq!(original, items());
        assert!(select_batch(&original, &r, &hc, 6).is_err());
        assert_eq!(select_batch(&original, &r, &hc, 0).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn unknown_mode_and_bad_items_are_errors() {
        let r = hex::decode(R).unwrap();
        assert!(select("favorite", &r, &h32(HC_A), &items(), 100000).is_err());
        assert!(select(MODE_PER_ITEM, &r, &h32(HC_A), &["xyz".to_string()], 100000).is_err());
    }

    #[test]
    fn validate_ppm_bounds() {
        assert!(validate_ppm(0).is_err());
        assert_eq!(validate_ppm(1), Ok(1));
        assert_eq!(validate_ppm(1_000_000), Ok(1_000_000));
        assert!(validate_ppm(1_000_001).is_err());
    }

    #[test]
    fn per_item_frequency_matches_ppm() {
        // 20000 draws at 10 percent: expect 2000, sd about 42.
        let hc = h32(HC_A);
        let mut selected = 0;
        for round in 0..100u32 {
            let r = crate::hash::hash_bytes(&round.to_be_bytes());
            let r = hex::decode(r).unwrap();
            for i in 0..200u32 {
                let item = h32(&crate::hash::hash_bytes(&(i + 1000).to_be_bytes()));
                if select_per_item(&r, &hc, &item, 100000) { selected += 1; }
            }
        }
        assert!((1790..=2210).contains(&selected), "selected {selected} of 20000 at ppm 100000");
    }

    #[test]
    fn batch_positions_are_uniform() {
        // 50 items, 5 selected per round, 2000 rounds: each item expected 200 times, sd about 13.4.
        let many: Vec<String> = (0..50u32).map(|i| crate::hash::hash_bytes(&i.to_be_bytes())).collect();
        let hc = h32(HC_A);
        let mut counts = std::collections::HashMap::new();
        for round in 0..2000u32 {
            let r = hex::decode(crate::hash::hash_bytes(&round.to_be_bytes())).unwrap();
            let sel = select_batch(&many, &r, &hc, 5).unwrap();
            assert_eq!(sel.len(), 5);
            assert_eq!(sel.iter().collect::<std::collections::HashSet<_>>().len(), 5);
            for s in sel { *counts.entry(s).or_insert(0u32) += 1; }
        }
        for item in &many {
            let c = *counts.get(item).unwrap_or(&0);
            assert!((133..=267).contains(&c), "item {item} selected {c} times, expected 200");
        }
    }
}
