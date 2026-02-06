package beacon

import (
	"testing"
	"time"
)

func TestDrandQuicknet_RoundTime(t *testing.T) {
	chain := &DrandQuicknet

	// Round 1 should be at genesis time.
	r1 := chain.RoundTime(1)
	if r1.Unix() != chain.GenesisTime {
		t.Errorf("RoundTime(1) = %d, want %d", r1.Unix(), chain.GenesisTime)
	}

	// Round 2 should be genesis + 3 seconds.
	r2 := chain.RoundTime(2)
	if r2.Unix() != chain.GenesisTime+3 {
		t.Errorf("RoundTime(2) = %d, want %d", r2.Unix(), chain.GenesisTime+3)
	}

	// Round 100 should be genesis + 99*3 seconds.
	r100 := chain.RoundTime(100)
	if r100.Unix() != chain.GenesisTime+99*3 {
		t.Errorf("RoundTime(100) = %d, want %d", r100.Unix(), chain.GenesisTime+99*3)
	}
}

func TestDrandQuicknet_TimeToRound(t *testing.T) {
	chain := &DrandQuicknet

	// At genesis time, should be round 1.
	genesis := time.Unix(chain.GenesisTime, 0)
	if r := chain.TimeToRound(genesis); r != 1 {
		t.Errorf("TimeToRound(genesis) = %d, want 1", r)
	}

	// 1 second after genesis, still round 1 (within the 3s period).
	if r := chain.TimeToRound(genesis.Add(time.Second)); r != 1 {
		t.Errorf("TimeToRound(genesis+1s) = %d, want 1", r)
	}

	// 3 seconds after genesis, round 2.
	if r := chain.TimeToRound(genesis.Add(3 * time.Second)); r != 2 {
		t.Errorf("TimeToRound(genesis+3s) = %d, want 2", r)
	}

	// 6 seconds after genesis, round 3.
	if r := chain.TimeToRound(genesis.Add(6 * time.Second)); r != 3 {
		t.Errorf("TimeToRound(genesis+6s) = %d, want 3", r)
	}
}

func TestDrandQuicknet_NextRoundAfter(t *testing.T) {
	chain := &DrandQuicknet

	genesis := time.Unix(chain.GenesisTime, 0)

	// At genesis exactly, next round after is round 2.
	if r := chain.NextRoundAfter(genesis); r != 2 {
		t.Errorf("NextRoundAfter(genesis) = %d, want 2", r)
	}

	// 1 second after genesis, still within round 1's period; next after is round 2.
	if r := chain.NextRoundAfter(genesis.Add(time.Second)); r != 2 {
		t.Errorf("NextRoundAfter(genesis+1s) = %d, want 2", r)
	}

	// 1 nanosecond before round 2's time, next after is round 2.
	justBefore2 := chain.RoundTime(2).Add(-time.Nanosecond)
	if r := chain.NextRoundAfter(justBefore2); r != 2 {
		t.Errorf("NextRoundAfter(just before round 2) = %d, want 2", r)
	}

	// At round 2's time exactly, next after is round 3.
	if r := chain.NextRoundAfter(chain.RoundTime(2)); r != 3 {
		t.Errorf("NextRoundAfter(round 2 time) = %d, want 3", r)
	}
}

func TestDrandQuicknet_RoundtripTimeRound(t *testing.T) {
	chain := &DrandQuicknet

	for round := uint64(1); round <= 100; round++ {
		roundTime := chain.RoundTime(round)
		computed := chain.TimeToRound(roundTime)
		if computed != round {
			t.Errorf("TimeToRound(RoundTime(%d)) = %d, want %d", round, computed, round)
		}
	}
}

func TestNewDrandRef(t *testing.T) {
	ref := NewDrandRef()
	if ref.Type != DrandType {
		t.Errorf("Type = %s, want %s", ref.Type, DrandType)
	}
	if ref.ChainHash != DrandQuicknet.ChainHash {
		t.Errorf("ChainHash = %s, want %s", ref.ChainHash, DrandQuicknet.ChainHash)
	}
}

func TestNewNistRef(t *testing.T) {
	ref := NewNistRef()
	if ref.Type != NistType {
		t.Errorf("Type = %s, want %s", ref.Type, NistType)
	}
	if ref.Version != "2.0" {
		t.Errorf("Version = %s, want 2.0", ref.Version)
	}
}

func TestBeaconOutput_RandomnessBytes(t *testing.T) {
	o := Output{
		Randomness: "f26a953dc50e6bf7608f7fc5c9cc3e382a9da0e3b6e3aa4fc8579fe13e08fbf6",
	}
	b, err := o.RandomnessBytes()
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 32 {
		t.Errorf("RandomnessBytes length = %d, want 32", len(b))
	}
}

func TestBeaconOutput_RandomnessBytes_Invalid(t *testing.T) {
	o := Output{Randomness: "not-hex"}
	_, err := o.RandomnessBytes()
	if err == nil {
		t.Error("expected error for invalid hex")
	}

	o2 := Output{Randomness: "aabb"} // too short
	_, err2 := o2.RandomnessBytes()
	if err2 == nil {
		t.Error("expected error for wrong length")
	}
}

func TestDrandRelayURL(t *testing.T) {
	url := DrandRelayURL("https://api.drand.sh", DrandQuicknet.ChainHash, 35200000)
	want := "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/35200000"
	if url != want {
		t.Errorf("DrandRelayURL = %s, want %s", url, want)
	}
}

func TestDrandQuicknet_BeforeGenesis(t *testing.T) {
	chain := &DrandQuicknet
	beforeGenesis := time.Unix(chain.GenesisTime-100, 0)
	round := chain.TimeToRound(beforeGenesis)
	if round != 1 {
		t.Errorf("TimeToRound(before genesis) = %d, want 1", round)
	}
}
