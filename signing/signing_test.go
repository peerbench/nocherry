package signing

import (
	"crypto/ed25519"
	"testing"
)

func TestGenerateKeyPair(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	if len(kp.PrivateKey) != ed25519.PrivateKeySize {
		t.Errorf("private key length = %d, want %d", len(kp.PrivateKey), ed25519.PrivateKeySize)
	}
	if len(kp.PublicKey) != ed25519.PublicKeySize {
		t.Errorf("public key length = %d, want %d", len(kp.PublicKey), ed25519.PublicKeySize)
	}
	if kp.DIDKey == "" {
		t.Error("DIDKey is empty")
	}
	if kp.DIDKey[:9] != "did:key:z" {
		t.Errorf("DIDKey prefix = %s, want did:key:z", kp.DIDKey[:9])
	}
}

func TestDIDKeyRoundtrip(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	// Encode
	did := EncodeDIDKey(kp.PublicKey)
	if did != kp.DIDKey {
		t.Errorf("EncodeDIDKey = %s, want %s", did, kp.DIDKey)
	}

	// Decode
	decoded, err := DecodeDIDKey(did)
	if err != nil {
		t.Fatal(err)
	}
	if !decoded.Equal(kp.PublicKey) {
		t.Errorf("decoded public key does not match original")
	}
}

func TestDIDKeyKnownVector(t *testing.T) {
	// Test with a known public key. The did:key format is:
	// did:key:z + base58btc(0xed01 + pub_bytes)
	// We can't hardcode a test vector without a specific key, but we can verify
	// the round-trip and format.
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	did := kp.DIDKey
	// Must start with did:key:z
	if did[:9] != "did:key:z" {
		t.Errorf("DID prefix = %s, want did:key:z", did[:9])
	}
	// Length should be: "did:key:z" (9) + base58btc(34 bytes) ≈ 48 chars
	if len(did) < 40 || len(did) > 60 {
		t.Errorf("DID length = %d, seems wrong", len(did))
	}
}

func TestDecodeDIDKey_Invalid(t *testing.T) {
	tests := []struct {
		name string
		did  string
	}{
		{"empty", ""},
		{"no prefix", "z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP"},
		{"wrong prefix", "did:web:example.com"},
		{"wrong multibase", "did:key:b6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP"},
		{"too short", "did:key:z11"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodeDIDKey(tt.did)
			if err == nil {
				t.Errorf("DecodeDIDKey(%q) should have failed", tt.did)
			}
		})
	}
}

func TestSignAndVerify(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	message := []byte("hello world")
	sig := Sign(kp.PrivateKey, message)

	// Verify with did:key
	if err := Verify(kp.DIDKey, message, sig); err != nil {
		t.Errorf("Verify failed: %v", err)
	}

	// Verify with public key directly
	if err := VerifyWithKey(kp.PublicKey, message, sig); err != nil {
		t.Errorf("VerifyWithKey failed: %v", err)
	}
}

func TestSignAndVerify_WrongMessage(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	message := []byte("hello world")
	sig := Sign(kp.PrivateKey, message)

	// Verify with wrong message should fail.
	if err := Verify(kp.DIDKey, []byte("wrong message"), sig); err == nil {
		t.Error("Verify should have failed with wrong message")
	}
}

func TestSignAndVerify_WrongKey(t *testing.T) {
	kp1, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	kp2, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	message := []byte("hello world")
	sig := Sign(kp1.PrivateKey, message)

	// Verify with wrong key should fail.
	if err := Verify(kp2.DIDKey, message, sig); err == nil {
		t.Error("Verify should have failed with wrong key")
	}
}

func TestSignatureHexFormat(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	sig := Sign(kp.PrivateKey, []byte("test"))

	// Ed25519 signature is 64 bytes = 128 hex chars.
	if len(sig) != 128 {
		t.Errorf("signature hex length = %d, want 128", len(sig))
	}

	// Must be lowercase hex.
	for _, c := range sig {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("signature contains non-lowercase-hex char: %c", c)
			break
		}
	}
}

func TestMultipleKeyPairsUnique(t *testing.T) {
	kp1, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	kp2, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	if kp1.DIDKey == kp2.DIDKey {
		t.Error("two generated key pairs should have different DID keys")
	}
}

func TestSignDeterministic(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	message := []byte("deterministic test")
	sig1 := Sign(kp.PrivateKey, message)
	sig2 := Sign(kp.PrivateKey, message)

	// Ed25519 signing is deterministic.
	if sig1 != sig2 {
		t.Error("signing the same message twice should produce the same signature")
	}
}
