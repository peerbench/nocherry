//! Statistical properties of the two selection modes, measured over many
//! pseudo-random beacon values (SHA-256 of a counter stands in for the beacon).
//!
//! The paper states that per-item mode selects each item independently with
//! probability p and that batch mode returns a uniformly random m-subset. These
//! tests check the marginal inclusion frequencies and the exact-count property;
//! a 5-sigma tolerance keeps them deterministic in practice.

use pb_core::select;
use sha2::{Digest, Sha256};

fn pseudo_beacon(i: u64) -> Vec<u8> {
    Sha256::digest(format!("beacon-{i}").as_bytes()).to_vec()
}

fn item(i: usize) -> String {
    hex::encode(Sha256::digest(format!("item-{i}").as_bytes()))
}

fn commitment_hash(i: usize) -> String {
    hex::encode(Sha256::digest(format!("commitment-{i}").as_bytes()))
}

#[test]
fn per_item_inclusion_frequency_matches_p() {
    let n = 2000usize;
    let rounds = 50u64;
    let p = 0.1f64;
    let items: Vec<String> = (0..n).map(item).collect();
    let ch = commitment_hash(0);
    let mut selected = 0usize;
    for r in 0..rounds {
        let beacon = pseudo_beacon(r);
        for h in &items {
            if select::select_per_item(&beacon, &ch, h, p) {
                selected += 1;
            }
        }
    }
    let trials = (n as f64) * (rounds as f64);
    let freq = selected as f64 / trials;
    let sd = (p * (1.0 - p) / trials).sqrt();
    assert!((freq - p).abs() < 5.0 * sd, "frequency {freq} is more than 5 sd from {p}");
}

#[test]
fn per_item_frequency_holds_for_several_p() {
    let n = 1000usize;
    let rounds = 20u64;
    let items: Vec<String> = (0..n).map(item).collect();
    for (k, p) in [0.01f64, 0.05, 0.25, 0.5, 0.9].into_iter().enumerate() {
        let ch = commitment_hash(k);
        let mut selected = 0usize;
        for r in 0..rounds {
            let beacon = pseudo_beacon(1000 + r);
            selected += items.iter().filter(|h| select::select_per_item(&beacon, &ch, h, p)).count();
        }
        let trials = (n as f64) * (rounds as f64);
        let freq = selected as f64 / trials;
        let sd = (p * (1.0 - p) / trials).sqrt();
        assert!((freq - p).abs() < 5.0 * sd, "p={p}: frequency {freq}");
    }
}

#[test]
fn per_item_p_one_selects_everything_in_practice() {
    // The threshold at p = 1 is u64::MAX, so an item is skipped only when the
    // 64-bit value equals u64::MAX (probability 2^-64).
    let items: Vec<String> = (0..5000).map(item).collect();
    let beacon = pseudo_beacon(42);
    let ch = commitment_hash(42);
    assert!(items.iter().all(|h| select::select_per_item(&beacon, &ch, h, 1.0)));
}

#[test]
fn batch_selects_exactly_m_distinct_committed_items_with_uniform_marginals() {
    let n = 200usize;
    let rounds = 2000u64;
    let p = 0.1f64;
    let m = (p * n as f64).ceil() as usize;
    let items: Vec<String> = (0..n).map(item).collect();
    let mut counts = std::collections::HashMap::<String, u64>::new();
    for r in 0..rounds {
        let sel = select::select_batch(&items, &pseudo_beacon(r), m).unwrap();
        assert_eq!(sel.len(), m);
        let distinct: std::collections::HashSet<&String> = sel.iter().collect();
        assert_eq!(distinct.len(), m, "duplicate item in batch selection");
        for h in &sel {
            assert!(items.contains(h), "selected item is not a committed item");
            *counts.entry(h.clone()).or_default() += 1;
        }
    }
    let expected = rounds as f64 * p;
    let sd = (rounds as f64 * p * (1.0 - p)).sqrt();
    for h in &items {
        let c = *counts.get(h).unwrap_or(&0) as f64;
        assert!((c - expected).abs() < 5.0 * sd, "item {h} selected {c} times, expected {expected}");
    }
}

#[test]
fn batch_by_probability_selects_ceil_pn_and_at_least_one() {
    let items: Vec<String> = (0..7).map(item).collect();
    let beacon = pseudo_beacon(3);
    assert_eq!(select::select_batch_by_probability(&items, &beacon, 0.1).unwrap().len(), 1);
    assert_eq!(select::select_batch_by_probability(&items, &beacon, 0.3).unwrap().len(), 3);
    assert_eq!(select::select_batch_by_probability(&items, &beacon, 1.0).unwrap().len(), 7);
}

#[test]
fn batch_seed_is_the_beacon_alone_so_equal_n_selects_equal_positions() {
    // Pins the open issue described in the paper (seed not bound to the
    // commitment). Update this test when the seed includes the commitment hash.
    let a: Vec<String> = (0..50).map(item).collect();
    let b: Vec<String> = (100..150).map(item).collect();
    let beacon = pseudo_beacon(7);
    let pos = |items: &Vec<String>, sel: Vec<String>| -> Vec<usize> {
        sel.iter().map(|h| items.iter().position(|x| x == h).unwrap()).collect()
    };
    let pa = pos(&a, select::select_batch(&a, &beacon, 5).unwrap());
    let pb = pos(&b, select::select_batch(&b, &beacon, 5).unwrap());
    assert_eq!(pa, pb);
}
