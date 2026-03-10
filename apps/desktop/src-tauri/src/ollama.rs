/// Ollama local model engine — install, status check, model pull/delete.
///
/// Architecture:
///   Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1/
///   so it slots into the existing OpenClaw routing with zero chat-layer changes.
///
///   Install strategy (silent, user-invisible):
///     macOS  → brew install ollama, fallback: official curl script
///     Windows → winget install Ollama.Ollama
///     Linux  → official curl script
///
///   Model pull progress is streamed line-by-line from POST /api/pull
///   and forwarded to the frontend as "ollama-pull-progress" Tauri events.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::platform::{augmented_path, shell_result};
use crate::types::StepResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    /// File size in bytes.
    pub size: u64,
    pub modified_at: String,
}

#[derive(Serialize, Clone)]
pub struct OllamaPullProgress {
    pub model: String,
    pub status: String,
    /// 0–100 download percentage.
    pub percent: f32,
    /// True when pull is complete (success or error).
    pub done: bool,
    pub error: Option<String>,
}

// ── Ollama REST API response shapes ──────────────────────────────────────────

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelRaw>,
}

#[derive(Deserialize)]
struct OllamaModelRaw {
    name: String,
    size: u64,
    modified_at: String,
}

#[derive(Deserialize)]
struct OllamaPullChunk {
    status: String,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    completed: u64,
    error: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build a short-timeout reqwest client for health checks.
fn quick_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default()
}

/// Build a long-timeout client for model pulls (large files).
fn long_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .unwrap_or_default()
}

async fn server_is_running() -> bool {
    quick_client()
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .is_ok()
}

