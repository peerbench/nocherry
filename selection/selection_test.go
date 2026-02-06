package selection

import (
	"encoding/hex"
	"math"
	"testing"
)

// --- Spec test vectors: Commit-Reveal Spec Section 10.1 (PRNG) ---

func TestPRNG_SpecVector(t *testing.T) {
	seedHex := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	seed, err := hex.DecodeString(seedHex)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		index   uint64
		wantMAC string
		wantVal uint64
	}{
		{
			index:   0,
			wantMAC: "8bc1aab00ed4423c741ed6670d50d4ab95e7207fc4a81f4aa09b8e2ba20b5658",
			wantVal: 4342266150297190795,
		},
		{
			index:   1,
			wantMAC: "4d0d8aedaf2ddd700fcdcad9c566103a29ee40c3b317a30d04916df298ac7a80",
			wantVal: 8132706735728758093,
		},
		{
			index:   2,
			wantMAC: "a95b16931142b70abdc2fc01f651e9ad201cc86a780d719c892e58950809196b",
			wantVal: 772158504366922665,
		},
	}

	for _, tt := range tests {
		val, macHex := PRNGNextHex(seed, tt.index)
		if macHex != tt.wantMAC {
			t.Errorf("PRNG index %d: HMAC = %s, want %s", tt.index, macHex, tt.wantMAC)
		}
		if val != tt.wantVal {
			t.Errorf("PRNG index %d: uint64 = %d, want %d", tt.index, val, tt.wantVal)
		}
	}
}

// --- Spec test vectors: Commit-Reveal Spec Section 10.2 (Per-Item Selection) ---

func TestThreshold(t *testing.T) {
	got := Threshold(0.10)
	want := uint64(1844674407370955264)
	if got != want {
		t.Errorf("Threshold(0.10) = %d, want %d", got, want)
	}
}

func TestThreshold_EdgeCases(t *testing.T) {
	// p = 1.0 should return MaxUint64
	if got := Threshold(1.0); got != math.MaxUint64 {
		t.Errorf("Threshold(1.0) = %d, want %d", got, uint64(math.MaxUint64))
	}
	// p = 0.0 should return 0
	if got := Threshold(0.0); got != 0 {
		t.Errorf("Threshold(0.0) = %d, want 0", got)
	}
	// p = 0.5 should be about half of max uint64
	got := Threshold(0.5)
	expected := uint64(1 << 63) // 2^63
	if got != expected {
		t.Errorf("Threshold(0.5) = %d, want %d", got, expected)
	}
}

func TestSelectPerItem_SpecVector_Selected(t *testing.T) {
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	commitmentHash := "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
	itemHash := "32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2"
	revealProb := 0.10

	selected, hmacHex, value, threshold := SelectPerItemDetail(beaconRandomness, commitmentHash, itemHash, revealProb)

	wantHMAC := "b42355774698a415dc125b565996db6c002f5f006d2f7d0f1ee0dba4b2d72b57"
	if hmacHex != wantHMAC {
		t.Errorf("HMAC = %s, want %s", hmacHex, wantHMAC)
	}

	wantValue := uint64(1559538799394235316)
	if value != wantValue {
		t.Errorf("value = %d, want %d", value, wantValue)
	}

	wantThreshold := uint64(1844674407370955264)
	if threshold != wantThreshold {
		t.Errorf("threshold = %d, want %d", threshold, wantThreshold)
	}

	if !selected {
		t.Error("item should be selected (value < threshold)")
	}
}

func TestSelectPerItem_SpecVector_NotSelected(t *testing.T) {
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	commitmentHash := "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
	itemHash := "2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8"
	revealProb := 0.10

	selected, hmacHex, value, threshold := SelectPerItemDetail(beaconRandomness, commitmentHash, itemHash, revealProb)

	wantHMAC := "e5cb6f092a341da003cd8ae1deadd933a772b411d474dafe5a72dadb2ca5e2a1"
	if hmacHex != wantHMAC {
		t.Errorf("HMAC = %s, want %s", hmacHex, wantHMAC)
	}

	wantValue := uint64(11537435175544671205)
	if value != wantValue {
		t.Errorf("value = %d, want %d", value, wantValue)
	}

	wantThreshold := uint64(1844674407370955264)
	if threshold != wantThreshold {
		t.Errorf("threshold = %d, want %d", threshold, wantThreshold)
	}

	if selected {
		t.Error("item should NOT be selected (value >= threshold)")
	}
}

// --- Spec test vectors: Commit-Reveal Spec Section 10.3 (Batch Selection) ---

