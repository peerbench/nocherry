//! Reveal object construction for both object formats.
//!
//! Format 0.2.0 (Spec v0.4 Section 10) lists plain item hashes. Format 0.5.0
//! (Spec v0.5 Section 10) lists item commitments and carries a signed
//! `openings` array with the salt and plain hash of every revealed item.

use serde::{Serialize, Deserialize};
use crate::canonical;
use crate::item;
use crate::metadata;
use crate::sign;

pub const SPEC_VERSION: &str = "0.2.0";
pub const SPEC_VERSION_V5: &str = "0.5.0";

/// 0.2.0 signing payload.
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

/// Opening of one item commitment (Spec v0.5 Section 10.3). Key order: item, salt, hash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Opening {
    pub item: String,
    pub salt: String,
    pub hash: String,
}

/// Full reveal object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reveal {
    pub spec_version: String,
    pub commitment_hash: String,
    pub selected_items: Vec<String>,
    pub voluntary_items: Vec<String>,
    /// 0.5.0 only: one opening per revealed item, selected then voluntary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openings: Option<Vec<Opening>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub revealed_at: String,
    pub signing_key: String,
    pub signature: String,
}

impl Reveal {
    pub fn is_v5(&self) -> bool {
        self.spec_version == SPEC_VERSION_V5
    }

    /// Every revealed item, selected first.
    pub fn revealed_items(&self) -> impl Iterator<Item = &String> {
        self.selected_items.iter().chain(self.voluntary_items.iter())
    }

    /// The opening of an item, if the reveal carries one.
    pub fn opening_of(&self, item: &str) -> Option<&Opening> {
        self.openings.as_ref()?.iter().find(|o| o.item == item)
    }
}

/// Canonical signing payload bytes for either format.
pub fn signing_payload(r: &Reveal) -> Result<Vec<u8>, String> {
    match r.spec_version.as_str() {
        SPEC_VERSION => {
            let payload = RevealSigningPayload {
                spec_version: &r.spec_version,
                commitment_hash: &r.commitment_hash,
                selected_items: &r.selected_items,
                voluntary_items: &r.voluntary_items,
                revealed_at: &r.revealed_at,
                signing_key: &r.signing_key,
            };
            canonical::to_bytes(&payload).map_err(|e| format!("serialize reveal payload: {e}"))
        }
        SPEC_VERSION_V5 => signing_payload_v5(r),
        other => Err(format!("unsupported reveal spec_version: {other}")),
    }
}

/// 0.5.0 signing payload (Spec v0.5 Section 10.4).
fn signing_payload_v5(r: &Reveal) -> Result<Vec<u8>, String> {
    let openings = r.openings.as_ref().ok_or("0.5.0 reveal has no openings")?;
    let mut out = String::new();
    let s = |out: &mut String, v: &str| metadata::write_string(v, out);
    let list = |out: &mut String, items: &[String]| {
        out.push('[');
        for (i, it) in items.iter().enumerate() {
            if i > 0 { out.push(','); }
            metadata::write_string(it, out);
        }
        out.push(']');
    };
    out.push_str("{\"spec_version\":");
    s(&mut out, &r.spec_version);
    out.push_str(",\"commitment_hash\":");
    s(&mut out, &r.commitment_hash);
    out.push_str(",\"selected_items\":");
    list(&mut out, &r.selected_items);
    out.push_str(",\"voluntary_items\":");
    list(&mut out, &r.voluntary_items);
    out.push_str(",\"openings\":[");
    for (i, o) in openings.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str("{\"item\":");
        s(&mut out, &o.item);
        out.push_str(",\"salt\":");
        s(&mut out, &o.salt);
        out.push_str(",\"hash\":");
        s(&mut out, &o.hash);
        out.push('}');
    }
    out.push_str("],\"revealed_at\":");
    s(&mut out, &r.revealed_at);
    out.push_str(",\"signing_key\":");
    s(&mut out, &r.signing_key);
    out.push('}');
    Ok(out.into_bytes())
}

