package verify

import (
	"encoding/hex"
	"testing"

	"github.com/peerbench/commit-reveal/beacon"
	"github.com/peerbench/commit-reveal/commitment"
	"github.com/peerbench/commit-reveal/pbhash"
	"github.com/peerbench/commit-reveal/reveal"
	"github.com/peerbench/commit-reveal/signing"
)

func makeTestCommitment(t *testing.T, kp *signing.KeyPair, items []string) *commitment.Commitment {
	t.Helper()
	c, err := commitment.Create(commitment.CreateParams{
		Items:             items,
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestComputeSelection(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
	}
	c := makeTestCommitment(t, kp, items)

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      35200001,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc123",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	if sel.CommitmentHash != c.CommitmentHash {
		t.Errorf("CommitmentHash = %s, want %s", sel.CommitmentHash, c.CommitmentHash)
	}
	if sel.SelectionMode != "per_item" {
		t.Errorf("SelectionMode = %s, want per_item", sel.SelectionMode)
	}
	if sel.TotalCount != 2 {
		t.Errorf("TotalCount = %d, want 2", sel.TotalCount)
	}
}

func TestVerifyFull_CompleteSuccess(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	// Create data and compute hashes.
	data1 := []byte("test data item 1")
	data2 := []byte("test data item 2")
	hash1 := pbhash.HashBytes(data1)
	hash2 := pbhash.HashBytes(data2)

	// Create commitment.
	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1, hash2},
		RevealProbability: 1.0, // select all
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Create beacon output.
	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      35200001,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc123",
	}

	// Compute selection.
	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	// With p=1.0, all items should be selected.
	if sel.SelectedCount != 2 {
		t.Fatalf("expected 2 selected items with p=1.0, got %d", sel.SelectedCount)
	}

	// Create reveal.
	rev, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: c.CommitmentHash,
		SelectedItems:  sel.SelectedItems,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Verify full chain.
	result := VerifyFull(c, sel, rev, []DataItem{
		{Hash: hash1, Data: data1},
		{Hash: hash2, Data: data2},
	})

	if result.Status != "verified" {
		t.Errorf("Status = %s, want verified", result.Status)
		for _, check := range result.Checks {
			t.Logf("  %s: %s %s", check.Name, check.Status, check.Detail)
		}
	}

	if result.ItemsPassed != 2 {
		t.Errorf("ItemsPassed = %d, want 2", result.ItemsPassed)
	}
	if result.ItemsFailed != 0 {
		t.Errorf("ItemsFailed = %d, want 0", result.ItemsFailed)
	}
}

func TestVerifyFull_TamperedCommitment(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	data1 := []byte("test data")
	hash1 := pbhash.HashBytes(data1)

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1},
		RevealProbability: 1.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with commitment.
	c.RevealProbability = 0.5

	result := VerifyFull(c, nil, nil, nil)

	if result.Status != "failed" {
		t.Errorf("Status = %s, want failed", result.Status)
	}

	// commitment_signature check should fail.
	found := false
	for _, check := range result.Checks {
		if check.Name == "commitment_signature" && check.Status == "fail" {
			found = true
		}
	}
	if !found {
		t.Error("expected commitment_signature check to fail")
	}
}

func TestVerifyFull_WrongData(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	data1 := []byte("original data")
	hash1 := pbhash.HashBytes(data1)

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1},
		RevealProbability: 1.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	rev, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: c.CommitmentHash,
		SelectedItems:  sel.SelectedItems,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Provide wrong data.
	result := VerifyFull(c, sel, rev, []DataItem{
		{Hash: hash1, Data: []byte("tampered data")},
	})

	if result.Status != "failed" {
		t.Errorf("Status = %s, want failed", result.Status)
	}
	if result.ItemsFailed != 1 {
		t.Errorf("ItemsFailed = %d, want 1", result.ItemsFailed)
	}
}

func TestVerifyFull_MissingData(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	data1 := []byte("data 1")
	hash1 := pbhash.HashBytes(data1)

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1},
		RevealProbability: 1.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	rev, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: c.CommitmentHash,
		SelectedItems:  sel.SelectedItems,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	// Provide no data.
	result := VerifyFull(c, sel, rev, nil)

	if result.ItemsMissing == 0 {
		t.Error("expected ItemsMissing > 0")
	}
}

