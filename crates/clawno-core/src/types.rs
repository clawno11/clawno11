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
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepPhase {
    Probing,
    Downloading,
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
    VersionTooOld,
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