/// Structural rules of a 0.5.0 reveal (Spec v0.5 Section 10.3): item lists
/// are distinct hex, and `openings` has one matching, valid entry per revealed
/// item in order. Does not look at the commitment.
pub fn validate_v5(r: &Reveal) -> Result<(), String> {
    if r.spec_version != SPEC_VERSION_V5 {
        return Err(format!("spec_version must be {SPEC_VERSION_V5}, got {}", r.spec_version));
    }
    item::decode_hash32(&r.commitment_hash, "commitment_hash")?;
    let mut seen = std::collections::HashSet::new();
    for it in r.revealed_items() {
        item::decode_hash32(it, "revealed item")?;
        if !seen.insert(it.as_str()) {
            return Err(format!("item {it} is listed twice in the reveal"));
        }
    }
    let openings = r.openings.as_ref().ok_or("openings is required in a 0.5.0 reveal")?;
    let revealed: Vec<&String> = r.revealed_items().collect();
    if openings.len() != revealed.len() {
        return Err(format!("{} openings for {} revealed items", openings.len(), revealed.len()));
    }
    for (o, it) in openings.iter().zip(revealed) {
        if &o.item != it {
            return Err(format!("opening for {} is out of order, expected {it}", o.item));
        }
        item::verify_opening(&o.item, &o.salt, &o.hash)?;
    }
    Ok(())
}

pub struct CreateParams {
    pub commitment_hash: String,
    pub selected_items: Vec<String>,
    pub voluntary_items: Vec<String>,
    pub data_url: Option<String>,
    pub revealed_at: String,
}

/// Create a signed 0.2.0 reveal object.
pub fn create(params: CreateParams, kp: &sign::KeyPair) -> Result<Reveal, String> {
    if params.commitment_hash.is_empty() {
        return Err("commitment_hash is required".into());
    }

    let mut r = Reveal {
        spec_version: SPEC_VERSION.into(),
        commitment_hash: params.commitment_hash,
        selected_items: params.selected_items,
        voluntary_items: params.voluntary_items,
        openings: None,
        data_url: params.data_url,
        revealed_at: params.revealed_at,
        signing_key: kp.did_key.clone(),
        signature: String::new(),
    };

    let payload_bytes = signing_payload(&r)?;
    r.signature = sign::sign(&kp.signing_key, &payload_bytes);
    Ok(r)
}

pub struct CreateParamsV5 {
    pub commitment_hash: String,
    pub selected_items: Vec<String>,
    pub voluntary_items: Vec<String>,
    /// Openings of every revealed item, in any order; sorted to match the lists.
    pub openings: Vec<Opening>,
    pub data_url: Option<String>,
    pub revealed_at: String,
}

/// Create a signed 0.5.0 reveal object. The openings are reordered to follow
/// `selected_items` then `voluntary_items` and checked against the items.
pub fn create_v5(params: CreateParamsV5, kp: &sign::KeyPair) -> Result<Reveal, String> {
    let mut ordered = Vec::with_capacity(params.selected_items.len() + params.voluntary_items.len());
    for it in params.selected_items.iter().chain(params.voluntary_items.iter()) {
        let o = params.openings.iter().find(|o| &o.item == it)
            .ok_or_else(|| format!("no opening for revealed item {it}"))?;
        ordered.push(o.clone());
    }
    let mut r = Reveal {
        spec_version: SPEC_VERSION_V5.into(),
        commitment_hash: params.commitment_hash,
        selected_items: params.selected_items,
        voluntary_items: params.voluntary_items,
        openings: Some(ordered),
        data_url: params.data_url,
        revealed_at: params.revealed_at,
        signing_key: kp.did_key.clone(),
        signature: String::new(),
    };
    validate_v5(&r)?;
    let payload_bytes = signing_payload(&r)?;
    r.signature = sign::sign(&kp.signing_key, &payload_bytes);
    Ok(r)
}

