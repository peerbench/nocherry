//! Commitment object construction (Spec Sections 3.1-3.3).

use serde::{Serialize, Deserialize};
use crate::beacon::BeaconRef;
use crate::canonical;
use crate::hash;
use crate::sign;

pub const SPEC_VERSION: &str = "0.2.0";

/// Signing payload — canonical JSON of commitment with specific fields in order.
/// Key order: spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key, identity
#[derive(Serialize)]
struct SigningPayload<'a> {
    spec_version: &'a str,
    items: &'a [String],
    item_count: usize,
    reveal_probability: f64,
    beacon: &'a BeaconRef,
    committed_at: &'a str,
    signing_key: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity: Option<&'a str>,
}

/// Full commitment object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commitment {
    pub spec_version: String,
    pub commitment_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_id: Option<String>,
    pub items: Vec<String>,
    pub item_count: usize,
    pub reveal_probability: f64,
    pub beacon: BeaconRef,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub committed_at: String,
    pub signing_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    pub signature: String,
}

/// Compute the canonical signing payload bytes.
pub fn signing_payload(c: &Commitment) -> Vec<u8> {
    let payload = SigningPayload {
        spec_version: &c.spec_version,
        items: &c.items,
        item_count: c.item_count,
        reveal_probability: c.reveal_probability,
        beacon: &c.beacon,
        committed_at: &c.committed_at,
        signing_key: &c.signing_key,
        identity: c.identity.as_deref(),
    };
    canonical::to_bytes(&payload).expect("signing payload serialization should not fail")
}

/// Compute commitment_hash from signing payload bytes.
pub fn compute_hash(payload_bytes: &[u8]) -> String {
    hash::hash_bytes(payload_bytes)
}

/// Parameters for creating a new commitment.
pub struct CreateParams {
    pub items: Vec<String>,
    pub reveal_probability: f64,
    pub beacon: BeaconRef,
    pub metadata: Option<serde_json::Value>,
    pub stream_id: Option<String>,
    pub committed_at: String,
    pub identity: Option<String>,
}

/// Create a signed commitment.
pub fn create(params: CreateParams, kp: &sign::KeyPair) -> Result<Commitment, String> {
    if params.items.is_empty() {
        return Err("at least one item is required".into());
    }
    if params.reveal_probability.is_nan() || params.reveal_probability <= 0.0 || params.reveal_probability > 1.0 {
        return Err(format!("reveal_probability must be in (0.0, 1.0], got {}", params.reveal_probability));
    }

    // Check for duplicates and valid hex.
    let mut seen = std::collections::HashSet::new();
    for item in &params.items {
        if item.len() != 64 {
            return Err(format!("item hash must be 64 hex chars, got {}: {}", item.len(), item));
        }
        if !seen.insert(item.clone()) {
            return Err(format!("duplicate item hash: {}", item));
        }
    }

    let metadata = params.metadata.unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let mut c = Commitment {
        spec_version: SPEC_VERSION.into(),
        commitment_hash: String::new(),
        stream_id: params.stream_id,
        items: params.items,
        item_count: 0,
        reveal_probability: params.reveal_probability,
        beacon: params.beacon,
        metadata,
        committed_at: params.committed_at,
        signing_key: kp.did_key.clone(),
        identity: params.identity,
        signature: String::new(),
    };
    c.item_count = c.items.len();

    let payload_bytes = signing_payload(&c);
    c.signature = sign::sign(&kp.signing_key, &payload_bytes);
    c.commitment_hash = compute_hash(&payload_bytes);

    Ok(c)
}

