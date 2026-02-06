// Package reveal implements reveal object construction for the commit-reveal
// protocol (Specification Sections 6.2-6.4).
//
// A reveal publishes the actual data behind selected item hashes.
package reveal

import (
	"fmt"
	"time"

	"github.com/peerbench/commit-reveal/canonical"
	"github.com/peerbench/commit-reveal/signing"
)

const SpecVersion = "0.2.0"

// Reveal represents a reveal object per spec Section 6.3.
type Reveal struct {
	SpecVersion    string   `json:"spec_version"`
	CommitmentHash string   `json:"commitment_hash"`
	SelectedItems  []string `json:"selected_items"`
	VoluntaryItems []string `json:"voluntary_items"`
	DataURL        *string  `json:"data_url"`
	RevealedAt     string   `json:"revealed_at"`
	SigningKey      string   `json:"signing_key"`
	Signature      string   `json:"signature"`
}

// signingPayload is the struct for the canonical JSON signing payload.
// Key order per spec Section 12:
// spec_version, commitment_hash, selected_items, voluntary_items, revealed_at, signing_key
type revealSigningPayload struct {
	SpecVersion    string   `json:"spec_version"`
	CommitmentHash string   `json:"commitment_hash"`
	SelectedItems  []string `json:"selected_items"`
	VoluntaryItems []string `json:"voluntary_items"`
	RevealedAt     string   `json:"revealed_at"`
	SigningKey     string   `json:"signing_key"`
}

// SigningPayload computes the canonical JSON signing payload for a reveal.
func SigningPayload(r *Reveal) ([]byte, error) {
	selectedItems := r.SelectedItems
	if selectedItems == nil {
		selectedItems = []string{}
	}
	voluntaryItems := r.VoluntaryItems
	if voluntaryItems == nil {
		voluntaryItems = []string{}
	}
	payload := revealSigningPayload{
		SpecVersion:    r.SpecVersion,
		CommitmentHash: r.CommitmentHash,
		SelectedItems:  selectedItems,
		VoluntaryItems: voluntaryItems,
		RevealedAt:     r.RevealedAt,
		SigningKey:     r.SigningKey,
	}
	return canonical.Marshal(payload)
}

// CreateParams holds the parameters for creating a new reveal.
type CreateParams struct {
	CommitmentHash string
	SelectedItems  []string
	VoluntaryItems []string
	DataURL        *string
}

// Create builds a complete, signed reveal object.
func Create(params CreateParams, kp *signing.KeyPair) (*Reveal, error) {
	if params.CommitmentHash == "" {
		return nil, fmt.Errorf("commitment_hash is required")
	}

	selectedItems := params.SelectedItems
	if selectedItems == nil {
		selectedItems = []string{}
	}
	voluntaryItems := params.VoluntaryItems
	if voluntaryItems == nil {
		voluntaryItems = []string{}
	}

	now := time.Now().UTC().Format(time.RFC3339)

	r := &Reveal{
		SpecVersion:    SpecVersion,
		CommitmentHash: params.CommitmentHash,
		SelectedItems:  selectedItems,
		VoluntaryItems: voluntaryItems,
		DataURL:        params.DataURL,
		RevealedAt:     now,
		SigningKey:      kp.DIDKey,
	}

	payloadBytes, err := SigningPayload(r)
	if err != nil {
		return nil, fmt.Errorf("compute signing payload: %w", err)
	}

	r.Signature = signing.Sign(kp.PrivateKey, payloadBytes)
	return r, nil
}

// VerifySignature verifies the reveal's signature against its signing payload.
func VerifySignature(r *Reveal) error {
	payloadBytes, err := SigningPayload(r)
	if err != nil {
		return fmt.Errorf("compute signing payload: %w", err)
	}
	if err := signing.Verify(r.SigningKey, payloadBytes, r.Signature); err != nil {
		return fmt.Errorf("signature verification: %w", err)
	}
	return nil
}
