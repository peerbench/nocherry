//! drand quicknet beacon (Spec Section 5.2).

/// Chain hash for drand quicknet.
pub const QUICKNET_CHAIN_HASH: &str =
    "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

/// Beacon period in seconds.
pub const QUICKNET_PERIOD: u64 = 3;

/// Genesis time (Unix timestamp).
pub const QUICKNET_GENESIS: i64 = 1692803367;

/// Round → Unix timestamp.
/// `round_time(round) = genesis_time + (round - 1) × period`
pub fn round_time(round: u64) -> i64 {
    QUICKNET_GENESIS + (round as i64 - 1) * QUICKNET_PERIOD as i64
}

/// Unix timestamp → round number.
/// `time_to_round(t) = floor((t - genesis_time) / period) + 1`
pub fn time_to_round(unix_time: i64) -> u64 {
    let elapsed = unix_time - QUICKNET_GENESIS;
    if elapsed < 0 { return 1; }
    (elapsed / QUICKNET_PERIOD as i64) as u64 + 1
}

/// First round whose timestamp is strictly after `unix_time`.
pub fn next_round_after(unix_time: i64) -> u64 {
    let mut round = time_to_round(unix_time);
    while round_time(round) <= unix_time {
        round += 1;
    }
    round
}

/// Build the URL for a drand relay.
pub fn relay_url(relay: &str, chain_hash: &str, round: u64) -> String {
    format!("{}/{}/public/{}", relay, chain_hash, round)
}

/// Default public drand relay endpoints.
pub const DEFAULT_RELAYS: &[&str] = &[
    "https://api.drand.sh",
    "https://drand.cloudflare.com",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_1_is_genesis() {
        assert_eq!(round_time(1), QUICKNET_GENESIS);
    }

    #[test]
    fn round_2() {
        assert_eq!(round_time(2), QUICKNET_GENESIS + 3);
    }

    #[test]
    fn round_100() {
        assert_eq!(round_time(100), QUICKNET_GENESIS + 99 * 3);
    }

    #[test]
    fn time_to_round_genesis() {
        assert_eq!(time_to_round(QUICKNET_GENESIS), 1);
    }

    #[test]
    fn time_to_round_plus_1s() {
        assert_eq!(time_to_round(QUICKNET_GENESIS + 1), 1);
    }

    #[test]
    fn time_to_round_plus_3s() {
        assert_eq!(time_to_round(QUICKNET_GENESIS + 3), 2);
    }

    #[test]
    fn time_to_round_plus_6s() {
        assert_eq!(time_to_round(QUICKNET_GENESIS + 6), 3);
    }

    #[test]
    fn roundtrip() {
        for round in 1..=100 {
            assert_eq!(time_to_round(round_time(round)), round);
        }
    }

    #[test]
    fn next_round_after_genesis() {
        assert_eq!(next_round_after(QUICKNET_GENESIS), 2);
    }

    #[test]
    fn next_round_after_mid_period() {
        assert_eq!(next_round_after(QUICKNET_GENESIS + 1), 2);
    }

    #[test]
    fn next_round_after_round2() {
        assert_eq!(next_round_after(round_time(2)), 3);
    }

    #[test]
    fn before_genesis() {
        assert_eq!(time_to_round(QUICKNET_GENESIS - 100), 1);
    }

    #[test]
    fn relay_url_format() {
        assert_eq!(
            relay_url("https://api.drand.sh", QUICKNET_CHAIN_HASH, 35200000),
            "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/35200000"
        );
    }
}
