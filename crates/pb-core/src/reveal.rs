//! Reveal object construction (Spec Section 6).

use serde::{Serialize, Deserialize};
use crate::canonical;
use crate::sign;

pub const SPEC_VERSION: &str = "0.2.0";

/// Signing payload for reveal.
/// Key order: spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key
#[derive(Serialize)]
struct RevealSigningPayload<'a> {
    spec_version: &'a str,
    commitment_hash: &'a str,
    selected_items: &'a [String],
    voluntary_items: &'a [String],
    revealed_at: &'a str,
    signing_key: &'a str,
}

/// Full reveal object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reveal {
    pub spec_version: String,
    pub commitment_hash: String,
    pub selected_items: Vec<String>,
    pub voluntary_items: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub revealed_at: String,
    pub signing_key: String,
    pub signature: String,
}

/// Compute the canonical signing payload bytes.
pub fn signing_payload(r: &Reveal) -> Vec<u8> {
    let payload = RevealSigningPayload {
        spec_version: &r.spec_version,
        commitment_hash: &r.commitment_hash,
        selected_items: &r.selected_items,
        voluntary_items: &r.voluntary_items,
        revealed_at: &r.revealed_at,
        signing_key: &r.signing_key,
    };
    canonical::to_bytes(&payload).expect("reveal signing payload should not fail")
}

pub struct CreateParams {
    pub commitment_hash: String,
    pub selected_items: Vec<String>,
    pub voluntary_items: Vec<String>,
    pub data_url: Option<String>,
    pub revealed_at: String,
}

/// Create a signed reveal object.
pub fn create(params: CreateParams, kp: &sign::KeyPair) -> Result<Reveal, String> {
    if params.commitment_hash.is_empty() {
        return Err("commitment_hash is required".into());
    }

    let mut r = Reveal {
        spec_version: SPEC_VERSION.into(),
        commitment_hash: params.commitment_hash,
        selected_items: params.selected_items,
        voluntary_items: params.voluntary_items,
        data_url: params.data_url,
        revealed_at: params.revealed_at,
        signing_key: kp.did_key.clone(),
        signature: String::new(),
    };

    let payload_bytes = signing_payload(&r);
    r.signature = sign::sign(&kp.signing_key, &payload_bytes);
    Ok(r)
}

/// Verify reveal signature.
pub fn verify_signature(r: &Reveal) -> Result<(), String> {
    let payload_bytes = signing_payload(r);
    sign::verify(&r.signing_key, &payload_bytes, &r.signature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sign;

    fn test_kp() -> sign::KeyPair { sign::generate_keypair() }

    #[test]
    fn create_basic() {
        let kp = test_kp();
        let r = create(CreateParams {
            commitment_hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".into(),
            selected_items: vec!["b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3".into()],
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).unwrap();
        assert_eq!(r.spec_version, SPEC_VERSION);
        assert!(!r.signature.is_empty());
    }

    #[test]
    fn verify_valid() {
        let kp = test_kp();
        let r = create(CreateParams {
            commitment_hash: "aabb".repeat(16),
            selected_items: vec!["ccdd".repeat(16)],
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).unwrap();
        assert!(verify_signature(&r).is_ok());
    }

    #[test]
    fn verify_tampered() {
        let kp = test_kp();
        let mut r = create(CreateParams {
            commitment_hash: "aabb".repeat(16),
            selected_items: vec![],
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).unwrap();
        r.commitment_hash = "0000".repeat(16);
        assert!(verify_signature(&r).is_err());
    }

    #[test]
    fn signing_payload_key_order() {
        let kp = test_kp();
        let r = create(CreateParams {
            commitment_hash: "aabb".repeat(16),
            selected_items: vec!["sel".into()],
            voluntary_items: vec!["vol".into()],
            data_url: Some("https://example.com".into()),
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).unwrap();
        let payload = String::from_utf8(signing_payload(&r)).unwrap();

        let keys = ["spec_version", "commitment_hash", "selected_items", "voluntary_items", "revealed_at", "signing_key"];
        let mut last = 0;
        for key in &keys {
            let pos = payload.find(&format!("\"{}\"", key)).unwrap();
            assert!(pos >= last, "key {} out of order", key);
            last = pos;
        }
        assert!(!payload.contains("data_url"));
        assert!(!payload.contains("\"signature\""));
    }

    #[test]
    fn reject_empty_commitment_hash() {
        let kp = test_kp();
        assert!(create(CreateParams {
            commitment_hash: "".into(),
            selected_items: vec![],
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp).is_err());
    }

    #[test]
    fn different_signer() {
        let kp1 = test_kp();
        let kp2 = test_kp();
        // Reveal can be signed by a different key than the commitment.
        let r = create(CreateParams {
            commitment_hash: "aabb".repeat(16),
            selected_items: vec![],
            voluntary_items: vec![],
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp2).unwrap();
        assert_eq!(r.signing_key, kp2.did_key);
        assert!(verify_signature(&r).is_ok());
        let _ = kp1;
    }
}
