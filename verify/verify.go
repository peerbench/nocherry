// Package verify implements the offline verification pipeline for the
// commit-reveal protocol (Specification Section 6.4).
//
// Given a commitment, selection record, reveal object, and actual data,
// the verifier checks the entire chain: signatures, beacon, selection, and data integrity.
package verify

import (
	"fmt"

	"github.com/peerbench/commit-reveal/beacon"
	"github.com/peerbench/commit-reveal/commitment"
	"github.com/peerbench/commit-reveal/pbhash"
	"github.com/peerbench/commit-reveal/reveal"
	"github.com/peerbench/commit-reveal/selection"
)

// SelectionRecord represents the result of the selection algorithm.
type SelectionRecord struct {
	CommitmentHash    string        `json:"commitment_hash"`
	BeaconOutput      beacon.Output `json:"beacon_output"`
	SelectionMode     string        `json:"selection_mode"`
	RevealProbability float64       `json:"reveal_probability"`
	SelectedItems     []string      `json:"selected_items"`
	SelectedCount     int           `json:"selected_count"`
	TotalCount        int           `json:"total_count"`
	ComputedAt        string        `json:"computed_at"`
	ServerKey         string        `json:"server_key,omitempty"`
	ServerSignature   string        `json:"server_signature,omitempty"`
}

// CheckResult holds the outcome of a single verification check.
type CheckResult struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "pass", "fail", "skip"
	Detail string `json:"detail,omitempty"`
}

// Result holds the full verification result.
type Result struct {
	Status        string        `json:"status"` // "verified", "failed", "partial"
	Checks        []CheckResult `json:"checks"`
	ItemsChecked  int           `json:"items_checked"`
	ItemsPassed   int           `json:"items_passed"`
	ItemsFailed   int           `json:"items_failed"`
	ItemsMissing  int           `json:"items_missing"`
}

func (r *Result) addCheck(name, status, detail string) {
	r.Checks = append(r.Checks, CheckResult{Name: name, Status: status, Detail: detail})
}

// DataItem pairs an item hash with its actual data bytes.
type DataItem struct {
	Hash string
	Data []byte
}

// VerifyCommitment verifies only the commitment signature and hash.
func VerifyCommitment(c *commitment.Commitment) error {
	return commitment.VerifySignature(c)
}

// VerifyReveal verifies only the reveal signature.
func VerifyReveal(r *reveal.Reveal) error {
	return reveal.VerifySignature(r)
}

// ComputeSelection re-runs the selection algorithm for a commitment using beacon output.
func ComputeSelection(c *commitment.Commitment, beaconOutput *beacon.Output) (*SelectionRecord, error) {
	randomness, err := beaconOutput.RandomnessBytes()
	if err != nil {
		return nil, fmt.Errorf("parse beacon randomness: %w", err)
	}

	selected, mode, err := selection.Select(randomness, c.CommitmentHash, c.Items, c.RevealProbability)
	if err != nil {
		return nil, fmt.Errorf("run selection: %w", err)
	}

	if selected == nil {
		selected = []string{}
	}

	return &SelectionRecord{
		CommitmentHash:    c.CommitmentHash,
		BeaconOutput:      *beaconOutput,
		SelectionMode:     mode,
		RevealProbability: c.RevealProbability,
		SelectedItems:     selected,
		SelectedCount:     len(selected),
		TotalCount:        c.ItemCount,
	}, nil
}

