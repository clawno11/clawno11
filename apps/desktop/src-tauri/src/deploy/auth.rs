use crate::platform::{augmented_path, path_join, user_home};
/// Auth file management for OpenClaw deployment.
///
/// Handles writing provider API keys to the correct auth-profiles.json
/// locations and syncing them between global and agent directories.
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Configure Ollama as a provider in the OpenClaw gateway.
/// OpenClaw discovers Ollama via the OLLAMA_API_KEY environment variable.
/// We set it persistently ("ollama-local" is the conventional placeholder)
/// so the gateway picks it up on next start without any manual user action.
pub(super) fn configure_ollama_in_gateway(fixes: &mut Vec<String>) {
    // ── 1. Persist OLLAMA_API_KEY so the gateway sees it on every restart ──
    #[cfg(target_os = "windows")]
    let env_ok = {
        // setx writes to the user-level registry (persists across reboots).
        let (ok, _) = super::run_silent("setx OLLAMA_API_KEY \"ollama-local\"");
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
                            .and_then(|mut f| {
                                use std::io::Write;
                                f.write_all(line.as_bytes())
                            });
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
            stdin
                .write_all(b"ollama-local")
                .map_err(|e| format!("stdin:{e}"))?;
        }
        Ok(child
            .wait_with_output()
            .map(|o| o.status.success())
            .unwrap_or(false))
    })();

    match result {
        Ok(true) => fixes.push("ollama-gateway-configured".to_string()),
        Ok(false) => fixes.push("ollama-gateway-skipped-non-fatal".to_string()),
        Err(e) => fixes.push(format!("ollama-gateway-error:{}", e)),
    }

    // Guarantee the ollama key is also written to the agent auth file.
    // paste-token may write to a location the agent doesn't read from.
    ensure_auth_in_agent_file("ollama", "ollama-local", fixes);
}

/// Ensure auth-profiles.json exists in the main agent directory.
///
/// `paste-token` may write to a global store that the agent runtime doesn't
/// read from.  On some openclaw versions the `agents/main/agent/` directory
/// isn't even created by `onboard`.  This function:
///   1. Creates the directory tree if missing.
///   2. Copies auth from WHEREVER it exists (global → agent, or agent → global).
///   3. If neither exists, does nothing (auth hasn't been configured yet).
pub(super) fn sync_auth_to_agents(fixes: &mut Vec<String>) {
    let home = user_home();
    let oc = path_join(&home, ".openclaw");
    let global = path_join(&oc, "auth-profiles.json");
    let agent_dir = path_join(&oc, "agents/main/agent");
    let agent_auth = path_join(&agent_dir, "auth-profiles.json");

    let g_exists = std::path::Path::new(&global).exists();
    let a_exists = std::path::Path::new(&agent_auth).exists();

    // Ensure the agent directory tree exists regardless
    let _ = std::fs::create_dir_all(&agent_dir);

    if g_exists && !a_exists {
        // global → agent
        if std::fs::copy(&global, &agent_auth).is_ok() {
            fixes.push("auth-synced:global-to-agent".to_string());
        }
    } else if !g_exists && a_exists {
        // agent → global (so next sync / list_configured_providers sees it)
        if std::fs::copy(&agent_auth, &global).is_ok() {
            fixes.push("auth-synced:agent-to-global".to_string());
        }
    } else if g_exists && a_exists {
        // Both exist — pick the one with more content (more providers configured)
        let g_len = std::fs::metadata(&global).map(|m| m.len()).unwrap_or(0);
        let a_len = std::fs::metadata(&agent_auth).map(|m| m.len()).unwrap_or(0);
        if g_len > a_len {
            let _ = std::fs::copy(&global, &agent_auth);
            fixes.push("auth-synced:global-larger".to_string());
        } else if a_len > g_len {
            let _ = std::fs::copy(&agent_auth, &global);
            fixes.push("auth-synced:agent-larger".to_string());
        }
    }
    // Neither exists → nothing to sync yet

    // Also sync to any other agent directories (custom agents)
    let agents_dir = path_join(&oc, "agents");
    let source = if std::path::Path::new(&agent_auth).exists() {
        &agent_auth
    } else if std::path::Path::new(&global).exists() {
        &global
    } else {
        return;
    };
    if let Ok(entries) = std::fs::read_dir(&agents_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "main" {
                continue;
            } // already handled
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let dest_dir = path_join(&entry.path().to_string_lossy(), "agent");
            let _ = std::fs::create_dir_all(&dest_dir);
            let dest = path_join(&dest_dir, "auth-profiles.json");
            let _ = std::fs::copy(source, &dest);
        }
    }
}

/// Directly write a provider's API key into the agent auth-profiles.json file.
/// This is the nuclear option — guarantees the key ends up in the right place
/// even if `openclaw models auth paste-token` writes to the wrong location
/// or fails to create the directory.
pub(super) fn ensure_auth_in_agent_file(provider: &str, api_key: &str, fixes: &mut Vec<String>) {
    let home = user_home();
    let agent_dir = path_join(&home, ".openclaw/agents/main/agent");
    let agent_auth = path_join(&agent_dir, "auth-profiles.json");

    let _ = std::fs::create_dir_all(&agent_dir);

    // Read existing file or start fresh
    let mut doc: serde_json::Value = std::fs::read_to_string(&agent_auth)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "version": 1,
                "profiles": {},
                "lastGood": {}
            })
        });

    // Insert the provider key
    let profile_key = format!("{provider}:manual");
    if let Some(profiles) = doc.get_mut("profiles").and_then(|p| p.as_object_mut()) {
        profiles.insert(
            profile_key.clone(),
            serde_json::json!({
                "type": "token",
                "provider": provider,
                "token": api_key
            }),
        );
    }
    if let Some(last_good) = doc.get_mut("lastGood").and_then(|l| l.as_object_mut()) {
        last_good.insert(provider.to_string(), serde_json::json!(profile_key));
    }

    // Write back
    match std::fs::write(
        &agent_auth,
        serde_json::to_string_pretty(&doc).unwrap_or_default(),
    ) {
        Ok(_) => fixes.push(format!("auth-direct-write:{provider}")),
        Err(e) => fixes.push(format!("auth-direct-write-failed:{provider}:{e}")),
    }

    // Also write to global location for consistency
    let global = path_join(&home, ".openclaw/auth-profiles.json");
    let _ = std::fs::copy(&agent_auth, &global);
}