/// Spawn `ollama serve` as a detached background process.
fn spawn_ollama_serve() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("ollama")
            .arg("serve")
            .env("PATH", augmented_path())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("ollama")
            .arg("serve")
            .env("PATH", augmented_path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Return Ollama installation and server status.
#[tauri::command]
pub async fn ollama_check_status() -> OllamaStatus {
    // Try PATH first to get the version string; also probe known install dirs.
    let (ok_path, out, _) = shell_result("ollama --version");
    let (installed, version) = if ok_path {
        let ver = out.lines().next().map(|l| l.trim().to_string());
        (true, ver)
    } else if ollama_binary_exists() {
        // Binary found in a non-PATH location (e.g. just installed, PATH not refreshed yet).
        (true, None)
    } else {
        (false, None)
    };

    let running = if installed { server_is_running().await } else { false };

    OllamaStatus { installed, running, version }
}

/// Silently install the Ollama engine if not already present.
/// Called in the background after OpenClaw deployment succeeds.
#[tauri::command]
pub async fn ollama_ensure_installed() -> StepResult {
    // Check multiple locations — winget/direct-installer may not update PATH until restart.
    if ollama_binary_exists() {
        return StepResult::ok("ollama-already-installed".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // Homebrew is the most reliable path on macOS.
        let (brew_ok, _, _) = shell_result("brew install ollama");
        if brew_ok {
            return StepResult::ok("ollama-installed-brew".to_string());
        }
        // Fallback: official install script.
        let (sh_ok, _, err) = shell_result("curl -fsSL https://ollama.com/install.sh | sh");
        if sh_ok {
            return StepResult::ok("ollama-installed-script".to_string());
        }
        return StepResult::err(format!(
            "ollama-install-failed:{}",
            err.lines().next().unwrap_or("unknown")
        ));
    }

    #[cfg(target_os = "windows")]
    {
        // Strategy 1: winget — async so we don't block the tokio runtime.
        // Accept exit codes 0 (success) and 3010 (success, restart required).
        let winget_ok = tokio::process::Command::new("winget")
            .args([
                "install", "Ollama.Ollama",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .env("PATH", augmented_path())
            .output()
            .await
            .map(|o| {
                let code = o.status.code().unwrap_or(-1);
                code == 0 || code == 3010
            })
            .unwrap_or(false);

        if winget_ok || ollama_binary_exists() {
            return StepResult::ok("ollama-installed-winget".to_string());
        }

        // Strategy 2: download the official installer and run silently.
        let tmp = std::env::temp_dir().join("OllamaSetup.exe");

        let dl_result = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_default()
            .get("https://ollama.com/download/OllamaSetup.exe")
            .send()
            .await;

        let resp = match dl_result {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => return StepResult::err(format!(
                "ollama-download-failed:http-{}", r.status().as_u16()
            )),
            Err(e) => return StepResult::err(format!("ollama-download-failed:{e}")),
        };

        let bytes = match resp.bytes().await {
            Ok(b) if !b.is_empty() => b,
            Ok(_)  => return StepResult::err("ollama-download-failed:empty-response".into()),
            Err(e) => return StepResult::err(format!("ollama-download-read-failed:{e}")),
        };

        if let Err(e) = std::fs::write(&tmp, &bytes) {
            return StepResult::err(format!("ollama-installer-write-failed:{e}"));
        }

        // /S = NSIS silent install (Ollama uses NSIS on Windows)
        let status = tokio::process::Command::new(&tmp)
            .arg("/S")
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .await;

        let _ = std::fs::remove_file(&tmp);

        return match status {
            Ok(s) if s.code().map(|c| c == 0 || c == 3010).unwrap_or(false) => {
                StepResult::ok("ollama-installed-direct".to_string())
            }
            Ok(s) if ollama_binary_exists() => {
                let _ = s;
                StepResult::ok("ollama-installed-direct".to_string())
            }
            Ok(s) => StepResult::err(format!(
                "ollama-install-failed:installer-exit-{}", s.code().unwrap_or(-1)
            )),
            Err(e) => StepResult::err(format!("ollama-install-failed:{e}")),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let (sh_ok, _, err) = shell_result("curl -fsSL https://ollama.com/install.sh | sh");
        if sh_ok {
            return StepResult::ok("ollama-installed-script".to_string());
        }
        return StepResult::err(format!(
            "ollama-install-failed:{}",
            err.lines().next().unwrap_or("unknown")
        ));
    }

    #[allow(unreachable_code)]
    StepResult::err("ollama-install-failed:unsupported-platform".to_string())
}

/// Check whether the Ollama binary is reachable, searching PATH and common install locations.
fn ollama_binary_exists() -> bool {
    // Quick PATH check first.
    let (ok, _, _) = shell_result("ollama --version");
    if ok {
        return true;
    }

    // On Windows, winget installs to %LOCALAPPDATA%\Programs\Ollama\ and the
    // PATH update only takes effect after a new shell session / restart.
    #[cfg(target_os = "windows")]
    {
        let local = crate::platform::data_local();
        let candidates = [
            format!("{local}\\Programs\\Ollama\\ollama.exe"),
            format!("{local}\\Ollama\\ollama.exe"),
            r"C:\Program Files\Ollama\ollama.exe".to_string(),
        ];
        return candidates.iter().any(|p| std::path::Path::new(p).exists());
    }

    #[allow(unreachable_code)]
    false
}

/// Start the Ollama server if it is not already running.
#[tauri::command]
pub async fn ollama_start_server() -> StepResult {
    if server_is_running().await {
        return StepResult::ok("ollama-already-running".to_string());
    }

    spawn_ollama_serve();

    // Poll up to 6 seconds for the server to become ready
    for _ in 0..12 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if server_is_running().await {
            return StepResult::ok("ollama-started".to_string());
        }
    }

    StepResult::err("ollama-start-timeout".to_string())
}

/// Return the list of locally downloaded Ollama models.
#[tauri::command]
pub async fn ollama_list_local_models() -> Vec<OllamaModel> {
    let Ok(resp) = quick_client()
        .get("http://localhost:11434/api/tags")
        .send()
        .await
    else {
        return vec![];
    };

    let Ok(data) = resp.json::<OllamaTagsResponse>().await else {
        return vec![];
    };

    data.models
        .into_iter()
        .map(|m| OllamaModel {
            name: m.name,
            size: m.size,
            modified_at: m.modified_at,
        })
        .collect()
}

/// Delete a locally downloaded model.
#[tauri::command]
pub async fn ollama_delete_model(name: String) -> StepResult {
    let body = serde_json::json!({ "name": name });
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
        .delete("http://localhost:11434/api/delete")
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() || r.status().as_u16() == 200 => {
            StepResult::ok(format!("deleted:{}", name))
        }
        Ok(r) => StepResult::err(format!("delete-failed:http-{}", r.status())),
        Err(e) => StepResult::err(format!("delete-failed:{}", e)),
    }
}

/// Pull a model from the Ollama registry, streaming progress as Tauri events.
///
/// Emits `ollama-pull-progress` events: `{ model, status, percent, done, error }`.
/// Returns `StepResult` when the pull completes or fails.
#[tauri::command]
pub async fn ollama_pull_model(app: AppHandle, name: String) -> StepResult {
    use tauri::Emitter;

    const EVENT: &str = "ollama-pull-progress";

    let emit = |status: &str, percent: f32, done: bool, error: Option<String>| {
        let _ = app.emit(
            EVENT,
            OllamaPullProgress {
                model: name.clone(),
                status: status.to_string(),
                percent,
                done,
                error,
            },
        );
    };

    // Ensure Ollama server is running before attempting pull
    if !server_is_running().await {
        emit("starting-server", 0.0, false, None);
        let sr = ollama_start_server().await;
        if !sr.ok {
            emit("server-start-failed", 0.0, true, Some(sr.detail.clone()));
            return sr;
        }
    }

    let body = serde_json::json!({ "name": name, "stream": true });

    let mut resp = match long_client()
        .post("http://localhost:11434/api/pull")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("pull-request-failed:{}", e);
            emit("request-failed", 0.0, true, Some(e.to_string()));
            return StepResult::err(msg);
        }
    };

    let mut last_pct = 0.0f32;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let text = String::from_utf8_lossy(&chunk);
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let Ok(parsed) = serde_json::from_str::<OllamaPullChunk>(line) else {
                        continue;
                    };

                    if let Some(err) = &parsed.error {
                        emit("error", last_pct, true, Some(err.clone()));
                        return StepResult::err(format!("pull-error:{}", err));
                    }

                    let pct = if parsed.total > 0 {
                        (parsed.completed as f32 / parsed.total as f32) * 100.0
                    } else if parsed.status == "success" {
                        100.0
                    } else {
                        last_pct
                    };
                    last_pct = pct;

                    let done = parsed.status == "success";
                    emit(&parsed.status, pct, done, None);

                    if done {
                        return StepResult::ok(format!("pulled:{}", name));
                    }
                }
            }
            Ok(None) => break, // stream ended
            Err(e) => {
                emit("stream-error", last_pct, true, Some(e.to_string()));
                return StepResult::err(format!("pull-stream-error:{}", e));
            }
        }
    }

    StepResult::ok(format!("pulled:{}", name))
}

