//! Commitment object construction for both object formats.
//!
//! Format 0.2.0 (Spec v0.4 Section 7): float `reveal_probability`, unsigned
//! `stream_id` and `metadata`, optional anchor. Format 0.5.0 (Spec v0.5
//! Section 7): integer `reveal_probability_ppm`, signed `selection_mode`,
//! `stream_id`, `sequence` and canonical `metadata`, required anchor. The
//! 0.2.0 signing payload is byte-for-byte what it was before 0.5.0 existed.

use serde::{Serialize, Deserialize};
use crate::beacon::{anchor, drand, BeaconRef};
use crate::canonical;
use crate::hash;
use crate::item;
use crate::metadata;
use crate::select_v5;
use crate::sign;

/// Object format of commitments created by `create` (the 0.2.0 path).
pub const SPEC_VERSION: &str = "0.2.0";
/// Object format of commitments created by `create_v5`.
pub const SPEC_VERSION_V5: &str = "0.5.0";
/// Formats this crate can verify.
pub const SUPPORTED_SPEC_VERSIONS: &[&str] = &[SPEC_VERSION, SPEC_VERSION_V5];

/// Longest `stream_id` in bytes (Spec v0.5 Section 7.1).
pub const MAX_STREAM_ID_BYTES: usize = 128;
/// Longest `identity` in bytes.
pub const MAX_IDENTITY_BYTES: usize = 1024;
/// Largest `sequence` and `anchor_round` (2^53 - 1, exact in every JSON parser).
pub const MAX_SAFE_INTEGER: u64 = (1u64 << 53) - 1;

/// 0.2.0 signing payload.
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

/// Full commitment object. Fields of both formats; which ones are present and
/// signed depends on `spec_version`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commitment {
    pub spec_version: String,
    pub commitment_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_id: Option<String>,
    /// 0.5.0 only: position in the stream, signed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    pub items: Vec<String>,
    pub item_count: usize,
    /// 0.2.0 only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_probability: Option<f64>,
    /// 0.5.0 only: parts per million, 1 to 1000000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_probability_ppm: Option<u64>,
    /// 0.5.0 only: "per_item" or "batch".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_mode: Option<String>,
    pub beacon: BeaconRef,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub committed_at: String,
    pub signing_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    pub signature: String,
}

impl Commitment {
    pub fn is_v5(&self) -> bool {
        self.spec_version == SPEC_VERSION_V5
    }

    /// Reveal probability in parts per million, in either format. For 0.2.0
    /// this is a display value only (the float is what selection uses).
    pub fn probability_ppm(&self) -> Option<u64> {
        match (self.reveal_probability_ppm, self.reveal_probability) {
            (Some(ppm), _) => Some(ppm),
            (None, Some(p)) => Some((p * select_v5::PPM as f64).round() as u64),
            (None, None) => None,
        }
    }
}

/// Canonical signing payload bytes for either format.
pub fn signing_payload(c: &Commitment) -> Result<Vec<u8>, String> {
    match c.spec_version.as_str() {
        SPEC_VERSION => {
            let reveal_probability = c.reveal_probability
                .ok_or("0.2.0 commitment has no reveal_probability")?;
            let payload = SigningPayload {
                spec_version: &c.spec_version,
                items: &c.items,
                item_count: c.item_count,
                reveal_probability,
                beacon: &c.beacon,
                committed_at: &c.committed_at,
                signing_key: &c.signing_key,
                identity: c.identity.as_deref(),
            };
            canonical::to_bytes(&payload).map_err(|e| format!("serialize signing payload: {e}"))
        }
        SPEC_VERSION_V5 => signing_payload_v5(c),
        other => Err(format!("unsupported spec_version: {other}")),
    }
}

