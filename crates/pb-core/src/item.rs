//! Hiding item commitments (Spec v0.5 Section 5).
//!
//! `c = SHA-256(TAG_ITEM || salt || item_hash)` with a 32-byte salt and the
//! plain SHA-256 item hash. The commitment lists `c`; salt and item hash are
//! published only when the item is revealed.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

/// Domain tag of the item commitment.
pub const TAG_ITEM: &[u8] = b"NoCherry/0.5/item";
/// Domain tag of the recommended salt derivation (Section 5.2).
pub const TAG_SALT: &[u8] = b"NoCherry/0.5/salt";

/// Decode a 64-character lowercase hex string to 32 bytes.
pub fn decode_hash32(hex_str: &str, what: &str) -> Result<[u8; 32], String> {
    if hex_str.len() != 64 || !hex_str.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(format!("{what} must be 64 lowercase hex characters"));
    }
    let bytes = hex::decode(hex_str).map_err(|e| format!("{what}: {e}"))?;
    Ok(bytes.try_into().expect("64 hex chars decode to 32 bytes"))
}

/// `SHA-256(TAG_ITEM || salt || item_hash)`.
pub fn item_commitment(salt: &[u8; 32], item_hash: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(TAG_ITEM);
    h.update(salt);
    h.update(item_hash);
    h.finalize().into()
}

/// Hex form of `item_commitment` for hex inputs.
pub fn item_commitment_hex(salt_hex: &str, item_hash_hex: &str) -> Result<String, String> {
    let salt = decode_hash32(salt_hex, "salt")?;
    let item_hash = decode_hash32(item_hash_hex, "item hash")?;
    Ok(hex::encode(item_commitment(&salt, &item_hash)))
}

/// Recommended salt derivation: `HMAC-SHA256(item_secret, TAG_SALT || item_hash)`.
pub fn derive_salt(item_secret: &[u8; 32], item_hash: &[u8; 32]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(item_secret).expect("HMAC accepts any key length");
    mac.update(TAG_SALT);
    mac.update(item_hash);
    mac.finalize().into_bytes().into()
}

/// Hex form of `derive_salt`.
pub fn derive_salt_hex(item_secret_hex: &str, item_hash_hex: &str) -> Result<String, String> {
    let secret = decode_hash32(item_secret_hex, "item secret")?;
    let item_hash = decode_hash32(item_hash_hex, "item hash")?;
    Ok(hex::encode(derive_salt(&secret, &item_hash)))
}

/// A fresh 32-byte item secret from the OS random source.
pub fn generate_item_secret() -> [u8; 32] {
    use rand::RngCore;
    let mut secret = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    secret
}

/// Check that `(salt, item_hash)` opens `item`.
pub fn verify_opening(item_hex: &str, salt_hex: &str, item_hash_hex: &str) -> Result<(), String> {
    let expected = item_commitment_hex(salt_hex, item_hash_hex)?;
    if expected != item_hex {
        return Err(format!("opening does not match item commitment {item_hex}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Spec v0.5 Section 13.9.
    const SECRET: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const VECTORS: [(&str, &str, &str); 5] = [
        ("2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
         "e76681508da30bf0a8fe7861601d6b672d9ed76f67d8292671232e7d58ecfb1b",
         "2682db88eb3a4e2aee9a9f347eb83edb104904354de6a0d00da0cbc056bcafbf"),
        ("32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
         "6ceab1c69985474e8576d16d84430d64576d3c4125e327a196f9f0c8fc3fe323",
         "da9bc6fbf8ad09a95a9cc9958c5930f6dce87492af4e17ef0861cc9637b6da7a"),
        ("6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da",
         "b42a1c219328e75ba590c3f4742548d04372d17bbb71de25759ad1a810824533",
         "5ef516a8fa1b605ac35598b1f5e42edcf9754b811155e0a859a4a55550396b9d"),
        ("4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030",
         "7d5ffda6bb923cb45d11e7a4aba3cbd7bdf13d44e8542177f976b4c0a5c951ca",
         "47e42a38728203b7fc4da96a68373bff8a1b111a8df5c31d3a4a16868a0ef28e"),
        ("57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
         "a03fb4699c682592c28bb330257a09222fc4f864a3e49474fa940319b20a5b4e",
         "7578d149ef397f8c93242e22fba26aedecae774ce593cc04d341f7d822b4fa1c"),
    ];

    #[test]
    fn spec_vectors_13_9() {
        for (item_hash, salt, commit) in VECTORS {
            assert_eq!(derive_salt_hex(SECRET, item_hash).unwrap(), salt, "salt of {item_hash}");
            assert_eq!(item_commitment_hex(salt, item_hash).unwrap(), commit, "commitment of {item_hash}");
            verify_opening(commit, salt, item_hash).unwrap();
        }
    }

    #[test]
    fn tags_are_the_spec_bytes() {
        assert_eq!(TAG_ITEM, b"NoCherry/0.5/item");
        assert_eq!(TAG_SALT, b"NoCherry/0.5/salt");
    }

    #[test]
    fn opening_with_other_salt_or_hash_fails() {
        let (item_hash, salt, commit) = VECTORS[0];
        let other_salt = VECTORS[1].1;
        let other_hash = VECTORS[1].0;
        assert!(verify_opening(commit, other_salt, item_hash).is_err());
        assert!(verify_opening(commit, salt, other_hash).is_err());
        assert!(verify_opening(VECTORS[1].2, salt, item_hash).is_err());
    }

    #[test]
    fn salt_hides_the_item() {
        // The same item hash under two salts gives unrelated commitments, and
        // the plain hash never equals its commitment.
        let (item_hash, salt, commit) = VECTORS[0];
        let other = item_commitment_hex(VECTORS[1].1, item_hash).unwrap();
        assert_ne!(other, commit);
        assert_ne!(commit, item_hash);
        let _ = salt;
    }

    #[test]
    fn rejects_bad_hex() {
        let (item_hash, salt, _) = VECTORS[0];
        assert!(item_commitment_hex(&salt.to_uppercase(), item_hash).is_err());
        assert!(item_commitment_hex(&salt[..62], item_hash).is_err());
        assert!(item_commitment_hex(salt, "zz").is_err());
        assert!(derive_salt_hex("00", item_hash).is_err());
    }

    #[test]
    fn secrets_are_random() {
        assert_ne!(generate_item_secret(), generate_item_secret());
    }
}
