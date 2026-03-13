/// Shared data types used across multiple Rust modules.
use serde::{Deserialize, Serialize};

pub use clawno_core::types::StepResult;

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
    pub openclaw_installed: bool,
    pub openclaw_version: String,
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
