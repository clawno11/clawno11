use crate::platform::{path_join, shell_output, user_home};

/// Query OpenClaw for auth store path and config path.
/// Returns (auth_store_path, config_path).
fn locate_auth_files() -> (String, String) {
    let out = shell_output("openclaw models status --json");
    let v: serde_json::Value = serde_json::from_str(&out).unwrap_or_default();

    let store_path = v
        .get("auth")
        .and_then(|a| a.get("storePath"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    let config_path = v
        .get("configPath")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    (store_path, config_path)
}

/// Fallback paths when CLI query fails (e.g. OpenClaw not yet onboarded).
fn fallback_auth_paths() -> (String, String) {
    let home = user_home();
    let store = path_join(&home, ".openclaw/agents/main/agent/auth-profiles.json");
    let config = path_join(&home, ".openclaw/openclaw.json");
    (store, config)
}

/// Write a provider key into OpenClaw's auth system.
///
/// Mirrors what `openclaw models auth paste-token` does internally:
///   1. Upsert credential in `auth-profiles.json`  (the actual token)
///   2. Upsert skeleton in `openclaw.json`          (provider + mode, no secret)
pub(super) fn write_provider_key(provider: &str, api_key: &str, fixes: &mut Vec<String>) {
    let (store_path, config_path) = locate_auth_files();
    let (store_path, config_path) = if store_path.is_empty() || config_path.is_empty() {
        let fb = fallback_auth_paths();
        fixes.push("auth-paths-from-fallback".into());
        fb
    } else {
        fixes.push(format!("auth-store:{}", store_path));
        (store_path, config_path)
    };

    // Ensure parent dirs exist
    if let Some(parent) = std::path::Path::new(&store_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // ── Step 1: auth-profiles.json ──
    let profile_key = format!("{provider}:manual");

    let mut store: serde_json::Value = std::fs::read_to_string(&store_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({ "version": 1, "profiles": {} }));

    let profiles = store.as_object_mut().and_then(|o| {
        o.entry("profiles")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
    });

    if let Some(profiles) = profiles {
        if let Some(existing) = profiles.get_mut(&profile_key) {
            // Slot exists — only update the token value
            existing["token"] = serde_json::json!(api_key);
            if existing.get("type").is_none() {
                existing["type"] = serde_json::json!("token");
            }
            if existing.get("provider").is_none() {
                existing["provider"] = serde_json::json!(provider);
            }
        } else {
            // Slot doesn't exist — create full entry
            profiles.insert(
                profile_key.clone(),
                serde_json::json!({
                    "type": "token",
                    "provider": provider,
                    "token": api_key
                }),
            );
        }
    }

    // Update lastGood
    if let Some(obj) = store.as_object_mut() {
        let last_good = obj
            .entry("lastGood")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(lg) = last_good.as_object_mut() {
            lg.insert(provider.to_string(), serde_json::json!(profile_key));
        }
    }

    match std::fs::write(
        &store_path,
        serde_json::to_string_pretty(&store).unwrap_or_default(),
    ) {
        Ok(_) => fixes.push(format!("auth-profiles-written:{provider}")),
        Err(e) => {
            fixes.push(format!("auth-profiles-write-failed:{e}"));
            return;
        }
    }

    // ── Step 2: openclaw.json (skeleton) ──
    let mut cfg: serde_json::Value = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let auth_profiles = cfg
        .as_object_mut()
        .and_then(|o| {
            o.entry("auth")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
        })
        .and_then(|auth| {
            auth.entry("profiles")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
        });

    if let Some(ap) = auth_profiles {
        if !ap.contains_key(&profile_key) {
            ap.insert(
                profile_key.clone(),
                serde_json::json!({
                    "provider": provider,
                    "mode": "token"
                }),
            );
        }
    }

    match std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&cfg).unwrap_or_default(),
    ) {
        Ok(_) => fixes.push(format!("openclaw-json-updated:{provider}")),
        Err(e) => fixes.push(format!("openclaw-json-update-failed:{e}")),
    }
}

/// Configure Ollama as a provider in the OpenClaw gateway.
pub(super) fn configure_ollama_in_gateway(fixes: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let (ok, _) = super::run_silent("setx OLLAMA_API_KEY \"ollama-local\"");
        if ok {
            fixes.push("ollama-env-key-set".into());
        } else {
            fixes.push("ollama-env-key-skipped-non-fatal".into());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let line = "\nexport OLLAMA_API_KEY=\"ollama-local\"\n";
        let home = user_home();
        let mut wrote = false;
        for rc in &[
            ".zshrc",
            ".bashrc",
            ".zprofile",
            ".bash_profile",
            ".profile",
        ] {
            let path = format!("{}/{}", home, rc);
            if std::path::Path::new(&path).exists() {
                if let Ok(existing) = std::fs::read_to_string(&path) {
                    if !existing.contains("OLLAMA_API_KEY") {
                        let _ = std::fs::OpenOptions::new()
                            .append(true)
                            .open(&path)
                            .and_then(|mut f| {
                                use std::io::Write;
                                f.write_all(line.as_bytes())
                            });
                    }
                    wrote = true;
                }
            }
        }
        if wrote {
            fixes.push("ollama-env-key-set".into());
        } else {
            fixes.push("ollama-env-key-skipped-non-fatal".into());
        }
    }

    write_provider_key("ollama", "ollama-local", fixes);
}
