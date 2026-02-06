//! Ed25519 signing/verification and did:key encoding.
//!
//! did:key format for Ed25519:
//!   did:key:z<base58btc(0xed01 || public_key_bytes)>

use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use rand::rngs::OsRng;

/// Multicodec prefix for Ed25519 public keys.
const ED25519_MULTICODEC: [u8; 2] = [0xed, 0x01];

/// An Ed25519 key pair with its did:key identifier.
pub struct KeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub did_key: String,
}

/// Generate a new Ed25519 key pair.
pub fn generate_keypair() -> KeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let did_key = encode_did_key(&verifying_key);
    KeyPair { signing_key, verifying_key, did_key }
}

/// Encode an Ed25519 public key as did:key.
pub fn encode_did_key(vk: &VerifyingKey) -> String {
    let mut data = Vec::with_capacity(2 + 32);
    data.extend_from_slice(&ED25519_MULTICODEC);
    data.extend_from_slice(vk.as_bytes());
    format!("did:key:z{}", bs58::encode(&data).into_string())
}

/// Decode a did:key string to an Ed25519 verifying key.
pub fn decode_did_key(did: &str) -> Result<VerifyingKey, String> {
    let rest = did.strip_prefix("did:key:z")
        .ok_or("invalid did:key: must start with did:key:z")?;
    let data = bs58::decode(rest).into_vec()
        .map_err(|e| format!("base58 decode error: {e}"))?;
    if data.len() < 2 {
        return Err("decoded data too short".into());
    }
    if data[0] != ED25519_MULTICODEC[0] || data[1] != ED25519_MULTICODEC[1] {
        return Err(format!(
            "unsupported multicodec prefix: {:02x}{:02x} (expected ed01 for Ed25519)",
            data[0], data[1]
        ));
    }
    let key_bytes: [u8; 32] = data[2..].try_into()
        .map_err(|_| format!("invalid key length: got {}, want 32", data.len() - 2))?;
    VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| format!("invalid Ed25519 public key: {e}"))
}

/// Sign a message. Returns signature as lowercase hex (128 chars).
pub fn sign(key: &SigningKey, message: &[u8]) -> String {
    let sig = key.sign(message);
    hex::encode(sig.to_bytes())
}

/// Verify a signature given a did:key, message, and hex-encoded signature.
pub fn verify(did_key: &str, message: &[u8], signature_hex: &str) -> Result<(), String> {
    let vk = decode_did_key(did_key)?;
    verify_with_key(&vk, message, signature_hex)
}

/// Verify a signature directly with a verifying key.
pub fn verify_with_key(vk: &VerifyingKey, message: &[u8], signature_hex: &str) -> Result<(), String> {
    let sig_bytes = hex::decode(signature_hex)
        .map_err(|e| format!("hex decode error: {e}"))?;
    let sig_array: [u8; 64] = sig_bytes.try_into()
        .map_err(|_| "invalid signature length: expected 64 bytes")?;
    let sig = Signature::from_bytes(&sig_array);
    vk.verify(message, &sig)
        .map_err(|e| format!("signature verification failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keypair_generation() {
        let kp = generate_keypair();
        assert!(kp.did_key.starts_with("did:key:z"));
        assert!(kp.did_key.len() > 40);
    }

    #[test]
    fn did_key_roundtrip() {
        let kp = generate_keypair();
        let decoded = decode_did_key(&kp.did_key).unwrap();
        assert_eq!(decoded.as_bytes(), kp.verifying_key.as_bytes());
    }

    #[test]
    fn sign_and_verify() {
        let kp = generate_keypair();
        let msg = b"hello world";
        let sig = sign(&kp.signing_key, msg);
        assert!(verify(&kp.did_key, msg, &sig).is_ok());
    }

    #[test]
    fn verify_wrong_message() {
        let kp = generate_keypair();
        let sig = sign(&kp.signing_key, b"hello");
        assert!(verify(&kp.did_key, b"wrong", &sig).is_err());
    }

    #[test]
    fn verify_wrong_key() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        let sig = sign(&kp1.signing_key, b"hello");
        assert!(verify(&kp2.did_key, b"hello", &sig).is_err());
    }

    #[test]
    fn signature_hex_format() {
        let kp = generate_keypair();
        let sig = sign(&kp.signing_key, b"test");
        assert_eq!(sig.len(), 128); // 64 bytes = 128 hex chars
        assert!(sig.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
    }

    #[test]
    fn sign_is_deterministic() {
        let kp = generate_keypair();
        let s1 = sign(&kp.signing_key, b"deterministic");
        let s2 = sign(&kp.signing_key, b"deterministic");
        assert_eq!(s1, s2);
    }

    #[test]
    fn decode_invalid_did() {
        assert!(decode_did_key("").is_err());
        assert!(decode_did_key("did:web:example.com").is_err());
        assert!(decode_did_key("did:key:b123").is_err());
        assert!(decode_did_key("did:key:z11").is_err());
    }

    #[test]
    fn two_keypairs_different() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        assert_ne!(kp1.did_key, kp2.did_key);
    }
}