/// 0.5.0 signing payload (Spec v0.5 Section 7.2), written field by field so
/// that every byte is under this function's control.
fn signing_payload_v5(c: &Commitment) -> Result<Vec<u8>, String> {
    let ppm = c.reveal_probability_ppm.ok_or("0.5.0 commitment has no reveal_probability_ppm")?;
    let mode = c.selection_mode.as_deref().ok_or("0.5.0 commitment has no selection_mode")?;
    let anchor_round = c.beacon.anchor_round.ok_or("0.5.0 commitment has no beacon.anchor_round")?;
    let chain_hash = c.beacon.chain_hash.as_deref().ok_or("0.5.0 commitment has no beacon.chain_hash")?;
    let metadata = metadata::canonical_metadata(&c.metadata)?;

    let mut out = String::with_capacity(512 + 67 * c.items.len());
    let s = |out: &mut String, v: &str| metadata::write_string(v, out);
    out.push_str("{\"spec_version\":");
    s(&mut out, &c.spec_version);
    out.push_str(",\"items\":[");
    for (i, it) in c.items.iter().enumerate() {
        if i > 0 { out.push(','); }
        s(&mut out, it);
    }
    out.push_str("],\"item_count\":");
    out.push_str(&c.item_count.to_string());
    out.push_str(",\"reveal_probability_ppm\":");
    out.push_str(&ppm.to_string());
    out.push_str(",\"selection_mode\":");
    s(&mut out, mode);
    out.push_str(",\"beacon\":{\"type\":");
    s(&mut out, &c.beacon.beacon_type);
    out.push_str(",\"anchor_round\":");
    out.push_str(&anchor_round.to_string());
    out.push_str(",\"chain_hash\":");
    s(&mut out, chain_hash);
    out.push('}');
    if let Some(stream_id) = &c.stream_id {
        out.push_str(",\"stream_id\":");
        s(&mut out, stream_id);
    }
    if let Some(sequence) = c.sequence {
        out.push_str(",\"sequence\":");
        out.push_str(&sequence.to_string());
    }
    out.push_str(",\"metadata\":");
    out.push_str(&metadata);
    out.push_str(",\"committed_at\":");
    s(&mut out, &c.committed_at);
    out.push_str(",\"signing_key\":");
    s(&mut out, &c.signing_key);
    if let Some(identity) = &c.identity {
        out.push_str(",\"identity\":");
        s(&mut out, identity);
    }
    out.push('}');
    Ok(out.into_bytes())
}

/// Compute commitment_hash from signing payload bytes.
pub fn compute_hash(payload_bytes: &[u8]) -> String {
    hash::hash_bytes(payload_bytes)
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn check_items(items: &[String], item_count: usize) -> Result<(), String> {
    if items.is_empty() {
        return Err("at least one item is required".into());
    }
    if items.len() != item_count {
        return Err(format!("item_count {} does not match {} items", item_count, items.len()));
    }
    let mut seen = std::collections::HashSet::new();
    for item in items {
        if !is_hex64(item) {
            return Err(format!("item must be 64 lowercase hex characters: {item}"));
        }
        if !seen.insert(item.as_str()) {
            return Err(format!("duplicate item: {item}"));
        }
    }
    Ok(())
}

/// Well-formedness of a 0.5.0 commitment (Spec v0.5 Section 7.5). Does not
/// check the signature or the hash.
pub fn validate_v5(c: &Commitment) -> Result<(), String> {
    if c.spec_version != SPEC_VERSION_V5 {
        return Err(format!("spec_version must be {SPEC_VERSION_V5}, got {}", c.spec_version));
    }
    if c.reveal_probability.is_some() {
        return Err("0.5.0 commitment must not carry reveal_probability; use reveal_probability_ppm".into());
    }
    check_items(&c.items, c.item_count)?;
    select_v5::validate_ppm(c.reveal_probability_ppm.ok_or("reveal_probability_ppm is required")?)?;
    match c.selection_mode.as_deref() {
        Some(select_v5::MODE_PER_ITEM) | Some(select_v5::MODE_BATCH) => {}
        Some(other) => return Err(format!("selection_mode must be per_item or batch, got {other}")),
        None => return Err("selection_mode is required".into()),
    }
    if c.beacon.beacon_type != "drand" {
        return Err(format!("beacon.type must be drand in 0.5.0, got {}", c.beacon.beacon_type));
    }
    match c.beacon.chain_hash.as_deref() {
        Some(h) if h == drand::QUICKNET_CHAIN_HASH => {}
        Some(h) => return Err(format!("beacon.chain_hash {h} is not the drand quicknet chain")),
        None => return Err("beacon.chain_hash is required".into()),
    }
    match c.beacon.anchor_round {
        Some(r) if r >= 1 && r <= MAX_SAFE_INTEGER && anchor::selection_round(r).is_some() => {}
        Some(r) => return Err(format!("beacon.anchor_round {r} is not a usable round number")),
        None => return Err("beacon.anchor_round is required in 0.5.0".into()),
    }
    match (&c.stream_id, c.sequence) {
        (None, None) => {}
        (Some(_), None) => return Err("sequence is required when stream_id is present".into()),
        (None, Some(_)) => return Err("sequence requires stream_id".into()),
        (Some(stream_id), Some(sequence)) => {
            if stream_id.is_empty() || stream_id.len() > MAX_STREAM_ID_BYTES {
                return Err(format!("stream_id must be 1 to {MAX_STREAM_ID_BYTES} bytes"));
            }
            if stream_id.chars().any(|ch| (ch as u32) < 0x20 || ch == '\u{7f}') {
                return Err("stream_id must not contain control characters".into());
            }
            if sequence > MAX_SAFE_INTEGER {
                return Err(format!("sequence {sequence} exceeds 2^53 - 1"));
            }
        }
    }
    metadata::canonical_metadata(&c.metadata)?;
    if anchor::parse_rfc3339_ms(&c.committed_at).is_none() {
        return Err(format!("committed_at is not an RFC 3339 timestamp: {}", c.committed_at));
    }
    sign::decode_did_key(&c.signing_key)?;
    if let Some(identity) = &c.identity {
        if identity.is_empty() || identity.len() > MAX_IDENTITY_BYTES {
            return Err(format!("identity must be 1 to {MAX_IDENTITY_BYTES} bytes"));
        }
    }
    if !is_hex64(&c.commitment_hash) {
        return Err("commitment_hash must be 64 lowercase hex characters".into());
    }
    Ok(())
}

/// Parameters for creating a 0.2.0 commitment.
pub struct CreateParams {
    pub items: Vec<String>,
    pub reveal_probability: f64,
    pub beacon: BeaconRef,
    pub metadata: Option<serde_json::Value>,
    pub stream_id: Option<String>,
    pub committed_at: String,
    pub identity: Option<String>,
}

/// Create a signed 0.2.0 commitment.
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
        sequence: None,
        items: params.items,
        item_count: 0,
        reveal_probability: Some(params.reveal_probability),
        reveal_probability_ppm: None,
        selection_mode: None,
        beacon: params.beacon,
        metadata,
        committed_at: params.committed_at,
        signing_key: kp.did_key.clone(),
        identity: params.identity,
        signature: String::new(),
    };
    c.item_count = c.items.len();

    let payload_bytes = signing_payload(&c)?;
    c.signature = sign::sign(&kp.signing_key, &payload_bytes);
    c.commitment_hash = compute_hash(&payload_bytes);

    Ok(c)
}

