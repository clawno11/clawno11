/// MCP (Model Context Protocol) security scanner + OpenClaw plugin discovery.
///
/// Risk analysis delegates to `clawno_core::mcp` for heuristic scanning.
/// This module adds HTTP probing and OpenClaw plugin management (desktop-only).
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

clawno_core::define_scan_mcp_command!();

// ── OpenClaw plugin discovery (desktop-only) ────────────────────────────

#[derive(serde::Serialize)]
pub struct OpenClawPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub origin: String,
    pub enabled: bool,
    pub status: String,
    pub tool_names: Vec<String>,
}

#[tauri::command]
pub async fn list_openclaw_plugins() -> Vec<OpenClawPlugin> {
    let out = crate::platform::shell_output("openclaw plugins list --json");
    if out.is_empty() {
        return Vec::new();
    }

    let Ok(root) = serde_json::from_str::<serde_json::Value>(&out) else {
        return Vec::new();
    };
    let Some(arr) = root.get("plugins").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    arr.iter()
        .map(|p| OpenClawPlugin {
            id: p["id"].as_str().unwrap_or("").to_string(),
            name: p["name"].as_str().unwrap_or("").to_string(),
            description: p["description"].as_str().unwrap_or("").to_string(),
            version: p["version"].as_str().unwrap_or("").to_string(),
            origin: p["origin"].as_str().unwrap_or("bundled").to_string(),
            enabled: p["enabled"].as_bool().unwrap_or(false),
            status: p["status"].as_str().unwrap_or("disabled").to_string(),
            tool_names: p["toolNames"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect()
}

#[tauri::command]
pub async fn toggle_openclaw_plugin(id: String, enable: bool) -> Result<String, String> {
    clawno_core::mcp::validate_plugin_id(&id)?;

    let verb = if enable { "enable" } else { "disable" };

    #[cfg(target_os = "windows")]
    let openclaw_bin = "openclaw.cmd";
    #[cfg(not(target_os = "windows"))]
    let openclaw_bin = "openclaw";

    let mut cmd = std::process::Command::new(openclaw_bin);
    cmd.args(["plugins", verb, &id])
        .env("PATH", crate::platform::augmented_path());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run openclaw: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(if stdout.is_empty() { stderr } else { stdout })
}
