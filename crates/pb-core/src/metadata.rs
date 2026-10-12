//! Canonical metadata (Spec v0.5 Section 7.3).
//!
//! Keys sorted by Unicode code point, integer numbers only, strings escaped as
//! in Section 4, at most `MAX_METADATA_BYTES` bytes. The serializer does not
//! rely on the map type of `serde_json::Value`, so the order is the same
//! whether or not `preserve_order` is enabled anywhere in the build.

use serde_json::Value;

/// Upper bound on the canonical serialization.
pub const MAX_METADATA_BYTES: usize = 4096;

/// Largest integer allowed in metadata (2^53 - 1).
pub const MAX_METADATA_INT: u64 = (1u64 << 53) - 1;

/// Canonical serialization of a metadata object, or why it is malformed.
pub fn canonical_metadata(value: &Value) -> Result<String, String> {
    if !value.is_object() {
        return Err("metadata must be a JSON object".into());
    }
    let mut out = String::new();
    write_value(value, &mut out)?;
    if out.len() > MAX_METADATA_BYTES {
        return Err(format!("metadata canonical form is {} bytes, limit {}", out.len(), MAX_METADATA_BYTES));
    }
    Ok(out)
}

fn write_value(value: &Value, out: &mut String) -> Result<(), String> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => {
            // serde_json parses "1.0", "1e2" and "-0" as floats; all are rejected.
            if let Some(u) = n.as_u64() {
                if u > MAX_METADATA_INT {
                    return Err(format!("metadata integer {u} exceeds 2^53 - 1"));
                }
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                if i < -(MAX_METADATA_INT as i64) {
                    return Err(format!("metadata integer {i} is below -(2^53 - 1)"));
                }
                out.push_str(&i.to_string());
            } else {
                return Err(format!("metadata number {n} is not an integer"));
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 { out.push(','); }
                write_value(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            // Code point order equals UTF-8 byte order, which is how Rust compares strings.
            // A JSON parser keeps one value per key, so duplicates cannot reach here.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.iter().enumerate() {
                if i > 0 { out.push(','); }
                write_string(key, out);
                out.push(':');
                write_value(&map[*key], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// JSON string with the escaping of Spec v0.5 Section 4.
pub fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn spec_vector_13_11() {
        let input: Value = serde_json::from_str(r#"{"b": 1, "a": "x", "nested": {"z": [true, null], "y": "é\n"}}"#).unwrap();
        assert_eq!(canonical_metadata(&input).unwrap(), "{\"a\":\"x\",\"b\":1,\"nested\":{\"y\":\"é\\n\",\"z\":[true,null]}}");
    }

    #[test]
    fn empty_object() {
        assert_eq!(canonical_metadata(&json!({})).unwrap(), "{}");
    }

    #[test]
    fn matches_serde_json_string_escaping() {
        // The escaping rule is the one serde_json and JSON.stringify share.
        let s = "quote\" backslash\\ bell\u{07} tab\t del\u{7f} line\u{2028} emoji\u{1F600}";
        let mut out = String::new();
        write_string(s, &mut out);
        assert_eq!(out, serde_json::to_string(s).unwrap());
    }

    #[test]
    fn keys_sorted_by_code_point_not_locale() {
        let v: Value = serde_json::from_str(r#"{"b":1,"B":2,"a":3,"ä":4,"aa":5,"_":6}"#).unwrap();
        assert_eq!(canonical_metadata(&v).unwrap(), r#"{"B":2,"_":6,"a":3,"aa":5,"b":1,"ä":4}"#);
    }

    #[test]
    fn rejects_non_integers_and_big_integers() {
        for bad in [r#"{"a":1.5}"#, r#"{"a":1.0}"#, r#"{"a":1e2}"#, r#"{"a":-0.0}"#, r#"{"a":9007199254740992}"#, r#"{"a":-9007199254740992}"#] {
            let v: Value = serde_json::from_str(bad).unwrap();
            assert!(canonical_metadata(&v).is_err(), "{bad}");
        }
        for ok in [r#"{"a":9007199254740991}"#, r#"{"a":-9007199254740991}"#, r#"{"a":0}"#] {
            let v: Value = serde_json::from_str(ok).unwrap();
            assert!(canonical_metadata(&v).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_non_object_and_oversize() {
        assert!(canonical_metadata(&json!([1])).is_err());
        assert!(canonical_metadata(&json!("x")).is_err());
        assert!(canonical_metadata(&Value::Null).is_err());
        let big = json!({"k": "x".repeat(MAX_METADATA_BYTES)});
        assert!(canonical_metadata(&big).is_err());
        let fits = json!({"k": "x".repeat(MAX_METADATA_BYTES - 8)}); // {"k":"..."} is 8 bytes of framing
        assert_eq!(canonical_metadata(&fits).unwrap().len(), MAX_METADATA_BYTES);
    }

    #[test]
    fn nested_order_and_control_chars() {
        let v: Value = serde_json::from_str("{\"z\":{\"b\":[{\"d\":null,\"c\":false}],\"a\":\"\\u0001\"}}").unwrap();
        assert_eq!(canonical_metadata(&v).unwrap(), r#"{"z":{"a":"\u0001","b":[{"c":false,"d":null}]}}"#);
    }
}