/// Parameters for creating a 0.5.0 commitment. `items` are item commitments
/// (Spec v0.5 Section 5), not plain hashes.
pub struct CreateParamsV5 {
    pub items: Vec<String>,
    pub reveal_probability_ppm: u64,
    pub selection_mode: String,
    pub anchor_round: u64,
    pub stream_id: Option<String>,
    pub sequence: Option<u64>,
    pub metadata: Option<serde_json::Value>,
    pub committed_at: String,
    pub identity: Option<String>,
}

/// Create a signed 0.5.0 commitment. Fails if the result would not be well formed.
pub fn create_v5(params: CreateParamsV5, kp: &sign::KeyPair) -> Result<Commitment, String> {
    let metadata = params.metadata.unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    let mut c = Commitment {
        spec_version: SPEC_VERSION_V5.into(),
        commitment_hash: "0".repeat(64),
        stream_id: params.stream_id,
        sequence: params.sequence,
        item_count: params.items.len(),
        items: params.items,
        reveal_probability: None,
        reveal_probability_ppm: Some(params.reveal_probability_ppm),
        selection_mode: Some(params.selection_mode),
        beacon: BeaconRef::drand_quicknet_anchored(params.anchor_round),
        metadata,
        committed_at: params.committed_at,
        signing_key: kp.did_key.clone(),
        identity: params.identity,
        signature: String::new(),
    };
    validate_v5(&c)?;
    let payload_bytes = signing_payload(&c)?;
    c.signature = sign::sign(&kp.signing_key, &payload_bytes);
    c.commitment_hash = compute_hash(&payload_bytes);
    Ok(c)
}

/// Item commitments for plain item hashes under one item secret (Spec v0.5
/// Section 5.2). Returns `(item_commitments, salts)` in input order.
pub fn commit_items(item_secret: &[u8; 32], item_hashes: &[String]) -> Result<(Vec<String>, Vec<String>), String> {
    let mut items = Vec::with_capacity(item_hashes.len());
    let mut salts = Vec::with_capacity(item_hashes.len());
    for h in item_hashes {
        let hash = item::decode_hash32(h, "item hash")?;
        let salt = item::derive_salt(item_secret, &hash);
        items.push(hex::encode(item::item_commitment(&salt, &hash)));
        salts.push(hex::encode(salt));
    }
    Ok((items, salts))
}

