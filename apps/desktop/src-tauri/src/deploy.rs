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

use std::process::Command;
use serde::Deserialize;

use crate::platform::{augmented_path, data_roaming, first_line, path_join, shell_result, user_home};
use crate::types::{RemoteDeployResult, StepResult};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Strict allowlist of known AI provider identifiers.
/// This prevents command injection via the `provider` argument passed to configure_api_key.
const VALID_PROVIDERS: &[&str] = &[
    "anthropic", "openai", "openrouter", "zai", "minimax", "deepseek",
    "moonshot", "qwen", "doubao", "hunyuan", "spark", "baichuan",
    "stepfun", "lingyi", "siliconflow",
];

// ── Onboard ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_onboard() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();
    let home_claw = path_join(&user_home(), ".openclaw");

    let (ok, stdout, stderr) = shell_result("openclaw onboard --yes");
    let combined = format!("{stdout} {stderr}").to_lowercase();

    if ok || combined.contains("already") || combined.contains("skip") {
        return StepResult::ok_fixed("config-initialized".to_string(), fixes);
    }

    if combined.contains("eacces") || combined.contains("permission") || combined.contains("access denied") {
        let alt_dir = path_join(&data_roaming(), "openclaw");
        let _ = std::fs::create_dir_all(&alt_dir);
        fixes.push(format!("alt-config-dir:{}", alt_dir));
        // Platform-specific env var syntax: cmd.exe uses "set VAR=val &&", sh uses "VAR=val cmd".
        #[cfg(target_os = "windows")]
        let onboard_cmd = format!("set OPENCLAW_STATE_DIR={alt_dir} && openclaw onboard --yes");
        #[cfg(not(target_os = "windows"))]
        let onboard_cmd = format!("OPENCLAW_STATE_DIR=\"{alt_dir}\" openclaw onboard --yes");
        let (ok2, _, _) = shell_result(&onboard_cmd);
        if ok2 { return StepResult::ok_fixed("config-initialized-alt-dir".to_string(), fixes); }
    }

    if combined.contains("parse") || combined.contains("invalid") || combined.contains("unexpected token") {
        if std::path::Path::new(&home_claw).exists() {
            let _ = std::fs::rename(&home_claw, format!("{home_claw}.bak"));
            fixes.push(format!("backup-corrupt-config:{home_claw}.bak"));
        }
        let (ok3, _, stderr3) = shell_result("openclaw onboard --yes");
        if ok3 { return StepResult::ok_fixed("config-reset-and-initialized".to_string(), fixes); }
        return StepResult::err_fixed(format!("config-reset-failed: {}", first_line(&stderr3)), fixes);
    }

    // Non-fatal: gateway --allow-unconfigured handles missing config.
    fixes.push("onboard-skipped-non-fatal".to_string());
    StepResult::ok_fixed("config-skipped-using-defaults".to_string(), fixes)
}

// ── Remote deploy (stub) ──────────────────────────────────────────────────────

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
        error: Some("remote-deploy-not-implemented".to_string()),
    }
}

#[tauri::command]
pub async fn get_remote_service_info(
    host: String, port: u16, username: String, password: Option<String>,
) -> crate::types::ServiceInfo {
    let _ = (host, port, username, password);
    crate::types::ServiceInfo {
        name: "openclaw".to_string(),
        status: "unknown".to_string(),
        pid: None, uptime: None, restarts: None,
    }
}

// ── AI provider key configuration ─────────────────────────────────────────────

/// Map a provider ID to the model string used in `openclaw models set <model>`.
///
/// Direct providers (anthropic, openai, zai, minimax) use their own routing prefix.
/// Relay providers (deepseek, moonshot, qwen, …) MUST use the `openrouter/` prefix
/// because OpenClaw routes them through OpenRouter — using a bare `deepseek/…` name
/// causes `FailoverError: Unknown model` since there is no direct DeepSeek connector.
fn provider_default_model(provider: &str) -> Option<&'static str> {
    match provider {
        // ── Direct connectors ────────────────────────────────────────────────
        "anthropic"   => Some("anthropic/claude-sonnet-4-6"),
        "openai"      => Some("openai/gpt-4o"),
        "openrouter"  => Some("openrouter/anthropic/claude-3.5-sonnet"),
        "zai"         => Some("zai/glm-4.7"),
        "minimax"     => Some("minimax/MiniMax-M2.5"),
        // ── Relay providers: route through OpenRouter ────────────────────────
        // These use the `openrouter/<provider>/<model>` form so that OpenClaw
        // looks up the model via the OpenRouter endpoint instead of trying a
        // non-existent direct connector.
        "deepseek"    => Some("openrouter/deepseek/deepseek-chat"),
        "moonshot"    => Some("openrouter/moonshot-ai/moonshot-v1-8k"),
        "qwen"        => Some("openrouter/qwen/qwen-plus"),
        "doubao"      => Some("openrouter/bytedance/doubao-pro-32k"),
        "hunyuan"     => Some("openrouter/tencent/hunyuan-turbos-20250313"),
        "spark"       => Some("openrouter/iflytek/spark-4-ultra"),
        "baichuan"    => Some("openrouter/baichuan-inc/baichuan2-turbo"),
        "stepfun"     => Some("openrouter/stepfun-inc/step-2-16k"),
        "lingyi"      => Some("openrouter/01-ai/yi-large"),
        "siliconflow" => Some("openrouter/meta-llama/llama-3.1-8b-instruct"),
        _             => None,
    }
}

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
            stdin.write_all(api_key.as_bytes()).map_err(|e| format!("stdin-write-failed:{e}"))?;
        }
        child.wait_with_output().map_err(|e| format!("wait-failed:{e}"))
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
                return StepResult::err(format!("paste-token-failed:{}", out.trim()));
            }
        }
        Err(e) => return StepResult::err(e),
    }

    if let Some(model) = provider_default_model(&provider) {
        let set_cmd = format!("openclaw models set {}", model);
        let (ok, out) = run_silent(&set_cmd);
        if ok {
            fixes.push(format!("model-set:{}", model));
        } else {
            fixes.push(format!("model-set-skipped:{}", out.trim().chars().take(80).collect::<String>()));
        }
    }

    StepResult::ok_fixed("api-key-configured".to_string(), fixes)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_default_model_known() {
        assert_eq!(provider_default_model("anthropic"), Some("anthropic/claude-sonnet-4-6"));
        assert_eq!(provider_default_model("openai"), Some("openai/gpt-4o"));
        // Relay providers must use the openrouter/ prefix
        assert_eq!(provider_default_model("deepseek"), Some("openrouter/deepseek/deepseek-chat"));
        assert_eq!(provider_default_model("moonshot"), Some("openrouter/moonshot-ai/moonshot-v1-8k"));
    }

    #[test]
    fn provider_default_model_unknown_returns_none() {
        assert_eq!(provider_default_model("nonexistent_provider"), None);
    }
}
