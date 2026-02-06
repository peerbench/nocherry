// Package selection implements the selection algorithms from the Commit-Reveal
// Service Specification v0.2.0 (Sections 4.2-4.4).
//
// The PRNG is based on HMAC-SHA256: prng_next(seed, index) = le_uint64(HMAC-SHA256(seed, uint64_le(index))[0:8])
//
// Per-item selection uses a Bernoulli trial seeded by beacon randomness.
// Batch selection uses a seeded Fisher-Yates partial shuffle.
package selection

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
)

// PRNGNext computes the next PRNG value using HMAC-SHA256.
//
//	mac = HMAC-SHA256(key=seed, message=uint64_le(index))
//	return le_uint64(mac[0..7])
func PRNGNext(seed []byte, index uint64) uint64 {
	msg := make([]byte, 8)
	binary.LittleEndian.PutUint64(msg, index)

	mac := hmac.New(sha256.New, seed)
	mac.Write(msg)
	result := mac.Sum(nil)

	return binary.LittleEndian.Uint64(result[:8])
}

// PRNGNextHex is like PRNGNext but also returns the full HMAC output as hex.
// Useful for debugging and test vector verification.
func PRNGNextHex(seed []byte, index uint64) (uint64, string) {
	msg := make([]byte, 8)
	binary.LittleEndian.PutUint64(msg, index)

	mac := hmac.New(sha256.New, seed)
	mac.Write(msg)
	result := mac.Sum(nil)

	return binary.LittleEndian.Uint64(result[:8]), hex.EncodeToString(result)
}

// Threshold computes floor(p * 2^64) for a reveal probability p.
// For p >= 1.0, returns math.MaxUint64.
func Threshold(p float64) uint64 {
	if p >= 1.0 {
		return math.MaxUint64
	}
	if p <= 0.0 {
		return 0
	}
	return uint64(math.Ldexp(p, 64))
}

// SelectPerItem determines whether a single item is selected for reveal.
//
// Per spec Section 4.3:
//
//	decision_input = HMAC-SHA256(key=beacon_randomness, msg=commitment_hash || item_hash)
//	threshold = floor(p * 2^64)
//	value = le_uint64(decision_input[0..7])
//	selected = (value < threshold)
//
// The commitment_hash and item_hash are hex strings, concatenated as UTF-8 bytes.
func SelectPerItem(beaconRandomness []byte, commitmentHash, itemHash string, revealProbability float64) bool {
	threshold := Threshold(revealProbability)

	msg := []byte(commitmentHash + itemHash)
	mac := hmac.New(sha256.New, beaconRandomness)
	mac.Write(msg)
	result := mac.Sum(nil)

	value := binary.LittleEndian.Uint64(result[:8])
	return value < threshold
}

// SelectPerItemDetail is like SelectPerItem but returns the HMAC, value, and threshold
// for debugging and test vector verification.
func SelectPerItemDetail(beaconRandomness []byte, commitmentHash, itemHash string, revealProbability float64) (selected bool, hmacHex string, value, threshold uint64) {
	threshold = Threshold(revealProbability)

	msg := []byte(commitmentHash + itemHash)
	mac := hmac.New(sha256.New, beaconRandomness)
	mac.Write(msg)
	result := mac.Sum(nil)

	value = binary.LittleEndian.Uint64(result[:8])
	hmacHex = hex.EncodeToString(result)
	selected = value < threshold
	return
}

// SelectPerItemBatch applies per-item selection to all items in a commitment.
// Returns the list of selected item hashes.
func SelectPerItemBatch(beaconRandomness []byte, commitmentHash string, items []string, revealProbability float64) []string {
	var selected []string
	for _, itemHash := range items {
		if SelectPerItem(beaconRandomness, commitmentHash, itemHash, revealProbability) {
			selected = append(selected, itemHash)
		}
	}
	return selected
}

// SelectBatch performs exact-count selection using a seeded Fisher-Yates partial shuffle.
//
// Per spec Section 4.4:
//
//	count = ceil(reveal_probability * item_count)
//	pool = copy of items
//	for i = 0 to count-1:
//	    range = len(pool) - i
//	    j = i + (prng_next(seed, i) mod range)
//	    swap pool[i] and pool[j]
//	return pool[0..count-1]
//
// The seed is the beacon_randomness (32 bytes).
func SelectBatch(items []string, beaconRandomness []byte, revealProbability float64) ([]string, error) {
	if len(items) == 0 {
		return nil, nil
	}

	count := int(math.Ceil(revealProbability * float64(len(items))))
	if count > len(items) {
		count = len(items)
	}
	if count == 0 {
		return nil, nil
	}

	return SelectBatchN(items, beaconRandomness, count)
}

// SelectBatchN performs exact-count selection of count items using Fisher-Yates.
func SelectBatchN(items []string, beaconRandomness []byte, count int) ([]string, error) {
	if count > len(items) {
		return nil, fmt.Errorf("count %d exceeds item count %d", count, len(items))
	}
	if count == 0 {
		return nil, nil
	}

	// Copy the items to avoid mutating the input.
	pool := make([]string, len(items))
	copy(pool, items)

	for i := 0; i < count; i++ {
		rangeSize := uint64(len(pool) - i)
		randVal := PRNGNext(beaconRandomness, uint64(i))
		j := i + int(randVal%rangeSize)
		pool[i], pool[j] = pool[j], pool[i]
	}

	result := make([]string, count)
	copy(result, pool[:count])
	return result, nil
}

// SelectionMode determines which selection algorithm to use based on item count.
// Per spec Section 4.5: per-item for <= 20 items, batch for > 20.
func SelectionMode(itemCount int) string {
	return SelectionModeWithThreshold(itemCount, 20)
}

// SelectionModeWithThreshold is like SelectionMode with a configurable threshold.
func SelectionModeWithThreshold(itemCount, threshold int) string {
	if itemCount > threshold {
		return "batch"
	}
	return "per_item"
}

// Select applies the appropriate selection algorithm based on item count.
// Returns the selected items and the selection mode used.
func Select(beaconRandomness []byte, commitmentHash string, items []string, revealProbability float64) (selected []string, mode string, err error) {
	return SelectWithThreshold(beaconRandomness, commitmentHash, items, revealProbability, 20)
}

// SelectWithThreshold is like Select with a configurable batch threshold.
func SelectWithThreshold(beaconRandomness []byte, commitmentHash string, items []string, revealProbability float64, batchThreshold int) (selected []string, mode string, err error) {
	mode = SelectionModeWithThreshold(len(items), batchThreshold)

	switch mode {
	case "per_item":
		selected = SelectPerItemBatch(beaconRandomness, commitmentHash, items, revealProbability)
	case "batch":
		selected, err = SelectBatch(items, beaconRandomness, revealProbability)
	default:
		err = fmt.Errorf("unknown selection mode: %s", mode)
	}
	return
}

// ParseHexSeed parses a hex-encoded 32-byte seed into a byte slice.
func ParseHexSeed(hexStr string) ([]byte, error) {
	seed, err := hex.DecodeString(hexStr)
	if err != nil {
		return nil, fmt.Errorf("decode hex seed: %w", err)
	}
	if len(seed) != 32 {
		return nil, fmt.Errorf("seed must be 32 bytes, got %d", len(seed))
	}
	return seed, nil
}
