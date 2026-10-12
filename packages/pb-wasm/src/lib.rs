//! WASM bindings for pb-core.
//! Thin wrappers that convert between JS types and pb-core types.

use wasm_bindgen::prelude::*;
use serde::Serialize;
use pb_core::{hash, select, sign, commitment, beacon, reveal, verify};
use pb_core::beacon::anchor;

// ── Hashing ──

#[wasm_bindgen(js_name = "hashBytes")]
pub fn hash_bytes(data: &[u8]) -> String {
    hash::hash_bytes(data)
}

#[wasm_bindgen(js_name = "hashManifest")]
pub fn hash_manifest(manifest_json: &str) -> Result<String, JsError> {
    let entries: Vec<hash::ManifestEntry> = serde_json::from_str(manifest_json)
        .map_err(|e| JsError::new(&format!("parse manifest: {e}")))?;
    Ok(hash::hash_manifest(&entries))
}

// ── Signing ──

#[wasm_bindgen(js_name = "generateKeypair")]
pub fn generate_keypair() -> Result<JsValue, JsError> {
    let kp = sign::generate_keypair();
    let result = serde_json::json!({
        "did_key": kp.did_key,
        "private_key_hex": hex::encode(kp.signing_key.to_bytes()),
        "public_key_hex": hex::encode(kp.verifying_key.as_bytes()),
    });
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    result.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

#[wasm_bindgen(js_name = "signMessage")]
pub fn sign_message(private_key_hex: &str, message: &[u8]) -> Result<String, JsError> {
    let key_bytes = hex::decode(private_key_hex)
        .map_err(|e| JsError::new(&format!("decode private key: {e}")))?;
    let key_array: [u8; 32] = key_bytes.try_into()
        .map_err(|_| JsError::new("private key must be 32 bytes"))?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_array);
    Ok(sign::sign(&signing_key, message))
}

