// Package pbhash implements SHA-256 file and directory hashing per the
// PeerBench Hashing Specification v0.3.0.
//
// Files are hashed as raw bytes streamed through SHA-256 in 64 KiB chunks.
// Directories are hashed via a canonical JSON manifest of their entries.
package pbhash

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/peerbench/commit-reveal/canonical"
)

const chunkSize = 64 * 1024 // 64 KiB

// ManifestEntry represents one entry in a directory manifest.
// Fields are ordered per spec Section 4.1: name, type, hash.
type ManifestEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Hash string `json:"hash"`
}

// HashFile computes the SHA-256 hash of a file, streaming in 64 KiB chunks.
// Returns the lowercase hex-encoded hash (64 characters).
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open file: %w", err)
	}
	defer f.Close()
	return HashReader(f)
}

// HashReader computes the SHA-256 hash of data from a reader, streaming in 64 KiB chunks.
// Returns the lowercase hex-encoded hash (64 characters).
func HashReader(r io.Reader) (string, error) {
	h := sha256.New()
	buf := make([]byte, chunkSize)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			h.Write(buf[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read: %w", err)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// HashBytes computes the SHA-256 hash of a byte slice.
// Returns the lowercase hex-encoded hash (64 characters).
func HashBytes(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// exclusions that must be skipped per spec Section 4.4.
var defaultExclusions = map[string]bool{
	".":         true,
	"..":        true,
	".DS_Store": true,
	"Thumbs.db": true,
}

func isExcluded(name string) bool {
	if defaultExclusions[name] {
		return true
	}
	if name == ".git" {
		return true
	}
	if strings.HasPrefix(name, ".peerbench") {
		return true
	}
	return false
}

// HashDirectory computes the SHA-256 hash of a directory by building a
// canonical JSON manifest and hashing it. Recurses into subdirectories.
// Returns the directory hash and the manifest entries.
func HashDirectory(path string) (string, []ManifestEntry, error) {
	return hashDirectoryRecursive(path, 0)
}

func hashDirectoryRecursive(path string, depth int) (string, []ManifestEntry, error) {
	if depth > 100 {
		return "", nil, fmt.Errorf("directory depth exceeds 100 levels at %s", path)
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return "", nil, fmt.Errorf("read directory: %w", err)
	}

	var manifest []ManifestEntry
	for _, entry := range entries {
		name := entry.Name()
		if isExcluded(name) {
			continue
		}

		fullPath := filepath.Join(path, name)

		// Skip symlinks per spec Section 3.2.
		info, err := os.Lstat(fullPath)
		if err != nil {
			return "", nil, fmt.Errorf("lstat %s: %w", fullPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		if entry.IsDir() {
			dirHash, _, err := hashDirectoryRecursive(fullPath, depth+1)
			if err != nil {
				return "", nil, err
			}
			manifest = append(manifest, ManifestEntry{
				Name: name,
				Type: "dir",
				Hash: dirHash,
			})
		} else if entry.Type().IsRegular() {
			fileHash, err := HashFile(fullPath)
			if err != nil {
				return "", nil, err
			}
			manifest = append(manifest, ManifestEntry{
				Name: name,
				Type: "file",
				Hash: fileHash,
			})
		}
		// Skip non-regular, non-directory entries (devices, sockets, etc.)
	}

	// Sort by name using byte-level lexicographic ordering (UTF-8).
	sort.Slice(manifest, func(i, j int) bool {
		return manifest[i].Name < manifest[j].Name
	})

	// Build canonical JSON and hash it.
	dirHash, err := HashManifest(manifest)
	if err != nil {
		return "", nil, err
	}
	return dirHash, manifest, nil
}

// HashManifest computes the SHA-256 hash of a manifest (array of entries)
// serialized as canonical JSON.
func HashManifest(entries []ManifestEntry) (string, error) {
	// Ensure we produce [] for nil/empty slices.
	if entries == nil {
		entries = []ManifestEntry{}
	}
	jsonBytes, err := canonical.Marshal(entries)
	if err != nil {
		return "", fmt.Errorf("marshal manifest: %w", err)
	}
	return HashBytes(jsonBytes), nil
}

// ManifestJSON returns the canonical JSON bytes for a manifest.
func ManifestJSON(entries []ManifestEntry) ([]byte, error) {
	if entries == nil {
		entries = []ManifestEntry{}
	}
	return canonical.Marshal(entries)
}

// CollectItems walks a directory and returns all leaf files as (relative path, hash)
// pairs, sorted lexicographically by path. Paths use "/" as separator regardless of OS.
// This is used to produce the items array for a commitment.
func CollectItems(root string) ([]ItemEntry, error) {
	var items []ItemEntry
	err := collectItemsRecursive(root, "", &items, 0)
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Path < items[j].Path
	})
	return items, nil
}

// ItemEntry represents a leaf file with its relative path and hash.
type ItemEntry struct {
	Path string
	Hash string
}

func collectItemsRecursive(root, prefix string, items *[]ItemEntry, depth int) error {
	if depth > 100 {
		return fmt.Errorf("directory depth exceeds 100 levels")
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("read directory: %w", err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if isExcluded(name) {
			continue
		}

		fullPath := filepath.Join(root, name)
		relPath := name
		if prefix != "" {
			relPath = prefix + "/" + name
		}

		// Skip symlinks.
		info, err := os.Lstat(fullPath)
		if err != nil {
			return fmt.Errorf("lstat %s: %w", fullPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		if entry.IsDir() {
			if err := collectItemsRecursive(fullPath, relPath, items, depth+1); err != nil {
				return err
			}
		} else if entry.Type().IsRegular() {
			h, err := HashFile(fullPath)
			if err != nil {
				return err
			}
			*items = append(*items, ItemEntry{Path: relPath, Hash: h})
		}
	}
	return nil
}
