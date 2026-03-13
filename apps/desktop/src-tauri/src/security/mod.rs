pub mod checks;
pub mod firewall;
pub mod network;
/// Security scanning, firewall rules, and network monitoring for Claw Guard dashboard.
pub mod scan;

use serde::{Deserialize, Serialize};

// ── Shared types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityCheck {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "notice" | "warn" | "danger" | "unknown"
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityReport {
    pub score: u8,
    pub checks: Vec<SecurityCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortConnection {
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: String,
    pub is_local: bool,
    /// True when the socket is in LISTENING state (no remote peer yet).
    /// Frontend uses this to exclude listening rows from the "external connection" count.
    pub is_listening: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissions {
    /// "deny" | "ask" | "allow"
    pub exec_mode: String,
    pub allowlist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowedIpEntry {
    pub ip: String,
    pub label: String, // user-supplied friendly name, e.g. "我的 iPhone 15"
    pub port: u16,
    pub active: bool,
}

/// Detected LAN address info returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanInfo {
    /// Machine's primary LAN IP (e.g. "192.168.1.100")
    pub ip: String,
    /// CIDR subnet the machine sits in (e.g. "192.168.1.0/24")
    pub subnet: String,
    /// Prefix length derived from the subnet mask (e.g. 24)
    pub prefix: u8,
}

// ── Shared helpers (used by both firewall and network submodules) ───────────

/// Path to the JSON file that persists the IP allowlist.
pub(crate) fn ip_allowlist_path() -> String {
    crate::platform::path_join(
        &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
        "ip-allowlist.json",
    )
}

pub(crate) fn read_ip_allowlist_json() -> serde_json::Value {
    std::fs::read_to_string(ip_allowlist_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({ "ips": {} }))
}

pub(crate) fn write_ip_allowlist_json(v: &serde_json::Value) -> Result<(), String> {
    let path = ip_allowlist_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ── Re-exports (keep `security::function_name` paths working in lib.rs) ────

pub use scan::{
    add_exec_allowlist_entry, check_firewall_active, get_port_connections, get_tool_permissions,
    remove_exec_allowlist_entry, scan_security_status, set_exec_mode,
};

pub use firewall::{
    apply_local_only_firewall, get_network_access_mode, kill_switch_offline, kill_switch_restore,
    remove_local_only_firewall, set_network_access_mode,
};

pub use network::{
    add_allowed_ip, get_allowed_ips, get_local_lan_info, remove_allowed_ip, scan_lan_devices,
};