/// Tell OpenClaw gateway to use this Ollama model as its active default.
///
/// Runs `openclaw models set ollama/<model_name>` so that subsequent chat
/// requests are routed to the locally-running Ollama instance.
/// Also registers the model in the fallback chain for resilience.
#[tauri::command]
pub fn set_ollama_model(model_name: String) -> StepResult {
    if model_name.trim().is_empty() {
        return StepResult::err("model-name-empty".to_string());
    }
    // Sanitise: reject anything that looks like shell injection.
    if model_name.contains('"') || model_name.contains('\'') || model_name.contains(';') || model_name.contains('&') {
        return StepResult::err("model-name-invalid".to_string());
    }

    let model_str = format!("ollama/{}", model_name);

    // Set as active model.
    let set_cmd = format!("openclaw models set {}", model_str);
    let (set_ok, set_out, set_err) = shell_result(&set_cmd);
    if !set_ok {
        let detail = format!("{}{}", set_out, set_err);
        return StepResult::err(format!("set-model-failed:{}", detail.trim().chars().take(120).collect::<String>()));
    }

    // Add to fallback chain so it is retried automatically.
    let fb_cmd = format!("openclaw models fallbacks add {}", model_str);
    let _ = shell_result(&fb_cmd);

    StepResult::ok(format!("ollama-model-set:{}", model_name))
}
