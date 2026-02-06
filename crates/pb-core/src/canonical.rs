//! Canonical JSON serialization.
//!
//! Rules (spec Section 12):
//! 1. No whitespace
//! 2. Object keys in the order specified per object type
//! 3. Strings use minimal JSON escaping (RFC 8259)
//! 4. UTF-8 encoding
//! 5. No trailing commas, no BOM
//! 6. Arrays preserve element order
//!
//! We use `serde_json` with struct field ordering.
//! Since Rust structs serialize in declaration order with serde,
//! defining fields in the correct order produces the right key order.

use serde::Serialize;
use serde_json;

/// Serialize a value to canonical JSON bytes (no whitespace, no trailing newline).
pub fn to_bytes<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(value)
}

/// Serialize a value to canonical JSON string.
pub fn to_string<T: Serialize + ?Sized>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Example {
        name: String,
        age: u32,
    }

    #[test]
    fn no_whitespace() {
        let v = Example { name: "Alice".into(), age: 30 };
        let s = to_string(&v).unwrap();
        assert_eq!(s, r#"{"name":"Alice","age":30}"#);
    }

    #[test]
    fn key_order_preserved() {
        #[derive(Serialize)]
        struct Ordered {
            zebra: String,
            apple: String,
        }
        let v = Ordered { zebra: "z".into(), apple: "a".into() };
        let s = to_string(&v).unwrap();
        assert_eq!(s, r#"{"zebra":"z","apple":"a"}"#);
    }

    #[test]
    fn array() {
        #[derive(Serialize)]
        struct Entry {
            name: String,
            #[serde(rename = "type")]
            entry_type: String,
            hash: String,
        }
        let entries = vec![
            Entry { name: "a.txt".into(), entry_type: "file".into(), hash: "abc123".into() },
            Entry { name: "b.txt".into(), entry_type: "file".into(), hash: "def456".into() },
        ];
        let s = to_string(&entries).unwrap();
        assert_eq!(s, r#"[{"name":"a.txt","type":"file","hash":"abc123"},{"name":"b.txt","type":"file","hash":"def456"}]"#);
    }

    #[test]
    fn empty_array() {
        let v: Vec<u8> = vec![];
        let s = to_string(&v).unwrap();
        assert_eq!(s, "[]");
    }

    #[test]
    fn nested_struct() {
        #[derive(Serialize)]
        struct Inner {
            #[serde(rename = "type")]
            typ: String,
            chain_hash: String,
        }
        #[derive(Serialize)]
        struct Outer {
            version: String,
            beacon: Inner,
        }
        let v = Outer {
            version: "0.2.0".into(),
            beacon: Inner { typ: "drand".into(), chain_hash: "abc".into() },
        };
        let s = to_string(&v).unwrap();
        assert_eq!(s, r#"{"version":"0.2.0","beacon":{"type":"drand","chain_hash":"abc"}}"#);
    }

    #[test]
    fn special_chars_not_over_escaped() {
        #[derive(Serialize)]
        struct U { url: String }
        let v = U { url: "https://example.com?a=1&b=2".into() };
        let s = to_string(&v).unwrap();
        // serde_json does not HTML-escape by default
        assert_eq!(s, r#"{"url":"https://example.com?a=1&b=2"}"#);
    }
}
