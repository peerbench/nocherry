// Package signing implements Ed25519 signing/verification and did:key encoding
// for the commit-reveal protocol.
//
// did:key format for Ed25519:
//
//	did:key:z<base58btc(0xed01 || public_key_bytes)>
//
// where 0xed01 is the multicodec prefix for Ed25519 public keys.
package signing

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/mr-tron/base58"
)

// ed25519MulticodecPrefix is the two-byte varint for Ed25519 public keys.
var ed25519MulticodecPrefix = []byte{0xed, 0x01}

// KeyPair holds an Ed25519 key pair with its did:key identifier.
type KeyPair struct {
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
	DIDKey     string
}

// GenerateKeyPair creates a new Ed25519 key pair.
func GenerateKeyPair() (*KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ed25519 key: %w", err)
	}
	did := EncodeDIDKey(pub)
	return &KeyPair{
		PrivateKey: priv,
		PublicKey:  pub,
		DIDKey:     did,
	}, nil
}

// EncodeDIDKey encodes an Ed25519 public key as a did:key string.
func EncodeDIDKey(pub ed25519.PublicKey) string {
	// Prepend multicodec prefix.
	data := make([]byte, len(ed25519MulticodecPrefix)+len(pub))
	copy(data, ed25519MulticodecPrefix)
	copy(data[len(ed25519MulticodecPrefix):], pub)
	// Base58btc encode with 'z' multibase prefix.
	encoded := base58.Encode(data)
	return "did:key:z" + encoded
}

// DecodeDIDKey decodes a did:key string to an Ed25519 public key.
func DecodeDIDKey(did string) (ed25519.PublicKey, error) {
	if !strings.HasPrefix(did, "did:key:z") {
		return nil, fmt.Errorf("invalid did:key format: must start with did:key:z")
	}
	encoded := did[len("did:key:z"):]
	data, err := base58.Decode(encoded)
	if err != nil {
		return nil, fmt.Errorf("base58 decode: %w", err)
	}
	if len(data) < 2 {
		return nil, fmt.Errorf("decoded data too short")
	}
	if data[0] != 0xed || data[1] != 0x01 {
		return nil, fmt.Errorf("unsupported multicodec prefix: %x%x (expected ed01 for Ed25519)", data[0], data[1])
	}
	pubBytes := data[2:]
	if len(pubBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid Ed25519 public key length: got %d, want %d", len(pubBytes), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(pubBytes), nil
}

// Sign signs a message with an Ed25519 private key.
// Returns the signature as lowercase hex.
func Sign(privateKey ed25519.PrivateKey, message []byte) string {
	sig := ed25519.Sign(privateKey, message)
	return hex.EncodeToString(sig)
}

// Verify verifies an Ed25519 signature against a did:key and message.
// The signature should be lowercase hex-encoded.
func Verify(didKey string, message []byte, signatureHex string) error {
	pub, err := DecodeDIDKey(didKey)
	if err != nil {
		return fmt.Errorf("decode did:key: %w", err)
	}
	sig, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("decode signature hex: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length: got %d, want %d", len(sig), ed25519.SignatureSize)
	}
	if !ed25519.Verify(pub, message, sig) {
		return fmt.Errorf("signature verification failed")
	}
	return nil
}

// VerifyWithKey verifies an Ed25519 signature directly with a public key.
func VerifyWithKey(pub ed25519.PublicKey, message []byte, signatureHex string) error {
	sig, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("decode signature hex: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length: got %d, want %d", len(sig), ed25519.SignatureSize)
	}
	if !ed25519.Verify(pub, message, sig) {
		return fmt.Errorf("signature verification failed")
	}
	return nil
}
