use super::scan::{openclaw_semver, scan_openclaw_bin_dir};
/// Deploy status checks and provider listing Tauri commands.
use crate::platform::shell_output;

/// Quick pre-deploy status check: is openclaw installed? is the service running?
/// This runs fast (no npm download) and is called when the Deploy page loads.
///
/// Uses two strategies to detect openclaw:
///   1. Shell: `openclaw --version` (works when openclaw is in PATH)
///   2. Filesystem scan: check well-known install locations directly
#[tauri::command]
pub async fn check_deploy_status() -> crate::types::DeployStatus {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    let mut openclaw_installed = !sv.is_empty();
    let mut version = sv;

    if !openclaw_installed {
        if let Some(bin_dir) = scan_openclaw_bin_dir() {
            openclaw_installed = true;
            let sep = if cfg!(target_os = "windows") {
                ";"
            } else {
                ":"
            };
            let current = std::env::var("PATH").unwrap_or_default();
            if !current.contains(&bin_dir) {
                std::env::set_var("PATH", format!("{}{}{}", bin_dir, sep, current));
            }
            let ver2 = shell_output("openclaw --version");
            let sv2 = openclaw_semver(&ver2);
            if !sv2.is_empty() {
                version = sv2;
            } else {
                version = "installed".to_string();
            }
        }
    }

    let jlist = crate::pm2::pm2_jlist();
    let service_running = jlist.contains("\"openclaw\"") && jlist.contains("\"online\"");

    crate::types::DeployStatus {
        openclaw_installed,
        openclaw_version: version,
        service_running,
    }
}

/// Read which AI providers already have a key configured in OpenClaw.
///
/// Uses TWO strategies to ensure reliability across all environments:
///   1. CLI: `openclaw models status --json` → auth.providers[].provider
///   2. File: directly read auth-profiles.json from both global and agent dirs
///
/// The union of both sources is returned so the UI never falsely shows
/// "not configured" just because the CLI isn't in PATH (common on macOS).
#[tauri::command]
pub async fn list_configured_providers() -> Vec<String> {
    let mut providers = std::collections::HashSet::<String>::new();

    let out = shell_output("openclaw models status --json");
    if !out.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) {
            if let Some(arr) = json
                .get("auth")
                .and_then(|a| a.get("providers"))
                .and_then(|p| p.as_array())
            {
                for entry in arr {
                    if let Some(p) = entry.get("provider").and_then(|v| v.as_str()) {
                        providers.insert(p.to_string());
                    }
                }
            }
        }
    }

    let home = crate::platform::user_home();
    let oc = crate::platform::path_join(&home, ".openclaw");
    let files = [
        crate::platform::path_join(&oc, "auth-profiles.json"),
        crate::platform::path_join(&oc, "agents/main/agent/auth-profiles.json"),
    ];
    for path in &files {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(profiles) = doc.get("profiles").and_then(|p| p.as_object()) {
                    for (_key, val) in profiles {
                        if let Some(p) = val.get("provider").and_then(|v| v.as_str()) {
                            if let Some(tok) = val.get("token").and_then(|v| v.as_str()) {
                                if !tok.is_empty() {
                                    providers.insert(p.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    providers.into_iter().collect()
}
