//! WASM bindings for pb-core.
//! Thin wrappers that convert between JS types and pb-core types.

use wasm_bindgen::prelude::*;
use serde::Serialize;
use pb_core::{hash, select, select_v5, item, metadata, sign, commitment, beacon, reveal, verify};
use pb_core::beacon::anchor;

/// JS value of a serializable result. JSON `null` becomes JS `null`, not
/// `undefined`: a `null` inside signed metadata must survive `JSON.stringify`
/// on the JS side, or the re-serialized commitment no longer verifies.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_missing_as_null(true);
    value.serialize(&serializer).map_err(|e| JsError::new(&format!("{e}")))
}

fn keypair_from_hex(private_key_hex: &str) -> Result<sign::KeyPair, JsError> {
    let key_bytes = hex::decode(private_key_hex)
        .map_err(|e| JsError::new(&format!("decode key: {e}")))?;
    let key_array: [u8; 32] = key_bytes.try_into()
        .map_err(|_| JsError::new("key must be 32 bytes"))?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_array);
    let verifying_key = signing_key.verifying_key();
    Ok(sign::KeyPair {
        signing_key,
        verifying_key,
        did_key: sign::encode_did_key(&verifying_key),
    })
}

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
    to_js(&result)
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
    to_js(&selected)
}

#[wasm_bindgen(js_name = "threshold")]
pub fn threshold(p: f64) -> String {
    // Return as string since u64 doesn't fit in JS number
    select::threshold(p).to_string()
}

// ── Commitment ──

/// Default reveal probability: 10% of items.
const DEFAULT_REVEAL_PROBABILITY: f64 = 0.10;

/// Create a signed commitment. `params.spec_version` selects the format:
/// `"0.2.0"` (default) takes `reveal_probability` and an optional anchor;
/// `"0.5.0"` takes item commitments, `reveal_probability_ppm`,
/// `selection_mode`, `beacon.anchor_round` (required), and optional
/// `stream_id`, `sequence`, `metadata`, `identity`.
#[wasm_bindgen(js_name = "createCommitment")]
pub fn create_commitment(params_json: &str, private_key_hex: &str) -> Result<JsValue, JsError> {
    let params: serde_json::Value = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("parse params: {e}")))?;

    let items: Vec<String> = params["items"].as_array()
        .ok_or_else(|| JsError::new("items is required"))?
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect();

    if params["spec_version"].as_str() == Some(commitment::SPEC_VERSION_V5) {
        return create_commitment_v5(&params, items, private_key_hex);
    }
    match params["spec_version"].as_str() {
        None | Some(commitment::SPEC_VERSION) => {}
        Some(other) => return Err(JsError::new(&format!("unsupported spec_version: {other}"))),
    }

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

    to_js(&c)
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
    to_js(&result)
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

    to_js(&checks)
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
    to_js(&result)
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
    to_js(&result)
}

// ── Object format 0.5.0 (Spec v0.5) ──

fn create_commitment_v5(params: &serde_json::Value, items: Vec<String>, private_key_hex: &str) -> Result<JsValue, JsError> {
    let kp = keypair_from_hex(private_key_hex)?;
    let ppm = params["reveal_probability_ppm"].as_u64()
        .ok_or_else(|| JsError::new("reveal_probability_ppm is required for 0.5.0"))?;
    let selection_mode = params["selection_mode"].as_str()
        .ok_or_else(|| JsError::new("selection_mode is required for 0.5.0"))?
        .to_string();
    let anchor_round = params["beacon"]["anchor_round"].as_u64()
        .ok_or_else(|| JsError::new("beacon.anchor_round is required for 0.5.0"))?;
    if let Some(t) = params["beacon"]["type"].as_str() {
        if t != "drand" {
            return Err(JsError::new(&format!("beacon.type must be drand in 0.5.0, got {t}")));
        }
    }
    let committed_at = match params["committed_at"].as_str() {
        Some(s) => s.to_string(),
        None => js_sys::Date::new_0().to_iso_string().as_string()
            .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string()),
    };
    let sequence = match params.get("sequence") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => Some(v.as_u64().ok_or_else(|| JsError::new("sequence must be a non-negative integer"))?),
    };
    let c = commitment::create_v5(commitment::CreateParamsV5 {
        items,
        reveal_probability_ppm: ppm,
        selection_mode,
        anchor_round,
        stream_id: params.get("stream_id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        sequence,
        metadata: params.get("metadata").filter(|v| !v.is_null()).cloned(),
        committed_at,
        identity: params.get("identity").and_then(|v| v.as_str()).map(|s| s.to_string()),
    }, &kp).map_err(|e| JsError::new(&e))?;
    to_js(&c)
}

