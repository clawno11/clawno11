use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Types of automated remedies the sentinel can apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RemedyType {
    Pm2Restart,
    ConfigPatch,
    PortKill,
    SuggestOnly,
}

impl RemedyType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pm2Restart => "pm2_restart",
            Self::ConfigPatch => "config_patch",
            Self::PortKill => "port_kill",
            Self::SuggestOnly => "suggest_only",
        }
    }

    pub fn from_str_inner(s: &str) -> Self {
        match s {
            "pm2_restart" => Self::Pm2Restart,
            "config_patch" => Self::ConfigPatch,
            "port_kill" => Self::PortKill,
            _ => Self::SuggestOnly,
        }
    }
}

/// Copy the file at `path` to `path.bak.{unix_timestamp}` and return the
/// backup path.  This MUST be called before any config mutation so that
/// `rollback_config` can restore the original.
pub fn backup_config(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("backup target does not exist: {}", path.display()));
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let backup = path.with_extension(format!("bak.{ts}"));
    std::fs::copy(path, &backup).map_err(|e| format!("backup_config failed: {e}"))?;
    Ok(backup)
}

/// Apply a JSON merge-patch to the config file at `path`.
/// The file is read as JSON, merged with `patch_json`, and written back.
pub fn apply_config_patch(path: &Path, patch_json: &str) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).map_err(|e| format!("read config: {e}"))?;
    let mut doc: serde_json::Value =
        serde_json::from_str(&existing).map_err(|e| format!("parse config: {e}"))?;
    let patch: serde_json::Value =
        serde_json::from_str(patch_json).map_err(|e| format!("parse patch: {e}"))?;
    json_merge_patch(&mut doc, &patch);
    let out = serde_json::to_string_pretty(&doc).map_err(|e| format!("serialize config: {e}"))?;
    std::fs::write(path, out).map_err(|e| format!("write config: {e}"))?;
    Ok(())
}

/// Restore the backup file over the original path.
pub fn rollback_config(path: &Path, backup: &Path) -> Result<(), String> {
    if !backup.exists() {
        return Err(format!("backup not found: {}", backup.display()));
    }
    std::fs::copy(backup, path).map_err(|e| format!("rollback_config failed: {e}"))?;
    Ok(())
}

/// RFC 7386 JSON Merge Patch — recursively merge `patch` into `target`.
fn json_merge_patch(target: &mut serde_json::Value, patch: &serde_json::Value) {
    if let serde_json::Value::Object(patch_obj) = patch {
        if !target.is_object() {
            *target = serde_json::Value::Object(serde_json::Map::new());
        }
        if let serde_json::Value::Object(ref mut map) = target {
            for (key, value) in patch_obj {
                if value.is_null() {
                    map.remove(key);
                } else if value.is_object() {
                    let entry = map
                        .entry(key.clone())
                        .or_insert(serde_json::Value::Object(serde_json::Map::new()));
                    json_merge_patch(entry, value);
                } else {
                    map.insert(key.clone(), value.clone());
                }
            }
        }
    } else {
        *target = patch.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remedy_type_roundtrip() {
        assert_eq!(
            RemedyType::from_str_inner(RemedyType::Pm2Restart.as_str()),
            RemedyType::Pm2Restart
        );
        assert_eq!(
            RemedyType::from_str_inner(RemedyType::ConfigPatch.as_str()),
            RemedyType::ConfigPatch
        );
        assert_eq!(
            RemedyType::from_str_inner("anything_else"),
            RemedyType::SuggestOnly
        );
    }

    #[test]
    fn json_merge_patch_basic() {
        let mut target: serde_json::Value = serde_json::json!({"a": 1, "b": 2});
        let patch: serde_json::Value = serde_json::json!({"b": 3, "c": 4});
        json_merge_patch(&mut target, &patch);
        assert_eq!(target, serde_json::json!({"a": 1, "b": 3, "c": 4}));
    }

    #[test]
    fn json_merge_patch_null_removes_key() {
        let mut target: serde_json::Value = serde_json::json!({"a": 1, "b": 2});
        let patch: serde_json::Value = serde_json::json!({"b": null});
        json_merge_patch(&mut target, &patch);
        assert_eq!(target, serde_json::json!({"a": 1}));
    }

    #[test]
    fn backup_and_rollback() {
        let dir = std::env::temp_dir().join("sentinel_test");
        let _ = std::fs::create_dir_all(&dir);
        let config = dir.join("test.json");
        std::fs::write(&config, r#"{"port":18789}"#).unwrap();

        let backup = backup_config(&config).unwrap();
        assert!(backup.exists());

        std::fs::write(&config, r#"{"port":99999}"#).unwrap();
        rollback_config(&config, &backup).unwrap();

        let restored = std::fs::read_to_string(&config).unwrap();
        assert!(restored.contains("18789"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
