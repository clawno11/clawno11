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
