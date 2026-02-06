//! SHA-256 file and directory hashing (PeerBench Hashing Spec v0.3.0).
//!
//! Files are hashed as raw bytes streamed through SHA-256.
//! Directories are hashed via a canonical JSON manifest.

use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};
use std::io::Read;

use crate::canonical;

const CHUNK_SIZE: usize = 64 * 1024; // 64 KiB

/// Hash raw bytes with SHA-256. Returns lowercase hex (64 chars).
pub fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Hash data from a reader in streaming fashion (64 KiB chunks).
pub fn hash_reader<R: Read>(reader: &mut R) -> Result<String, std::io::Error> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// A single entry in a directory manifest.
/// Fields ordered per spec Section 4.1: name, type, hash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManifestEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub hash: String,
}

/// Serialize a manifest (sorted array of entries) to canonical JSON bytes.
pub fn manifest_to_bytes(entries: &[ManifestEntry]) -> Vec<u8> {
    canonical::to_bytes(entries).expect("manifest serialization should not fail")
}

/// Hash a manifest: SHA-256 of its canonical JSON.
pub fn hash_manifest(entries: &[ManifestEntry]) -> String {
    hash_bytes(&manifest_to_bytes(entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    // -- Spec test vectors: Hashing Spec Section 7.1 --

    #[test]
    fn hash_empty() {
        assert_eq!(
            hash_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hash_hello_newline() {
        assert_eq!(
            hash_bytes(b"hello\n"),
            "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"
        );
    }

    #[test]
    fn hash_hello_no_newline() {
        assert_eq!(
            hash_bytes(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn hash_reader_streaming() {
        let data = b"hello";
        let mut cursor = Cursor::new(data);
        let h = hash_reader(&mut cursor).unwrap();
        assert_eq!(h, hash_bytes(b"hello"));
    }

    #[test]
    fn hash_reader_large() {
        // Larger than one chunk
        let data = vec![0u8; 128 * 1024];
        let mut cursor = Cursor::new(&data);
        let h = hash_reader(&mut cursor).unwrap();
        assert_eq!(h, hash_bytes(&data));
    }

    // -- Spec test vectors: Hashing Spec Section 7.2 --

    #[test]
    fn manifest_single_file() {
        let entries = vec![ManifestEntry {
            name: "hello.txt".into(),
            entry_type: "file".into(),
            hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into(),
        }];
        let json = String::from_utf8(manifest_to_bytes(&entries)).unwrap();
        assert_eq!(
            json,
            r#"[{"name":"hello.txt","type":"file","hash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}]"#
        );
        assert_eq!(
            hash_manifest(&entries),
            "10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f"
        );
    }

    #[test]
    fn manifest_empty_directory() {
        let entries: Vec<ManifestEntry> = vec![];
        let json = String::from_utf8(manifest_to_bytes(&entries)).unwrap();
        assert_eq!(json, "[]");
        assert_eq!(
            hash_manifest(&entries),
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        );
    }

    #[test]
    fn manifest_nested_directory() {
        // testdir/
        //   data/
        //     log.txt  ("log\n", 4 bytes)
        //   readme.txt ("readme", 6 bytes)

        // Step 1: log.txt hash
        let log_hash = hash_bytes(b"log\n");
        assert_eq!(log_hash, "9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857");

        // Step 2: data/ manifest
        let data_entries = vec![ManifestEntry {
            name: "log.txt".into(),
            entry_type: "file".into(),
            hash: log_hash.clone(),
        }];
        let data_hash = hash_manifest(&data_entries);
        assert_eq!(data_hash, "3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80");

        // Step 3: readme.txt hash
        let readme_hash = hash_bytes(b"readme");
        assert_eq!(readme_hash, "711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe");

        // Step 4: testdir/ manifest (sorted: "data" < "readme.txt")
        let root_entries = vec![
            ManifestEntry {
                name: "data".into(),
                entry_type: "dir".into(),
                hash: data_hash,
            },
            ManifestEntry {
                name: "readme.txt".into(),
                entry_type: "file".into(),
                hash: readme_hash,
            },
        ];
        let root_hash = hash_manifest(&root_entries);
        assert_eq!(root_hash, "28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94");
    }
}
