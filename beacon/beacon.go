// Package beacon defines types and interfaces for randomness beacons
// used by the commit-reveal protocol (Specification Section 5).
//
// Supported beacon types:
//   - drand (League of Entropy, quicknet chain)
//   - NIST Randomness Beacon v2.0
package beacon

import (
	"encoding/hex"
	"fmt"
	"time"
)

// Ref identifies a randomness source, pinned at commitment time.
// Per spec: key order is "type", then type-specific fields alphabetically.
type Ref struct {
	Type      string `json:"type"`
	ChainHash string `json:"chain_hash,omitempty"` // drand
	Version   string `json:"version,omitempty"`     // nist
}

// Output represents a beacon output used for selection.
type Output struct {
	Type       string `json:"type"`
	ChainHash  string `json:"chain_hash,omitempty"`
	Round      uint64 `json:"round,omitempty"`
	Randomness string `json:"randomness"`
	Signature  string `json:"signature"`
}

// RandomnessBytes returns the 32-byte randomness from the beacon output.
func (o *Output) RandomnessBytes() ([]byte, error) {
	b, err := hex.DecodeString(o.Randomness)
	if err != nil {
		return nil, fmt.Errorf("decode randomness hex: %w", err)
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("randomness must be 32 bytes, got %d", len(b))
	}
	return b, nil
}

// --- drand quicknet constants ---

const (
	DrandType = "drand"
	NistType  = "nist"
)

// DrandQuicknet holds parameters for the drand quicknet chain.
var DrandQuicknet = DrandChain{
	ChainHash:   "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
	Period:      3 * time.Second,
	GenesisTime: 1692803367, // Unix timestamp: 2023-08-23
	Scheme:      "bls-unchained-g1-rfc9380",
}

// DrandChain holds parameters for a drand chain.
type DrandChain struct {
	ChainHash   string
	Period      time.Duration
	GenesisTime int64
	Scheme      string
}

// RoundTime returns the timestamp for a given drand round.
//
//	round_time(round) = genesis_time + (round - 1) * period
func (c *DrandChain) RoundTime(round uint64) time.Time {
	secs := c.GenesisTime + int64(round-1)*int64(c.Period.Seconds())
	return time.Unix(secs, 0).UTC()
}

// TimeToRound returns the round number for a given time.
//
//	time_to_round(unix_time) = floor((unix_time - genesis_time) / period) + 1
func (c *DrandChain) TimeToRound(t time.Time) uint64 {
	elapsed := t.Unix() - c.GenesisTime
	if elapsed < 0 {
		return 1
	}
	return uint64(elapsed/int64(c.Period.Seconds())) + 1
}

// NextRoundAfter returns the first round whose timestamp is strictly after t.
func (c *DrandChain) NextRoundAfter(t time.Time) uint64 {
	round := c.TimeToRound(t)
	// Ensure the round's time is strictly after t.
	for !c.RoundTime(round).After(t) {
		round++
	}
	return round
}

// NewDrandRef creates a beacon reference for drand quicknet.
func NewDrandRef() Ref {
	return Ref{
		Type:      DrandType,
		ChainHash: DrandQuicknet.ChainHash,
	}
}

// NewNistRef creates a beacon reference for NIST beacon v2.0.
func NewNistRef() Ref {
	return Ref{
		Type:    NistType,
		Version: "2.0",
	}
}

// DrandRelayURL returns the URL to fetch a specific round from a drand relay.
func DrandRelayURL(relay, chainHash string, round uint64) string {
	return fmt.Sprintf("%s/%s/public/%d", relay, chainHash, round)
}

// DefaultDrandRelays lists the public drand relay endpoints.
var DefaultDrandRelays = []string{
	"https://api.drand.sh",
	"https://drand.cloudflare.com",
}
