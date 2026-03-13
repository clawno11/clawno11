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
///   • configure_api_key     — write AI provider token via CLI (stdin pipe)
mod auth;
pub mod diagnosis;
pub mod executor;
pub mod models;
pub mod watchdog;

use serde::Deserialize;
use std::process::Command;

use crate::platform::{
    augmented_path, data_roaming, first_line, path_join, shell_result, user_home,
};
use crate::types::{RemoteDeployResult, StepResult};

pub use models::{auto_select_active_model, restore_default_model, select_model_for_provider};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Strict allowlist of known AI provider identifiers.
/// This prevents command injection via the `provider` argument passed to configure_api_key.
const VALID_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "openrouter",
    "zai",
    "minimax",
    "deepseek",
    "moonshot",
    "qwen",
    "doubao",
    "hunyuan",
    "spark",
    "baichuan",
    "stepfun",
    "lingyi",
    "siliconflow",
    "ollama", // local engine — uses placeholder key "ollama-local"
];

// ── Onboard ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_onboard() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();
    let home_claw = path_join(&user_home(), ".openclaw");

    let (ok, stdout, stderr) = shell_result("openclaw onboard --yes");
    let combined = format!("{stdout} {stderr}").to_lowercase();

    if ok || combined.contains("already") || combined.contains("skip") {
        auth::configure_ollama_in_gateway(&mut fixes);
        auth::sync_auth_to_agents(&mut fixes);
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
            auth::sync_auth_to_agents(&mut fixes);
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
            auth::sync_auth_to_agents(&mut fixes);
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
    match crate::platform::shell_cmd(cmd) {
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

/// Configure an AI provider API key via the OpenClaw CLI.
/// The key is piped via stdin — it never appears in the process command line.
/// The provider is validated against a strict allowlist to prevent command injection.
#[tauri::command]
pub async fn configure_api_key(provider: String, api_key: String) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    if provider.is_empty() || api_key.is_empty() {
        return StepResult::err("provider-or-key-empty".to_string());
    }

    // Security: validate provider against allowlist before shell interpolation.
    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        return StepResult::err(format!("invalid-provider:{}", provider));
    }

    // Use the platform shell (cmd on Windows, sh on Unix) for cross-platform support.
    let cmd_str = format!("openclaw models auth paste-token --provider {}", provider);
    #[cfg(target_os = "windows")]
    let mut c = {
        let mut b = Command::new("cmd");
        b.args(["/C", &cmd_str]);
        b.creation_flags(CREATE_NO_WINDOW);
        b
    };
    #[cfg(not(target_os = "windows"))]
    let mut c = {
        let mut b = Command::new("sh");
        b.args(["-c", &cmd_str]);
        b
    };
    c.env("PATH", augmented_path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let paste_result = (|| -> Result<std::process::Output, String> {
        let mut child = c.spawn().map_err(|e| format!("spawn-failed:{e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(api_key.as_bytes())
                .map_err(|e| format!("stdin-write-failed:{e}"))?;
        }
        child
            .wait_with_output()
            .map_err(|e| format!("wait-failed:{e}"))
    })();

    match paste_result {
        Ok(o) => {
            let out = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            if o.status.success() {
                fixes.push(format!("auth-written:{}", provider));
            } else {
                fixes.push(format!(
                    "paste-token-exit-nonzero:{}",
                    out.trim().chars().take(80).collect::<String>()
                ));
            }
        }
        Err(e) => {
            fixes.push(format!(
                "paste-token-spawn-failed:{}",
                e.chars().take(80).collect::<String>()
            ));
        }
    }

    // GUARANTEE: directly write the key into the agent auth file.
    auth::ensure_auth_in_agent_file(&provider, &api_key, &mut fixes);
    auth::sync_auth_to_agents(&mut fixes);

    models::select_model_for_provider(&provider, &mut fixes);

    StepResult::ok_fixed("api-key-configured".to_string(), fixes)
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
