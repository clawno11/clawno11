use crate::node::npm_install_with_fallback;
use crate::platform::{augmented_path, data_local, data_roaming, first_line, path_join};
use crate::types::{ServiceInfo, StepResult};
/// pm2 process manager — installation, lifecycle, and service queries.
use std::process::Command;
use tauri::Emitter;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── pm2 binary location ──────────────────────────────────────────────────────

/// Find the `pm2.cmd` (Windows) or `pm2` (Unix) binary path.
/// Searching well-known locations avoids relying on cmd /C PATH quoting.
pub fn find_pm2_cmd() -> Option<String> {
    let local = data_local();

    // ── Windows: static known locations ──────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        let roaming = data_roaming();
        let candidates = vec![
            format!("{roaming}\\npm\\pm2.cmd"),
            format!("{local}\\clawno-npm-global\\pm2.cmd"),
            format!("{local}\\Programs\\nodejs\\pm2.cmd"),
            r"C:\Program Files\nodejs\pm2.cmd".to_string(),
        ];
        for p in &candidates {
            if std::path::Path::new(p).exists() {
                return Some(p.clone());
            }
        }
    }

    // ── macOS/Linux: static + nvm version dirs ────────────────────────────
    #[cfg(not(target_os = "windows"))]
    {
        let home = crate::platform::user_home();
        let mut candidates = vec![
            "/opt/homebrew/bin/pm2".to_string(), // Apple Silicon Homebrew
            "/usr/local/bin/pm2".to_string(),    // Intel Mac Homebrew / Linux pkg
            "/usr/bin/pm2".to_string(),
            format!("{home}/.npm-global/bin/pm2"),
            format!("{local}/clawno-npm-global/bin/pm2"),
        ];
        // Scan all nvm version directories — pm2 may be under any nvm-managed node.
        // Respect custom NVM_DIR env var (falls back to ~/.nvm).
        let nvm_base = std::env::var("NVM_DIR")
            .ok()
            .filter(|d| !d.is_empty() && std::path::Path::new(d).exists())
            .unwrap_or_else(|| format!("{home}/.nvm"));
        let nvm_vers = format!("{nvm_base}/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_vers) {
            let mut pm2_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(format!("{nvm_vers}/{s}/bin/pm2"))
                    } else {
                        None
                    }
                })
                .collect();
            pm2_bins.sort_by(|a, b| b.cmp(a)); // newest first (v22 before v20)
            candidates.extend(pm2_bins);
        }
        for p in &candidates {
            if std::path::Path::new(p).exists() {
                return Some(p.clone());
            }
        }
    }

    // ── Fallback: scan augmented PATH ─────────────────────────────────────
    let path_env = augmented_path();
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let bin = if cfg!(target_os = "windows") {
        "pm2.cmd"
    } else {
        "pm2"
    };
    for dir in path_env.split(sep) {
        let candidate = path_join(dir, bin);
        if std::path::Path::new(&candidate).exists() {
            return Some(candidate);
        }
    }
    None
}

// ── pm2 invocation ───────────────────────────────────────────────────────────

/// Run pm2 with properly separated arguments — avoids cmd /C quoting issues.
pub fn run_pm2(args: &[&str]) -> (bool, String, String) {
    let pm2_path = find_pm2_cmd().unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "pm2.cmd".to_string()
        } else {
            "pm2".to_string()
        }
    });
    let mut cmd = Command::new(&pm2_path);
    cmd.args(args).env("PATH", augmented_path());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(o) => (
            o.status.success(),
            String::from_utf8_lossy(&o.stdout).trim().to_string(),
            String::from_utf8_lossy(&o.stderr).trim().to_string(),
        ),
        Err(e) => (false, String::new(), e.to_string()),
    }
}

pub fn pm2_jlist() -> String {
    run_pm2(&["jlist"]).1
}

