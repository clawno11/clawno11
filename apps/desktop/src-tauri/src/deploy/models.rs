/// Model routing and auto-selection for OpenClaw deployment.
///
/// Provides model priority tables and auto-selection logic that picks
/// the cheapest configured cloud provider as the default active model.
use crate::platform::{path_join, user_home};
use crate::types::StepResult;

/// Model routing priority:
///   1st — Cloud API (fast, online): ZAI → OpenAI → Anthropic → OpenRouter → other
///   2nd — Local Ollama (fallback, offline only)
///
/// Automatically select the best active model based on what's configured.
///
/// Routing priority (in order):
///   1st — Cheapest configured cloud provider (free-tier first)
///   2nd — Local Ollama (fallback — activates when cloud is unreachable/offline)
///
/// Call this:
///   • After first deployment (`deploy_step_onboard`)
///   • After every gateway restart (`restart_local_service`)
pub fn auto_select_active_model(fixes: &mut Vec<String>) {
    // Parse configured providers — try CLI first, then read auth files directly.
    // CLI may fail on macOS due to GUI app PATH isolation.
    let mut configured: Vec<String> = Vec::new();

    let status_out = crate::platform::shell_output("openclaw models status --json");
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&status_out) {
        if let Some(arr) = v
            .get("auth")
            .and_then(|a| a.get("providers"))
            .and_then(|p| p.as_array())
        {
            for e in arr {
                if let Some(p) = e.get("provider").and_then(|v| v.as_str()) {
                    if !configured.contains(&p.to_string()) {
                        configured.push(p.to_string());
                    }
                }
            }
        }
    }

    // Fallback: read auth-profiles.json files directly
    if configured.is_empty() {
        let home = user_home();
        let oc = path_join(&home, ".openclaw");
        for path in &[
            path_join(&oc, "agents/main/agent/auth-profiles.json"),
            path_join(&oc, "auth-profiles.json"),
        ] {
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(profiles) = doc.get("profiles").and_then(|p| p.as_object()) {
                        for (_key, val) in profiles {
                            if let Some(p) = val.get("provider").and_then(|v| v.as_str()) {
                                if let Some(tok) = val.get("token").and_then(|v| v.as_str()) {
                                    if !tok.is_empty() && !configured.contains(&p.to_string()) {
                                        configured.push(p.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Priority order: free-tier first, then cheapest-paid, then standard/premium.
    let cheapest_priority = [
        "siliconflow",
        "hunyuan",
        "spark", // free tier
        "zai",
        "openrouter", // ultra cheap / free models
        "doubao",
        "minimax",
        "qwen",
        "deepseek", // cheap paid
        "moonshot",
        "lingyi",
        "baichuan",
        "stepfun", // mid-range
        "openai",
        "anthropic", // premium
    ];

    // Find the first configured cloud provider and set its cheapest model as primary.
    let best = cheapest_priority
        .iter()
        .find(|&&p| configured.contains(&p.to_string()));

    if let Some(provider) = best {
        if let Some(model) = provider_cheapest_model(provider) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", model));
            if ok {
                fixes.push(format!("cloud-model-active:{}", model));
            }
            // Also register in fallback chain for transient error retry.
            let _ = super::run_silent(&format!("openclaw models fallbacks add {}", model));
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
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", model_str));
            if ok {
                fixes.push(format!("no-cloud-keys-ollama-active:{}", ollama_model));
            }
        } else {
            fixes.push("no-cloud-keys-no-ollama-models".to_string());
        }
    }
}

/// Map a provider ID to its **cheapest / free-tier** model.
///
/// Used by `auto_select_active_model` to pick the lowest-cost default so
/// users aren't surprised by unexpected charges after first deployment.
pub fn provider_cheapest_model(provider: &str) -> Option<&'static str> {
    match provider {
        // ── Free-tier / ultra-cheap (top priority) ───────────────────────────
        "siliconflow" => Some("openrouter/meta-llama/llama-3.1-8b-instruct"), // free
        "hunyuan" => Some("openrouter/tencent/hunyuan-lite"),                 // free
        "spark" => Some("openrouter/iflytek/spark-lite"),                     // free
        "zai" => Some("zai/glm-4-flash"),                                     // ¥0.1/1M
        "openrouter" => Some("openrouter/meta-llama/llama-3.2-3b-instruct"),  // free
        // ── Cheap paid ───────────────────────────────────────────────────────
        "doubao" => Some("openrouter/bytedance/doubao-lite-32k"), // ¥0.3/1M
        "minimax" => Some("minimax/MiniMax-M2"),                  // ¥0.15/1M
        "deepseek" => Some("openrouter/deepseek/deepseek-chat"),  // ¥1/1M
        "qwen" => Some("openrouter/qwen/qwen-plus"),              // ¥0.5/1M
        "moonshot" => Some("openrouter/moonshot-ai/moonshot-v1-8k"), // ¥12/1M
        "lingyi" => Some("openrouter/01-ai/yi-large"),
        "baichuan" => Some("openrouter/baichuan-inc/baichuan2-turbo"),
        "stepfun" => Some("openrouter/stepfun-inc/step-2-16k"),
        // ── Standard / premium ───────────────────────────────────────────────
        "openai" => Some("openai/gpt-4o-mini"), // cheaper than 4o
        "anthropic" => Some("anthropic/claude-haiku-3"),
        _ => None,
    }
}

/// Map a provider ID to the model string used in `openclaw models set <model>`.
///
/// Direct providers (anthropic, openai, zai, minimax) use their own routing prefix.
/// Relay providers (deepseek, moonshot, qwen, …) MUST use the `openrouter/` prefix
/// because OpenClaw routes them through OpenRouter — using a bare `deepseek/…` name
/// causes `FailoverError: Unknown model` since there is no direct DeepSeek connector.
pub fn provider_default_model(provider: &str) -> Option<&'static str> {
    match provider {
        // ── Direct connectors ────────────────────────────────────────────────
        "anthropic" => Some("anthropic/claude-sonnet-4-6"),
        "openai" => Some("openai/gpt-4o"),
        "openrouter" => Some("openrouter/anthropic/claude-3.5-sonnet"),
        "zai" => Some("zai/glm-4.7"),
        "minimax" => Some("minimax/MiniMax-M2.5"),
        // ── Relay providers: route through OpenRouter ────────────────────────
        "deepseek" => Some("openrouter/deepseek/deepseek-chat"),
        "moonshot" => Some("openrouter/moonshot-ai/moonshot-v1-8k"),
        "qwen" => Some("openrouter/qwen/qwen-plus"),
        "doubao" => Some("openrouter/bytedance/doubao-pro-32k"),
        "hunyuan" => Some("openrouter/tencent/hunyuan-turbos-20250313"),
        "spark" => Some("openrouter/iflytek/spark-4-ultra"),
        "baichuan" => Some("openrouter/baichuan-inc/baichuan2-turbo"),
        "stepfun" => Some("openrouter/stepfun-inc/step-2-16k"),
        "lingyi" => Some("openrouter/01-ai/yi-large"),
        "siliconflow" => Some("openrouter/meta-llama/llama-3.1-8b-instruct"),
        _ => None,
    }
}

/// Restore the cheapest configured model as the active CLI default.
///
/// Used during deployment/restart to ensure the gateway has a valid
/// default model.  Runtime model selection is handled per-request via
/// the WS `agentId` parameter and does not need CLI switching.
#[tauri::command]
pub fn restore_default_model() -> StepResult {
    let mut fixes = Vec::new();
    auto_select_active_model(&mut fixes);
    if fixes.is_empty() {
        StepResult::ok("no-change".into())
    } else {
        StepResult::ok(fixes.join("; "))
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_default_model_known() {
        assert_eq!(
            provider_default_model("anthropic"),
            Some("anthropic/claude-sonnet-4-6")
        );
        assert_eq!(provider_default_model("openai"), Some("openai/gpt-4o"));
        // Relay providers must use the openrouter/ prefix
        assert_eq!(
            provider_default_model("deepseek"),
            Some("openrouter/deepseek/deepseek-chat")
        );
        assert_eq!(
            provider_default_model("moonshot"),
            Some("openrouter/moonshot-ai/moonshot-v1-8k")
        );
    }

    #[test]
    fn provider_default_model_unknown_returns_none() {
        assert_eq!(provider_default_model("nonexistent_provider"), None);
    }
}