func TestVerifyFull_IncompleteReveal(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	data1 := []byte("data 1")
	data2 := []byte("data 2")
	hash1 := pbhash.HashBytes(data1)
	hash2 := pbhash.HashBytes(data2)

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1, hash2},
		RevealProbability: 1.0,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	// Only reveal one of two selected items.
	var partialSelected []string
	if len(sel.SelectedItems) > 0 {
		partialSelected = sel.SelectedItems[:1]
	}

	rev, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: c.CommitmentHash,
		SelectedItems:  partialSelected,
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	result := VerifyFull(c, sel, rev, []DataItem{
		{Hash: hash1, Data: data1},
		{Hash: hash2, Data: data2},
	})

	// Should detect that not all selected items were revealed.
	completenessFound := false
	for _, check := range result.Checks {
		if check.Name == "completeness" {
			completenessFound = true
			if sel.SelectedCount > 1 && check.Status != "fail" {
				t.Errorf("completeness check should fail when not all selected items revealed")
			}
		}
	}
	if !completenessFound {
		t.Error("expected completeness check")
	}
}

func TestVerifyFull_VoluntaryReveal(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	data1 := []byte("voluntary data")
	hash1 := pbhash.HashBytes(data1)

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{hash1},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: "0000000000000000000000000000000000000000000000000000000000000000",
		Signature:  "abc",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	// Create reveal with item as voluntary (regardless of selection).
	rev, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: c.CommitmentHash,
		SelectedItems:  sel.SelectedItems,
		VoluntaryItems: []string{hash1},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	result := VerifyFull(c, sel, rev, []DataItem{
		{Hash: hash1, Data: data1},
	})

	// Data integrity should pass for the voluntary item.
	if result.ItemsFailed > 0 {
		t.Errorf("ItemsFailed = %d, want 0", result.ItemsFailed)
	}
}

func TestVerifyCommitment_Standalone(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c, err := commitment.Create(commitment.CreateParams{
		Items:             []string{"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		RevealProbability: 0.10,
		Beacon:            beacon.NewDrandRef(),
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if err := VerifyCommitment(c); err != nil {
		t.Errorf("VerifyCommitment failed: %v", err)
	}
}

func TestVerifyReveal_Standalone(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	r, err := reveal.Create(reveal.CreateParams{
		CommitmentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		SelectedItems:  []string{"item1"},
	}, kp)
	if err != nil {
		t.Fatal(err)
	}

	if err := VerifyReveal(r); err != nil {
		t.Errorf("VerifyReveal failed: %v", err)
	}
}

func TestComputeSelection_Deterministic(t *testing.T) {
	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c := makeTestCommitment(t, kp, []string{
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
		"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
		"c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
	})

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
		Signature:  "abc",
	}

	sel1, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}
	sel2, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	if len(sel1.SelectedItems) != len(sel2.SelectedItems) {
		t.Fatal("selection should be deterministic")
	}
	for i := range sel1.SelectedItems {
		if sel1.SelectedItems[i] != sel2.SelectedItems[i] {
			t.Errorf("selection[%d] differs: %s vs %s", i, sel1.SelectedItems[i], sel2.SelectedItems[i])
		}
	}
}

func TestComputeSelection_SpecVectorPerItem(t *testing.T) {
	// Use the spec test vectors from Section 10.2.
	// We need a commitment with a specific commitment_hash.
	// Since we can't easily control commitment_hash, let's test
	// the selection logic directly through ComputeSelection.

	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	_, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	// The spec test uses commitment_hash "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4".
	// We can't easily create a commitment with that exact hash, so we test
	// the selection algorithm separately in selection_test.go.
	// This test just verifies the integration works.

	kp, err := signing.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	c := makeTestCommitment(t, kp, []string{
		"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
	})

	beaconOut := &beacon.Output{
		Type:       "drand",
		ChainHash:  beacon.DrandQuicknet.ChainHash,
		Round:      1,
		Randomness: beaconHex,
		Signature:  "abc",
	}

	sel, err := ComputeSelection(c, beaconOut)
	if err != nil {
		t.Fatal(err)
	}

	if sel.TotalCount != 1 {
		t.Errorf("TotalCount = %d, want 1", sel.TotalCount)
	}
	if sel.SelectionMode != "per_item" {
		t.Errorf("SelectionMode = %s, want per_item", sel.SelectionMode)
	}
}
