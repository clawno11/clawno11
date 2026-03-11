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
    "ollama",  // local engine — uses placeholder key "ollama-local"
];

// ── Onboard ───────────────────────────────────────────────────────────────────

/// Configure Ollama as a provider in the OpenClaw gateway.
/// OpenClaw discovers Ollama via the OLLAMA_API_KEY environment variable.
/// We set it persistently ("ollama-local" is the conventional placeholder)
/// so the gateway picks it up on next start without any manual user action.
fn configure_ollama_in_gateway(fixes: &mut Vec<String>) {
    // ── 1. Persist OLLAMA_API_KEY so the gateway sees it on every restart ──
    #[cfg(target_os = "windows")]
    let env_ok = {
        // setx writes to the user-level registry (persists across reboots).
        let (ok, _) = run_silent("setx OLLAMA_API_KEY \"ollama-local\"");
        ok
    };
    #[cfg(not(target_os = "windows"))]
    let env_ok = {
        // Append to shell rc files so it survives new terminal sessions.
        let line = "\nexport OLLAMA_API_KEY=\"ollama-local\"\n";
        let home = user_home();
        let mut wrote = false;
        for rc in &[".zshrc", ".bashrc", ".profile"] {
            let path = format!("{}/{}", home, rc);
            if std::path::Path::new(&path).exists() {
                if let Ok(existing) = std::fs::read_to_string(&path) {
                    if !existing.contains("OLLAMA_API_KEY") {
                        let _ = std::fs::OpenOptions::new()
                            .append(true)
                            .open(&path)
                            .and_then(|mut f| { use std::io::Write; f.write_all(line.as_bytes()) });
                        wrote = true;
                    } else {
                        wrote = true; // already set
                    }
                }
            }
        }
        wrote
    };

    if env_ok {
        fixes.push("ollama-env-key-set".to_string());
    } else {
        fixes.push("ollama-env-key-skipped-non-fatal".to_string());
    }

    // ── 2. Also try CLI paste-token (works even if env var approach differs) ──
    let cmd_str = "openclaw models auth paste-token --provider ollama";
    #[cfg(target_os = "windows")]
    let mut c = {
        let mut b = Command::new("cmd");
        b.args(["/C", cmd_str]);
        b.creation_flags(CREATE_NO_WINDOW);
        b
    };
    #[cfg(not(target_os = "windows"))]
    let mut c = {
        let mut b = Command::new("sh");
        b.args(["-c", cmd_str]);
        b
    };
    c.env("PATH", augmented_path())
     .env("OLLAMA_API_KEY", "ollama-local")
     .stdin(std::process::Stdio::piped())
     .stdout(std::process::Stdio::piped())
     .stderr(std::process::Stdio::piped());

    let result = (|| -> Result<bool, String> {
        let mut child = c.spawn().map_err(|e| format!("spawn:{e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(b"ollama-local").map_err(|e| format!("stdin:{e}"))?;
        }
        Ok(child.wait_with_output().map(|o| o.status.success()).unwrap_or(false))
    })();

    match result {
        Ok(true)  => fixes.push("ollama-gateway-configured".to_string()),
        Ok(false) => fixes.push("ollama-gateway-skipped-non-fatal".to_string()),
        Err(e)    => fixes.push(format!("ollama-gateway-error:{}", e)),
    }
}

/// Sync the global auth-profiles.json into every agent directory.
///
/// `openclaw models auth paste-token` writes keys to the global store at
/// `~/.openclaw/auth-profiles.json`, but `openclaw agent --agent main` reads
/// from `~/.openclaw/agents/main/agent/auth-profiles.json`.
/// Without this sync, `configure_api_key` would report success ("已配置") but
/// the chat agent would fail with "No API key found for provider".
fn sync_auth_to_agents(fixes: &mut Vec<String>) {
    let home = user_home();
    let openclaw_dir = path_join(&home, ".openclaw");
    let global_auth = path_join(&openclaw_dir, "auth-profiles.json");

    if !std::path::Path::new(&global_auth).exists() {
        // No global auth file yet — nothing to sync
        return;
    }

    let agents_dir = path_join(&openclaw_dir, "agents");
    let entries = match std::fs::read_dir(&agents_dir) {
        Ok(e) => e,
        Err(_) => return, // No agents directory
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let agent_auth_dir = path_join(
            &entry.path().to_string_lossy(),
            "agent",
        );
        let _ = std::fs::create_dir_all(&agent_auth_dir);
        let dest = path_join(&agent_auth_dir, "auth-profiles.json");
        match std::fs::copy(&global_auth, &dest) {
            Ok(_) => fixes.push(format!(
                "auth-synced:{}",
                entry.file_name().to_string_lossy()
            )),
            Err(e) => fixes.push(format!(
                "auth-sync-failed:{}:{}",
                entry.file_name().to_string_lossy(), e
            )),
        }
    }
}

/// Model routing priority:
///   1st — Cloud API (fast, online): ZAI → OpenAI → Anthropic → OpenRouter → other
///   2nd — Local Ollama (fallback, offline only)
///
/// Cloud model is always set as the active primary. Ollama is only added to
/// the fallback chain so it activates when:
///   a) All cloud providers fail (offline / network error / auth issue)
///   b) User explicitly requests local model in the chat input
///   c) User asks for local model in the ClawNo.11 chat
/// Automatically select the best active model based on what's configured.
///
/// Routing priority (in order):
///   1st — Cheapest configured cloud provider (free-tier first)
///   2nd — Local Ollama (fallback — activates when cloud is unreachable/offline)
///
/// Call this:
///   • After first deployment (`deploy_step_onboard`)
///   • After every gateway restart (`restart_local_service`)
///
/// On restart, any session-level model override the user set in chat is
/// cleared, returning to this default priority.
pub fn auto_select_active_model(fixes: &mut Vec<String>) {
    // Parse configured providers from `openclaw models status --json`.
    let status_out = crate::platform::shell_output("openclaw models status --json");
    let configured: Vec<String> = serde_json::from_str::<serde_json::Value>(&status_out)
        .ok()
        .and_then(|v| {
            v.get("auth")
             .and_then(|a| a.get("providers"))
             .and_then(|p| p.as_array())
             .map(|arr| {
                 arr.iter()
                    .filter_map(|e| e.get("provider").and_then(|v| v.as_str()).map(String::from))
                    .collect()
             })
        })
        .unwrap_or_default();

    // Priority order: free-tier first, then cheapest-paid, then standard/premium.
    // This ensures the user's wallet is protected by default.
    let cheapest_priority = [
        "siliconflow", "hunyuan", "spark",                      // free tier
        "zai", "openrouter",                                     // ultra cheap / free models
        "doubao", "minimax", "qwen", "deepseek",                 // cheap paid
        "moonshot", "lingyi", "baichuan", "stepfun",             // mid-range
        "openai", "anthropic",                                   // premium
    ];

    // Find the first configured cloud provider and set its cheapest model as primary.
    let best = cheapest_priority.iter().find(|&&p| configured.contains(&p.to_string()));

    if let Some(provider) = best {
        if let Some(model) = provider_cheapest_model(provider) {
            let (ok, _) = run_silent(&format!("openclaw models set {}", model));
            if ok {
                fixes.push(format!("cloud-model-active:{}", model));
            }
            // Also register in fallback chain for transient error retry.
            let _ = run_silent(&format!("openclaw models fallbacks add {}", model));
        }
    } else {
        // No cloud providers configured yet.
        // Check if Ollama has a local model and make it the temporary primary.
        let ollama_out = crate::platform::shell_output("curl -s http://localhost:11434/api/tags");
        let first_ollama = serde_json::from_str::<serde_json::Value>(&ollama_out)
            .ok()
            .and_then(|v| {
                v.get("models")
                 .and_then(|m| m.as_array())
                 .and_then(|a| a.first())
                 .and_then(|m| m.get("name"))
                 .and_then(|n| n.as_str())
                 .map(String::from)
            });

        if let Some(ollama_model) = first_ollama {
            let model_str = format!("ollama/{}", ollama_model);
            let (ok, _) = run_silent(&format!("openclaw models set {}", model_str));
            if ok {
                fixes.push(format!("no-cloud-keys-ollama-active:{}", ollama_model));
            }
        } else {
            fixes.push("no-cloud-keys-no-ollama-models".to_string());
        }
    }
}

#[tauri::command]
pub async fn deploy_step_onboard() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();
    let home_claw = path_join(&user_home(), ".openclaw");

    let (ok, stdout, stderr) = shell_result("openclaw onboard --yes");
    let combined = format!("{stdout} {stderr}").to_lowercase();

    if ok || combined.contains("already") || combined.contains("skip") {
        configure_ollama_in_gateway(&mut fixes);
        sync_auth_to_agents(&mut fixes);
        auto_select_active_model(&mut fixes);
        return StepResult::ok_fixed("config-initialized".to_string(), fixes);
    }

    if combined.contains("eacces") || combined.contains("permission") || combined.contains("access denied") {
        let alt_dir = path_join(&data_roaming(), "openclaw");
        let _ = std::fs::create_dir_all(&alt_dir);
        fixes.push(format!("alt-config-dir:{}", alt_dir));
        #[cfg(target_os = "windows")]
        let onboard_cmd = format!("set OPENCLAW_STATE_DIR={alt_dir} && openclaw onboard --yes");
        #[cfg(not(target_os = "windows"))]
        let onboard_cmd = format!("OPENCLAW_STATE_DIR=\"{alt_dir}\" openclaw onboard --yes");
        let (ok2, _, _) = shell_result(&onboard_cmd);
        if ok2 {
            configure_ollama_in_gateway(&mut fixes);
            sync_auth_to_agents(&mut fixes);
            auto_select_active_model(&mut fixes);
            return StepResult::ok_fixed("config-initialized-alt-dir".to_string(), fixes);
        }
    }

    if combined.contains("parse") || combined.contains("invalid") || combined.contains("unexpected token") {
        if std::path::Path::new(&home_claw).exists() {
            let _ = std::fs::rename(&home_claw, format!("{home_claw}.bak"));
            fixes.push(format!("backup-corrupt-config:{home_claw}.bak"));
        }
        let (ok3, _, stderr3) = shell_result("openclaw onboard --yes");
        if ok3 {
            configure_ollama_in_gateway(&mut fixes);
            sync_auth_to_agents(&mut fixes);
            auto_select_active_model(&mut fixes);
            return StepResult::ok_fixed("config-reset-and-initialized".to_string(), fixes);
        }
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

/// Map a provider ID to its **cheapest / free-tier** model.
///
/// Used by `auto_select_active_model` to pick the lowest-cost default so
/// users aren't surprised by unexpected charges after first deployment.
/// Priority: free → cheapest-paid → standard.
pub fn provider_cheapest_model(provider: &str) -> Option<&'static str> {
    match provider {
        // ── Free-tier / ultra-cheap (top priority) ───────────────────────────
        "siliconflow"  => Some("openrouter/meta-llama/llama-3.1-8b-instruct"), // free
        "hunyuan"      => Some("openrouter/tencent/hunyuan-lite"),              // free
        "spark"        => Some("openrouter/iflytek/spark-lite"),                // free
        "zai"          => Some("zai/glm-4-flash"),                              // ¥0.1/1M
        "openrouter"   => Some("openrouter/meta-llama/llama-3.2-3b-instruct"), // free
        // ── Cheap paid ───────────────────────────────────────────────────────
        "doubao"       => Some("openrouter/bytedance/doubao-lite-32k"),         // ¥0.3/1M
        "minimax"      => Some("minimax/MiniMax-M2"),                           // ¥0.15/1M
        "deepseek"     => Some("openrouter/deepseek/deepseek-chat"),            // ¥1/1M
        "qwen"         => Some("openrouter/qwen/qwen-plus"),                    // ¥0.5/1M
        "moonshot"     => Some("openrouter/moonshot-ai/moonshot-v1-8k"),        // ¥12/1M
        "lingyi"       => Some("openrouter/01-ai/yi-large"),
        "baichuan"     => Some("openrouter/baichuan-inc/baichuan2-turbo"),
        "stepfun"      => Some("openrouter/stepfun-inc/step-2-16k"),
        // ── Standard / premium ───────────────────────────────────────────────
        "openai"       => Some("openai/gpt-4o-mini"),                           // cheaper than 4o
        "anthropic"    => Some("anthropic/claude-haiku-3"),
        _              => None,
    }
}

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

    // `openclaw models auth paste-token` writes to the GLOBAL auth store
    // (~/.openclaw/auth-profiles.json), but `openclaw agent` reads from an
    // AGENT-SPECIFIC store (~/.openclaw/agents/main/agent/auth-profiles.json).
    // Sync the global file to all agent directories so the key is found at runtime.
    sync_auth_to_agents(&mut fixes);

    if let Some(model) = provider_default_model(&provider) {
        // Set as the active default model.
        let set_cmd = format!("openclaw models set {}", model);
        let (ok, out) = run_silent(&set_cmd);
        if ok {
            fixes.push(format!("model-set:{}", model));
        } else {
            fixes.push(format!("model-set-skipped:{}", out.trim().chars().take(80).collect::<String>()));
        }

        // Always register this model in the fallback chain so that if the
        // primary model fails (e.g. rate-limit, auth error, quota exhausted),
        // OpenClaw can automatically retry with the next available model.
        let fb_cmd = format!("openclaw models fallbacks add {}", model);
        let (fb_ok, fb_out) = run_silent(&fb_cmd);
        if fb_ok {
            fixes.push(format!("fallback-added:{}", model));
        } else {
            fixes.push(format!("fallback-add-skipped:{}", fb_out.trim().chars().take(60).collect::<String>()));
        }
    }

    StepResult::ok_fixed("api-key-configured".to_string(), fixes)
}

