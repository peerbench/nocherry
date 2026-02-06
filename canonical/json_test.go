package canonical

import (
	"testing"
)

func TestMarshalNoWhitespace(t *testing.T) {
	type example struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}
	got, err := Marshal(example{Name: "Alice", Age: 30})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"name":"Alice","age":30}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalKeyOrder(t *testing.T) {
	// Fields should appear in struct declaration order.
	type ordered struct {
		Zebra string `json:"zebra"`
		Apple string `json:"apple"`
	}
	got, err := Marshal(ordered{Zebra: "z", Apple: "a"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"zebra":"z","apple":"a"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalNoHTMLEscaping(t *testing.T) {
	type example struct {
		URL string `json:"url"`
	}
	got, err := Marshal(example{URL: "https://example.com?a=1&b=2"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"url":"https://example.com?a=1&b=2"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalArray(t *testing.T) {
	type entry struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Hash string `json:"hash"`
	}
	entries := []entry{
		{Name: "a.txt", Type: "file", Hash: "abc123"},
		{Name: "b.txt", Type: "file", Hash: "def456"},
	}
	got, err := Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"name":"a.txt","type":"file","hash":"abc123"},{"name":"b.txt","type":"file","hash":"def456"}]`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalOmitEmpty(t *testing.T) {
	type beacon struct {
		Type      string `json:"type"`
		ChainHash string `json:"chain_hash,omitempty"`
		Version   string `json:"version,omitempty"`
	}
	// drand beacon: chain_hash present, version omitted
	got, err := Marshal(beacon{Type: "drand", ChainHash: "52db9ba70e"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"drand","chain_hash":"52db9ba70e"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalEmptyArray(t *testing.T) {
	got, err := Marshal([]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	want := `[]`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalNestedStruct(t *testing.T) {
	type inner struct {
		Type      string `json:"type"`
		ChainHash string `json:"chain_hash"`
	}
	type outer struct {
		Version string `json:"version"`
		Beacon  inner  `json:"beacon"`
	}
	got, err := Marshal(outer{Version: "0.2.0", Beacon: inner{Type: "drand", ChainHash: "abc"}})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"version":"0.2.0","beacon":{"type":"drand","chain_hash":"abc"}}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

func TestMarshalSpecialCharacters(t *testing.T) {
	type example struct {
		Text string `json:"text"`
	}
	// Test that control characters are escaped, but normal unicode is literal.
	got, err := Marshal(example{Text: "hello\tworld"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"text":"hello\tworld"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}
