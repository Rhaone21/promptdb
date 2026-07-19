//! Data model matching the existing Electron db.json schema EXACTLY.
//! Every struct carries a `#[serde(flatten)] extra` catch-all so that any
//! field we don't explicitly model is preserved on round-trip save — this
//! prevents silent data loss on the user's existing 16MB database.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

type Extra = BTreeMap<String, serde_json::Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "folderId", default)]
    pub folder_id: String,
    #[serde(rename = "imageUrl", default)]
    pub image_url: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub order: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Whole database file (data/db.json). `settings` is kept as a raw value so
/// whatever the Electron app wrote there survives untouched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    #[serde(default)]
    pub prompts: Vec<Prompt>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for Database {
    fn default() -> Self {
        Database {
            prompts: Vec::new(),
            tags: Vec::new(),
            folders: Vec::new(),
            settings: None,
            extra: Extra::new(),
        }
    }
}

/// Separate settings.json file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(rename = "autoBackup", default = "default_true")]
    pub auto_backup: bool,
    #[serde(rename = "sidebarCollapsed", default)]
    pub sidebar_collapsed: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

fn default_theme() -> String {
    "dark".to_string()
}
fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: default_theme(),
            auto_backup: true,
            sidebar_collapsed: false,
            extra: Extra::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip must preserve unknown fields (no data loss on the user's db).
    #[test]
    fn preserves_unknown_prompt_fields() {
        let json = r#"{
            "id": "abc",
            "title": "hi",
            "content": "body",
            "tags": ["t1"],
            "folderId": "f1",
            "imageUrl": "img::x.png",
            "pinned": true,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
            "someFutureField": {"nested": 42}
        }"#;
        let p: Prompt = serde_json::from_str(json).unwrap();
        assert_eq!(p.id, "abc");
        assert_eq!(p.folder_id, "f1");
        assert!(p.pinned);
        let out = serde_json::to_value(&p).unwrap();
        // camelCase names must be emitted, and the unknown field must survive.
        assert_eq!(out["folderId"], "f1");
        assert_eq!(out["someFutureField"]["nested"], 42);
    }

    #[test]
    fn database_defaults_when_empty() {
        let db: Database = serde_json::from_str("{}").unwrap();
        assert!(db.prompts.is_empty());
        assert!(db.tags.is_empty());
        assert!(db.folders.is_empty());
    }

    #[test]
    fn settings_defaults() {
        let s: Settings = serde_json::from_str(r#"{"theme":"oled"}"#).unwrap();
        assert_eq!(s.theme, "oled");
        assert!(s.auto_backup); // defaults true
    }
}