func TestSelectBatch_SpecVector(t *testing.T) {
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
		"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
		"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da",
		"4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030",
		"57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
	}

	// Verify PRNG values from spec.
	// Step 0: HMAC-SHA256(seed, uint64_le(0)) → first 8 bytes → 6916673916840581544
	val0 := PRNGNext(beaconRandomness, 0)
	if val0 != 6916673916840581544 {
		t.Errorf("PRNG(0) = %d, want 6916673916840581544", val0)
	}

	// Step 1: HMAC-SHA256(seed, uint64_le(1)) → first 8 bytes → 9911365303496060051
	val1 := PRNGNext(beaconRandomness, 1)
	if val1 != 9911365303496060051 {
		t.Errorf("PRNG(1) = %d, want 9911365303496060051", val1)
	}

	// count = ceil(0.40 * 5) = 2
	count := 2
	selected, err := SelectBatchN(items, beaconRandomness, count)
	if err != nil {
		t.Fatal(err)
	}

	wantSelected := []string{
		"57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
	}

	if len(selected) != len(wantSelected) {
		t.Fatalf("selected %d items, want %d", len(selected), len(wantSelected))
	}

	for i := range selected {
		if selected[i] != wantSelected[i] {
			t.Errorf("selected[%d] = %s, want %s", i, selected[i], wantSelected[i])
		}
	}
}

func TestSelectBatch_StepByStep(t *testing.T) {
	// Manually verify the Fisher-Yates steps from the spec.
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
		"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
		"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da",
		"4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030",
		"57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
	}

	// Step 0: range = 5, j = 0 + (6916673916840581544 mod 5) = 0 + 4 = 4
	val0 := PRNGNext(beaconRandomness, 0)
	j0 := 0 + int(val0%5)
	if j0 != 4 {
		t.Errorf("Step 0: j = %d, want 4 (val=%d, val%%5=%d)", j0, val0, val0%5)
	}

	// After swap pool[0] <-> pool[4]:
	// pool = [items[4], items[1], items[2], items[3], items[0]]
	pool := make([]string, len(items))
	copy(pool, items)
	pool[0], pool[4] = pool[4], pool[0]

	if pool[0] != items[4] {
		t.Errorf("After step 0: pool[0] = %s, want %s", pool[0], items[4])
	}

	// Step 1: range = 4, j = 1 + (9911365303496060051 mod 4)
	val1 := PRNGNext(beaconRandomness, 1)
	j1 := 1 + int(val1%4)
	if j1 != 4 {
		t.Errorf("Step 1: j = %d, want 4 (val=%d, val%%4=%d)", j1, val1, val1%4)
	}

	// After swap pool[1] <-> pool[4]:
	pool[1], pool[4] = pool[4], pool[1]

	// pool[0] = items[4], pool[1] = items[0]
	if pool[0] != items[4] {
		t.Errorf("After step 1: pool[0] = %s, want %s", pool[0], items[4])
	}
	if pool[1] != items[0] {
		t.Errorf("After step 1: pool[1] = %s, want %s", pool[1], items[0])
	}
}

func TestSelectBatchViaRevealProbability(t *testing.T) {
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, err := hex.DecodeString(beaconHex)
	if err != nil {
		t.Fatal(err)
	}

	items := []string{
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
		"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
		"6a9722cdf589a2a068832c955a8253b9df87983501c03dd92e95debae1f409da",
		"4a317b6972e2f1834050485420bd71fe6fc2d87cd25d572cb4b8b327b37bc030",
		"57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
	}

	// ceil(0.40 * 5) = 2
	selected, err := SelectBatch(items, beaconRandomness, 0.40)
	if err != nil {
		t.Fatal(err)
	}

	if len(selected) != 2 {
		t.Fatalf("expected 2 selected items, got %d", len(selected))
	}

	wantSelected := []string{
		"57dbfc296665f072254d15345fb3a2bbf457ae03cbb6ee8f6020e8f11d4b056b",
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
	}

	for i := range selected {
		if selected[i] != wantSelected[i] {
			t.Errorf("selected[%d] = %s, want %s", i, selected[i], wantSelected[i])
		}
	}
}

// --- Additional edge case tests ---

func TestSelectPerItem_Probability100(t *testing.T) {
	seed, _ := hex.DecodeString("0000000000000000000000000000000000000000000000000000000000000000")
	// With p=1.0, everything should be selected.
	selected := SelectPerItem(seed, "aabbccdd", "11223344", 1.0)
	if !selected {
		t.Error("p=1.0 should always select")
	}
}

func TestSelectPerItem_AllItemsWithHighProbability(t *testing.T) {
	seed, _ := hex.DecodeString("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6")
	// With p=1.0, all items should be selected.
	items := []string{
		"aaaa000000000000000000000000000000000000000000000000000000000001",
		"aaaa000000000000000000000000000000000000000000000000000000000002",
		"aaaa000000000000000000000000000000000000000000000000000000000003",
	}
	selected := SelectPerItemBatch(seed, "commitaabbcc", items, 1.0)
	if len(selected) != 3 {
		t.Errorf("p=1.0 should select all 3 items, got %d", len(selected))
	}
}

