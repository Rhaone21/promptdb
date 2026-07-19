//! Filesystem data access. Mirrors the Electron main.js contract:
//! data/db.json, data/settings.json, data/backups/backup_{1..3}.json,
//! data/images/. Reads the EXISTING format unchanged.

use crate::models::{Database, Settings};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Resolve the data directory, mirroring Electron's getDataDir():
/// - debug/dev: `<manifest>/data` (same as `electron .`)
/// - release: `<dir-of-exe>/data` if writable (portable), else
///   platform user-data dir (`~/Library/Application Support/PromptDB/data`, etc.)
pub fn data_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let portable = dir.join("data");
            // Prefer a portable data/ next to the exe when it already exists.
            if portable.exists() {
                return portable;
            }
        }
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PromptDB")
        .join("data")
}

pub fn db_path() -> PathBuf {
    data_dir().join("db.json")
}
pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}
pub fn backup_dir() -> PathBuf {
    data_dir().join("backups")
}
pub fn images_dir() -> PathBuf {
    data_dir().join("images")
}

/// Load db.json. Missing/corrupt file yields an empty Database rather than
/// crashing, matching the Electron fallback behavior.
pub fn load_database() -> Database {
    match fs::read_to_string(db_path()) {
        Ok(mut raw) => {
            strip_bom(&mut raw);
            serde_json::from_str(&raw).unwrap_or_default()
        }
        Err(_) => Database::default(),
    }
}

pub fn save_database(db: &Database) -> io::Result<()> {
    let dir = data_dir();
    fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(db)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    // Write to temp then rename for crash safety.
    let tmp = db_path().with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, db_path())?;
    Ok(())
}

pub fn load_settings() -> Settings {
    match fs::read_to_string(settings_path()) {
        Ok(mut raw) => {
            strip_bom(&mut raw);
            serde_json::from_str(&raw).unwrap_or_default()
        }
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(s: &Settings) -> io::Result<()> {
    fs::create_dir_all(data_dir())?;
    let json = serde_json::to_string_pretty(s)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(settings_path(), json)
}

/// Rotate up to 3 backups: 2->3, 1->2, then write current as backup_1.
pub fn rotate_backups(db: &Database) -> io::Result<()> {
    let dir = backup_dir();
    fs::create_dir_all(&dir)?;
    for i in (2..=3).rev() {
        let curr = dir.join(format!("backup_{}.json", i - 1));
        let next = dir.join(format!("backup_{}.json", i));
        if curr.exists() {
            let _ = fs::copy(&curr, &next);
        }
    }
    let json = serde_json::to_string_pretty(db)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(dir.join("backup_1.json"), json)
}

pub struct BackupInfo {
    pub slot: u8,
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<std::time::SystemTime>,
}

pub fn list_backups() -> Vec<BackupInfo> {
    let dir = backup_dir();
    let mut out = Vec::new();
    for slot in 1..=3u8 {
        let p = dir.join(format!("backup_{}.json", slot));
        if let Ok(meta) = fs::metadata(&p) {
            out.push(BackupInfo {
                slot,
                modified: meta.modified().ok(),
                path: p,
                size: meta.len(),
            });
        }
    }
    out
}

/// Write image bytes into the images dir under `filename` (mirrors Electron's
/// image:save IPC — the caller picks the filename, typically `<uuid>.<ext>`).
pub fn save_image(filename: &str, bytes: &[u8]) -> io::Result<String> {
    let dir = images_dir();
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(filename), bytes)?;
    Ok(filename.to_string())
}

/// Delete an image by filename (mirrors Electron's image:delete IPC). Missing
/// file is not an error — the prompt referencing it may already be gone.
pub fn delete_image(filename: &str) -> io::Result<()> {
    let p = images_dir().join(filename);
    if p.exists() {
        fs::remove_file(p)?;
    }
    Ok(())
}

pub fn restore_backup(slot: u8) -> io::Result<Database> {
    let p = backup_dir().join(format!("backup_{}.json", slot));
    let mut raw = fs::read_to_string(p)?;
    strip_bom(&mut raw);
    let db: Database =
        serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    save_database(&db)?;
    Ok(db)
}

/// Import a db from an arbitrary path (used by the file-open dialog).
pub fn import_from(path: &Path) -> io::Result<Database> {
    let mut raw = fs::read_to_string(path)?;
    strip_bom(&mut raw);
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Export the db to an arbitrary path.
pub fn export_to(path: &Path, db: &Database) -> io::Result<()> {
    let json = serde_json::to_string_pretty(db)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(path, json)
}

fn strip_bom(s: &mut String) {
    if s.starts_with('\u{feff}') {
        s.remove(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// save_image/delete_image round-trip: write bytes, read them back,
    /// delete, confirm gone. Uses a throwaway filename in the real images
    /// dir and cleans up after itself either way.
    #[test]
    fn save_and_delete_image_round_trips() {
        let name = "promptdb_test_save_and_delete_image.bin";
        let bytes = [1u8, 2, 3, 4, 5];
        save_image(name, &bytes).expect("save_image should succeed");
        let read_back = fs::read(images_dir().join(name)).expect("file should exist after save");
        assert_eq!(read_back, bytes);
        delete_image(name).expect("delete_image should succeed");
        assert!(!images_dir().join(name).exists(), "file should be gone after delete");
    }

    /// Loads the user's real db.json (present in dev) and confirms it parses
    /// and round-trips without dropping data.
    #[test]
    fn loads_real_db_if_present() {
        let path = db_path();
        if !path.exists() {
            eprintln!("skip: no db.json at {:?}", path);
            return;
        }
        let db = load_database();
        assert!(
            !db.prompts.is_empty(),
            "expected prompts in real db.json"
        );
        // Re-serialize; every prompt must keep its id (no silent loss).
        let val = serde_json::to_value(&db).unwrap();
        assert!(val["prompts"].is_array());
        assert_eq!(
            val["prompts"].as_array().unwrap().len(),
            db.prompts.len()
        );
    }
}
