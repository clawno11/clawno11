/// Model routing and auto-selection for OpenClaw deployment.
///
/// Model names come from OpenClaw's own catalog (`openclaw models list --all`),
/// never from hardcoded tables.  ClawNo.11's role is limited to:
///   - Initial setup: pick a working model after first deployment
///   - Repair: detect broken/unknown models and switch to a valid alternative
use crate::types::StepResult;

/// Query OpenClaw for the current model configuration.
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

/// Query the real model catalog for a specific provider.
/// Runs `openclaw models list --all --provider {provider} --plain`
/// and returns the list of valid model keys (e.g. ["zai/glm-4.7", "zai/glm-4.5"]).
fn query_catalog_models(provider: &str) -> Vec<String> {
    if !is_safe_model_name(provider) {
        return vec![];
    }
    let out = crate::platform::shell_output(&format!(
        "openclaw models list --all --provider {} --plain",
        provider
    ));
    out.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && is_safe_model_name(l))
        .collect()
}

/// Check if a model key actually exists in the catalog.
fn model_exists_in_catalog(model: &str) -> bool {
    let provider = model_provider(model);
    if provider.is_empty() {
        return false;
    }
    let catalog = query_catalog_models(provider);
    catalog.iter().any(|m| m == model)
}

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

fn model_provider(model: &str) -> &str {
    model.split('/').next().unwrap_or("")
}

fn current_model_is_valid(current: &str, providers: &[String]) -> bool {
    if current.is_empty() {
        return false;
    }
    if current.starts_with("ollama/") {
        return true;
    }
    let prov = model_provider(current);
    providers.iter().any(|p| p.as_str() == prov)
}

/// True when at least one non-Ollama provider has auth configured.
fn has_cloud_providers(providers: &[String]) -> bool {
    providers.iter().any(|p| p != "ollama")
}

/// Pick the first valid catalog model from providers that have auth configured.
/// This queries the REAL catalog, not the `allowed` list (which may contain bad names).
fn pick_model_from_catalog(providers: &[String]) -> Option<String> {
    for provider in providers {
        if provider == "ollama" {
            continue;
        }
        let catalog = query_catalog_models(provider);
        if let Some(model) = catalog.first() {
            return Some(model.clone());
        }
    }
    None
}

/// Remove the model allowlist so users can freely switch to any model.
///
/// OpenClaw's `openclaw configure` wizard creates an allowlist by default,
/// which blocks models not explicitly added. For private deployments this
/// is unnecessarily restrictive — clear it once during initial setup.
pub fn clear_model_allowlist(fixes: &mut Vec<String>) {
    let (ok, out) = super::run_silent("openclaw config set agents.defaults.models {}");
    if ok {
        fixes.push("model-allowlist-cleared".to_string());
    } else {
        fixes.push(format!(
            "model-allowlist-clear-failed:{}",
            out.chars().take(120).collect::<String>()
        ));
    }
}