/// Canonical signing payload of a commitment in either format, as a string.
#[wasm_bindgen(js_name = "commitmentSigningPayload")]
pub fn commitment_signing_payload(commitment_json: &str) -> Result<String, JsError> {
    let c: commitment::Commitment = serde_json::from_str(commitment_json)
        .map_err(|e| JsError::new(&format!("parse commitment: {e}")))?;
    let bytes = commitment::signing_payload(&c).map_err(|e| JsError::new(&e))?;
    String::from_utf8(bytes).map_err(|e| JsError::new(&format!("{e}")))
}

/// Well-formedness of a 0.5.0 commitment (Spec v0.5 Section 7.5).
/// Returns `{ ok: true }` or `{ ok: false, error }`. Does not check the signature.
#[wasm_bindgen(js_name = "validateCommitment")]
pub fn validate_commitment(commitment_json: &str) -> Result<JsValue, JsError> {
    let result = match serde_json::from_str::<commitment::Commitment>(commitment_json) {
        Err(e) => serde_json::json!({ "ok": false, "error": format!("parse commitment: {e}") }),
        Ok(c) if c.is_v5() => match commitment::validate_v5(&c) {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        },
        Ok(c) if c.spec_version == commitment::SPEC_VERSION => serde_json::json!({ "ok": true }),
        Ok(c) => serde_json::json!({ "ok": false, "error": format!("unsupported spec_version: {}", c.spec_version) }),
    };
    to_js(&result)
}

/// Object formats this build can verify.
#[wasm_bindgen(js_name = "supportedSpecVersions")]
pub fn supported_spec_versions() -> Result<JsValue, JsError> {
    to_js(&commitment::SUPPORTED_SPEC_VERSIONS)
}

/// `SHA-256(TAG_ITEM || salt || item_hash)`, hex in and out.
#[wasm_bindgen(js_name = "itemCommitment")]
pub fn item_commitment(salt_hex: &str, item_hash_hex: &str) -> Result<String, JsError> {
    item::item_commitment_hex(salt_hex, item_hash_hex).map_err(|e| JsError::new(&e))
}

/// Recommended salt derivation `HMAC-SHA256(item_secret, TAG_SALT || item_hash)`.
#[wasm_bindgen(js_name = "deriveItemSalt")]
pub fn derive_item_salt(item_secret_hex: &str, item_hash_hex: &str) -> Result<String, JsError> {
    item::derive_salt_hex(item_secret_hex, item_hash_hex).map_err(|e| JsError::new(&e))
}

/// A fresh 32-byte item secret, hex.
#[wasm_bindgen(js_name = "generateItemSecret")]
pub fn generate_item_secret() -> String {
    hex::encode(item::generate_item_secret())
}

/// Item commitments and salts for plain item hashes under one secret.
/// Returns `{ items: [...], salts: [...] }` in input order.
#[wasm_bindgen(js_name = "commitItems")]
pub fn commit_items(item_secret_hex: &str, item_hashes_json: &str) -> Result<JsValue, JsError> {
    let hashes: Vec<String> = serde_json::from_str(item_hashes_json)
        .map_err(|e| JsError::new(&format!("parse item hashes: {e}")))?;
    let secret = item::decode_hash32(item_secret_hex, "item secret").map_err(|e| JsError::new(&e))?;
    let (items, salts) = commitment::commit_items(&secret, &hashes).map_err(|e| JsError::new(&e))?;
    to_js(&serde_json::json!({ "items": items, "salts": salts }))
}

