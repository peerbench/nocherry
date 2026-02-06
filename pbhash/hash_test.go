package pbhash

import (
	"os"
	"path/filepath"
	"testing"
)

// --- Spec test vectors: Hashing Spec Section 7.1 ---

func TestHashBytes_Empty(t *testing.T) {
	got := HashBytes([]byte{})
	want := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got != want {
		t.Errorf("HashBytes(empty) = %s, want %s", got, want)
	}
}

func TestHashBytes_HelloNewline(t *testing.T) {
	// "hello\n" = 6 bytes
	got := HashBytes([]byte("hello\n"))
	want := "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"
	if got != want {
		t.Errorf("HashBytes(hello\\n) = %s, want %s", got, want)
	}
}

func TestHashBytes_HelloNoNewline(t *testing.T) {
	// "hello" = 5 bytes, no newline
	got := HashBytes([]byte("hello"))
	want := "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
	if got != want {
		t.Errorf("HashBytes(hello) = %s, want %s", got, want)
	}
}

// --- Spec test vectors: Hashing Spec Section 7.2 ---

func TestHashFile_Streaming(t *testing.T) {
	// Create a temp file with "hello" (5 bytes, no newline).
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	if err := os.WriteFile(path, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	got, err := HashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
	if got != want {
		t.Errorf("HashFile(hello.txt) = %s, want %s", got, want)
	}
}

func TestHashFile_Empty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
	got, err := HashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got != want {
		t.Errorf("HashFile(empty) = %s, want %s", got, want)
	}
}

func TestHashFile_LargeFile(t *testing.T) {
	// Create a file larger than the 64 KiB chunk size to test streaming.
	dir := t.TempDir()
	path := filepath.Join(dir, "large.bin")
	data := make([]byte, 128*1024) // 128 KiB of zeros
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	got, err := HashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// HashBytes should give the same result.
	want := HashBytes(data)
	if got != want {
		t.Errorf("HashFile(large) = %s, want %s", got, want)
	}
}

// --- Directory hashing test vectors: Hashing Spec Section 7.2 ---

