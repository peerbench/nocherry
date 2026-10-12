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

/// Group public key of drand quicknet (G2, compressed, hex).
pub const QUICKNET_PUBLIC_KEY: &str =
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";

/// Randomness of a quicknet round: `SHA-256(signature)`, hex.
pub fn randomness_from_signature(signature_hex: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let sig = hex::decode(signature_hex).map_err(|e| format!("decode signature hex: {e}"))?;
    Ok(hex::encode(Sha256::digest(&sig)))
}

/// Verify the BLS signature of a quicknet round against the group public key.
#[cfg(feature = "drand-bls")]
pub fn verify_signature(round: u64, signature_hex: &str) -> Result<(), String> {
    use drand_verify::{G2PubkeyRfc, Pubkey};
    let sig = hex::decode(signature_hex).map_err(|e| format!("decode signature hex: {e}"))?;
    let pk_bytes = hex::decode(QUICKNET_PUBLIC_KEY).map_err(|e| format!("decode public key: {e}"))?;
    let pk = G2PubkeyRfc::from_variable(&pk_bytes).map_err(|e| format!("public key: {e}"))?;
    match pk.verify(round, b"", &sig) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("signature does not verify for round {round}")),
        Err(e) => Err(format!("signature malformed: {e}")),
    }
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

    // Real quicknet rounds from https://api.drand.sh/<chain_hash>/public/<round>.
    const ROUND_1000_SIG: &str = "b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
    const ROUND_1000_RANDOMNESS: &str = "fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd";
    const ROUND_25892263_SIG: &str = "89d9074bd1ad018acd9b85fd99dba90b784fc9b62632f3b762cf7078c417e4c72895804e372e1a8cb201eb2c9e60a51d";

    #[test]
    fn randomness_is_hash_of_signature() {
        assert_eq!(randomness_from_signature(ROUND_1000_SIG).unwrap(), ROUND_1000_RANDOMNESS);
        assert!(randomness_from_signature("zz").is_err());
    }

    #[cfg(feature = "drand-bls")]
    #[test]
    fn bls_accepts_real_rounds() {
        verify_signature(1000, ROUND_1000_SIG).unwrap();
        verify_signature(25892263, ROUND_25892263_SIG).unwrap();
    }

    #[cfg(feature = "drand-bls")]
    #[test]
    fn bls_rejects_wrong_round_and_forged_signature() {
        assert!(verify_signature(1001, ROUND_1000_SIG).is_err());
        assert!(verify_signature(1000, ROUND_25892263_SIG).is_err());
        assert!(verify_signature(1000, "abc").is_err());
        assert!(verify_signature(1000, &"00".repeat(48)).is_err());
    }
}