/// Canonical metadata serialization (Spec v0.5 Section 7.3), or an error.
#[wasm_bindgen(js_name = "canonicalMetadata")]
pub fn canonical_metadata(metadata_json: &str) -> Result<String, JsError> {
    let v: serde_json::Value = serde_json::from_str(metadata_json)
        .map_err(|e| JsError::new(&format!("parse metadata: {e}")))?;
    metadata::canonical_metadata(&v).map_err(|e| JsError::new(&e))
}

/// `floor(ppm * 2^64 / 10^6)` as a decimal string (it can be 2^64).
#[wasm_bindgen(js_name = "thresholdPpm")]
pub fn threshold_ppm(ppm: u32) -> Result<String, JsError> {
    select_v5::validate_ppm(ppm as u64).map_err(|e| JsError::new(&e))?;
    Ok(select_v5::threshold(ppm).to_string())
}

/// `ceil(ppm * n / 10^6)`.
#[wasm_bindgen(js_name = "batchCount")]
pub fn batch_count(ppm: u32, item_count: u32) -> Result<u32, JsError> {
    select_v5::validate_ppm(ppm as u64).map_err(|e| JsError::new(&e))?;
    Ok(select_v5::batch_count(ppm, item_count as usize) as u32)
}

/// `2^64 - (2^64 mod range)` as a decimal string.
#[wasm_bindgen(js_name = "rejectionLimit")]
pub fn rejection_limit(range: u64) -> Result<String, JsError> {
    if range == 0 { return Err(JsError::new("range must be positive")); }
    Ok(select_v5::rejection_limit(range).to_string())
}

/// 0.5.0 per-item selection of one item commitment.
#[wasm_bindgen(js_name = "selectPerItemV5")]
pub fn select_per_item_v5(
    beacon_randomness_hex: &str,
    commitment_hash: &str,
    item: &str,
    ppm: u32,
) -> Result<bool, JsError> {
    let randomness = hex::decode(beacon_randomness_hex)
        .map_err(|e| JsError::new(&format!("decode randomness: {e}")))?;
    let hc = item::decode_hash32(commitment_hash, "commitment_hash").map_err(|e| JsError::new(&e))?;
    let c = item::decode_hash32(item, "item").map_err(|e| JsError::new(&e))?;
    select_v5::validate_ppm(ppm as u64).map_err(|e| JsError::new(&e))?;
    Ok(select_v5::select_per_item(&randomness, &hc, &c, ppm))
}

/// 0.5.0 batch selection of `count` items with the commitment-bound seed.
#[wasm_bindgen(js_name = "selectBatchV5")]
pub fn select_batch_v5(
    items_json: &str,
    beacon_randomness_hex: &str,
    commitment_hash: &str,
    count: u32,
) -> Result<JsValue, JsError> {
    let items: Vec<String> = serde_json::from_str(items_json)
        .map_err(|e| JsError::new(&format!("parse items: {e}")))?;
    let randomness = hex::decode(beacon_randomness_hex)
        .map_err(|e| JsError::new(&format!("decode randomness: {e}")))?;
    let hc = item::decode_hash32(commitment_hash, "commitment_hash").map_err(|e| JsError::new(&e))?;
    let selected = select_v5::select_batch(&items, &randomness, &hc, count as usize)
        .map_err(|e| JsError::new(&e))?;
    to_js(&selected)
}

