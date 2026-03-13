use super::PatchRecord;

pub const SQL_CREATE_EVOLUTION_PATCHES: &str = r#"
CREATE TABLE IF NOT EXISTS evolution_patches (
  id               TEXT    PRIMARY KEY,
  bug_signature    TEXT    NOT NULL,
  source           TEXT    NOT NULL,
  platform         TEXT,
  openclaw_ver     TEXT,
  diagnosis        TEXT,
  remedy_type      TEXT    NOT NULL,
  remedy_payload   TEXT    NOT NULL,
  success_count    INTEGER DEFAULT 0,
  attempt_count    INTEGER DEFAULT 0,
  created_at       INTEGER NOT NULL,
  last_used_at     INTEGER,
  status           TEXT    NOT NULL DEFAULT 'active',
  min_version      TEXT,
  max_version      TEXT,
  superseded_by    TEXT,
  trust_level      TEXT    NOT NULL DEFAULT 'local',
  author_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS idx_evo_sig    ON evolution_patches(bug_signature);
CREATE INDEX IF NOT EXISTS idx_evo_status ON evolution_patches(status);
"#;

pub const SQL_LOOKUP_BY_SIG: &str =
    "SELECT id, bug_signature, source, platform, openclaw_ver, diagnosis, \
     remedy_type, remedy_payload, success_count, attempt_count, \
     status, min_version, max_version, superseded_by, trust_level, author_fingerprint \
     FROM evolution_patches \
     WHERE bug_signature = ? AND status = 'active' \
     ORDER BY success_count DESC";

pub const SQL_INSERT_PATCH: &str = "INSERT OR REPLACE INTO evolution_patches \
     (id, bug_signature, source, platform, openclaw_ver, diagnosis, \
      remedy_type, remedy_payload, success_count, attempt_count, created_at, \
      status, min_version, max_version, superseded_by, trust_level, author_fingerprint) \
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

pub const SQL_INCREMENT_SUCCESS: &str =
    "UPDATE evolution_patches SET success_count = success_count + 1, last_used_at = ? WHERE id = ?";

pub const SQL_INCREMENT_ATTEMPT: &str =
    "UPDATE evolution_patches SET attempt_count = attempt_count + 1, last_used_at = ? WHERE id = ?";

pub const SQL_SET_STATUS: &str = "UPDATE evolution_patches SET status = ? WHERE id = ?";

pub const SQL_SUPERSEDE_BY_VERSION: &str = "UPDATE evolution_patches SET status = 'superseded' \
     WHERE status = 'active' AND superseded_by IS NOT NULL AND superseded_by <= ?";

pub const SQL_STALE_BEYOND_MAX_VERSION: &str = "UPDATE evolution_patches SET status = 'stale' \
     WHERE status = 'active' AND max_version IS NOT NULL AND max_version < ?";

/// Prepare INSERT parameters from a `PatchRecord`.
pub fn insert_params(patch: &PatchRecord) -> Vec<serde_json::Value> {
    use serde_json::Value;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    vec![
        Value::String(patch.id.clone()),
        Value::String(patch.bug_signature.clone()),
        Value::String(patch.target.clone()),
        opt_string(&patch.platform),
        opt_string(&patch.openclaw_ver),
        opt_string(&patch.diagnosis),
        Value::String(patch.remedy_type.clone()),
        Value::String(patch.remedy_payload.clone()),
        Value::Number(patch.success_count.into()),
        Value::Number(patch.attempt_count.into()),
        Value::Number(now.into()),
        Value::String(patch.status.clone()),
        opt_string(&patch.min_version),
        opt_string(&patch.max_version),
        opt_string(&patch.superseded_by),
        Value::String(patch.trust_level.clone()),
        opt_string(&patch.author_fingerprint),
    ]
}

fn opt_string(v: &Option<String>) -> serde_json::Value {
    match v {
        Some(s) => serde_json::Value::String(s.clone()),
        None => serde_json::Value::Null,
    }
}

/// Build a new local `PatchRecord` with default lifecycle fields.
pub fn new_patch(
    bug_signature: &str,
    source: &str,
    remedy_type: &str,
    remedy_payload: &str,
) -> PatchRecord {
    PatchRecord {
        id: generate_id(),
        bug_signature: bug_signature.to_string(),
        target: source.to_string(),
        platform: Some(current_platform().to_string()),
        openclaw_ver: None,
        diagnosis: None,
        remedy_type: remedy_type.to_string(),
        remedy_payload: remedy_payload.to_string(),
        success_count: 0,
        attempt_count: 0,
        status: "active".to_string(),
        min_version: None,
        max_version: None,
        superseded_by: None,
        trust_level: "local".to_string(),
        author_fingerprint: None,
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    }
}

fn generate_id() -> String {
    use sha2::{Digest, Sha256};
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let hash = Sha256::digest(format!("evo-{now}").as_bytes());
    hash.iter().take(8).map(|b| format!("{b:02x}")).collect()
}