pub fn pm2_last_log(name: &str) -> String {
    let (_, stdout, stderr) = run_pm2(&["logs", name, "--lines", "10", "--no-color", "--nostream"]);
    let raw = if !stdout.is_empty() { stdout } else { stderr };
    raw.lines()
        .filter(|l| l.contains('|') || l.to_lowercase().contains("error"))
        .filter(|l| !l.contains("[TAILING]"))
        .map(|l| l.trim())
        .collect::<Vec<_>>()
        .join(" | ")
}

pub fn cleanup_pm2_openclaw(fixes: &mut Vec<String>) {
    let jlist = pm2_jlist();
    if jlist.contains("\"openclaw\"") {
        fixes.push("delete-stale-pm2-process".to_string());
        run_pm2(&["delete", "openclaw"]);
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
}

/// Returns `(success, error_detail)`.
pub fn pm2_start_with_retry(wrapper_path: &str, fixes: &mut Vec<String>) -> (bool, String) {
    let (ok, stdout, stderr) = run_pm2(&["start", wrapper_path, "--name", "openclaw"]);
    if ok {
        return (true, String::new());
    }

    let err1 = if !stderr.is_empty() { stderr } else { stdout };

    fixes.push("restart-pm2-daemon-and-retry".to_string());
    run_pm2(&["kill"]);
    // 3.5 s gives slow-disk machines enough time for the daemon to fully shut down.
    std::thread::sleep(std::time::Duration::from_millis(3500));
    let (ok2, stdout2, stderr2) = run_pm2(&["start", wrapper_path, "--name", "openclaw"]);
    if ok2 {
        return (true, String::new());
    }

    let err2 = if !stderr2.is_empty() {
        stderr2
    } else {
        stdout2
    };
    let msg = if !err2.is_empty() { err2 } else { err1 };
    (false, first_line(&msg).to_string())
}

fn clean_pm2_version(raw: &str) -> String {
    raw.lines()
        .find(|l| {
            let t = l.trim();
            !t.is_empty()
                && t.chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
        })
        .unwrap_or("")
        .trim()
        .to_string()
}

// ── Synchronous exit hook ────────────────────────────────────────────────────

/// Called from the window-destroy event (non-async) to stop the gateway
/// so it does not remain as an orphan background process after the app closes.
pub fn stop_openclaw_on_exit() {
    run_pm2(&["stop", "openclaw"]);
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_install_pm2() -> StepResult {
    let (_, raw, _) = run_pm2(&["--version"]);
    let ver = clean_pm2_version(&raw);
    if !ver.is_empty() {
        return StepResult::ok(format!("already-installed:v{}", ver));
    }

    // Guard: npm must be available to install pm2
    {
        let mut npm_fixes: Vec<String> = Vec::new();
        if !crate::node::is_npm_available() && !crate::node::ensure_npm(&mut npm_fixes) {
            return StepResult::err_fixed(
                "npm-not-available: cannot install pm2 without npm".into(),
                npm_fixes,
            );
        }
    }

    let (ok, _detail, mut fixes) = npm_install_with_fallback("pm2");
    if !ok {
        // Self-healing: rebuild .pm2 home and retry
        let pm2_home = path_join(&crate::platform::user_home(), ".pm2");
        if std::path::Path::new(&pm2_home).exists() {
            let _ = std::fs::rename(&pm2_home, format!("{pm2_home}.bak"));
            fixes.push("rebuild-pm2-home".to_string());
            let (ok2, _detail2, fixes2) = npm_install_with_fallback("pm2");
            fixes.extend(fixes2);
            if ok2 {
                let (_, raw2, _) = run_pm2(&["--version"]);
                let ver2 = clean_pm2_version(&raw2);
                return StepResult::ok_fixed(format!("installed:v{}", ver2), fixes);
            }
        }

        // Self-healing: even if npm reported failure, check if pm2 is
        // actually usable (npm exit code can be misleading)
        let (_, raw_retry, _) = run_pm2(&["--version"]);
        let ver_retry = clean_pm2_version(&raw_retry);
        if !ver_retry.is_empty() {
            fixes.push("npm-reported-fail-but-pm2-works".to_string());
            return StepResult::ok_fixed(format!("installed:v{}", ver_retry), fixes);
        }

        // Self-healing: scan common global bin directories for pm2
        // VERIFY: not just find the file — execute it to confirm it works
        if let Some(pm2_path) = find_pm2_cmd() {
            if let Ok(o) = std::process::Command::new(&pm2_path)
                .arg("--version")
                .env("PATH", augmented_path())
                .output()
            {
                let v = clean_pm2_version(&String::from_utf8_lossy(&o.stdout));
                if !v.is_empty() {
                    fixes.push("found-pm2-via-scan-verified".to_string());
                    return StepResult::ok_fixed(format!("installed:v{}", v), fixes);
                }
            }
            // Binary file exists but execution failed — cannot trust it
            fixes.push("found-pm2-file-but-exec-failed".to_string());
        }

        fixes.push("pm2-install-failed".to_string());
        return StepResult::err_fixed(
            "pm2-not-found: check npm permissions or install manually".to_string(),
            fixes,
        );
    }
    // npm reported success — VERIFY pm2 actually responds
    let (_, raw2, _) = run_pm2(&["--version"]);
    let ver2 = clean_pm2_version(&raw2);
    if !ver2.is_empty() {
        return StepResult::ok_fixed(format!("installed:v{}", ver2), fixes);
    }
    // npm said OK but pm2 doesn't respond — try scanning for the binary
    fixes.push("npm-ok-but-pm2-not-responding".to_string());
    if let Some(pm2_path) = find_pm2_cmd() {
        if let Ok(o) = std::process::Command::new(&pm2_path)
            .arg("--version")
            .env("PATH", augmented_path())
            .output()
        {
            let v = clean_pm2_version(&String::from_utf8_lossy(&o.stdout));
            if !v.is_empty() {
                fixes.push("found-pm2-via-scan-verified".to_string());
                return StepResult::ok_fixed(format!("installed:v{}", v), fixes);
            }
        }
    }
    StepResult::err_fixed(
        "pm2-installed-but-not-responding: check npm global bin path".to_string(),
        fixes,
    )
}

#[tauri::command]
pub async fn get_local_service_info() -> ServiceInfo {
    let out = pm2_jlist();
    let status = if out.contains("\"openclaw\"") && out.contains("\"online\"") {
        "running"
    } else if out.contains("\"openclaw\"") {
        "stopped"
    } else {
        "unknown"
    };
    ServiceInfo {
        name: "openclaw".to_string(),
        status: status.to_string(),
        pid: None,
        uptime: None,
        restarts: None,
    }
}

#[tauri::command]
pub async fn stop_local_service() {
    run_pm2(&["stop", "openclaw"]);
}

#[tauri::command]
pub async fn restart_local_service(app: tauri::AppHandle) {
    // Reset active model to default priority BEFORE restarting so the gateway
    // picks up the correct config on startup. Any session-level model override
    // the user set in chat is intentionally cleared here.
    let mut fixes = Vec::new();
    crate::deploy::auto_select_active_model(&mut fixes);
    run_pm2(&["restart", "openclaw"]);
    // Notify the frontend so any manual model override in the chat UI is cleared.
    let _ = app.emit("gateway-restarted", ());
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_pm2_version_extracts_semver() {
        let raw = "\n[PM2] Spawning PM2 daemon...\n5.3.1\n";
        assert_eq!(clean_pm2_version(raw), "5.3.1");
    }

    #[test]
    fn clean_pm2_version_empty_on_no_match() {
        assert_eq!(clean_pm2_version("[PM2] error"), "");
    }

    #[test]
    fn find_pm2_cmd_returns_string_or_none() {
        // Just verify it doesn't panic; actual result depends on the environment.
        let _result = find_pm2_cmd();
    }
}
