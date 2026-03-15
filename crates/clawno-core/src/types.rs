//! Re-exports of shared types across all core modules.
//!
//! Consumers can either import from the specific module
//! (`clawno_core::chat::ChatChunk`) or from this convenience barrel
//! (`clawno_core::types::ChatChunk`).

use serde::{Deserialize, Serialize};

pub use crate::chat::{ChatChunk, ChatDone};
pub use crate::mcp::McpScanResult;
#[allow(unused_imports)]
pub use crate::sentinel::{DiagnosisRequest, DiagnosisResult, PatchRecord};
pub use crate::token_log::MigrationDef;

pub const STEP_PROGRESS_EVENT: &str = "deploy-step-progress";

/// Tailscale connection status — shared across desktop and mobile.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TailscaleStatus {
    pub installed: bool,
    pub running: bool,
    pub ip: Option<String>,
    pub version: Option<String>,
}

/// Gateway health probe result — shared across desktop and mobile.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProbeResult {
    pub online: bool,
    pub latency_ms: u64,
}

// ── Self-healing deploy progress ─────────────────────────────────────────────

/// Unified progress event emitted by every deploy step.
///
/// Replaces the old `DeployDownloadProgress` which only covered npm downloads.
/// The frontend listens on `deploy-step-progress` and renders real-time
/// progress bars, speed, ETA, strategy switches, and self-healing status.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepProgress {
    /// Which deploy step is running (e.g. "install-node", "install-openclaw").
    pub step_id: String,
    /// Current phase within the step.
    pub phase: StepPhase,
    /// Human-readable name of the active strategy (e.g. "winget", "choco").
    pub strategy_name: String,
    /// 0-based index of the current strategy in the chain.
    pub strategy_idx: u8,
    /// Total number of strategies available for this step.
    pub strategy_total: u8,
    /// Bytes transferred so far (download phases).
    pub bytes_done: u64,
    /// Total expected bytes (0 = unknown).
    pub bytes_total: u64,
    /// Current transfer speed in bytes/sec.
    pub speed_bps: f64,
    /// Overall completion percentage for this step (0.0 – 100.0).
    pub pct: f32,
    /// Estimated seconds remaining (-1.0 = unknown).
    pub eta_secs: f32,
    /// Human-readable status message.
    pub message: String,
    /// True when the engine is retrying after a failure.
    pub is_retrying: bool,
    /// Bug signature from the diagnosis engine, if retrying.
    pub error_sig: Option<String>,
    /// Description of the remedy being applied.
    pub remedy: Option<String>,
    /// Active download source URL (shown to user during download phase).
    pub source_url: Option<String>,
    /// Trust level of the active source.
    pub source_trust: Option<TrustLevel>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepPhase {
    Probing,
    Downloading,
    Downloaded,
    Installing,
    Verifying,
    Retrying,
    StrategySwitch,
    Done,
    WaitingForUser,
}

impl StepProgress {
    pub fn new(step_id: &str, strategy_name: &str, idx: u8, total: u8) -> Self {
        Self {
            step_id: step_id.to_string(),
            phase: StepPhase::Probing,
            strategy_name: strategy_name.to_string(),
            strategy_idx: idx,
            strategy_total: total,
            bytes_done: 0,
            bytes_total: 0,
            speed_bps: 0.0,
            pct: 0.0,
            eta_secs: -1.0,
            message: String::new(),
            is_retrying: false,
            error_sig: None,
            remedy: None,
            source_url: None,
            source_trust: None,
        }
    }
}

// ── Diagnosis types ──────────────────────────────────────────────────────────

/// Categorised error from the diagnosis engine.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCategory {
    PermissionDenied,
    NetworkTimeout,
    NetworkUnreachable,
    DiskFull,
    CacheCorrupt,
    SslError,
    PortInUse,
    ConfigCorrupt,
    BinaryNotFound,
    /// A dependency (typically `git`) needed by npm to resolve git-based packages is missing.
    GitNotInstalled,
    VersionTooOld,
    /// Node.js version used by pm2/gateway doesn't meet the minimum requirement.
    NodeVersionMismatch,
    ProcessStalled,
    ProcessCrash,
    Unknown,
}