/// Verify commitment signature and hash.
pub fn verify_signature(c: &Commitment) -> Result<(), String> {
    let payload_bytes = signing_payload(c);

    // Check commitment_hash matches.
    let expected_hash = compute_hash(&payload_bytes);
    if c.commitment_hash != expected_hash {
        return Err(format!(
            "commitment_hash mismatch: got {}, want {}",
            c.commitment_hash, expected_hash
        ));
    }

    sign::verify(&c.signing_key, &payload_bytes, &c.signature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::beacon::BeaconRef;
    use crate::sign;

    fn test_kp() -> sign::KeyPair { sign::generate_keypair() }

    fn test_item() -> String {
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".into()
    }

    fn test_create(kp: &sign::KeyPair) -> Commitment {
        create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, kp).unwrap()
    }

    #[test]
    fn create_basic() {
        let kp = test_kp();
        let c = test_create(&kp);
        assert_eq!(c.spec_version, SPEC_VERSION);
        assert_eq!(c.item_count, 1);
        assert_eq!(c.commitment_hash.len(), 64);
        assert!(!c.signature.is_empty());
        assert_eq!(c.signing_key, kp.did_key);
    }

    #[test]
    fn verify_valid() {
        let kp = test_kp();
        let c = test_create(&kp);
        assert!(verify_signature(&c).is_ok());
    }

    #[test]
    fn verify_tampered_item() {
        let kp = test_kp();
        let mut c = test_create(&kp);
        c.items[0] = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".into();
        assert!(verify_signature(&c).is_err());
    }

    #[test]
    fn verify_tampered_hash() {
        let kp = test_kp();
        let mut c = test_create(&kp);
        c.commitment_hash = "0000000000000000000000000000000000000000000000000000000000000000".into();
        assert!(verify_signature(&c).is_err());
    }

    #[test]
    fn verify_tampered_probability() {
        let kp = test_kp();
        let mut c = test_create(&kp);
        c.reveal_probability = 0.99;
        assert!(verify_signature(&c).is_err());
    }

    #[test]
    fn reject_empty_items() {
        let kp = test_kp();
        let result = create(CreateParams {
            items: vec![],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp);
        assert!(result.is_err());
    }

    #[test]
    fn reject_duplicate_items() {
        let kp = test_kp();
        let item = test_item();
        let result = create(CreateParams {
            items: vec![item.clone(), item],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp);
        assert!(result.is_err());
    }

    #[test]
    fn reject_invalid_probability() {
        let kp = test_kp();
        assert!(create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 0.0,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None, stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp).is_err());

        assert!(create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 1.5,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None, stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp).is_err());
    }

    #[test]
    fn p_1_is_valid() {
        let kp = test_kp();
        let c = create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 1.0,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None, stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp);
        assert!(c.is_ok());
    }

    #[test]
    fn signing_payload_key_order() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        let keys = ["spec_version", "items", "item_count", "reveal_probability", "beacon", "committed_at", "signing_key"];
        let mut last = 0;
        for key in &keys {
            let pos = payload.find(&format!("\"{}\"", key)).unwrap();
            assert!(pos > last || *key == "spec_version", "key {} out of order", key);
            last = pos;
        }
        // Excluded fields
        assert!(!payload.contains("commitment_hash"));
        assert!(!payload.contains("stream_id"));
        assert!(!payload.contains("metadata"));
        assert!(!payload.contains("\"signature\""));
    }

    #[test]
    fn signing_payload_no_whitespace() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        assert!(!payload.contains('\n'));
        assert!(!payload.contains("  "));
    }

    #[test]
    fn commitment_hash_deterministic() {
        let kp = test_kp();
        let c = test_create(&kp);
        let p1 = signing_payload(&c);
        let h1 = compute_hash(&p1);
        let h2 = compute_hash(&p1);
        assert_eq!(h1, h2);
    }

    #[test]
    fn with_stream_id() {
        let kp = test_kp();
        let c = create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: Some("s_test123".into()),
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &kp).unwrap();
        assert_eq!(c.stream_id, Some("s_test123".into()));
        // stream_id should NOT be in signing payload
        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        assert!(!payload.contains("stream_id"));
    }

    #[test]
    fn beacon_key_order_drand() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        let type_pos = payload.find("\"type\"").unwrap();
        let chain_pos = payload.find("\"chain_hash\"").unwrap();
        assert!(type_pos < chain_pos);
    }

    #[test]
    fn without_identity_same_payload() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        assert!(!payload.contains("identity"), "identity should be omitted when None");
        // Key order should remain the same as before
        let keys = ["spec_version", "items", "item_count", "reveal_probability", "beacon", "committed_at", "signing_key"];
        let mut last = 0;
        for key in &keys {
            let pos = payload.find(&format!("\"{}\"", key)).unwrap();
            assert!(pos > last || *key == "spec_version", "key {} out of order", key);
            last = pos;
        }
    }

    #[test]
    fn with_identity_included_in_payload() {
        let kp = test_kp();
        let c = create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: Some("did:web:alice.example.com".into()),
        }, &kp).unwrap();

        assert_eq!(c.identity, Some("did:web:alice.example.com".into()));

        let payload = String::from_utf8(signing_payload(&c)).unwrap();
        assert!(payload.contains("\"identity\""), "identity should be in signing payload");
        assert!(payload.contains("did:web:alice.example.com"));

        // identity should come after signing_key
        let sk_pos = payload.find("\"signing_key\"").unwrap();
        let id_pos = payload.find("\"identity\"").unwrap();
        assert!(id_pos > sk_pos, "identity should come after signing_key");

        // Verify signature still works
        assert!(verify_signature(&c).is_ok());
    }

    #[test]
    fn identity_is_tamper_proof() {
        let kp = test_kp();
        let mut c = create(CreateParams {
            items: vec![test_item()],
            reveal_probability: 0.10,
            beacon: BeaconRef::drand_quicknet(),
            metadata: None,
            stream_id: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: Some("did:web:alice.example.com".into()),
        }, &kp).unwrap();

        // Tamper with identity
        c.identity = Some("did:web:evil.example.com".into());
        assert!(verify_signature(&c).is_err(), "tampered identity should fail verification");
    }
}
