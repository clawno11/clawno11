/// Deployment coordinator — orchestrates node / pm2 / gateway sub-modules.
///
/// All heavy logic lives in the focused sub-modules:
///   crate::node    — Node.js + openclaw CLI
///   crate::pm2     — pm2 daemon lifecycle
///   crate::gateway — openclaw gateway start / health / URL
///
/// This module owns only:
///   • deploy_step_onboard   — openclaw one-time config init
///   • deploy_remote         — remote deployment (stub, not yet implemented)
///   • configure_api_key     — write AI provider token directly to auth-profiles.json
mod auth;
pub mod diagnosis;
pub mod environment;
pub mod executor;
pub mod models;
pub mod trust;
pub mod watchdog;

use serde::Deserialize;

use crate::platform::{data_roaming, first_line, path_join, shell_result, user_home};
use crate::types::{RemoteDeployResult, StepResult};

pub use models::{auto_select_active_model, restore_default_model};

/// Provider IDs accepted from the UI.
///
/// Some UI ids don't match OpenClaw's internal provider name;
/// `resolve_openclaw_provider()` translates them before writing auth.
const VALID_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "openrouter",
    "zai",
    "minimax",
    "google",
    "groq",
    "mistral",
    "xai",
    "ollama",
    "moonshot",
    "qwen",
    "doubao",
    "volcengine",
    "modelstudio",
    "kimi-coding",
];

/// Map UI-facing provider id to the id OpenClaw actually recognises
/// in auth-profiles.json and its implicit provider loaders.
fn resolve_openclaw_provider(ui_id: &str) -> &str {
    match ui_id {
        "qwen" => "modelstudio",
        "doubao" => "volcengine",
        _ => ui_id,
    }
}

// ── Onboard ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_onboard() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();
    let home_claw = path_join(&user_home(), ".openclaw");

    let (ok, stdout, stderr) = shell_result("openclaw onboard --yes");
    let combined = format!("{stdout} {stderr}").to_lowercase();

    if ok || combined.contains("already") || combined.contains("skip") {
        auth::configure_ollama_in_gateway(&mut fixes);
        models::auto_select_active_model(&mut fixes);
        return StepResult::ok_fixed("config-initialized".to_string(), fixes);
    }

    if combined.contains("eacces")
        || combined.contains("permission")
        || combined.contains("access denied")
    {
        let alt_dir = path_join(&data_roaming(), "openclaw");
        let _ = std::fs::create_dir_all(&alt_dir);
        fixes.push(format!("alt-config-dir:{}", alt_dir));
        #[cfg(target_os = "windows")]
        let onboard_cmd = format!("set OPENCLAW_STATE_DIR={alt_dir} && openclaw onboard --yes");
        #[cfg(not(target_os = "windows"))]
        let onboard_cmd = format!("OPENCLAW_STATE_DIR=\"{alt_dir}\" openclaw onboard --yes");
        let (ok2, _, _) = shell_result(&onboard_cmd);
        if ok2 {
            auth::configure_ollama_in_gateway(&mut fixes);
            models::auto_select_active_model(&mut fixes);
            return StepResult::ok_fixed("config-initialized-alt-dir".to_string(), fixes);
        }
    }

    if combined.contains("parse")
        || combined.contains("invalid")
        || combined.contains("unexpected token")
    {
        if std::path::Path::new(&home_claw).exists() {
            let _ = std::fs::rename(&home_claw, format!("{home_claw}.bak"));
            fixes.push(format!("backup-corrupt-config:{home_claw}.bak"));
        }
        let (ok3, _, stderr3) = shell_result("openclaw onboard --yes");
        if ok3 {
            auth::configure_ollama_in_gateway(&mut fixes);
            models::auto_select_active_model(&mut fixes);
            return StepResult::ok_fixed("config-reset-and-initialized".to_string(), fixes);
        }
        return StepResult::err_fixed(
            format!("config-reset-failed: {}", first_line(&stderr3)),
            fixes,
        );
    }

    // Non-fatal: gateway --allow-unconfigured handles missing config.
    fixes.push("onboard-skipped-non-fatal".to_string());
    StepResult::ok_fixed("config-skipped-using-defaults".to_string(), fixes)
}

// ── Remote deploy ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RemoteDeployArgs {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub gateway_port: u16,
    pub use_docker: bool,
}

#[tauri::command]
pub async fn deploy_remote(args: RemoteDeployArgs) -> RemoteDeployResult {
    RemoteDeployResult {
        success: false,
        host: args.host.clone(),
        gateway_port: args.gateway_port,
        gateway_url: format!("http://{}:{}", args.host, args.gateway_port),
        error: Some(
            "Use the step-by-step SSH deployment commands instead: \
             deploy_remote_connect → deploy_remote_check_node → \
             deploy_remote_install_openclaw → deploy_remote_onboard → \
             deploy_remote_start_gateway"
                .to_string(),
        ),
    }
}