#[wasm_bindgen(js_name = "verifySignature")]
pub fn verify_signature(did_key: &str, message: &[u8], signature_hex: &str) -> Result<bool, JsError> {
    match sign::verify(did_key, message, signature_hex) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[wasm_bindgen(js_name = "encodeDIDKey")]
pub fn encode_did_key(public_key_hex: &str) -> Result<String, JsError> {
    let key_bytes = hex::decode(public_key_hex)
        .map_err(|e| JsError::new(&format!("decode public key: {e}")))?;
    let key_array: [u8; 32] = key_bytes.try_into()
        .map_err(|_| JsError::new("public key must be 32 bytes"))?;
    let vk = ed25519_dalek::VerifyingKey::from_bytes(&key_array)
        .map_err(|e| JsError::new(&format!("invalid key: {e}")))?;
    Ok(sign::encode_did_key(&vk))
}

// ── Selection ──

#[wasm_bindgen(js_name = "prngNext")]
pub fn prng_next(seed_hex: &str, index: u64) -> Result<JsValue, JsError> {
    let seed = hex::decode(seed_hex)
        .map_err(|e| JsError::new(&format!("decode seed: {e}")))?;
    let val = select::prng_next(&seed, index);
    // Return as string since JS can't handle u64 natively
    Ok(JsValue::from_str(&val.to_string()))
}

#[wasm_bindgen(js_name = "selectPerItem")]
pub fn select_per_item(
    beacon_randomness_hex: &str,
    commitment_hash: &str,
    item_hash: &str,
    reveal_probability: f64,
) -> Result<bool, JsError> {
    let randomness = hex::decode(beacon_randomness_hex)
        .map_err(|e| JsError::new(&format!("decode randomness: {e}")))?;
    Ok(select::select_per_item(&randomness, commitment_hash, item_hash, reveal_probability))
}

#[wasm_bindgen(js_name = "selectBatch")]
pub fn select_batch(
    items_json: &str,
    beacon_randomness_hex: &str,
    count: usize,
) -> Result<JsValue, JsError> {
    let items: Vec<String> = serde_json::from_str(items_json)
        .map_err(|e| JsError::new(&format!("parse items: {e}")))?;
    let randomness = hex::decode(beacon_randomness_hex)
        .map_err(|e| JsError::new(&format!("decode randomness: {e}")))?;
    let selected = select::select_batch(&items, &randomness, count)
        .map_err(|e| JsError::new(&e))?;
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    selected.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

#[wasm_bindgen(js_name = "threshold")]
pub fn threshold(p: f64) -> String {
    // Return as string since u64 doesn't fit in JS number
    select::threshold(p).to_string()
}

// ── Commitment ──

/// Default reveal probability: 10% of items.
const DEFAULT_REVEAL_PROBABILITY: f64 = 0.10;

#[wasm_bindgen(js_name = "createCommitment")]
pub fn create_commitment(params_json: &str, private_key_hex: &str) -> Result<JsValue, JsError> {
    let params: serde_json::Value = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("parse params: {e}")))?;

    let items: Vec<String> = params["items"].as_array()
        .ok_or_else(|| JsError::new("items is required"))?
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect();

    let reveal_probability = params["reveal_probability"].as_f64()
        .unwrap_or(DEFAULT_REVEAL_PROBABILITY);

    let beacon_ref: beacon::BeaconRef = if params["beacon"].is_null() || params.get("beacon").is_none() {
        beacon::BeaconRef::drand_quicknet()
    } else {
        serde_json::from_value(params["beacon"].clone())
            .map_err(|e| JsError::new(&format!("parse beacon: {e}")))?
    };

    let committed_at = match params["committed_at"].as_str() {
        Some(s) => s.to_string(),
        None => js_sys::Date::new_0().to_iso_string().as_string()
            .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string()),
    };

    let key_bytes = hex::decode(private_key_hex)
        .map_err(|e| JsError::new(&format!("decode key: {e}")))?;
    let key_array: [u8; 32] = key_bytes.try_into()
        .map_err(|_| JsError::new("key must be 32 bytes"))?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_array);
    let verifying_key = signing_key.verifying_key();
    let kp = sign::KeyPair {
        signing_key,
        verifying_key,
        did_key: sign::encode_did_key(&verifying_key),
    };

    let identity = params.get("identity").and_then(|v| v.as_str()).map(|s| s.to_string());

    let c = commitment::create(commitment::CreateParams {
        items,
        reveal_probability,
        beacon: beacon_ref,
        metadata: params.get("metadata").cloned(),
        stream_id: params.get("stream_id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        committed_at,
        identity,
    }, &kp).map_err(|e| JsError::new(&e))?;

    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    c.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

#[wasm_bindgen(js_name = "verifyCommitment")]
pub fn verify_commitment(commitment_json: &str) -> Result<bool, JsError> {
    let c: commitment::Commitment = serde_json::from_str(commitment_json)
        .map_err(|e| JsError::new(&format!("parse commitment: {e}")))?;
    match commitment::verify_signature(&c) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ── Beacon ──

#[wasm_bindgen(js_name = "drandRoundTime")]
pub fn drand_round_time(round: u64) -> i64 {
    beacon::drand::round_time(round)
}

#[wasm_bindgen(js_name = "drandTimeToRound")]
pub fn drand_time_to_round(unix_time: i64) -> u64 {
    beacon::drand::time_to_round(unix_time)
}

#[wasm_bindgen(js_name = "drandNextRoundAfter")]
pub fn drand_next_round_after(unix_time: i64) -> u64 {
    beacon::drand::next_round_after(unix_time)
}

// ── Anchored selection round ──

/// `ANCHOR_SELECTION_DELAY`: selection round = anchor_round + this value.
#[wasm_bindgen(js_name = "anchorSelectionDelay")]
pub fn anchor_selection_delay() -> u32 {
    anchor::ANCHOR_SELECTION_DELAY as u32
}

/// `ANCHOR_SELECTION_SAFETY_MARGIN_MS`.
#[wasm_bindgen(js_name = "anchorSelectionSafetyMarginMs")]
pub fn anchor_selection_safety_margin_ms() -> u32 {
    anchor::ANCHOR_SELECTION_SAFETY_MARGIN_MS as u32
}

/// `ANCHOR_CLOCK_SKEW_ALLOWANCE_MS`.
#[wasm_bindgen(js_name = "anchorClockSkewAllowanceMs")]
pub fn anchor_clock_skew_allowance_ms() -> u32 {
    anchor::ANCHOR_CLOCK_SKEW_ALLOWANCE_MS as u32
}

/// Selection round for an anchored commitment.
#[wasm_bindgen(js_name = "anchoredSelectionRound")]
pub fn anchored_selection_round(anchor_round: u64) -> Result<u64, JsError> {
    anchor::selection_round(anchor_round)
        .ok_or_else(|| JsError::new(anchor::AnchorRejection::InvalidRound.message()))
}

/// Registration rule for an anchored commitment.
/// Returns `{ ok: true, selection_round }` or `{ ok: false, code, message }`.
#[wasm_bindgen(js_name = "checkAnchorRegistration")]
pub fn check_anchor_registration(anchor_round: u64, registered_at_ms: i64) -> Result<JsValue, JsError> {
    let result = match anchor::check_registration(anchor_round, registered_at_ms) {
        Ok(round) => serde_json::json!({ "ok": true, "selection_round": round }),
        Err(e) => serde_json::json!({ "ok": false, "code": e.code(), "message": e.message() }),
    };
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    result.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

/// Verifier checks for a server receipt (`{ commitment, registered_at, selection }`).
/// Returns `[]` when the commitment has no `anchor_round` or the receipt has
/// no selection yet, otherwise the `anchor_selection_round` and
/// `anchor_registration_time` checks as `{ name, status, detail? }`.
#[wasm_bindgen(js_name = "verifyReceiptAnchor")]
pub fn verify_receipt_anchor(receipt_json: &str) -> Result<JsValue, JsError> {
    let receipt: serde_json::Value = serde_json::from_str(receipt_json)
        .map_err(|e| JsError::new(&format!("parse receipt: {e}")))?;
    let beacon_ref: beacon::BeaconRef = serde_json::from_value(receipt["commitment"]["beacon"].clone())
        .map_err(|e| JsError::new(&format!("parse commitment.beacon: {e}")))?;

    let checks = match (beacon_ref.anchor_round, receipt.get("selection")) {
        (Some(anchor_round), Some(selection)) if !selection.is_null() => verify::check_anchor(
            anchor_round,
            selection["beacon_output"]["round"].as_u64(),
            receipt["registered_at"].as_str(),
        ),
        _ => vec![],
    };

    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    checks.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

/// Offline verification of a server receipt (`{ commitment, registered_at, selection }`):
/// commitment signature, beacon authenticity, selection round timing and the
/// recomputed selection (Spec Section 10.5, steps 1 to 3). Returns
/// `{ status, checks: [{ name, status, detail? }], ... }`.
#[wasm_bindgen(js_name = "verifyReceipt")]
pub fn verify_receipt(receipt_json: &str) -> Result<JsValue, JsError> {
    let receipt: serde_json::Value = serde_json::from_str(receipt_json)
        .map_err(|e| JsError::new(&format!("parse receipt: {e}")))?;
    let c: commitment::Commitment = serde_json::from_value(receipt["commitment"].clone())
        .map_err(|e| JsError::new(&format!("parse commitment: {e}")))?;
    let selection: Option<verify::SelectionRecord> = match receipt.get("selection") {
        Some(v) if !v.is_null() => Some(serde_json::from_value(v.clone())
            .map_err(|e| JsError::new(&format!("parse selection: {e}")))?),
        _ => None,
    };

    let result = verify::verify_full_with_registration(
        &c, selection.as_ref(), None, &[], receipt["registered_at"].as_str(),
    );
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    result.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}

/// Offline verification of a receipt together with a reveal and the revealed
/// data (Spec Section 10.5, steps 1 to 6). `computed_hashes_json` is an object
/// mapping each revealed item hash to the hash the caller computed from the
/// data it holds; an item without an entry counts as missing data.
#[wasm_bindgen(js_name = "verifyReveal")]
pub fn verify_reveal(receipt_json: &str, reveal_json: &str, computed_hashes_json: &str) -> Result<JsValue, JsError> {
    let receipt: serde_json::Value = serde_json::from_str(receipt_json)
        .map_err(|e| JsError::new(&format!("parse receipt: {e}")))?;
    let c: commitment::Commitment = serde_json::from_value(receipt["commitment"].clone())
        .map_err(|e| JsError::new(&format!("parse commitment: {e}")))?;
    let selection: Option<verify::SelectionRecord> = match receipt.get("selection") {
        Some(v) if !v.is_null() => Some(serde_json::from_value(v.clone())
            .map_err(|e| JsError::new(&format!("parse selection: {e}")))?),
        _ => None,
    };
    let rev: reveal::Reveal = serde_json::from_str(reveal_json)
        .map_err(|e| JsError::new(&format!("parse reveal: {e}")))?;
    let computed: std::collections::HashMap<String, String> = serde_json::from_str(computed_hashes_json)
        .map_err(|e| JsError::new(&format!("parse computed hashes: {e}")))?;

    let result = verify::verify_full_with_hashes(
        &c, selection.as_ref(), Some(&rev), &computed, receipt["registered_at"].as_str(),
    );
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    result.serialize(&serializer)
        .map_err(|e| JsError::new(&format!("{e}")))
}