func TestHashDirectory_SingleFile(t *testing.T) {
	// testdir/
	//   hello.txt  (contains "hello", 5 bytes, no newline)
	//
	// Expected manifest:
	//   [{"name":"hello.txt","type":"file","hash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}]
	// Expected directory hash: 10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f
	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	if err := os.Mkdir(testDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(testDir, "hello.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	hash, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	// Check manifest.
	if len(manifest) != 1 {
		t.Fatalf("expected 1 manifest entry, got %d", len(manifest))
	}
	if manifest[0].Name != "hello.txt" {
		t.Errorf("manifest[0].Name = %s, want hello.txt", manifest[0].Name)
	}
	if manifest[0].Type != "file" {
		t.Errorf("manifest[0].Type = %s, want file", manifest[0].Type)
	}
	wantFileHash := "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
	if manifest[0].Hash != wantFileHash {
		t.Errorf("manifest[0].Hash = %s, want %s", manifest[0].Hash, wantFileHash)
	}

	// Check directory hash.
	wantDirHash := "10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f"
	if hash != wantDirHash {
		t.Errorf("HashDirectory = %s, want %s", hash, wantDirHash)
	}
}

func TestHashDirectory_Nested(t *testing.T) {
	// testdir/
	//   data/
	//     log.txt  (contains "log\n", 4 bytes)
	//   readme.txt  (contains "readme", 6 bytes, no newline)
	//
	// Step 1: log.txt hash = 9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857
	// Step 2: data/ hash = 3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80
	// Step 3: readme.txt hash = 711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe
	// Step 4: testdir/ hash = 28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94

	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	dataDir := filepath.Join(testDir, "data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "log.txt"), []byte("log\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(testDir, "readme.txt"), []byte("readme"), 0644); err != nil {
		t.Fatal(err)
	}

	// Verify intermediate hashes.
	logHash := HashBytes([]byte("log\n"))
	wantLogHash := "9b75290f6a6359a2a3471022cbba4b724e45105b313ae8f6c103a2f79e82a857"
	if logHash != wantLogHash {
		t.Errorf("log.txt hash = %s, want %s", logHash, wantLogHash)
	}

	readmeHash := HashBytes([]byte("readme"))
	wantReadmeHash := "711a6108ba2ce6ca93dd47d6817f2361db10d8ab6eec89460b2dfc2c325efabe"
	if readmeHash != wantReadmeHash {
		t.Errorf("readme.txt hash = %s, want %s", readmeHash, wantReadmeHash)
	}

	// Verify data/ directory hash.
	dataHash, _, err := HashDirectory(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	wantDataHash := "3d1fc26917bf08adb34bad524c64b224d66ad1eaef790be4a6ea0c9746b97b80"
	if dataHash != wantDataHash {
		t.Errorf("data/ hash = %s, want %s", dataHash, wantDataHash)
	}

	// Verify testdir/ directory hash.
	hash, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	// Manifest should have 2 entries: data (dir), readme.txt (file) - sorted by name.
	if len(manifest) != 2 {
		t.Fatalf("expected 2 manifest entries, got %d", len(manifest))
	}
	if manifest[0].Name != "data" || manifest[0].Type != "dir" {
		t.Errorf("manifest[0] = %+v, want {Name:data Type:dir}", manifest[0])
	}
	if manifest[1].Name != "readme.txt" || manifest[1].Type != "file" {
		t.Errorf("manifest[1] = %+v, want {Name:readme.txt Type:file}", manifest[1])
	}

	wantDirHash := "28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94"
	if hash != wantDirHash {
		t.Errorf("testdir/ hash = %s, want %s", hash, wantDirHash)
	}
}

func TestHashDirectory_Empty(t *testing.T) {
	dir := t.TempDir()
	emptyDir := filepath.Join(dir, "empty")
	if err := os.Mkdir(emptyDir, 0755); err != nil {
		t.Fatal(err)
	}

	hash, manifest, err := HashDirectory(emptyDir)
	if err != nil {
		t.Fatal(err)
	}

	if len(manifest) != 0 {
		t.Errorf("expected 0 manifest entries, got %d", len(manifest))
	}

	// Empty directory manifest is [], hash per spec Section 4.5.
	wantHash := "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	if hash != wantHash {
		t.Errorf("empty dir hash = %s, want %s", hash, wantHash)
	}
}

func TestHashDirectory_ExcludesDSStore(t *testing.T) {
	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	if err := os.Mkdir(testDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Write hello.txt and .DS_Store
	if err := os.WriteFile(filepath.Join(testDir, "hello.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(testDir, ".DS_Store"), []byte("garbage"), 0644); err != nil {
		t.Fatal(err)
	}

	hash, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	// .DS_Store should be excluded, so same as single-file test.
	if len(manifest) != 1 {
		t.Fatalf("expected 1 manifest entry (excluding .DS_Store), got %d", len(manifest))
	}
	wantHash := "10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f"
	if hash != wantHash {
		t.Errorf("hash = %s, want %s", hash, wantHash)
	}
}

func TestHashDirectory_ExcludesGit(t *testing.T) {
	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	gitDir := filepath.Join(testDir, ".git")
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "config"), []byte("git config"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(testDir, "hello.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	hash, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	if len(manifest) != 1 {
		t.Fatalf("expected 1 manifest entry (excluding .git), got %d", len(manifest))
	}
	wantHash := "10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f"
	if hash != wantHash {
		t.Errorf("hash = %s, want %s", hash, wantHash)
	}
}

func TestHashDirectory_ExcludesPeerbench(t *testing.T) {
	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	pbDir := filepath.Join(testDir, ".peerbench-meta")
	if err := os.MkdirAll(pbDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pbDir, "state.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(testDir, "hello.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	_, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	if len(manifest) != 1 {
		t.Fatalf("expected 1 manifest entry (excluding .peerbench*), got %d", len(manifest))
	}
}

func TestHashDirectory_SortOrder(t *testing.T) {
	dir := t.TempDir()
	testDir := filepath.Join(dir, "testdir")
	if err := os.Mkdir(testDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Create files that should sort: a.txt, b.txt, z.txt
	for _, name := range []string{"z.txt", "a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(testDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}

	_, manifest, err := HashDirectory(testDir)
	if err != nil {
		t.Fatal(err)
	}

	if len(manifest) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(manifest))
	}
	if manifest[0].Name != "a.txt" || manifest[1].Name != "b.txt" || manifest[2].Name != "z.txt" {
		t.Errorf("sort order wrong: %s, %s, %s", manifest[0].Name, manifest[1].Name, manifest[2].Name)
	}
}

func TestCollectItems_Flat(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"case_002.json", "case_001.json", "case_003.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}

	items, err := CollectItems(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	// Should be sorted lexicographically by path.
	if items[0].Path != "case_001.json" {
		t.Errorf("items[0].Path = %s, want case_001.json", items[0].Path)
	}
	if items[1].Path != "case_002.json" {
		t.Errorf("items[1].Path = %s, want case_002.json", items[1].Path)
	}
	if items[2].Path != "case_003.json" {
		t.Errorf("items[2].Path = %s, want case_003.json", items[2].Path)
	}
}

func TestCollectItems_Nested(t *testing.T) {
	dir := t.TempDir()
	easyDir := filepath.Join(dir, "easy")
	hardDir := filepath.Join(dir, "hard")
	if err := os.MkdirAll(easyDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(hardDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(easyDir, "case_001.json"), []byte("easy1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hardDir, "case_101.json"), []byte("hard1"), 0644); err != nil {
		t.Fatal(err)
	}

	items, err := CollectItems(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0].Path != "easy/case_001.json" {
		t.Errorf("items[0].Path = %s, want easy/case_001.json", items[0].Path)
	}
	if items[1].Path != "hard/case_101.json" {
		t.Errorf("items[1].Path = %s, want hard/case_101.json", items[1].Path)
	}
}

func TestManifestJSON_SingleFile(t *testing.T) {
	entries := []ManifestEntry{
		{Name: "hello.txt", Type: "file", Hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"},
	}
	got, err := ManifestJSON(entries)
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"name":"hello.txt","type":"file","hash":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}]`
	if string(got) != want {
		t.Errorf("ManifestJSON = %s, want %s", string(got), want)
	}
}

func TestManifestJSON_Empty(t *testing.T) {
	got, err := ManifestJSON(nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "[]"
	if string(got) != want {
		t.Errorf("ManifestJSON(nil) = %s, want %s", string(got), want)
	}
}

func TestHashManifest_EmptyDirectory(t *testing.T) {
	hash, err := HashManifest(nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	if hash != want {
		t.Errorf("HashManifest(nil) = %s, want %s", hash, want)
	}
}
