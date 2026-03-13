//! Sentinel — self-healing engine (crash capture + diagnosis + evolution library)

pub mod capture;
pub mod evolution;
pub mod remedy;

use serde::{Deserialize, Serialize};

// ── Core types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosisRequest {
    pub stderr_lines: Vec<String>,
    pub bug_signature: String,
    pub source: String,
    pub instance_id: Option<String>,
    pub openclaw_version: Option<String>,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchRecord {
    pub id: String,
    pub bug_signature: String,
    pub target: String,
    pub platform: Option<String>,
    pub openclaw_ver: Option<String>,
    pub diagnosis: Option<String>,
    pub remedy_type: String,
    pub remedy_payload: String,
    pub success_count: i64,
    pub attempt_count: i64,
    /// Lifecycle status: "active", "superseded", "stale", "archived".
    #[serde(default = "default_status")]
    pub status: String,
    /// Minimum applicable version (inclusive). None = no lower bound.
    pub min_version: Option<String>,
    /// Maximum applicable version (inclusive). None = no upper bound.
    pub max_version: Option<String>,
    /// The official version that ships a code fix for this bug.
    /// When current_version >= superseded_by, the patch auto-retires.
    pub superseded_by: Option<String>,
    /// Trust level: "local", "peer", "community", "official".
    #[serde(default = "default_trust")]
    pub trust_level: String,
    /// Anonymised originator identifier for peer/community patches.
    pub author_fingerprint: Option<String>,
}

fn default_status() -> String {
    "active".into()
}
fn default_trust() -> String {
    "local".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosisResult {
    pub summary: String,
    pub suggested_patches: Vec<PatchRecord>,
}

// ── Sentinel event (unified self-healing audit record) ──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelEvent {
    /// Origin of the event: "chat_http", "chat_cli", "gateway", etc.
    pub source: String,
    /// Stable hash of the first 3 error lines, for evolution library lookup.
    pub bug_signature: String,
    /// What happened: "captured", "matched", "applied", "rollback", "suggest".
    pub action: String,
    /// Human-readable description.
    pub detail: String,
    /// Severity level: "info", "warn", "danger".
    pub severity: String,
}

impl SentinelEvent {
    pub fn captured(source: &str, bug_signature: &str, detail: &str) -> Self {
        Self {
            source: source.into(),
            bug_signature: bug_signature.into(),
            action: "captured".into(),
            detail: detail.into(),
            severity: "warn".into(),
        }
    }

    pub fn matched(source: &str, bug_signature: &str, detail: &str) -> Self {
        Self {
            source: source.into(),
            bug_signature: bug_signature.into(),
            action: "matched".into(),
            detail: detail.into(),
            severity: "info".into(),
        }
    }

    pub fn applied(source: &str, bug_signature: &str, detail: &str) -> Self {
        Self {
            source: source.into(),
            bug_signature: bug_signature.into(),
            action: "applied".into(),
            detail: detail.into(),
            severity: "info".into(),
        }
    }

    pub fn rollback(source: &str, bug_signature: &str, detail: &str) -> Self {
        Self {
            source: source.into(),
            bug_signature: bug_signature.into(),
            action: "rollback".into(),
            detail: detail.into(),
            severity: "danger".into(),
        }
    }

    pub fn suggest(source: &str, bug_signature: &str, detail: &str) -> Self {
        Self {
            source: source.into(),
            bug_signature: bug_signature.into(),
            action: "suggest".into(),
            detail: detail.into(),
            severity: "warn".into(),
        }
    }
}

/// Format a sentinel event as a log line, print to stderr, and return the
/// detail string so callers can forward it to the frontend's `logSecurityEvent`.
pub fn log_sentinel_event(event: &SentinelEvent) -> String {
    let line = format!(
        "[sentinel] [{sev}] {src}/{action} sig={sig} — {detail}",
        sev = event.severity,
        src = event.source,
        action = event.action,
        sig = &event.bug_signature[..event.bug_signature.len().min(8)],
        detail = event.detail,
    );
    eprintln!("{line}");
    line
}
