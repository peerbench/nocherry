use clap::{Parser, Subcommand};
use std::fs;
use std::path::{Path, PathBuf};

use pb_core::beacon::BeaconRef;
use pb_core::commitment::{self, Commitment, CreateParams};
use pb_core::hash::{self, ManifestEntry};
use pb_core::sign::{self, KeyPair};

use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// CLI structure
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "pb", about = "commit-reveal CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Key management
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
    /// Hashing operations
    Hash {
        #[command(subcommand)]
        action: HashAction,
    },
    /// Create a signed commitment for a directory
    Commit {
        /// Directory containing items to commit
        dir: PathBuf,
        /// Reveal probability (0.0, 1.0]
        #[arg(long)]
        probability: f64,
        /// Beacon type
        #[arg(long, default_value = "drand")]
        beacon: String,
    },
    /// Verify a commitment JSON file
    Verify {
        /// Path to commitment JSON file
        path: PathBuf,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    /// Generate a new Ed25519 keypair
    Generate,
    /// Show the stored did:key
    Show,
}

#[derive(Subcommand)]
enum HashAction {
    /// Hash a single file with SHA-256
    File {
        /// Path to file
        path: PathBuf,
    },
    /// Hash a directory (build manifest, hash manifest)
    Dir {
        /// Path to directory
        path: PathBuf,
    },
}

// ---------------------------------------------------------------------------
// Stored key format
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct StoredKey {
    did: String,
    private_key_hex: String,
    public_key_hex: String,
    algorithm: String,
    created_at: String,
}

// ---------------------------------------------------------------------------
// Key file helpers
// ---------------------------------------------------------------------------

fn key_file_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not determine home directory")?;
    Ok(home.join(".nocherry").join("key.json"))
}

fn save_key(kp: &KeyPair) -> Result<PathBuf, String> {
    let path = key_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create directory {:?}: {}", parent, e))?;
    }
    let stored = StoredKey {
        did: kp.did_key.clone(),
        private_key_hex: hex::encode(kp.signing_key.to_bytes()),
        public_key_hex: hex::encode(kp.verifying_key.to_bytes()),
        algorithm: "Ed25519".into(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("JSON serialization error: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("failed to write {:?}: {}", path, e))?;
    Ok(path)
}

fn load_key() -> Result<KeyPair, String> {
    // Check env var override first
    if let Ok(hex_key) = std::env::var("PB_SIGNING_KEY") {
        return keypair_from_hex(&hex_key);
    }

    let path = key_file_path()?;
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {:?}: {} (run `pb key generate` first)", path, e))?;
    let stored: StoredKey =
        serde_json::from_str(&data).map_err(|e| format!("invalid key file: {}", e))?;
    keypair_from_hex(&stored.private_key_hex)
}

fn keypair_from_hex(hex_key: &str) -> Result<KeyPair, String> {
    let bytes = hex::decode(hex_key).map_err(|e| format!("hex decode error: {}", e))?;
    let key_bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "private key must be 32 bytes")?;
    let signing_key = SigningKey::from_bytes(&key_bytes);
    let verifying_key = signing_key.verifying_key();
    let did_key = sign::encode_did_key(&verifying_key);
    Ok(KeyPair {
        signing_key,
        verifying_key,
        did_key,
    })
}

// ---------------------------------------------------------------------------
// Directory hashing
// ---------------------------------------------------------------------------

fn hash_dir_recursive(dir: &Path) -> Result<(String, Vec<ManifestEntry>), String> {
    let mut entries: Vec<ManifestEntry> = Vec::new();

    let read_dir = fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {:?}: {}", dir, e))?;

    let mut dir_entries: Vec<fs::DirEntry> = read_dir
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("error reading directory entries: {}", e))?;

    // Sort by file name for deterministic ordering
    dir_entries.sort_by_key(|e| e.file_name());

    for entry in dir_entries {
        let name = entry
            .file_name()
            .to_str()
            .ok_or_else(|| format!("non-UTF-8 filename: {:?}", entry.file_name()))?
            .to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to get file type for {:?}: {}", name, e))?;

        if file_type.is_file() {
            let data = fs::read(entry.path())
                .map_err(|e| format!("failed to read file {:?}: {}", entry.path(), e))?;
            let file_hash = hash::hash_bytes(&data);
            entries.push(ManifestEntry {
                name,
                entry_type: "file".into(),
                hash: file_hash,
            });
        } else if file_type.is_dir() {
            let (dir_hash, _) = hash_dir_recursive(&entry.path())?;
            entries.push(ManifestEntry {
                name,
                entry_type: "dir".into(),
                hash: dir_hash,
            });
        }
        // Skip symlinks and other special file types
    }

    let manifest_hash = hash::hash_manifest(&entries);
    Ok((manifest_hash, entries))
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

fn cmd_key_generate() -> Result<(), String> {
    let kp = sign::generate_keypair();
    let path = save_key(&kp)?;
    eprintln!("Key saved to {}", path.display());
    println!("{}", kp.did_key);
    Ok(())
}

fn cmd_key_show() -> Result<(), String> {
    let kp = load_key()?;
    println!("{}", kp.did_key);
    Ok(())
}

fn cmd_hash_file(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("failed to open {:?}: {}", path, e))?;
    let h = hash::hash_reader(&mut file)
        .map_err(|e| format!("hash error: {}", e))?;
    println!("{}", h);
    Ok(())
}

fn cmd_hash_dir(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{:?} is not a directory", path));
    }
    let (manifest_hash, entries) = hash_dir_recursive(path)?;
    // Print manifest entries for visibility
    for entry in &entries {
        eprintln!("  {} {} {}", entry.entry_type, entry.hash, entry.name);
    }
    println!("{}", manifest_hash);
    Ok(())
}

