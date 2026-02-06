// Package canonical provides canonical JSON serialization for the commit-reveal protocol.
//
// Canonical JSON rules (from spec Section 12):
//  1. No whitespace
//  2. Object keys in the order specified per object type
//  3. Strings use minimal JSON escaping (RFC 8259)
//  4. UTF-8 encoding
//  5. No trailing commas, no BOM
//  6. Arrays preserve element order
//
// Callers must define struct fields in the correct order for each object type.
// Go's encoding/json marshals struct fields in declaration order.
package canonical

import (
	"bytes"
	"encoding/json"
)

// Marshal produces canonical JSON bytes from a value.
// The value should be a struct with fields in the spec-required key order.
// HTML escaping is disabled to produce minimal JSON escaping per RFC 8259.
func Marshal(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	// json.Encoder.Encode appends a trailing newline; strip it.
	b := buf.Bytes()
	if len(b) > 0 && b[len(b)-1] == '\n' {
		b = b[:len(b)-1]
	}
	return b, nil
}