/// Verify reveal signature. A 0.5.0 reveal must also pass `validate_v5`.
pub fn verify_signature(r: &Reveal) -> Result<(), String> {
    if r.is_v5() {
        validate_v5(r)?;
    }
    let payload_bytes = signing_payload(r)?;
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
        let payload = String::from_utf8(signing_payload(&r).unwrap()).unwrap();

        let keys = ["spec_version", "commitment_hash", "selected_items", "voluntary_items", "revealed_at", "signing_key"];
        let mut last = 0;
        for key in &keys {
            let pos = payload.find(&format!("\"{}\"", key)).unwrap();
            assert!(pos >= last, "key {} out of order", key);
            last = pos;
        }
        assert!(!payload.contains("data_url"));
        assert!(!payload.contains("\"signature\""));
        assert!(!payload.contains("openings"));
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

    // ── 0.5.0 (Spec v0.5 Section 13.15) ──

    fn rfc8032_kp() -> sign::KeyPair {
        let bytes: [u8; 32] = hex::decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").unwrap().try_into().unwrap();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();
        sign::KeyPair { signing_key, verifying_key, did_key: sign::encode_did_key(&verifying_key) }
    }

    fn opening(item: &str, salt: &str, hash: &str) -> Opening {
        Opening { item: item.into(), salt: salt.into(), hash: hash.into() }
    }

    const ITEM0: &str = "2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf";
    const ITEM1: &str = "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a";
    const ITEM2: &str = "5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d";
    const HC_A: &str = "a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826";

    pub(crate) fn vector_openings() -> Vec<Opening> {
        vec![
            opening(ITEM0, "e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b", "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"),
            opening(ITEM1, "6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323", "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"),
            opening(ITEM2, "b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533", "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da"),
        ]
    }

    fn vector_reveal(kp: &sign::KeyPair) -> Reveal {
        // Openings given out of order on purpose; create_v5 sorts them.
        let mut openings = vector_openings();
        openings.reverse();
        create_v5(CreateParamsV5 {
            commitment_hash: HC_A.into(),
            selected_items: vec![ITEM0.into(), ITEM1.into()],
            voluntary_items: vec![ITEM2.into()],
            openings,
            data_url: Some("https://example.com/reveal".into()),
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, kp).unwrap()
    }

    #[test]
    fn v5_vector_13_15() {
        let r = vector_reveal(&rfc8032_kp());
        let payload = String::from_utf8(signing_payload(&r).unwrap()).unwrap();
        assert_eq!(payload, "{\"spec_version\":\"0.5.0\",\"commitment_hash\":\"a70d044b861f11389ae5e1b7da147c17be3daa7ed612d87494b6c1c1febb9826\",\"selected_items\":[\"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf\",\"da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a\"],\"voluntary_items\":[\"5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d\"],\"openings\":[{\"item\":\"2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf\",\"salt\":\"e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b\",\"hash\":\"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8\"},{\"item\":\"da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a\",\"salt\":\"6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323\",\"hash\":\"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2\"},{\"item\":\"5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d\",\"salt\":\"b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533\",\"hash\":\"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da\"}],\"revealed_at\":\"2026-02-07T10:00:00Z\",\"signing_key\":\"did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw\"}");
        assert_eq!(r.signature, "e145fb61ab8b828c773806c1bdf6731c9b82cd2b63bbcf85ff2933dca40400fc36aa8e3bee7d719e129ba45289af0a2d2873c5a0a89d00244139592c3e920c0e");
        verify_signature(&r).unwrap();
        assert!(!payload.contains("data_url"));
    }

    #[test]
    fn v5_roundtrips_through_json() {
        let r = vector_reveal(&rfc8032_kp());
        let json = serde_json::to_string(&r).unwrap();
        let back: Reveal = serde_json::from_str(&json).unwrap();
        verify_signature(&back).unwrap();
        assert_eq!(back.opening_of(ITEM2).unwrap().hash, "6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da");
    }

    #[test]
    fn v5_openings_are_signed_and_checked() {
        let kp = rfc8032_kp();
        let base = vector_reveal(&kp);
        let cases: Vec<(&str, Box<dyn Fn(&mut Reveal)>)> = vec![
            ("other salt", Box::new(|r| r.openings.as_mut().unwrap()[0].salt = "00".repeat(32))),
            ("other hash", Box::new(|r| r.openings.as_mut().unwrap()[0].hash = "00".repeat(32))),
            ("opening removed", Box::new(|r| { r.openings.as_mut().unwrap().pop(); })),
            ("openings missing", Box::new(|r| r.openings = None)),
            ("openings out of order", Box::new(|r| r.openings.as_mut().unwrap().swap(0, 1))),
            ("item listed twice", Box::new(|r| r.voluntary_items = vec![ITEM0.into()])),
            ("selected moved to voluntary", Box::new(|r| { r.selected_items = vec![ITEM0.into()]; r.voluntary_items = vec![ITEM1.into(), ITEM2.into()]; })),
            ("uppercase item", Box::new(|r| r.selected_items[0] = r.selected_items[0].to_uppercase())),
            ("revealed_at", Box::new(|r| r.revealed_at = "2026-02-08T10:00:00Z".into())),
        ];
        for (name, mutate) in cases {
            let mut r = base.clone();
            mutate(&mut r);
            assert!(verify_signature(&r).is_err(), "{name} still verifies");
        }
    }

    #[test]
    fn create_v5_needs_every_opening() {
        let kp = rfc8032_kp();
        let result = create_v5(CreateParamsV5 {
            commitment_hash: HC_A.into(),
            selected_items: vec![ITEM0.into(), ITEM1.into()],
            voluntary_items: vec![],
            openings: vector_openings()[..1].to_vec(),
            data_url: None,
            revealed_at: "2026-02-07T10:00:00Z".into(),
        }, &kp);
        assert!(result.is_err());
    }
}
