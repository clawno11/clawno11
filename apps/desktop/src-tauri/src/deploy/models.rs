/// Model routing and auto-selection for OpenClaw deployment.
///
/// All model selection is **dynamic** — we query OpenClaw's own configuration
/// via `openclaw models status --json` to discover available models and
/// providers.  No hardcoded model-name mappings are maintained here because:
///
///   1. OpenClaw manages its own model registry (names change across versions)
///   2. Hardcoded tables go stale and cause "Unknown model" errors
///   3. OpenClaw's agent can switch models via natural language instructions
///
/// ClawNo.11's role is limited to:
///   - Initial setup: pick a non-Ollama model from the configured list
///   - Repair: detect broken models and switch to a working alternative
use crate::types::StepResult;

/// Query OpenClaw for the current model configuration.
///
/// Returns (allowed_models, configured_providers, current_default).
fn query_openclaw_models() -> (Vec<String>, Vec<String>, String) {
    let out = crate::platform::shell_output("openclaw models status --json");
    let v: serde_json::Value = match serde_json::from_str(&out) {
        Ok(v) => v,
        Err(_) => return (vec![], vec![], String::new()),
    };

    let allowed: Vec<String> = v
        .get("allowed")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

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

    let default_model = v
        .get("defaultModel")
        .and_then(|d| d.as_str())
        .unwrap_or("")
        .to_string();

    (allowed, providers, default_model)
}

/// Reject model names that contain shell metacharacters.
fn is_safe_model_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(|c: char| {
            c.is_whitespace()
                || c == ';'
                || c == '|'
                || c == '&'
                || c == '`'
                || c == '$'
                || c == '\''
                || c == '"'
        })
}

/// Pick the first non-Ollama cloud model from the allowed list.
fn first_cloud_model(allowed: &[String]) -> Option<&str> {
    allowed
        .iter()
        .map(|s| s.as_str())
        .find(|m| !m.starts_with("ollama/") && is_safe_model_name(m))
}

/// Automatically select the best active model based on what OpenClaw
/// actually has configured.
///
/// Strategy: query `openclaw models status --json` for the allowed model
/// list, then pick the first non-Ollama cloud model.  If no cloud models
/// exist, fall back to the first available Ollama model.
///
/// Call this:
///   - After first deployment (`deploy_step_onboard`)
///   - After every gateway restart (`restart_local_service`)
pub fn auto_select_active_model(fixes: &mut Vec<String>) {
    let (allowed, _providers, _current) = query_openclaw_models();

    if allowed.is_empty() {
        fixes.push("no-models-configured".to_string());
        return;
    }

    // Prefer any cloud model over local Ollama
    if let Some(cloud) = first_cloud_model(&allowed) {
        let (ok, _) = super::run_silent(&format!("openclaw models set {}", cloud));
        if ok {
            fixes.push(format!("cloud-model-active:{}", cloud));
            let _ = super::run_silent(&format!("openclaw models fallbacks add {}", cloud));
            return;
        }
        fixes.push(format!("cloud-model-set-failed:{}", cloud));
    }

    // No cloud models or cloud set failed — try the first available model
    if let Some(fallback) = allowed.iter().find(|m| is_safe_model_name(m)) {
        let (ok, _) = super::run_silent(&format!("openclaw models set {}", fallback));
        if ok {
            fixes.push(format!("fallback-model-active:{}", fallback));
        }
    }
}

/// After a new API key is configured, pick a model for that provider
/// from OpenClaw's actual allowed list (not from a hardcoded table).
pub fn select_model_for_provider(provider: &str, fixes: &mut Vec<String>) {
    let (allowed, _providers, _current) = query_openclaw_models();

    // Find a model whose prefix matches the provider name
    let candidate = allowed
        .iter()
        .find(|m| m.starts_with(&format!("{}/", provider)));

    if let Some(model) = candidate {
        let (ok, _) = super::run_silent(&format!("openclaw models set {}", model));
        if ok {
            fixes.push(format!("model-set:{}", model));
        }
        let (fb_ok, _) = super::run_silent(&format!("openclaw models fallbacks add {}", model));
        if fb_ok {
            fixes.push(format!("fallback-added:{}", model));
        }
    } else {
        // Provider might use a different prefix in the model name.
        // Fall back to picking any cloud model.
        if let Some(cloud) = first_cloud_model(&allowed) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", cloud));
            if ok {
                fixes.push(format!("model-set-fallback:{}", cloud));
            }
        }
    }
}

