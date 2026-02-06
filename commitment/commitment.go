// Package commitment implements commitment object construction for the
// commit-reveal protocol (Specification Sections 3.1-3.3).
//
// A commitment is a signed declaration that one or more item hashes exist.
// The signing payload is canonical JSON of specific fields in a defined order.
// The commitment_hash is SHA-256 of the signing payload.
package commitment

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/peerbench/commit-reveal/beacon"
	"github.com/peerbench/commit-reveal/canonical"
	"github.com/peerbench/commit-reveal/signing"
)

const SpecVersion = "0.2.0"

// Commitment represents a full commitment object per spec Section 3.1.
type Commitment struct {
	SpecVersion       string                 `json:"spec_version"`
	CommitmentHash    string                 `json:"commitment_hash"`
	StreamID          *string                `json:"stream_id"`
	Items             []string               `json:"items"`
	ItemCount         int                    `json:"item_count"`
	RevealProbability float64                `json:"reveal_probability"`
	Beacon            beacon.Ref             `json:"beacon"`
	Metadata          map[string]interface{} `json:"metadata"`
	CommittedAt       string                 `json:"committed_at"`
	SigningKey        string                 `json:"signing_key"`
	Signature         string                 `json:"signature"`
}

// signingPayload is the struct used to produce the canonical JSON signing payload.
// Fields are in the spec-required order (Section 3.2):
// spec_version, items, item_count, reveal_probability, beacon, committed_at, signing_key
type signingPayload struct {
	SpecVersion       string     `json:"spec_version"`
	Items             []string   `json:"items"`
	ItemCount         int        `json:"item_count"`
	RevealProbability float64    `json:"reveal_probability"`
	Beacon            beacon.Ref `json:"beacon"`
	CommittedAt       string     `json:"committed_at"`
	SigningKey        string     `json:"signing_key"`
}

// SigningPayload computes the canonical JSON signing payload for a commitment.
// This is the data that gets signed and hashed.
func SigningPayload(c *Commitment) ([]byte, error) {
	payload := signingPayload{
		SpecVersion:       c.SpecVersion,
		Items:             c.Items,
		ItemCount:         c.ItemCount,
		RevealProbability: c.RevealProbability,
		Beacon:            c.Beacon,
		CommittedAt:       c.CommittedAt,
		SigningKey:        c.SigningKey,
	}
	return canonical.Marshal(payload)
}

// ComputeHash computes the commitment_hash from the signing payload.
// commitment_hash = SHA-256(signing_payload), lowercase hex, 64 chars.
func ComputeHash(signingPayloadBytes []byte) string {
	h := sha256.Sum256(signingPayloadBytes)
	return hex.EncodeToString(h[:])
}

// CreateParams holds the parameters for creating a new commitment.
type CreateParams struct {
	Items             []string
	RevealProbability float64
	Beacon            beacon.Ref
	Metadata          map[string]interface{}
	StreamID          *string
}

// Create builds a complete, signed commitment.
// It computes the signing payload, signs it, and derives the commitment hash.
func Create(params CreateParams, kp *signing.KeyPair) (*Commitment, error) {
	if len(params.Items) == 0 {
		return nil, fmt.Errorf("at least one item is required")
	}
	if params.RevealProbability <= 0.0 || params.RevealProbability > 1.0 {
		return nil, fmt.Errorf("reveal_probability must be in (0.0, 1.0], got %f", params.RevealProbability)
	}

	// Check for duplicate items.
	seen := make(map[string]bool, len(params.Items))
	for _, item := range params.Items {
		if seen[item] {
			return nil, fmt.Errorf("duplicate item hash: %s", item)
		}
		if len(item) != 64 {
			return nil, fmt.Errorf("item hash must be 64 hex chars, got %d: %s", len(item), item)
		}
		seen[item] = true
	}

	now := time.Now().UTC().Format(time.RFC3339)

	metadata := params.Metadata
	if metadata == nil {
		metadata = map[string]interface{}{}
	}

	c := &Commitment{
		SpecVersion:       SpecVersion,
		Items:             params.Items,
		ItemCount:         len(params.Items),
		RevealProbability: params.RevealProbability,
		Beacon:            params.Beacon,
		Metadata:          metadata,
		CommittedAt:       now,
		SigningKey:        kp.DIDKey,
		StreamID:          params.StreamID,
	}

	// Compute signing payload.
	payloadBytes, err := SigningPayload(c)
	if err != nil {
		return nil, fmt.Errorf("compute signing payload: %w", err)
	}

	// Sign.
	c.Signature = signing.Sign(kp.PrivateKey, payloadBytes)

	// Compute commitment hash.
	c.CommitmentHash = ComputeHash(payloadBytes)

	return c, nil
}

// VerifySignature verifies the commitment's signature against its signing payload.
func VerifySignature(c *Commitment) error {
	payloadBytes, err := SigningPayload(c)
	if err != nil {
		return fmt.Errorf("compute signing payload: %w", err)
	}

	// Verify commitment_hash matches.
	expectedHash := ComputeHash(payloadBytes)
	if c.CommitmentHash != expectedHash {
		return fmt.Errorf("commitment_hash mismatch: got %s, want %s", c.CommitmentHash, expectedHash)
	}

	// Verify signature.
	if err := signing.Verify(c.SigningKey, payloadBytes, c.Signature); err != nil {
		return fmt.Errorf("signature verification: %w", err)
	}

	return nil
}