/// Whether the engine should auto-retry, prompt the user, or abort.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RetryPolicy {
    /// Network / timeout / cache errors — retry automatically.
    AutoRetry,
    /// Permission / disk errors — ask the user before retrying.
    UserPrompt,
    /// Unrecoverable — stop the pipeline.
    Abort,
}

/// A concrete action the engine can take to fix a diagnosed error.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Remedy {
    SwitchRegistry,
    UseUserPrefix,
    CleanNpmCache,
    DisableSsl,
    KillPortOccupant,
    ResetConfig,
    RestartDaemon,
    RefreshPath,
    TryNextStrategy,
    DirectDownload,
    /// Re-scan for a v22+ node binary and rewrite the gateway wrapper.
    RescanNodeVersion,
    /// Install Git (required by npm for git-based dependencies).
    InstallGit,
}

/// Full diagnosis result produced by the diagnosis engine.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Diagnosis {
    pub category: ErrorCategory,
    pub policy: RetryPolicy,
    pub signature: String,
    pub remedies: Vec<Remedy>,
    pub raw_message: String,
}

// ── Environment scan types ───────────────────────────────────────────────────

/// Trust level of a download source, used by the UI to show green/blue/yellow badges.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrustLevel {
    /// Official upstream source (e.g. nodejs.org, npmjs.org).
    Official,
    /// Officially recognized mirror (e.g. npmmirror.com).
    OfficialMirror,
    /// Third-party / community source.
    Community,
}

/// Whether a dependency is satisfied, needs upgrade, or is missing.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DepStatus {
    Satisfied,
    NeedsUpgrade,
    NotInstalled,
}

/// A download/install source for a dependency.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DepSource {
    pub url: String,
    pub label: String,
    pub trust_level: TrustLevel,
    pub expected_sha256: Option<String>,
    pub is_primary: bool,
}

/// Status and metadata for a single dependency (Node.js, npm, openclaw, pm2, etc.).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DependencyInfo {
    pub id: String,
    pub display_name: String,
    pub required_version: String,
    pub current_version: Option<String>,
    pub status: DepStatus,
    pub sources: Vec<DepSource>,
    pub strategies: Vec<String>,
    pub size_estimate_mb: u32,
    pub is_optional: bool,
}

/// Info about a package manager available on the host system.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageManagerInfo {
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
}

/// Full environment report returned by `scan_environment`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentReport {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub total_memory_mb: u64,
    pub free_disk_mb: u64,
    pub is_admin: bool,
    pub is_chinese_locale: bool,
    pub http_proxy: Option<String>,
    pub package_managers: Vec<PackageManagerInfo>,
    pub dependencies: Vec<DependencyInfo>,
}

// ── Deploy step result ───────────────────────────────────────────────────────

/// Unified deploy step result used by both desktop and mobile.
#[derive(Serialize, Deserialize, Clone)]
pub struct StepResult {
    pub ok: bool,
    pub detail: String,
    pub fixes_applied: Vec<String>,
}

impl StepResult {
    pub fn ok(detail: String) -> Self {
        Self {
            ok: true,
            detail,
            fixes_applied: vec![],
        }
    }
    pub fn ok_fixed(detail: String, fixes: Vec<String>) -> Self {
        Self {
            ok: true,
            detail,
            fixes_applied: fixes,
        }
    }
    pub fn err(detail: String) -> Self {
        Self {
            ok: false,
            detail,
            fixes_applied: vec![],
        }
    }
    pub fn err_fixed(detail: String, fixes: Vec<String>) -> Self {
        Self {
            ok: false,
            detail,
            fixes_applied: fixes,
        }
    }
}