#[tauri::command]
pub async fn get_remote_service_info(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> crate::types::ServiceInfo {
    use clawno_core::ssh::{self, SshArgs};

    if ssh::validate_ssh_input(&host, &username, port).is_err() {
        return crate::types::ServiceInfo {
            name: "openclaw".to_string(),
            status: "invalid-args".to_string(),
            pid: None,
            uptime: None,
            restarts: None,
        };
    }

    let args = SshArgs {
        host,
        port,
        username,
        password,
        private_key,
        gateway_port: 18789,
    };

    let script = ssh::cmd_gateway_status();
    match ssh::ssh_exec(&args, &script).await {
        Ok((_, out)) => parse_pm2_jlist(&out),
        Err(_) => crate::types::ServiceInfo {
            name: "openclaw".to_string(),
            status: "unreachable".to_string(),
            pid: None,
            uptime: None,
            restarts: None,
        },
    }
}

fn parse_pm2_jlist(raw: &str) -> crate::types::ServiceInfo {
    if let Ok(procs) = serde_json::from_str::<Vec<serde_json::Value>>(raw) {
        for p in &procs {
            let name = p["name"].as_str().unwrap_or("");
            if name.contains("openclaw") {
                return crate::types::ServiceInfo {
                    name: name.to_string(),
                    status: p["pm2_env"]["status"]
                        .as_str()
                        .unwrap_or("unknown")
                        .to_string(),
                    pid: p["pid"].as_u64().map(|v| v as u32),
                    uptime: p["pm2_env"]["pm_uptime"].as_u64(),
                    restarts: p["pm2_env"]["restart_time"].as_u64().map(|v| v as u32),
                };
            }
        }
    }
    crate::types::ServiceInfo {
        name: "openclaw".to_string(),
        status: if raw.contains("no-pm2") {
            "no-pm2".to_string()
        } else {
            "not-found".to_string()
        },
        pid: None,
        uptime: None,
        restarts: None,
    }
}

// ── AI provider key configuration ─────────────────────────────────────────────

/// Run a command silently (no window) using the platform shell abstraction.
fn run_silent(cmd: &str) -> (bool, String) {
    match crate::platform::shell_cmd(cmd, false) {
        Ok(o) => {
            let out = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            (o.status.success(), out)
        }
        Err(e) => (false, e.to_string()),
    }
}

/// Write an AI provider key directly into OpenClaw's auth-profiles.json,
/// then restart the gateway so the running process picks it up.
///
/// No CLI intermediary — file I/O only. This avoids PATH issues,
/// CLI version drift, and pipe-stdin fragility that plagued `paste-token`.
#[tauri::command]
pub async fn configure_api_key(provider: String, api_key: String) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    if provider.is_empty() || api_key.is_empty() {
        return StepResult::err("provider-or-key-empty".to_string());
    }

    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        return StepResult::err(format!("invalid-provider:{}", provider));
    }

    let oc_provider = resolve_openclaw_provider(&provider);
    if oc_provider != provider {
        fixes.push(format!("provider-mapped:{}→{}", provider, oc_provider));
    }

    auth::write_provider_key(oc_provider, &api_key, &mut fixes);

    // Key write is the source of truth — check it directly
    let write_ok = fixes
        .iter()
        .any(|f| f.starts_with("auth-profiles-written:"));
    if !write_ok {
        return StepResult::err_fixed("auth-profiles-write-failed".to_string(), fixes);
    }

    let (restart_ok, _, _) = crate::pm2::run_pm2(&["restart", "openclaw"]);
    if restart_ok {
        fixes.push("gateway-restarted-for-auth".into());
    } else {
        fixes.push("gateway-restart-skipped".into());
    }

    // Non-blocking verify: check if OpenClaw picked up the provider.
    // For implicit providers (moonshot, modelstudio, volcengine) that aren't
    // in agents.defaults.models yet, verify may report "not found" even
    // though the key is correctly written — this is expected.
    std::thread::sleep(std::time::Duration::from_secs(2));
    let (verified, verify_detail) = verify_provider_configured(oc_provider);
    if verified {
        fixes.push("verify-ok".into());
    } else {
        fixes.push(format!("verify-pending:{}", verify_detail));
    }

    // Re-evaluate the active model: if the default is Ollama (fallback-only)
    // and this new cloud provider is usable, upgrade to cloud automatically.
    models::auto_select_active_model(&mut fixes);

    StepResult::ok_fixed("api-key-configured".to_string(), fixes)
}

