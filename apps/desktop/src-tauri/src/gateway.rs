/// OpenClaw gateway lifecycle — start, stop, health probe, browser URL.

use std::process::Command;
use std::time::Duration;
use serde::Serialize;

use crate::platform::{
    data_local, first_line, path_join, shell_output, user_home,
};
use crate::pm2::{cleanup_pm2_openclaw, pm2_last_log, pm2_start_with_retry, run_pm2};
use crate::types::StepResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Health probe ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProbeResult {
    pub online: bool,
    pub latency_ms: u64,
}

#[tauri::command]
pub fn probe_instance_health(port: u16) -> ProbeResult {
    use std::net::{TcpStream, ToSocketAddrs};
    let addr = format!("127.0.0.1:{}", port);
    let t0 = std::time::Instant::now();
    let online = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .map(|sa| TcpStream::connect_timeout(&sa, Duration::from_secs(3)).is_ok())
        .unwrap_or(false);
    ProbeResult { online, latency_ms: t0.elapsed().as_millis() as u64 }
}

// ── Gateway failure diagnosis ─────────────────────────────────────────────────

enum GatewayFailure {
    PortInUse,
    ConfigCorrupt,
    Timeout,
    UnknownCrash(String),
}

fn diagnose_gateway_log(log: &str) -> GatewayFailure {
    let l = log.to_lowercase();
    if l.contains("eaddrinuse") || l.contains("address already in use") {
        GatewayFailure::PortInUse
    } else if l.contains("config") && (l.contains("invalid") || l.contains("parse")) {
        GatewayFailure::ConfigCorrupt
    } else if log.is_empty() {
        GatewayFailure::Timeout
    } else {
        GatewayFailure::UnknownCrash(log.to_string())
    }
}

// ── Port utilities ────────────────────────────────────────────────────────────

/// TCP connect probe — cross-platform, no subprocess needed.
fn is_port_listening(port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let addr_str = format!("127.0.0.1:{}", port);
    addr_str.to_socket_addrs().ok()
        .and_then(|mut a| a.next())
        .map(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(300)).is_ok())
        .unwrap_or(false)
}