// ── Model config auto-fix ─────────────────────────────────────────────────────

/// Run on app startup: detect missing-auth models, auto-switch default,
/// and build the fallback chain from all providers that have auth configured.
///
/// Returns a summary string for telemetry / logging only.
#[tauri::command]
pub fn fix_model_config() -> String {
    let (ok, out) = run_silent("openclaw models");
    if !ok {
        return format!("skip:openclaw-not-ready");
    }

    // ── 1. Collect models that have auth (from "Providers w/ OAuth/tokens" line) ──
    let mut auth_providers: Vec<&str> = Vec::new();
    for line in out.lines() {
        if line.trim_start().starts_with("- ") {
            // e.g. "- zai effective=..." — extract provider name before the space
            let rest = line.trim_start_matches("- ").trim();
            if let Some(pname) = rest.split_whitespace().next() {
                // strip trailing colon if present
                let p = pname.trim_end_matches(':');
                if !p.is_empty() && !auth_providers.contains(&p) {
                    auth_providers.push(p);
                }
            }
        }
    }

    // ── 2. Check if current default model has auth ────────────────────────────
    let default_model = out.lines()
        .find(|l| l.trim_start().starts_with("Default"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let default_provider = default_model.split('/').next().unwrap_or("").to_string();

    // "openrouter/X/Y" prefix — route through openrouter which counts as having auth
    let default_has_auth = auth_providers.contains(&default_provider.as_str())
        || default_provider == "openrouter";

    let mut actions: Vec<String> = Vec::new();

    // ── 3. If default has no auth, switch to first model with auth ────────────
    if !default_has_auth && !auth_providers.is_empty() {
        // Pick the best available model for each known auth provider
        let candidate = auth_providers.iter().find_map(|&p| provider_default_model(p));
        if let Some(new_model) = candidate {
            let (ok2, _) = run_silent(&format!("openclaw models set {}", new_model));
            if ok2 {
                actions.push(format!("switched-default:{}", new_model));
            }
        }
    }

    // ── 4. Ensure every auth-bearing provider is in the fallback chain ────────
    for p in &auth_providers {
        if let Some(model) = provider_default_model(p) {
            let (ok3, _) = run_silent(&format!("openclaw models fallbacks add {}", model));
            if ok3 {
                actions.push(format!("fallback-ensured:{}", model));
            }
        }
    }

    if actions.is_empty() {
        "ok:no-changes-needed".to_string()
    } else {
        actions.join(";")
    }
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
