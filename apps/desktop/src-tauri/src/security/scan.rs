use super::checks::{
    calculate_score, check_im_connector_exposure_cached, check_network_access_mode_cached,
    check_node_version, check_offline_mode, check_pm2_status, check_port_exposure,
};
use super::{PortConnection, SecurityReport, ToolPermissions};
/// Security scanning, scoring, and tool-permission commands.
use crate::platform::shell_output as run_cmd;

// ── Tool permissions (exec-approvals) ────────────────────────────────────────

fn exec_approvals_path() -> String {
    crate::platform::path_join(
        &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
        "exec-approvals.json",
    )
}

fn read_approvals_json() -> serde_json::Value {
    let path = exec_approvals_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "version": 1,
                "defaults": { "mode": "ask" },
                "allowlist": []
            })
        })
}

/// Return the current exec approval mode and allowlist.
#[tauri::command]
pub fn get_tool_permissions() -> ToolPermissions {
    let json = read_approvals_json();
    let exec_mode = json
        .pointer("/defaults/mode")
        .and_then(|v| v.as_str())
        .unwrap_or("ask")
        .to_string();
    let allowlist = json
        .get("allowlist")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    ToolPermissions {
        exec_mode,
        allowlist,
    }
}

/// Persist the exec approval mode to ~/.openclaw/exec-approvals.json.
#[tauri::command]
pub fn set_exec_mode(mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "deny" | "ask" | "allow") {
        return Err(format!(
            "invalid exec mode: {mode:?}; must be 'deny', 'ask', or 'allow'"
        ));
    }
    let mut json = read_approvals_json();
    if let Some(obj) = json.as_object_mut() {
        obj.insert("defaults".to_string(), serde_json::json!({ "mode": mode }));
    }
    let path = exec_approvals_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Add a glob pattern to the exec allowlist via the OpenClaw CLI.
#[tauri::command]
pub fn add_exec_allowlist_entry(pattern: String) -> Result<(), String> {
    let mut json = read_approvals_json();
    let entry = serde_json::Value::String(pattern.clone());
    if let Some(list) = json.get_mut("allowlist").and_then(|v| v.as_array_mut()) {
        if !list.contains(&entry) {
            list.push(entry);
        }
    } else {
        json["allowlist"] = serde_json::json!([pattern]);
    }
    let path = exec_approvals_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a glob pattern from the exec allowlist.
#[tauri::command]
pub fn remove_exec_allowlist_entry(pattern: String) -> Result<(), String> {
    let mut json = read_approvals_json();
    if let Some(list) = json.get_mut("allowlist").and_then(|v| v.as_array_mut()) {
        list.retain(|v| v.as_str() != Some(&pattern));
    }
    let path = exec_approvals_path();
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Run all security checks and return a full report with score.
#[tauri::command]
pub fn scan_security_status(port: u16) -> SecurityReport {
    let block_active = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    ))
    .contains(&format!("ClawNo11_Block_Port_{port}"));

    let checks = vec![
        check_network_access_mode_cached(port, block_active),
        check_im_connector_exposure_cached(port, block_active),
        check_port_exposure(port),
        check_node_version(),
        check_pm2_status(),
        check_offline_mode(),
    ];
    let score = calculate_score(&checks);
    SecurityReport { score, checks }
}

/// List all active TCP/UDP connections on the given OpenClaw port.
#[tauri::command]
pub fn get_port_connections(port: u16) -> Vec<PortConnection> {
    let output = run_cmd(&format!("netstat -ano | findstr \":{port}\""));

    output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                return None;
            }

            let proto = parts[0].to_uppercase();
            let local_addr = parts.get(1).unwrap_or(&"").to_string();
            let remote_addr = parts.get(2).unwrap_or(&"").to_string();

            let (state, pid) = if proto.starts_with("TCP") && parts.len() >= 5 {
                (
                    parts.get(3).unwrap_or(&"").to_string(),
                    parts.get(4).unwrap_or(&"-").to_string(),
                )
            } else {
                ("".to_string(), parts.get(3).unwrap_or(&"-").to_string())
            };

            if !local_addr.contains(&format!(":{port}")) {
                return None;
            }

            let is_listening = state == "LISTENING";

            let is_local = !is_listening
                && (remote_addr.starts_with("127.0.0.1")
                    || remote_addr.starts_with("::1")
                    || remote_addr.starts_with("[::1]"));

            Some(PortConnection {
                local_addr,
                remote_addr,
                state,
                pid,
                is_local,
                is_listening,
            })
        })
        .collect()
}

/// Check whether the ClawNo.11 firewall rules for the given port are currently active.
#[tauri::command]
pub fn check_firewall_active(port: u16) -> bool {
    let has_block = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    ))
    .contains(&format!("ClawNo11_Block_Port_{port}"));

    if !has_block {
        return false;
    }

    let has_subnet = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Subnet_{port}\""
    ))
    .contains(&format!("ClawNo11_Allow_Subnet_{port}"));

    let has_tailscale = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Tailscale_{port}\""
    ))
    .contains(&format!("ClawNo11_Allow_Tailscale_{port}"));

    !has_subnet && !has_tailscale
}