/// 验证 OpenClaw 是否识别了指定 provider 的 Key。
/// 调用 `openclaw models status --json`，检查 `auth.providers` 中是否包含该 provider。
fn verify_provider_configured(provider: &str) -> (bool, String) {
    let out = crate::platform::shell_output("openclaw models status --json");
    let v: serde_json::Value = match serde_json::from_str(&out) {
        Ok(v) => v,
        Err(e) => {
            return (false, format!("models-status-parse-failed:{}", e));
        }
    };

    let providers: Vec<String> = v
        .get("auth")
        .and_then(|a| a.get("providers"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("provider").and_then(|p| p.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if providers.iter().any(|p| p == provider) {
        (true, format!("provider-{}-found", provider))
    } else {
        (
            false,
            format!(
                "provider-{}-not-in-list:[{}]",
                provider,
                providers.join(",")
            ),
        )
    }
}

// ── Auth diagnostic ───────────────────────────────────────────────────────────

/// 诊断 auth 配置：返回路径、文件内容、pm2 状态，便于排查「Key 已写入但聊天仍报未配置」。
#[tauri::command]
pub fn diagnose_auth() -> serde_json::Value {
    use crate::platform::{data_roaming, path_join, shell_output, user_home};

    let home = user_home();
    let default_oc = path_join(&home, ".openclaw");
    let default_agent_auth = path_join(&default_oc, "agents/main/agent/auth-profiles.json");
    let default_global = path_join(&default_oc, "auth-profiles.json");

    let roaming = data_roaming();
    let alt_oc = path_join(&roaming, "openclaw");
    let alt_agent_auth = path_join(&alt_oc, "agents/main/agent/auth-profiles.json");

    let read_redacted = |path: &str| -> String {
        match std::fs::read_to_string(path) {
            Ok(s) => {
                let mut doc: serde_json::Value = serde_json::from_str(&s)
                    .unwrap_or(serde_json::json!({"_raw_parse_error": true}));
                if let Some(profiles) = doc.get_mut("profiles").and_then(|p| p.as_object_mut()) {
                    for val in profiles.values_mut() {
                        for field in &["key", "token", "apiKey"] {
                            if let Some(v) = val.get(*field).and_then(|v| v.as_str()) {
                                if v.len() > 8 {
                                    let redacted = format!("{}…({} chars)", &v[..4], v.len());
                                    val[*field] = serde_json::json!(redacted);
                                }
                            }
                        }
                    }
                }
                serde_json::to_string_pretty(&doc).unwrap_or(s)
            }
            Err(e) => format!("READ_ERROR: {e}"),
        }
    };

    let models_status = shell_output("openclaw models status --json");
    let models_preview: String = models_status.chars().take(800).collect();

    let pm2_jlist = crate::pm2::pm2_jlist();
    let pm2_preview: String = pm2_jlist.chars().take(600).collect();

    let config_json_path = path_join(&default_oc, "openclaw.json");
    let config_exists = std::path::Path::new(&config_json_path).exists();
    let config_auth_section = if config_exists {
        std::fs::read_to_string(&config_json_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|doc| doc.get("auth").cloned())
            .map(|a| a.to_string())
            .unwrap_or_else(|| "no-auth-section".to_string())
    } else {
        "openclaw.json-not-found".to_string()
    };

    serde_json::json!({
        "userHome": home,
        "defaultAgentAuth": default_agent_auth,
        "defaultAgentAuthExists": std::path::Path::new(&default_agent_auth).exists(),
        "defaultAgentAuthContent": read_redacted(&default_agent_auth),
        "defaultGlobalExists": std::path::Path::new(&default_global).exists(),
        "altDirExists": std::path::Path::new(&alt_oc).exists(),
        "altAgentAuthExists": std::path::Path::new(&alt_agent_auth).exists(),
        "altAgentAuthContent": if std::path::Path::new(&alt_agent_auth).exists() {
            read_redacted(&alt_agent_auth)
        } else {
            "N/A".to_string()
        },
        "configJsonExists": config_exists,
        "configAuthSection": config_auth_section,
        "openclawModelsStatusPreview": models_preview,
        "pm2ProcessList": pm2_preview,
    })
}

// ── Model config auto-fix ─────────────────────────────────────────────────────

/// Run on app startup: ensure a working model is set as default.
///
/// Delegates to `auto_select_active_model` which dynamically queries
/// OpenClaw's configuration — no hardcoded model names needed.
#[tauri::command]
pub fn fix_model_config() -> String {
    let mut fixes = Vec::new();
    models::auto_select_active_model(&mut fixes);
    if fixes.is_empty() {
        "ok:no-changes-needed".to_string()
    } else {
        fixes.join(";")
    }
}