fn cmd_commit(dir: &Path, probability: f64, beacon: &str) -> Result<(), String> {
    if !dir.is_dir() {
        return Err(format!("{:?} is not a directory", dir));
    }

    // Hash all files in directory to get item hashes
    let read_dir = fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {:?}: {}", dir, e))?;

    let mut dir_entries: Vec<fs::DirEntry> = read_dir
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("error reading directory entries: {}", e))?;

    dir_entries.sort_by_key(|e| e.file_name());

    let mut items: Vec<String> = Vec::new();

    for entry in dir_entries {
        let name = entry
            .file_name()
            .to_str()
            .ok_or_else(|| format!("non-UTF-8 filename: {:?}", entry.file_name()))?
            .to_string();

        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to get file type for {:?}: {}", name, e))?;

        if file_type.is_file() {
            let data = fs::read(entry.path())
                .map_err(|e| format!("failed to read file {:?}: {}", entry.path(), e))?;
            items.push(hash::hash_bytes(&data));
        } else if file_type.is_dir() {
            let (dir_hash, _) = hash_dir_recursive(&entry.path())?;
            items.push(dir_hash);
        }
    }

    if items.is_empty() {
        return Err("no items found in directory".into());
    }

    // Load signing key
    let kp = load_key()?;

    // Resolve beacon reference
    let beacon_ref = match beacon {
        "drand" => BeaconRef::drand_quicknet(),
        "nist" => BeaconRef::nist_v2(),
        other => return Err(format!("unknown beacon type: {}", other)),
    };

    let params = CreateParams {
        items,
        reveal_probability: probability,
        beacon: beacon_ref,
        metadata: None,
        stream_id: None,
        committed_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        identity: None,
    };

    let c = commitment::create(params, &kp)?;

    let json = serde_json::to_string_pretty(&c)
        .map_err(|e| format!("JSON serialization error: {}", e))?;
    println!("{}", json);
    Ok(())
}

fn cmd_verify(path: &Path) -> Result<(), String> {
    let data = fs::read_to_string(path)
        .map_err(|e| format!("failed to read {:?}: {}", path, e))?;
    let c: Commitment =
        serde_json::from_str(&data).map_err(|e| format!("invalid commitment JSON: {}", e))?;

    commitment::verify_signature(&c)?;
    eprintln!("Commitment signature: VALID");
    eprintln!("  did:key   = {}", c.signing_key);
    eprintln!("  hash      = {}", c.commitment_hash);
    eprintln!("  items     = {}", c.item_count);
    eprintln!("  p         = {}", c.reveal_probability);
    eprintln!("  beacon    = {}", c.beacon.beacon_type);
    eprintln!("  committed = {}", c.committed_at);
    Ok(())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Key { action } => match action {
            KeyAction::Generate => cmd_key_generate(),
            KeyAction::Show => cmd_key_show(),
        },
        Commands::Hash { action } => match action {
            HashAction::File { path } => cmd_hash_file(&path),
            HashAction::Dir { path } => cmd_hash_dir(&path),
        },
        Commands::Commit {
            dir,
            probability,
            beacon,
        } => cmd_commit(&dir, probability, &beacon),
        Commands::Verify { path } => cmd_verify(&path),
    };

    if let Err(e) = result {
        eprintln!("error: {}", e);
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn keypair_hex_roundtrip() {
        let kp = sign::generate_keypair();
        let hex_key = hex::encode(kp.signing_key.to_bytes());
        let restored = keypair_from_hex(&hex_key).unwrap();
        assert_eq!(restored.did_key, kp.did_key);
    }

    #[test]
    fn keypair_from_hex_invalid() {
        assert!(keypair_from_hex("not-hex").is_err());
        assert!(keypair_from_hex("abcd").is_err()); // too short
    }

    #[test]
    fn hash_dir_empty() {
        let tmp = std::env::temp_dir().join("pb_cli_test_empty");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let (h, entries) = hash_dir_recursive(&tmp).unwrap();
        assert!(entries.is_empty());
        // Hash of "[]"
        assert_eq!(
            h,
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn hash_dir_single_file() {
        let tmp = std::env::temp_dir().join("pb_cli_test_single");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("hello.txt"), b"hello").unwrap();
        let (h, entries) = hash_dir_recursive(&tmp).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "hello.txt");
        assert_eq!(entries[0].entry_type, "file");
        assert_eq!(
            entries[0].hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        // Should match the single-file manifest hash from pb-core tests
        assert_eq!(
            h,
            "10631e3bca07b228f16731e4a4a1de0a88630485dc19df0bc5294f0d5626416f"
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn hash_dir_skips_hidden() {
        let tmp = std::env::temp_dir().join("pb_cli_test_hidden");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join(".hidden"), b"secret").unwrap();
        fs::write(tmp.join("visible.txt"), b"hello").unwrap();
        let (_, entries) = hash_dir_recursive(&tmp).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.txt");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn hash_dir_nested() {
        // Reproduce the spec test vector from pb-core
        // testdir/
        //   data/
        //     log.txt  ("log\n")
        //   readme.txt ("readme")
        let tmp = std::env::temp_dir().join("pb_cli_test_nested");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("data")).unwrap();
        fs::write(tmp.join("data").join("log.txt"), b"log\n").unwrap();
        fs::write(tmp.join("readme.txt"), b"readme").unwrap();
        let (h, _) = hash_dir_recursive(&tmp).unwrap();
        assert_eq!(
            h,
            "28a24ba7d3a308be24a324ae90b720bd4498f3ecb1418ad34b520e9e0a68cd94"
        );
        let _ = fs::remove_dir_all(&tmp);
    }
}