fn kill_port_occupant(port: u16) -> bool {
    #[cfg(target_os = "windows")]
    {
        let out = shell_output(&format!("netstat -ano | findstr :{port}"));
        for line in out.lines() {
            if !line.contains("LISTENING") && !line.contains("ESTABLISHED") { continue; }
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    if pid == 0 || pid == 4 { continue; }
                    shell_output(&format!("taskkill /PID {pid} /F"));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
        !shell_output(&format!("netstat -ano | findstr :{port}")).contains("LISTENING")
    }
    #[cfg(not(target_os = "windows"))]
    {
        // lsof -ti :PORT prints just the PIDs; kill -9 each one.
        let out = shell_output(&format!("lsof -ti :{port} 2>/dev/null"));
        for pid_str in out.split_whitespace() {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                if pid > 1 { shell_output(&format!("kill -9 {pid}")); }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
        !is_port_listening(port)
    }
}

/// Wait up to `secs` seconds for the port to become reachable via TCP.
/// Uses a direct connect probe — no subprocess, fully cross-platform.
fn wait_for_port(port: u16, secs: u8) -> bool {
    for _ in 0..secs {
        std::thread::sleep(Duration::from_secs(1));
        if is_port_listening(port) { return true; }
    }
    false
}

// ── Node.js executable finder ─────────────────────────────────────────────────

/// Find the first `node` / `node.exe` binary in the current process PATH that
/// is version 22 or newer.  Falls back to the first `node` binary found if none
/// is ≥ 22.  This is used to embed an explicit path in the CJS gateway wrapper
/// so the gateway always runs with the correct Node.js version, regardless of
/// which node version pm2 itself was installed under.
fn find_node_exe() -> String {
    #[cfg(target_os = "windows")]
    let exe_name = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "node";

    let path_env = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };

    let mut first_found = String::new();
    for dir in path_env.split(sep) {
        let candidate = std::path::Path::new(dir).join(exe_name);
        if candidate.exists() {
            let candidate_str = candidate.to_string_lossy().to_string();
            // Try to run it to verify the version
            if let Ok(o) = std::process::Command::new(&candidate_str).arg("--version").output() {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let major = ver.trim_start_matches('v')
                    .split('.').next().unwrap_or("0")
                    .parse::<u32>().unwrap_or(0);
                if major >= 22 {
                    return candidate_str;
                }
                if first_found.is_empty() {
                    first_found = candidate_str;
                }
            } else if first_found.is_empty() {
                first_found = candidate_str;
            }
        }
    }
    // No v22+ found — return whatever we found, or just "node" as last resort
    if first_found.is_empty() { exe_name.to_string() } else { first_found }
}

// ── CJS wrapper writer ────────────────────────────────────────────────────────

fn write_cjs_wrapper(mjs: &str, port: u16, fixes: &mut Vec<String>) -> Option<String> {
    let mjs_js = mjs.replace('\\', "\\\\");
    // Find the v22+ node binary and embed it explicitly.
    // Using process.execPath would inherit pm2's own node (which may be v20 if pm2
    // was installed before the nvm upgrade), causing "Node.js v22+ is required" crashes.
    let node_exe = find_node_exe();
    let node_exe_js = node_exe.replace('\\', "\\\\");
    let content = format!(
        concat!(
            "'use strict';\n",
            "var cp = require('child_process');\n",
            "var child = cp.spawn(\n",
            "  \"{node_exe}\",\n",
            "  [\"{mjs}\", \"gateway\", \"--port\", \"{port}\",\n",
            "   \"--allow-unconfigured\", \"--force\"],\n",
            "  {{ stdio: 'inherit', windowsHide: true }}\n",
            ");\n",
            "child.on('exit', function(code) {{ process.exit(code || 0); }});\n",
            "child.on('error', function(err) {{ console.error('[clawno]', err.message); process.exit(1); }});\n"
        ),
        node_exe = node_exe_js, mjs = mjs_js, port = port,
    );

    let app_dir = crate::platform::app_data_dir();
    if std::fs::create_dir_all(&app_dir).is_ok() {
        let path = path_join(&app_dir, "gateway-wrapper.cjs");
        if std::fs::write(&path, &content).is_ok() { return Some(path); }
    }

    fixes.push("wrapper-fallback-to-temp".to_string());
    let temp = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .unwrap_or_else(|_| {
            if cfg!(target_os = "windows") { "C:\\Windows\\Temp".into() }
            else { "/tmp".into() }
        });
    let path = path_join(&temp, "clawno-gateway-wrapper.cjs");
    if std::fs::write(&path, &content).is_ok() { return Some(path); }
    None
}

// ── Gateway start ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_start(port: Option<u16>) -> StepResult {
    let port = port.unwrap_or(18789);
    let ui_port = port + 2;
    let mut fixes: Vec<String> = Vec::new();

    // Locate openclaw.mjs — try shell first, then filesystem scan (macOS PATH isolation)
    let mjs = {
        let from_shell = {
            let npm_root = shell_output("npm root -g").trim().to_string();
            if !npm_root.is_empty() {
                let p = path_join(&path_join(&npm_root, "openclaw"), "openclaw.mjs");
                if std::path::Path::new(&p).exists() { Some(p) } else { None }
            } else {
                None
            }
        };
        match from_shell {
            Some(p) => p,
            None => {
                // Shell PATH isolation fallback: scan known install locations
                match crate::node::scan_openclaw_mjs() {
                    Some(p) => {
                        fixes.push("openclaw-mjs-found-via-scan".to_string());
                        p
                    }
                    None => {
                        return StepResult::err_fixed(
                            "openclaw-mjs-not-found: reinstall openclaw via the deploy steps".to_string(),
                            fixes,
                        );
                    }
                }
            }
        }
    };

    let wrapper_path = match write_cjs_wrapper(&mjs, port, &mut fixes) {
        Some(p) => p,
        None => return StepResult::err_fixed(
            "wrapper-write-failed: disk permission issue".to_string(), fixes,
        ),
    };

    if is_port_listening(port) {
        fixes.push(format!("kill-port-occupant:{}", port));
        kill_port_occupant(port);
        std::thread::sleep(Duration::from_millis(600));
    }

    cleanup_pm2_openclaw(&mut fixes);

    let (pm2_ok, pm2_err) = pm2_start_with_retry(&wrapper_path, &mut fixes);
    if !pm2_ok {
        return StepResult::err_fixed(
            format!("pm2-start-failed: {}", if pm2_err.is_empty() { "unknown error".to_string() } else { pm2_err }),
            fixes,
        );
    }

    for round in 0u8..3 {
        if wait_for_port(port, 6) {
            return StepResult::ok_fixed(
                format!("gateway-ready:{}:{}", port, ui_port), fixes,
            );
        }

        let log = pm2_last_log("openclaw");
        match diagnose_gateway_log(&log) {
            GatewayFailure::PortInUse => {
                fixes.push(format!("kill-port-occupant:{}", port));
                kill_port_occupant(port);
                std::thread::sleep(Duration::from_millis(500));
                cleanup_pm2_openclaw(&mut fixes);
                pm2_start_with_retry(&wrapper_path, &mut fixes);
            }
            GatewayFailure::ConfigCorrupt => {
                if round == 0 {
                    fixes.push("reset-corrupt-config".to_string());
                    let home_claw = path_join(&user_home(), ".openclaw");
                    if std::path::Path::new(&home_claw).exists() {
                        let _ = std::fs::rename(&home_claw, format!("{home_claw}.bak"));
                    }
                    shell_output("openclaw onboard --yes");
                    cleanup_pm2_openclaw(&mut fixes);
                    pm2_start_with_retry(&wrapper_path, &mut fixes);
                }
            }
            GatewayFailure::Timeout => {}
            GatewayFailure::UnknownCrash(ref msg) => {
                if round >= 1 {
                    return StepResult::err_fixed(
                        format!("gateway-crash: {}", first_line(msg)), fixes,
                    );
                }
                fixes.push("restart-pm2-daemon".to_string());
                run_pm2(&["kill"]);
                // Match the 3.5s wait used in pm2_start_with_retry for consistency.
                std::thread::sleep(Duration::from_millis(3500));
                cleanup_pm2_openclaw(&mut fixes);
                pm2_start_with_retry(&wrapper_path, &mut fixes);
            }
        }
    }

    let log = pm2_last_log("openclaw");
    let detail = if log.is_empty() {
        format!("gateway-timeout: port {} not listening after 18s", port)
    } else {
        format!("gateway-timeout: {}", first_line(&log))
    };
    StepResult::err_fixed(detail, fixes)
}