func TestSelectBatchN_AllItems(t *testing.T) {
	seed, _ := hex.DecodeString("0000000000000000000000000000000000000000000000000000000000000000")
	items := []string{"a", "b", "c"}
	selected, err := SelectBatchN(items, seed, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 3 {
		t.Errorf("expected 3 selected, got %d", len(selected))
	}
	// All items should be present (in some order).
	seen := make(map[string]bool)
	for _, s := range selected {
		seen[s] = true
	}
	for _, item := range items {
		if !seen[item] {
			t.Errorf("item %s not in selected", item)
		}
	}
}

func TestSelectBatchN_CountExceedsItems(t *testing.T) {
	seed, _ := hex.DecodeString("0000000000000000000000000000000000000000000000000000000000000000")
	items := []string{"a", "b"}
	_, err := SelectBatchN(items, seed, 5)
	if err == nil {
		t.Error("expected error when count > len(items)")
	}
}

func TestSelectBatchN_ZeroCount(t *testing.T) {
	seed, _ := hex.DecodeString("0000000000000000000000000000000000000000000000000000000000000000")
	items := []string{"a", "b"}
	selected, err := SelectBatchN(items, seed, 0)
	if err != nil {
		t.Fatal(err)
	}
	if selected != nil {
		t.Errorf("expected nil for count=0, got %v", selected)
	}
}

func TestSelectBatchN_DoesNotMutateInput(t *testing.T) {
	seed, _ := hex.DecodeString("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6")
	items := []string{"a", "b", "c", "d", "e"}
	original := make([]string, len(items))
	copy(original, items)

	_, err := SelectBatchN(items, seed, 2)
	if err != nil {
		t.Fatal(err)
	}

	for i := range items {
		if items[i] != original[i] {
			t.Errorf("input mutated: items[%d] = %s, want %s", i, items[i], original[i])
		}
	}
}

func TestSelectionMode(t *testing.T) {
	if mode := SelectionMode(1); mode != "per_item" {
		t.Errorf("SelectionMode(1) = %s, want per_item", mode)
	}
	if mode := SelectionMode(20); mode != "per_item" {
		t.Errorf("SelectionMode(20) = %s, want per_item", mode)
	}
	if mode := SelectionMode(21); mode != "batch" {
		t.Errorf("SelectionMode(21) = %s, want batch", mode)
	}
	if mode := SelectionMode(100); mode != "batch" {
		t.Errorf("SelectionMode(100) = %s, want batch", mode)
	}
}

func TestSelect_PerItemMode(t *testing.T) {
	beaconHex := "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6"
	beaconRandomness, _ := hex.DecodeString(beaconHex)

	// 2 items -> per_item mode
	items := []string{
		"32012c4c32888ee2c4ba4331e3c77ece9acd811a4b3abb708363123591abfea2",
		"2f58b7d7725eac66c32ab446bb53a188688dc1d76fcc40cf31f5cf6509181ce8",
	}
	commitmentHash := "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"

	selected, mode, err := Select(beaconRandomness, commitmentHash, items, 0.10)
	if err != nil {
		t.Fatal(err)
	}
	if mode != "per_item" {
		t.Errorf("mode = %s, want per_item", mode)
	}

	// From spec vectors: first item IS selected, second is NOT
	if len(selected) != 1 {
		t.Fatalf("expected 1 selected, got %d: %v", len(selected), selected)
	}
	if selected[0] != items[0] {
		t.Errorf("selected[0] = %s, want %s", selected[0], items[0])
	}
}

func TestParseHexSeed(t *testing.T) {
	validHex := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	seed, err := ParseHexSeed(validHex)
	if err != nil {
		t.Fatal(err)
	}
	if len(seed) != 32 {
		t.Errorf("seed length = %d, want 32", len(seed))
	}

	// Invalid hex
	if _, err := ParseHexSeed("not-hex"); err == nil {
		t.Error("expected error for invalid hex")
	}

	// Wrong length
	if _, err := ParseHexSeed("aabb"); err == nil {
		t.Error("expected error for wrong length")
	}
}

func TestPRNG_Deterministic(t *testing.T) {
	seed, _ := hex.DecodeString("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	val1 := PRNGNext(seed, 42)
	val2 := PRNGNext(seed, 42)
	if val1 != val2 {
		t.Errorf("PRNG not deterministic: %d != %d", val1, val2)
	}
}

func TestSelectPerItem_Deterministic(t *testing.T) {
	seed, _ := hex.DecodeString("f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6")
	r1 := SelectPerItem(seed, "abc", "def", 0.5)
	r2 := SelectPerItem(seed, "abc", "def", 0.5)
	if r1 != r2 {
		t.Error("SelectPerItem not deterministic")
	}
}