/// Selection record for a commitment of either format and a beacon output
/// (Spec v0.5 Section 8.5). Servers call this instead of choosing a mode.
#[wasm_bindgen(js_name = "computeSelectionRecord")]
pub fn compute_selection_record(commitment_json: &str, beacon_output_json: &str, computed_at: &str) -> Result<JsValue, JsError> {
    let c: commitment::Commitment = serde_json::from_str(commitment_json)
        .map_err(|e| JsError::new(&format!("parse commitment: {e}")))?;
    let bo: beacon::BeaconOutput = serde_json::from_str(beacon_output_json)
        .map_err(|e| JsError::new(&format!("parse beacon output: {e}")))?;
    let record = verify::compute_selection(&c, &bo, computed_at).map_err(|e| JsError::new(&e))?;
    to_js(&record)
}

/// Create a signed reveal. `params.spec_version` selects the format; a 0.5.0
/// reveal takes `openings: [{ item, salt, hash }]` for every revealed item.
#[wasm_bindgen(js_name = "createReveal")]
pub fn create_reveal(params_json: &str, private_key_hex: &str) -> Result<JsValue, JsError> {
    let params: serde_json::Value = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("parse params: {e}")))?;
    let kp = keypair_from_hex(private_key_hex)?;
    let list = |key: &str| -> Result<Vec<String>, JsError> {
        match params.get(key) {
            None | Some(serde_json::Value::Null) => Ok(vec![]),
            Some(v) => serde_json::from_value(v.clone()).map_err(|e| JsError::new(&format!("{key}: {e}"))),
        }
    };
    let commitment_hash = params["commitment_hash"].as_str()
        .ok_or_else(|| JsError::new("commitment_hash is required"))?.to_string();
    let revealed_at = match params["revealed_at"].as_str() {
        Some(s) => s.to_string(),
        None => js_sys::Date::new_0().to_iso_string().as_string()
            .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string()),
    };
    let data_url = params.get("data_url").and_then(|v| v.as_str()).map(|s| s.to_string());
    let r = match params["spec_version"].as_str() {
        Some(reveal::SPEC_VERSION_V5) => {
            let openings: Vec<reveal::Opening> = serde_json::from_value(params["openings"].clone())
                .map_err(|e| JsError::new(&format!("openings: {e}")))?;
            reveal::create_v5(reveal::CreateParamsV5 {
                commitment_hash, selected_items: list("selected_items")?, voluntary_items: list("voluntary_items")?,
                openings, data_url, revealed_at,
            }, &kp)
        }
        None | Some(reveal::SPEC_VERSION) => reveal::create(reveal::CreateParams {
            commitment_hash, selected_items: list("selected_items")?, voluntary_items: list("voluntary_items")?,
            data_url, revealed_at,
        }, &kp),
        Some(other) => Err(format!("unsupported spec_version: {other}")),
    }.map_err(|e| JsError::new(&e))?;
    to_js(&r)
}

/// Canonical signing payload of a reveal in either format, as a string.
#[wasm_bindgen(js_name = "revealSigningPayload")]
pub fn reveal_signing_payload(reveal_json: &str) -> Result<String, JsError> {
    let r: reveal::Reveal = serde_json::from_str(reveal_json)
        .map_err(|e| JsError::new(&format!("parse reveal: {e}")))?;
    let bytes = reveal::signing_payload(&r).map_err(|e| JsError::new(&e))?;
    String::from_utf8(bytes).map_err(|e| JsError::new(&format!("{e}")))
}

/// Signature and, for 0.5.0, structure and openings of a reveal.
/// Returns `{ ok: true }` or `{ ok: false, error }`.
#[wasm_bindgen(js_name = "verifyRevealObject")]
pub fn verify_reveal_object(reveal_json: &str) -> Result<JsValue, JsError> {
    let result = match serde_json::from_str::<reveal::Reveal>(reveal_json) {
        Err(e) => serde_json::json!({ "ok": false, "error": format!("parse reveal: {e}") }),
        Ok(r) => match reveal::verify_signature(&r) {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        },
    };
    to_js(&result)
}