// VerifyFull performs the complete verification pipeline per spec Section 6.4:
//  1. Verify commitment signature
//  2. (Beacon verification - caller responsibility, noted as skip if not done)
//  3. Verify selection (re-run algorithm and compare)
//  4. Verify reveal signature
//  5. Verify data integrity (hash each revealed item)
//  6. Check completeness (which selected items are actually revealed)
func VerifyFull(
	c *commitment.Commitment,
	sel *SelectionRecord,
	rev *reveal.Reveal,
	data []DataItem,
) *Result {
	result := &Result{Status: "verified"}

	// Step 1: Verify commitment signature.
	if err := commitment.VerifySignature(c); err != nil {
		result.addCheck("commitment_signature", "fail", err.Error())
		result.Status = "failed"
	} else {
		result.addCheck("commitment_signature", "pass", "")
	}

	// Step 2: Beacon verification (BLS/RSA) is external; note it.
	result.addCheck("beacon_authentic", "skip", "beacon signature verification requires external library")

	// Step 3: Verify selection by re-running the algorithm.
	if sel != nil {
		randomness, err := sel.BeaconOutput.RandomnessBytes()
		if err != nil {
			result.addCheck("selection_correct", "fail", fmt.Sprintf("parse randomness: %v", err))
			result.Status = "failed"
		} else {
			recomputed, _, err := selection.Select(
				randomness, c.CommitmentHash, c.Items, c.RevealProbability,
			)
			if err != nil {
				result.addCheck("selection_correct", "fail", fmt.Sprintf("run selection: %v", err))
				result.Status = "failed"
			} else {
				if recomputed == nil {
					recomputed = []string{}
				}
				if !stringSliceEqual(recomputed, sel.SelectedItems) {
					result.addCheck("selection_correct", "fail",
						fmt.Sprintf("recomputed selection does not match: got %v, want %v", recomputed, sel.SelectedItems))
					result.Status = "failed"
				} else {
					result.addCheck("selection_correct", "pass", "")
				}
			}
		}
	}

	// Step 4: Verify reveal signature.
	if rev != nil {
		if err := reveal.VerifySignature(rev); err != nil {
			result.addCheck("reveal_signature", "fail", err.Error())
			result.Status = "failed"
		} else {
			result.addCheck("reveal_signature", "pass", "")
		}
	}

	// Step 5: Verify data integrity.
	dataMap := make(map[string][]byte, len(data))
	for _, d := range data {
		dataMap[d.Hash] = d.Data
	}

	allRevealedItems := make(map[string]bool)
	if rev != nil {
		for _, h := range rev.SelectedItems {
			allRevealedItems[h] = true
		}
		for _, h := range rev.VoluntaryItems {
			allRevealedItems[h] = true
		}
	}

	for hash := range allRevealedItems {
		result.ItemsChecked++
		dataBytes, ok := dataMap[hash]
		if !ok {
			result.ItemsMissing++
			continue
		}
		computedHash := pbhash.HashBytes(dataBytes)
		if computedHash != hash {
			result.ItemsFailed++
		} else {
			result.ItemsPassed++
		}
	}

	if result.ItemsFailed > 0 {
		result.addCheck("data_integrity", "fail",
			fmt.Sprintf("%d/%d items failed hash check", result.ItemsFailed, result.ItemsChecked))
		result.Status = "failed"
	} else if result.ItemsMissing > 0 {
		result.addCheck("data_integrity", "fail",
			fmt.Sprintf("%d/%d items missing data", result.ItemsMissing, result.ItemsChecked))
		if result.Status != "failed" {
			result.Status = "partial"
		}
	} else if result.ItemsChecked > 0 {
		result.addCheck("data_integrity", "pass",
			fmt.Sprintf("%d/%d items verified", result.ItemsPassed, result.ItemsChecked))
	}

	// Step 6: Check completeness of selected items.
	if sel != nil && rev != nil {
		revealedSelected := make(map[string]bool)
		for _, h := range rev.SelectedItems {
			revealedSelected[h] = true
		}
		missing := 0
		for _, h := range sel.SelectedItems {
			if !revealedSelected[h] {
				missing++
			}
		}
		if missing > 0 {
			result.addCheck("completeness", "fail",
				fmt.Sprintf("%d/%d selected items not revealed", missing, len(sel.SelectedItems)))
			if result.Status != "failed" {
				result.Status = "partial"
			}
		} else {
			result.addCheck("completeness", "pass",
				fmt.Sprintf("all %d selected items revealed", len(sel.SelectedItems)))
		}
	}

	return result
}

func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
