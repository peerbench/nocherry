package commitment

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/peerbench/commit-reveal/beacon"
	"github.com/peerbench/commit-reveal/signing"
)

func TestCreate_Basic(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if c.SpecVersion != SpecVersion {
		t.Errorf("SpecVersion = %s, want %s", c.SpecVersion, SpecVersion)
	}
	if c.ItemCount != 1 {
		t.Errorf("ItemCount = %d, want 1", c.ItemCount)
	}
	if len(c.CommitmentHash) != 64 {
		t.Errorf("CommitmentHash length = %d, want 64", len(c.CommitmentHash))
	}
	if c.Signature == "" {
		t.Error("Signature is empty")
	}
	if c.SigningKey != kp.DIDKey {
		t.Errorf("SigningKey = %s, want %s", c.SigningKey, kp.DIDKey)
	}
	if c.CommittedAt == "" {
		t.Error("CommittedAt is empty")
	}
}

func TestCreate_MultipleItems(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
		"c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
	}
	c, err := Create(CreateParams{
		Items:             items,
		RevealProbability: 0.20,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if c.ItemCount != 3 {
		t.Errorf("ItemCount = %d, want 3", c.ItemCount)
	}
}

func TestCreate_DuplicateItems(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
	}
	_, err = Create(CreateParams{
		Items:             items,
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err == nil {
		t.Error("expected error for duplicate items")
	}
}

func TestCreate_EmptyItems(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	_, err = Create(CreateParams{
		Items:             []string{},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err == nil {
		t.Error("expected error for empty items")
	}
}

func TestCreate_InvalidProbability(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	items := []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"}

	// p = 0
	_, err = Create(CreateParams{
		Items:             items,
		RevealProbability: 0.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err == nil {
		t.Error("expected error for p=0")
	}

	// p > 1
	_, err = Create(CreateParams{
		Items:             items,
		RevealProbability: 1.5,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err == nil {
		t.Error("expected error for p=1.5")
	}

	// p = 1.0 should be valid
	_, err = Create(CreateParams{
		Items:             items,
		RevealProbability: 1.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Errorf("p=1.0 should be valid: %v", err)
	}
}

func TestCreate_InvalidItemHash(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	_, err = Create(CreateParams{
		Items:             []string{"short"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err == nil {
		t.Error("expected error for short item hash")
	}
}

func TestVerifySignature_Valid(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if err := VerifySignature(c); err != nil {
		t.Errorf("VerifySignature failed: %v", err)
	}
}

func TestVerifySignature_TamperedItem(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with item.
	c.Items[0] = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if err := VerifySignature(c); err == nil {
		t.Error("VerifySignature should fail for tampered item")
	}
}

func TestVerifySignature_TamperedHash(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with commitment hash.
	c.CommitmentHash = "0000000000000000000000000000000000000000000000000000000000000000"
	if err := VerifySignature(c); err == nil {
		t.Error("VerifySignature should fail for tampered commitment hash")
	}
}

func TestVerifySignature_TamperedProbability(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with reveal_probability.
	c.RevealProbability = 0.99
	if err := VerifySignature(c); err == nil {
		t.Error("VerifySignature should fail for tampered probability")
	}
}

func TestCommitmentHash_Deterministic(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	params := CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}

	c1, err := Create(params, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Create another commitment with same params but possibly different committed_at.
	// The hash depends on committed_at, so they may differ. Let's verify determinism
	// within the same commitment.
	payload1, _ := SigningPayload(c1)
	hash1 := ComputeHash(payload1)
	hash2 := ComputeHash(payload1)
	if hash1 != hash2 {
		t.Error("ComputeHash should be deterministic")
	}
}

func TestSigningPayload_KeyOrder(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	payloadBytes, err := SigningPayload(c)
	if err != nil {
		t.Fatal(err)
	}

	payload := string(payloadBytes)

	// Verify key order: spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key
	keys := []string{
		`"spec_version"`,
		`"items"`,
		`"item_count"`,
		`"reveal_probability"`,
		`"beacon"`,
		`"committed_at"`,
		`"signing_key"`,
	}

	lastIdx := -1
	for _, key := range keys {
		idx := strings.Index(payload, key)
		if idx == -1 {
			t.Errorf("key %s not found in payload: %s", key, payload)
			continue
		}
		if idx <= lastIdx {
			t.Errorf("key %s (at %d) is not after previous key (at %d) in payload: %s", key, idx, lastIdx, payload)
		}
		lastIdx = idx
	}

	// Verify excluded keys are NOT in payload.
	for _, excluded := range []string{`"commitment_hash"`, `"stream_id"`, `"metadata"`, `"signature"`} {
		if strings.Contains(payload, excluded) {
			t.Errorf("payload should not contain %s: %s", excluded, payload)
		}
	}
}

func TestSigningPayload_NoWhitespace(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	payloadBytes, err := SigningPayload(c)
	if err != nil {
		t.Fatal(err)
	}

	payload := string(payloadBytes)
	// Should have no newlines, no indentation.
	if strings.Contains(payload, "\n") || strings.Contains(payload, "  ") {
		t.Errorf("payload contains whitespace: %s", payload)
	}
}

func TestSigningPayload_ValidJSON(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	payloadBytes, err := SigningPayload(c)
	if err != nil {
		t.Fatal(err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(payloadBytes, &parsed); err != nil {
		t.Errorf("payload is not valid JSON: %v\npayload: %s", err, string(payloadBytes))
	}
}

func TestCreate_WithStreamID(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	streamID := "s_test123"
	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
		StreamID:          &streamID,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if c.StreamID == nil || *c.StreamID != streamID {
		t.Errorf("StreamID = %v, want %s", c.StreamID, streamID)
	}

	// stream_id should NOT be in signing payload.
	payloadBytes, _ := SigningPayload(c)
	if strings.Contains(string(payloadBytes), "stream_id") {
		t.Error("signing payload should not contain stream_id")
	}
}

func TestCreate_WithMetadata(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
		Metadata: map[string]interface{}{
			"benchmark": "swe-bench",
			"version":   "1.0",
		},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if c.Metadata["benchmark"] != "swe-bench" {
		t.Errorf("Metadata[benchmark] = %v, want swe-bench", c.Metadata["benchmark"])
	}

	// metadata should NOT be in signing payload.
	payloadBytes, _ := SigningPayload(c)
	if strings.Contains(string(payloadBytes), "metadata") {
		t.Error("signing payload should not contain metadata")
	}
}

func TestCreate_NistBeacon(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewNistRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if c.Beacon.Type != "nist" {
		t.Errorf("Beacon.Type = %s, want nist", c.Beacon.Type)
	}
	if c.Beacon.Version != "2.0" {
		t.Errorf("Beacon.Version = %s, want 2.0", c.Beacon.Version)
	}
}

func TestSigningPayload_BeaconKeyOrder_Drand(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := Create(CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	payloadBytes, _ := SigningPayload(c)
	payload := string(payloadBytes)

	// In the beacon sub-object, "type" should come before "chain_hash".
	typeIdx := strings.Index(payload, `"type"`)
	chainIdx := strings.Index(payload, `"chain_hash"`)
	if typeIdx == -1 || chainIdx == -1 {
		t.Fatalf("missing beacon keys in payload: %s", payload)
	}
	if typeIdx >= chainIdx {
		t.Errorf("beacon type (%d) should come before chain_hash (%d)", typeIdx, chainIdx)
	}
}