#[tauri::command]
pub async fn start_local_service(port: Option<u16>) -> StepResult {
    deploy_step_start(Some(port.unwrap_or(18789))).await
}

// ── Dashboard URL ─────────────────────────────────────────────────────────────

fn openclaw_dashboard_url() -> Option<String> {
    // Use the platform shell abstraction (cmd /C on Windows, sh -c on Unix).
    let out = crate::platform::shell_cmd("openclaw dashboard --no-open").ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Dashboard URL:") {
            let url = rest.trim().to_string();
            if !url.is_empty() { return Some(url); }
        }
    }
    None
}

#[tauri::command]
pub async fn get_browser_url(ui_port: Option<u16>) -> String {
    if let Some(url) = openclaw_dashboard_url() {
        return url;
    }
    // Default gateway port is 18789; UI runs on port+2 = 18791.
    let port = ui_port.unwrap_or(18789 + 2);
    format!("http://127.0.0.1:{}/", port)
}

// ── Open in system browser ────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let app_dir = crate::platform::app_data_dir();
        let _ = std::fs::create_dir_all(&app_dir);
        let bat_path = path_join(&app_dir, "open-browser.bat");
        let bat_content = format!("@echo off\nstart \"\" \"{}\"\n", url);
        if std::fs::write(&bat_path, bat_content).is_ok() {
            let mut c = Command::new("cmd");
            c.args(["/C", &bat_path]);
            c.creation_flags(CREATE_NO_WINDOW);
            if c.spawn().is_ok() { return Ok(()); }
        }
        let r2 = Command::new("powershell")
            .args(["-NonInteractive", "-WindowStyle", "Hidden",
                   "-Command", &format!("Start-Process '{}'", url)])
            .spawn();
        if r2.is_ok() { return Ok(()); }
    }

    #[cfg(target_os = "macos")]
    {
        if Command::new("open").arg(&url).spawn().is_ok() { return Ok(()); }
    }

    #[cfg(target_os = "linux")]
    {
        if Command::new("xdg-open").arg(&url).spawn().is_ok() { return Ok(()); }
    }

    Err(format!("Failed to open URL: {}", url))
}

// ── Active model query ───────────────────────────────────────────────────────

/// Fetch the model string of the "main" agent from a running gateway instance.
///
/// Calls `GET http://127.0.0.1:{port}/agents`, finds the agent with id "main"
/// (falling back to the first agent), and returns its `model` field.
///
/// Returns `None` if the gateway is unreachable or returns no agents.
/// The model string is typically `"provider/model-name"` (e.g. `"anthropic/claude-3-5-sonnet-20241022"`).
#[tauri::command]
pub async fn get_main_agent_model(port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{}/agents", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    let agents: Vec<serde_json::Value> = resp.json().await.ok()?;

    // Prefer the agent explicitly named "main"; fall back to the first entry.
    let agent = agents
        .iter()
        .find(|a| a.get("id").and_then(|v| v.as_str()) == Some("main"))
        .or_else(|| agents.first())?;

    agent
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_localhost_closed_port_is_offline() {
        // Port 19999 is almost certainly not listening in CI.
        let result = probe_instance_health(19999);
        assert!(!result.online);
    }

    #[test]
    fn diagnose_port_in_use() {
        assert!(matches!(
            diagnose_gateway_log("listen EADDRINUSE: address already in use"),
            GatewayFailure::PortInUse
        ));
    }

    #[test]
    fn diagnose_empty_log_is_timeout() {
        assert!(matches!(diagnose_gateway_log(""), GatewayFailure::Timeout));
    }
}