/// Restore a working model as the active CLI default.
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

/// Diagnose and repair a broken model configuration.
///
/// Typical scenario: user tried a local Ollama model that doesn't support
/// tool calling, or switched to a model name OpenClaw doesn't recognize.
///
/// Strategy:
///   1. Query OpenClaw for the current model and the full allowed list
///   2. If the current model is Ollama, check tool-calling support
///   3. If broken, pick an alternative from the allowed list (cloud first)
///   4. Remove broken Ollama models from the fallback chain
#[tauri::command]
pub async fn repair_model_config(port: u16) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // ── 1. Get current active model from the running agent ──
    let current = crate::gateway::get_main_agent_model(port)
        .await
        .unwrap_or_default();

    // ── 2. Get the full allowed model list from OpenClaw ──
    let (allowed, _providers, _cfg_default) = query_openclaw_models();

    // ── 3. Diagnose the current model ──
    let mut need_switch = false;

    if current.is_empty() {
        fixes.push("detected:no-active-model".to_string());
        need_switch = true;
    } else if current.starts_with("ollama/") {
        let ollama_name = current.trim_start_matches("ollama/");
        match crate::ollama::ollama_model_supports_tools(ollama_name).await {
            Ok(false) => {
                fixes.push(format!("detected:no-tool-support:{}", current));
                need_switch = true;
            }
            Err(e) => {
                fixes.push(format!("detected:ollama-unreachable:{}", e));
                need_switch = true;
            }
            Ok(true) => {}
        }
    } else if !allowed.contains(&current) && !allowed.is_empty() {
        fixes.push(format!("detected:model-not-in-allowed-list:{}", current));
        need_switch = true;
    }

    // ── 4. Scan fallback chain for broken Ollama models ──
    for model in &allowed {
        if !model.starts_with("ollama/") {
            continue;
        }
        let name = model.trim_start_matches("ollama/");
        if let Ok(false) = crate::ollama::ollama_model_supports_tools(name).await {
            let _ = super::run_silent(&format!("openclaw models fallbacks remove {}", model));
            fixes.push(format!("removed-broken-fallback:{}", model));
        }
    }

    // ── 5. Switch to a working model and restart the gateway ──
    if need_switch {
        let switched = if let Some(cloud) = first_cloud_model(&allowed) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", cloud));
            if ok {
                fixes.push(format!("switched-to:{}", cloud));
            }
            ok
        } else if let Some(fallback) = allowed.iter().find(|m| is_safe_model_name(m)) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", fallback));
            if ok {
                fixes.push(format!("switched-to-only-available:{}", fallback));
            }
            ok
        } else {
            fixes.push("no-models-available-to-switch".to_string());
            false
        };

        if switched {
            crate::pm2::run_pm2(&["restart", "openclaw"]);
            fixes.push("gateway-restarted".to_string());
        }
    }

    if fixes.is_empty() {
        StepResult::ok("no-repair-needed".to_string())
    } else {
        StepResult::ok(fixes.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_cloud_model_skips_ollama() {
        let models = vec![
            "ollama/gemma3:4b".to_string(),
            "zhipu/glm-4-flash".to_string(),
            "openai/gpt-4o".to_string(),
        ];
        assert_eq!(first_cloud_model(&models), Some("zhipu/glm-4-flash"));
    }

    #[test]
    fn first_cloud_model_returns_none_when_only_ollama() {
        let models = vec!["ollama/gemma3:4b".to_string()];
        assert_eq!(first_cloud_model(&models), None);
    }

    #[test]
    fn first_cloud_model_empty() {
        let models: Vec<String> = vec![];
        assert_eq!(first_cloud_model(&models), None);
    }
}
