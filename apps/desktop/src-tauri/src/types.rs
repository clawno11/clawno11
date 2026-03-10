/// Shared data types used across multiple Rust modules.

use serde::{Deserialize, Serialize};

// ── Deploy step result ───────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct StepResult {
    pub ok: bool,
    /// English key or message; the frontend translates it for display.
    pub detail: String,
    /// Fix-action keys applied automatically (translated by the frontend).
    pub fixes_applied: Vec<String>,
}

impl StepResult {
    pub fn ok(detail: String) -> Self {
        Self { ok: true, detail, fixes_applied: vec![] }
    }
    pub fn ok_fixed(detail: String, fixes: Vec<String>) -> Self {
        Self { ok: true, detail, fixes_applied: fixes }
    }
    pub fn err(detail: String) -> Self {
        Self { ok: false, detail, fixes_applied: vec![] }
    }
    pub fn err_fixed(detail: String, fixes: Vec<String>) -> Self {
        Self { ok: false, detail, fixes_applied: fixes }
    }
}

// ── Service info ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub status: String,
    pub pid: Option<u32>,
    pub uptime: Option<u64>,
    pub restarts: Option<u32>,
}

// ── Deploy status (pre-check) ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct DeployStatus {
    /// Whether `openclaw` CLI is installed and reachable.
    pub openclaw_installed: bool,
    /// Installed version string, e.g. "1.2.3". Empty when not installed.
    pub openclaw_version: String,
    /// Whether the pm2-managed `openclaw` process is currently online.
    pub service_running: bool,
}

// ── Deploy results ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct RemoteDeployResult {
    pub success: bool,
    pub host: String,
    pub gateway_port: u16,
    pub gateway_url: String,
    pub error: Option<String>,
}