/// Verify commitment signature and hash. For 0.5.0 the commitment must also
/// be well formed, since the payload is built from the parsed fields.
pub fn verify_signature(c: &Commitment) -> Result<(), String> {
    if c.is_v5() {
        validate_v5(c)?;
    }
    let payload_bytes = signing_payload(c)?;

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
        c.reveal_probability = Some(0.99);
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
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
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
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
        assert!(!payload.contains('\n'));
        assert!(!payload.contains("  "));
    }

    #[test]
    fn commitment_hash_deterministic() {
        let kp = test_kp();
        let c = test_create(&kp);
        let p1 = signing_payload(&c).unwrap();
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
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
        assert!(!payload.contains("stream_id"));
    }

    #[test]
    fn beacon_key_order_drand() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
        let type_pos = payload.find("\"type\"").unwrap();
        let chain_pos = payload.find("\"chain_hash\"").unwrap();
        assert!(type_pos < chain_pos);
    }

    #[test]
    fn without_identity_same_payload() {
        let kp = test_kp();
        let c = test_create(&kp);
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
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

        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
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

    // ── 0.2.0 vectors stay valid (Spec v0.4 13.6 and 13.7) ──

    fn rfc8032_kp() -> sign::KeyPair {
        let bytes: [u8; 32] = hex::decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").unwrap().try_into().unwrap();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();
        sign::KeyPair { signing_key, verifying_key, did_key: sign::encode_did_key(&verifying_key) }
    }

    fn v4_items() -> Vec<String> {
        vec![
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8".into(),
            "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2".into(),
        ]
    }

    #[test]
    fn v4_vector_13_6_unanchored() {
        let c = create(CreateParams {
            items: v4_items(), reveal_probability: 0.1, beacon: BeaconRef::drand_quicknet(),
            metadata: None, stream_id: None, committed_at: "2026-02-06T14:30:00Z".into(), identity: None,
        }, &rfc8032_kp()).unwrap();
        assert_eq!(c.commitment_hash, "39b23208e0f65e4e2e5c0cd52e7eacb26047aaf9b4d89bb1280c3b78a21b33ac");
        assert_eq!(c.signature, "5516f721b6f71554c8bacc6b3458a2427db9fd4d2367a0722e6fa2e08366e1c59cc1aba2cec6563a61a80026a58b155746951b3e74fb662a3891dde4994aaa07");
    }

    #[test]
    fn v4_vector_13_7_anchored() {
        let c = create(CreateParams {
            items: v4_items(), reveal_probability: 0.1, beacon: BeaconRef::drand_quicknet_anchored(25892262),
            metadata: None, stream_id: None, committed_at: "2026-02-06T14:30:00Z".into(), identity: None,
        }, &rfc8032_kp()).unwrap();
        assert_eq!(c.commitment_hash, "d3e6d24523acbbae6c586378da650bbcf2b3419974a938e7fa3aeb5051d9a59b");
        assert_eq!(c.signature, "f52fd33cdedd906ba795aa06fe13e7b944bac5506d058846eae8407cbfa2c9dc452695f57c06035f8175bda4809a4bb2a96893de6b8ec48dc641984a570f5e07");
    }

    // ── 0.5.0 ──

    const SECRET: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    fn v5_item_hashes() -> Vec<String> {
        [
            "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
            "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
            "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da",
            "4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030",
            "57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
        ].map(String::from).to_vec()
    }

    fn v5_items() -> Vec<String> {
        let secret: [u8; 32] = hex::decode(SECRET).unwrap().try_into().unwrap();
        commit_items(&secret, &v5_item_hashes()).unwrap().0
    }

    /// Spec v0.5 Section 13.12.
    pub(crate) fn vector_a(kp: &sign::KeyPair) -> Commitment {
        create_v5(CreateParamsV5 {
            items: v5_items(),
            reveal_probability_ppm: 400000,
            selection_mode: "batch".into(),
            anchor_round: 25892262,
            stream_id: Some("bench-2026".into()),
            sequence: Some(7),
            metadata: Some(serde_json::from_str(r#"{"b": 1, "a": "x", "nested": {"z": [true, null], "y": "é\n"}}"#).unwrap()),
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, kp).unwrap()
    }

    #[test]
    fn v5_vector_13_12_commitment_a() {
        let c = vector_a(&rfc8032_kp());
        let payload = String::from_utf8(signing_payload(&c).unwrap()).unwrap();
        assert_eq!(payload, "{\"spec_version\":\"0.5.0\",\"items\":[\"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf\",\"da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a\",\"5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d\",\"47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e\",\"7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c\"],\"item_count\":5,\"reveal_probability_ppm\":400000,\"selection_mode\":\"batch\",\"beacon\":{\"type\":\"drand\",\"anchor_round\":25892262,\"chain_hash\":\"52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971\"},\"stream_id\":\"bench-2026\",\"sequence\":7,\"metadata\":{\"a\":\"x\",\"b\":1,\"nested\":{\"y\":\"é\\n\",\"z\":[true,null]}},\"committed_at\":\"2026-02-06T14:30:00Z\",\"signing_key\":\"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw\"}");
        assert_eq!(c.commitment_hash, "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826");
        assert_eq!(c.signature, "a399931bbae7c576b95cff32710726f2151043afaa462fe48e83d1a3454da7158851f10097707b0acbe0bfe03094346ccdddab9fdedf2c45177051c6e410880c");
        verify_signature(&c).unwrap();
    }

    #[test]
    fn v5_vector_13_14_commitment_b() {
        let c = create_v5(CreateParamsV5 {
            items: v5_items()[..2].to_vec(),
            reveal_probability_ppm: 100000,
            selection_mode: "per_item".into(),
            anchor_round: 25892262,
            stream_id: None,
            sequence: None,
            metadata: None,
            committed_at: "2026-02-06T14:30:00Z".into(),
            identity: None,
        }, &rfc8032_kp()).unwrap();
        assert_eq!(c.commitment_hash, "d92fb2774202942e3a838d7c8cbb00d6e4de3b46af0a6ac67f74db7529627efa");
        assert_eq!(c.signature, "60d2b1c846fd95e9bb2b48db87d19e88cee9373ac0306a429b07e359fd6a0531592d4834f9cf0bbff22c411af18c968884223fbdff3fa3cf4ef46af947b5230c");
        assert!(String::from_utf8(signing_payload(&c).unwrap()).unwrap().contains("\"metadata\":{}"));
    }

    #[test]
    fn v5_roundtrips_through_json() {
        let c = vector_a(&rfc8032_kp());
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("reveal_probability\":"), "0.5.0 JSON carries no float probability: {json}");
        let back: Commitment = serde_json::from_str(&json).unwrap();
        verify_signature(&back).unwrap();
        assert_eq!(back.commitment_hash, c.commitment_hash);
    }

    #[test]
    fn v5_metadata_order_in_input_does_not_matter() {
        let c = vector_a(&rfc8032_kp());
        let mut json: serde_json::Value = serde_json::to_value(&c).unwrap();
        json["metadata"] = serde_json::from_str(r#"{"nested": {"y": "é\n", "z": [true, null]}, "b": 1, "a": "x"}"#).unwrap();
        let back: Commitment = serde_json::from_value(json).unwrap();
        verify_signature(&back).unwrap();
    }

    #[test]
    fn v5_signed_fields_are_tamper_proof() {
        let kp = rfc8032_kp();
        let base = vector_a(&kp);
        let mutations: Vec<(&str, Box<dyn Fn(&mut Commitment)>)> = vec![
            ("stream_id", Box::new(|c| c.stream_id = Some("bench-2027".into()))),
            ("sequence", Box::new(|c| c.sequence = Some(8))),
            ("metadata", Box::new(|c| c.metadata = serde_json::json!({"a": "y"}))),
            ("selection_mode", Box::new(|c| c.selection_mode = Some("per_item".into()))),
            ("ppm", Box::new(|c| c.reveal_probability_ppm = Some(400001))),
            ("anchor", Box::new(|c| c.beacon.anchor_round = Some(25892263))),
            ("item", Box::new(|c| c.items[0] = "0".repeat(64))),
            ("identity", Box::new(|c| c.identity = Some("did:web:x".into()))),
            ("stream removed", Box::new(|c| { c.stream_id = None; c.sequence = None; })),
        ];
        for (name, mutate) in mutations {
            let mut c = base.clone();
            mutate(&mut c);
            assert!(verify_signature(&c).is_err(), "{name} changed but still verifies");
        }
    }

    #[test]
    fn v5_malformed_commitments_are_rejected() {
        let kp = rfc8032_kp();
        let base = vector_a(&kp);
        let cases: Vec<(&str, Box<dyn Fn(&mut Commitment)>)> = vec![
            ("no anchor", Box::new(|c| c.beacon.anchor_round = None)),
            ("anchor 0", Box::new(|c| c.beacon.anchor_round = Some(0))),
            ("anchor too big", Box::new(|c| c.beacon.anchor_round = Some(MAX_SAFE_INTEGER + 1))),
            ("ppm 0", Box::new(|c| c.reveal_probability_ppm = Some(0))),
            ("ppm 1000001", Box::new(|c| c.reveal_probability_ppm = Some(1_000_001))),
            ("float probability present", Box::new(|c| c.reveal_probability = Some(0.4))),
            ("bad mode", Box::new(|c| c.selection_mode = Some("favorite".into()))),
            ("no mode", Box::new(|c| c.selection_mode = None)),
            ("stream without sequence", Box::new(|c| c.sequence = None)),
            ("sequence without stream", Box::new(|c| c.stream_id = None)),
            ("empty stream", Box::new(|c| c.stream_id = Some(String::new()))),
            ("long stream", Box::new(|c| c.stream_id = Some("x".repeat(129)))),
            ("control char in stream", Box::new(|c| c.stream_id = Some("a\tb".into()))),
            ("sequence too big", Box::new(|c| c.sequence = Some(MAX_SAFE_INTEGER + 1))),
            ("float metadata", Box::new(|c| c.metadata = serde_json::json!({"a": 1.5}))),
            ("array metadata", Box::new(|c| c.metadata = serde_json::json!([1]))),
            ("uppercase item", Box::new(|c| c.items[0] = c.items[0].to_uppercase())),
            ("duplicate item", Box::new(|c| c.items[1] = c.items[0].clone())),
            ("item_count off", Box::new(|c| c.item_count = 4)),
            ("other chain", Box::new(|c| c.beacon.chain_hash = Some("00".repeat(32)))),
            ("other beacon", Box::new(|c| c.beacon.beacon_type = "nist".into())),
            ("bad committed_at", Box::new(|c| c.committed_at = "yesterday".into())),
            ("bad signing key", Box::new(|c| c.signing_key = "did:web:x".into())),
            ("empty identity", Box::new(|c| c.identity = Some(String::new()))),
        ];
        for (name, mutate) in cases {
            let mut c = base.clone();
            mutate(&mut c);
            assert!(validate_v5(&c).is_err(), "{name} accepted as well formed");
            assert!(verify_signature(&c).is_err(), "{name} verifies");
        }
        assert!(validate_v5(&base).is_ok());
    }

    #[test]
    fn create_v5_refuses_malformed_params() {
        let kp = rfc8032_kp();
        let ok = |f: &dyn Fn(&mut CreateParamsV5)| {
            let mut p = CreateParamsV5 {
                items: v5_items(), reveal_probability_ppm: 100000, selection_mode: "batch".into(),
                anchor_round: 25892262, stream_id: None, sequence: None, metadata: None,
                committed_at: "2026-02-06T14:30:00Z".into(), identity: None,
            };
            f(&mut p);
            create_v5(p, &kp)
        };
        assert!(ok(&|_| {}).is_ok());
        assert!(ok(&|p| p.items = vec![]).is_err());
        assert!(ok(&|p| p.reveal_probability_ppm = 0).is_err());
        assert!(ok(&|p| p.selection_mode = "all".into()).is_err());
        assert!(ok(&|p| p.anchor_round = 0).is_err());
        assert!(ok(&|p| p.stream_id = Some("s".into())).is_err());
        assert!(ok(&|p| p.metadata = Some(serde_json::json!({"x": 0.5}))).is_err());
    }

    #[test]
    fn unknown_spec_version_is_an_error() {
        let mut c = vector_a(&rfc8032_kp());
        c.spec_version = "0.3.0".into();
        assert!(signing_payload(&c).is_err());
        assert!(verify_signature(&c).is_err());
    }

    #[test]
    fn probability_ppm_in_both_formats() {
        assert_eq!(vector_a(&rfc8032_kp()).probability_ppm(), Some(400000));
        assert_eq!(test_create(&test_kp()).probability_ppm(), Some(100000));
    }
}
