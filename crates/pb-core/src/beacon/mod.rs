//! Randomness beacon types and interfaces (Spec Section 5).

pub mod anchor;
pub mod drand;

use serde::{Serialize, Deserialize};

/// Beacon reference — identifies the randomness source, pinned at commitment time.
/// Key order: "type", then type-specific fields alphabetically.
///
/// `anchor_round` is optional. When absent it is omitted from the serialized
/// form (never emitted as null), so the signing payload, commitment hash and
/// signature of a commitment without an anchor are unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BeaconRef {
    #[serde(rename = "type")]
    pub beacon_type: String,
    /// Client-chosen, already public beacon round. When present, selection
    /// uses round `anchor_round + ANCHOR_SELECTION_DELAY` (see `anchor`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_round: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Beacon output used for selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconOutput {
    #[serde(rename = "type")]
    pub beacon_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round: Option<u64>,
    pub randomness: String,
    pub signature: String,
}

impl BeaconOutput {
    /// Parse the randomness field (hex) to 32 bytes.
    pub fn randomness_bytes(&self) -> Result<Vec<u8>, String> {
        let b = hex::decode(&self.randomness)
            .map_err(|e| format!("decode randomness hex: {e}"))?;
        if b.len() != 32 {
            return Err(format!("randomness must be 32 bytes, got {}", b.len()));
        }
        Ok(b)
    }
}

impl BeaconRef {
    pub fn drand_quicknet() -> Self {
        BeaconRef {
            beacon_type: "drand".into(),
            anchor_round: None,
            chain_hash: Some(drand::QUICKNET_CHAIN_HASH.into()),
            version: None,
        }
    }

    /// drand quicknet reference anchored to `anchor_round`.
    pub fn drand_quicknet_anchored(anchor_round: u64) -> Self {
        BeaconRef {
            anchor_round: Some(anchor_round),
            ..Self::drand_quicknet()
        }
    }

    pub fn nist_v2() -> Self {
        BeaconRef {
            beacon_type: "nist".into(),
            anchor_round: None,
            chain_hash: None,
            version: Some("2.0".into()),
        }
    }
}
