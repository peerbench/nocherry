package reveal

import (
	"strings"
	"testing"

	"github.com/peerbench/commit-reveal/signing"
)

func TestCreate_Basic(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
		VoluntaryItems: []string{"c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if r.SpecVersion != SpecVersion {
		t.Errorf("SpecVersion = %s, want %s", r.SpecVersion, SpecVersion)
	}
	if r.CommitmentHash != "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" {
		t.Error("CommitmentHash mismatch")
	}
	if len(r.SelectedItems) != 1 {
		t.Errorf("SelectedItems length = %d, want 1", len(r.SelectedItems))
	}
	if len(r.VoluntaryItems) != 1 {
		t.Errorf("VoluntaryItems length = %d, want 1", len(r.VoluntaryItems))
	}
	if r.Signature == "" {
		t.Error("Signature is empty")
	}
	if r.SigningKey != kp.DIDKey {
		t.Errorf("SigningKey = %s, want %s", r.SigningKey, kp.DIDKey)
	}
}

func TestCreate_EmptyCommitmentHash(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	_, err = Create(CreateParams{
		CommitmentHash: "",
	}, kp)
	if err == nil {
		t.Error("expected error for empty commitment hash")
	}
}

func TestCreate_NilItems(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Nil items should become empty arrays.
	if r.SelectedItems == nil || len(r.SelectedItems) != 0 {
		t.Errorf("SelectedItems should be empty slice, got %v", r.SelectedItems)
	}
	if r.VoluntaryItems == nil || len(r.VoluntaryItems) != 0 {
		t.Errorf("VoluntaryItems should be empty slice, got %v", r.VoluntaryItems)
	}
}

func TestVerifySignature_Valid(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if err := VerifySignature(r); err != nil {
		t.Errorf("VerifySignature failed: %v", err)
	}
}

func TestVerifySignature_Tampered(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with commitment hash.
	r.CommitmentHash = "0000000000000000000000000000000000000000000000000000000000000000"
	if err := VerifySignature(r); err == nil {
		t.Error("VerifySignature should fail for tampered commitment hash")
	}
}

func TestVerifySignature_WrongKey(t *testing.T) {
	kp1, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	kp2, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
	}, kp1)
	if err != nil {
		t.Fatal(err)
	}

	// Replace signing key with a different key - signature won't match.
	r.SigningKey = kp2.DIDKey
	if err := VerifySignature(r); err == nil {
		t.Error("VerifySignature should fail with wrong key")
	}
}

func TestSigningPayload_KeyOrder(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"sel1"},
		VoluntaryItems: []string{"vol1"},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	payloadBytes, err := SigningPayload(r)
	if err != nil {
		t.Fatal(err)
	}

	payload := string(payloadBytes)

	// Key order: spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key
	keys := []string{
		`"spec_version"`,
		`"commitment_hash"`,
		`"selected_items"`,
		`"voluntary_items"`,
		`"revealed_at"`,
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
			t.Errorf("key %s (at %d) is not after previous key (at %d)", key, idx, lastIdx)
		}
		lastIdx = idx
	}

	// data_url and signature should NOT be in signing payload.
	if strings.Contains(payload, `"data_url"`) {
		t.Error("signing payload should not contain data_url")
	}
	if strings.Contains(payload, `"signature"`) {
		t.Error("signing payload should not contain signature")
	}
}

func TestCreate_WithDataURL(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	dataURL := "https://github.com/myorg/benchmark-reveal"
	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
		DataURL:        &dataURL,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if r.DataURL == nil || *r.DataURL != dataURL {
		t.Errorf("DataURL = %v, want %s", r.DataURL, dataURL)
	}
}

func TestCreate_DifferentSignerThanCommitter(t *testing.T) {
	// Per spec Section 6.3: reveal signing_key need not match commitment's key.
	kp1, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	kp2, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	// Commitment with kp1.
	// Reveal with kp2 - should work.
	r, err := Create(CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"},
	}, kp2)
	if err != nil {
		t.Fatal(err)
	}

	if r.SigningKey != kp2.DIDKey {
		t.Errorf("SigningKey = %s, want %s", r.SigningKey, kp2.DIDKey)
	}

	// Verify should work with kp2's key.
	if err := VerifySignature(r); err != nil {
		t.Errorf("VerifySignature failed with different signer: %v", err)
	}

	_ = kp1 // kp1 was used for commitment, kp2 for reveal
}