/// Automatically select the best active model based on what OpenClaw
/// actually has configured.
///
/// Called after first deployment (`deploy_step_onboard`), on startup
/// (`fix_model_config`), and after a new API key is configured.
///
/// Cloud providers always take priority over Ollama.  If the current
/// default is an Ollama model but a cloud provider with a valid catalog
/// model is available, we upgrade to the cloud model automatically.
pub fn auto_select_active_model(fixes: &mut Vec<String>) {
    clear_model_allowlist(fixes);
    let (_allowed, providers, current) = query_openclaw_models();

    // Ollama is fallback-only: upgrade to cloud whenever possible.
    if current.starts_with("ollama/") && has_cloud_providers(&providers) {
        if let Some(cloud) = pick_model_from_catalog(&providers) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", cloud));
            if ok {
                fixes.push(format!("upgraded-from-ollama-to-cloud:{}", cloud));
                let _ = super::run_silent(&format!("openclaw models fallbacks add {}", cloud));
                return;
            }
            fixes.push(format!("cloud-upgrade-failed:{}", cloud));
        }
        // Cloud catalog empty despite having providers — keep Ollama for now
    }

    // If current model is valid AND exists in catalog, keep it
    if current_model_is_valid(&current, &providers) && model_exists_in_catalog(&current) {
        fixes.push("current-model-valid-keeping".to_string());
        return;
    }

    // Current model is invalid/unknown — pick from real catalog
    if let Some(model) = pick_model_from_catalog(&providers) {
        let (ok, _) = super::run_silent(&format!("openclaw models set {}", model));
        if ok {
            fixes.push(format!("cloud-model-active:{}", model));
            let _ = super::run_silent(&format!("openclaw models fallbacks add {}", model));
            return;
        }
        fixes.push(format!("cloud-model-set-failed:{}", model));
    }

    // No cloud models — try Ollama
    let ollama_catalog = query_catalog_models("ollama");
    if let Some(ollama) = ollama_catalog.first() {
        let (ok, _) = super::run_silent(&format!("openclaw models set {}", ollama));
        if ok {
            fixes.push(format!("fallback-ollama-active:{}", ollama));
            return;
        }
    }

    if providers.is_empty() {
        fixes.push("no-configured-providers".to_string());
    } else {
        fixes.push("no-catalog-models-found".to_string());
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
/// Strategy:
///   1. Get current active model from the running agent
///   2. Validate it exists in the real catalog
///   3. If broken, pick a valid alternative from the catalog
///   4. Remove broken Ollama models from the fallback chain
#[tauri::command]
pub async fn repair_model_config(port: u16) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    let current = crate::gateway::get_main_agent_model(port)
        .await
        .unwrap_or_default();

    let (allowed, providers, _cfg_default) = query_openclaw_models();

    let mut need_switch = false;

    if current.is_empty() {
        fixes.push("detected:no-active-model".to_string());
        need_switch = true;
    } else if current.starts_with("ollama/") {
        // Ollama is fallback-only: upgrade to cloud when a provider is available
        if has_cloud_providers(&providers) {
            fixes.push(format!("detected:ollama-with-cloud-available:{}", current));
            need_switch = true;
        } else {
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
        }
    } else if !model_exists_in_catalog(&current) {
        fixes.push(format!("detected:unknown-model:{}", current));
        need_switch = true;
    } else if !current_model_is_valid(&current, &providers) {
        fixes.push(format!(
            "detected:no-auth-for-provider:{}",
            model_provider(&current)
        ));
        need_switch = true;
    }

    // Scan fallback chain for broken Ollama models
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

    if need_switch {
        // Pick from real catalog, only providers with auth
        let switched = if let Some(model) = pick_model_from_catalog(&providers) {
            let (ok, _) = super::run_silent(&format!("openclaw models set {}", model));
            if ok {
                fixes.push(format!("switched-to:{}", model));
            }
            ok
        } else {
            let ollama_catalog = query_catalog_models("ollama");
            if let Some(ollama) = ollama_catalog.first() {
                let (ok, _) = super::run_silent(&format!("openclaw models set {}", ollama));
                if ok {
                    fixes.push(format!("switched-to-ollama:{}", ollama));
                }
                ok
            } else {
                fixes.push("no-models-available-to-switch".to_string());
                false
            }
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
    fn model_provider_extracts_prefix() {
        assert_eq!(model_provider("zai/glm-4.7"), "zai");
        assert_eq!(model_provider("ollama/gemma3:4b"), "ollama");
        assert_eq!(model_provider(""), "");
    }

    #[test]
    fn safe_model_name_rejects_shell_chars() {
        assert!(is_safe_model_name("zai/glm-4.7"));
        assert!(!is_safe_model_name("foo;bar"));
        assert!(!is_safe_model_name(""));
    }

    #[test]
    fn has_cloud_providers_ignores_ollama() {
        assert!(!has_cloud_providers(&[]));
        assert!(!has_cloud_providers(&["ollama".into()]));
        assert!(has_cloud_providers(&["zai".into()]));
        assert!(has_cloud_providers(&["ollama".into(), "zai".into()]));
    }
}
