/// OpenClaw gateway lifecycle — start, stop, health probe, browser URL.
///
/// All self-healing actions are captured via the sentinel engine so they
/// become auditable and can feed the evolution library.
use std::process::Command;
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::platform::{first_line, path_join, shell_output, user_home};
use crate::pm2::{cleanup_pm2_openclaw, pm2_last_log, pm2_start_with_retry, run_pm2};
use crate::types::StepResult;

use clawno_core::sentinel::{self, capture::capture_context, SentinelEvent};
use clawno_core::types::{StepPhase, StepProgress, STEP_PROGRESS_EVENT};

#[cfg(target_os = "windows")]
use crate::platform::CREATE_NO_WINDOW;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ── Health probe ─────────────────────────────────────────────────────────────

pub use clawno_core::types::ProbeResult;

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
    ProbeResult {
        online,
        latency_ms: t0.elapsed().as_millis() as u64,
    }
}

// ── Port utilities ────────────────────────────────────────────────────────────

/// TCP connect probe — cross-platform, no subprocess needed.
fn is_port_listening(port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let addr_str = format!("127.0.0.1:{}", port);
    addr_str
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .map(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(300)).is_ok())
        .unwrap_or(false)
}

fn kill_port_occupant(port: u16) -> bool {
    #[cfg(target_os = "windows")]
    {
        let out = shell_output(&format!("netstat -ano | findstr :{port}"));
        for line in out.lines() {
            if !line.contains("LISTENING") {
                continue;
            }
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    if pid == 0 || pid == 4 {
                        continue;
                    }
                    shell_output(&format!("taskkill /PID {pid} /F"));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
        !shell_output(&format!("netstat -ano | findstr :{port}")).contains("LISTENING")
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Try lsof first (most reliable); fall back to fuser or ss+awk
        // for minimal Linux installs that don't have lsof.
        let out = shell_output(&format!("lsof -ti :{port} 2>/dev/null"));
        let pids: Vec<u32> = if !out.trim().is_empty() {
            out.split_whitespace()
                .filter_map(|s| s.trim().parse::<u32>().ok())
                .filter(|&pid| pid > 1)
                .collect()
        } else {
            // Fallback 1: fuser (available on most Linux distros)
            let fuser_out = shell_output(&format!("fuser {port}/tcp 2>/dev/null"));
            if !fuser_out.trim().is_empty() {
                fuser_out
                    .split_whitespace()
                    .filter_map(|s| s.trim().parse::<u32>().ok())
                    .filter(|&pid| pid > 1)
                    .collect()
            } else {
                // Fallback 2: ss (always present on modern Linux)
                let ss_out = shell_output(&format!(
                    "ss -tlnp sport = :{port} 2>/dev/null | grep -oP 'pid=\\K[0-9]+'",
                    port = port
                ));
                ss_out
                    .split_whitespace()
                    .filter_map(|s| s.trim().parse::<u32>().ok())
                    .filter(|&pid| pid > 1)
                    .collect()
            }
        };
        for pid in &pids {
            shell_output(&format!("kill -9 {pid}"));
        }
        std::thread::sleep(Duration::from_millis(500));
        !is_port_listening(port)
    }
}

// ── Node.js executable: pre-flight verification + cache ──────────────────────

/// Persistent cache file for the last-verified Node v22+ binary path.
fn node_cache_path() -> String {
    path_join(&crate::platform::app_data_dir(), "node-v22-path.txt")
}

/// Layer 3 — Try the cached path first; only valid if the binary still exists
/// and actually reports v22+.
fn load_cached_node() -> Option<String> {
    let cache = node_cache_path();
    let path = std::fs::read_to_string(&cache).ok()?;
    let path = path.trim().to_string();
    if path.is_empty() {
        return None;
    }
    if !std::path::Path::new(&path).exists() {
        return None;
    }
    if let Ok(o) = std::process::Command::new(&path).arg("--version").output() {
        let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if crate::node::node_major(&ver) >= 22 {
            return Some(path);
        }
    }
    None
}

fn save_cached_node(path: &str) {
    let cache = node_cache_path();
    let _ = std::fs::create_dir_all(
        std::path::Path::new(&cache)
            .parent()
            .unwrap_or(std::path::Path::new(".")),
    );
    let _ = std::fs::write(&cache, path);
}

/// Layer 1 — Pre-flight verification.  Returns an absolute path to a node v22+
/// binary, trying (in order):
/// 1. Cached path from a previous successful launch
/// 2. `find_node_exe()` with version validation
/// 3. Emergency nvm-which on Unix
/// 4. Bare fallback `"node"` (last resort — self-healing will catch the crash)
fn verify_or_recover_node(fixes: &mut Vec<String>) -> String {
    // Fast path: cached binary from last successful launch
    if let Some(cached) = load_cached_node() {
        return cached;
    }

    // Normal path: scan via find_node_exe()
    let candidate = crate::node::find_node_exe();

    // Validate that the candidate actually runs and reports v22+
    if candidate != "node" && candidate != "node.exe" {
        if let Ok(o) = std::process::Command::new(&candidate)
            .arg("--version")
            .output()
        {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if crate::node::node_major(&ver) >= 22 {
                save_cached_node(&candidate);
                return candidate;
            }
            fixes.push(format!("node-version-mismatch:found={}", ver));
        } else {
            fixes.push("node-exe-not-executable".to_string());
        }
    }

    // Emergency recovery: ask nvm/shell for the correct binary
    #[cfg(not(target_os = "windows"))]
    {
        let nvm_node = shell_output(
            &format!(
                "export NVM_DIR=\"{}\" && . \"{}/nvm.sh\" 2>/dev/null && nvm use 22 >/dev/null 2>&1 && which node 2>/dev/null",
                crate::node::nvm_dir_path(),
                crate::node::nvm_dir_path(),
            )
        );
        if !nvm_node.is_empty() && std::path::Path::new(nvm_node.trim()).exists() {
            let bin = nvm_node.trim().to_string();
            if let Ok(o) = std::process::Command::new(&bin).arg("--version").output() {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if crate::node::node_major(&ver) >= 22 {
                    fixes.push("recovered-via-nvm-which".to_string());
                    save_cached_node(&bin);
                    return bin;
                }
            }
        }
    }

    // On Windows: try refreshing PATH from registry then re-scan
    #[cfg(target_os = "windows")]
    {
        let new_path = shell_output(
            "powershell -NoProfile -Command \"\
             $m=[System.Environment]::GetEnvironmentVariable('PATH','Machine'); \
             $u=[System.Environment]::GetEnvironmentVariable('PATH','User'); \
             \"$m;$u\"\"",
        );
        if !new_path.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{};{}", new_path, current));
            fixes.push("refreshed-registry-path".to_string());
            let retry = crate::node::find_node_exe();
            if retry != "node" && retry != "node.exe" {
                if let Ok(o) = std::process::Command::new(&retry).arg("--version").output() {
                    let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if crate::node::node_major(&ver) >= 22 {
                        save_cached_node(&retry);
                        return retry;
                    }
                }
            }
        }
    }

    // Fallback: return whatever we have; self-healing Layer 2 will catch the
    // version mismatch crash and apply the NodeVersionMismatch remedy.
    fixes.push("node-v22-not-verified-using-fallback".to_string());
    candidate
}

// ── CJS wrapper writer ────────────────────────────────────────────────────────

fn write_cjs_wrapper(
    mjs: &str,
    port: u16,
    node_exe: &str,
    fixes: &mut Vec<String>,
) -> Option<String> {
    let mjs_js = mjs.replace('\\', "\\\\").replace('"', "\\\"");
    let node_exe_js = node_exe.replace('\\', "\\\\").replace('"', "\\\"");
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
        if std::fs::write(&path, &content).is_ok() {
            return Some(path);
        }
    }

    fixes.push("wrapper-fallback-to-temp".to_string());
    let temp = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "C:\\Windows\\Temp".into()
            } else {
                "/tmp".into()
            }
        });
    let path = path_join(&temp, "clawno-gateway-wrapper.cjs");
    if std::fs::write(&path, &content).is_ok() {
        return Some(path);
    }
    None
}

// ── Gateway start ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_start(port: Option<u16>, app: tauri::AppHandle) -> StepResult {
    let port = port.unwrap_or(18789);
    let ui_port = port + 2;
    let mut fixes: Vec<String> = Vec::new();

    let emit_progress = |phase: StepPhase, msg: &str, pct: f32| {
        let mut p = StepProgress::new("start-gateway", "pm2", 0, 1);
        p.phase = phase;
        p.pct = pct;
        p.message = msg.to_string();
        let _ = app.emit(STEP_PROGRESS_EVENT, &p);
    };

    emit_progress(StepPhase::Probing, "locating openclaw.mjs", 5.0);

    let mjs = {
        let from_shell = {
            let npm_root = shell_output("npm root -g").trim().to_string();
            if !npm_root.is_empty() {
                let p = path_join(&path_join(&npm_root, "openclaw"), "openclaw.mjs");
                if std::path::Path::new(&p).exists() {
                    Some(p)
                } else {
                    None
                }
            } else {
                None
            }
        };
        match from_shell {
            Some(p) => p,
            None => match crate::node::scan_openclaw_mjs() {
                Some(p) => {
                    fixes.push("openclaw-mjs-found-via-scan".to_string());
                    p
                }
                None => {
                    return StepResult::err_fixed(
                        "openclaw-mjs-not-found: reinstall openclaw via the deploy steps"
                            .to_string(),
                        fixes,
                    );
                }
            },
        }
    };

    emit_progress(StepPhase::Installing, "verifying node v22+", 8.0);

    // Layer 1 — Pre-flight: verify that find_node_exe() returns a genuine v22+
    // binary BEFORE writing the wrapper.  If it doesn't, attempt emergency
    // recovery before giving up.
    let mut node_exe = verify_or_recover_node(&mut fixes);

    emit_progress(StepPhase::Installing, "writing gateway wrapper", 10.0);

    let mut wrapper_path = match write_cjs_wrapper(&mjs, port, &node_exe, &mut fixes) {
        Some(p) => p,
        None => {
            return StepResult::err_fixed(
                "wrapper-write-failed: disk permission issue".to_string(),
                fixes,
            )
        }
    };

    if is_port_listening(port) {
        emit_progress(
            StepPhase::Installing,
            &format!("killing port {} occupant", port),
            15.0,
        );
        fixes.push(format!("kill-port-occupant:{}", port));
        kill_port_occupant(port);
        tokio::time::sleep(Duration::from_millis(600)).await;
    }

    emit_progress(StepPhase::Installing, "cleaning up old processes", 20.0);
    cleanup_pm2_openclaw(&mut fixes);

    // Kill stale pm2 daemon that may be pinned to an old Node version,
    // then flush logs so old error entries don't confuse diagnosis.
    run_pm2(&["kill"]);
    tokio::time::sleep(Duration::from_millis(1500)).await;
    run_pm2(&["flush"]);

    emit_progress(StepPhase::Installing, "starting gateway via pm2", 25.0);
    let interp_for = |exe: &str| -> Option<String> {
        if exe != "node" && exe != "node.exe" {
            Some(exe.to_string())
        } else {
            None
        }
    };
    let interp = interp_for(&node_exe);
    let (pm2_ok, pm2_err) = pm2_start_with_retry(&wrapper_path, interp.as_deref(), &mut fixes);
    if !pm2_ok {
        return StepResult::err_fixed(
            format!(
                "pm2-start-failed: {}",
                if pm2_err.is_empty() {
                    "unknown error".to_string()
                } else {
                    pm2_err
                }
            ),
            fixes,
        );
    }

    // Continuous probe with per-second progress updates
    let max_wait_secs = 32u8;
    let mut total_waited = 0u8;

    for round in 0u8..3 {
        let wait_secs: u8 = if round == 0 { 12 } else { 10 };

        for _sec in 0..wait_secs {
            total_waited += 1;
            let pct = 30.0 + (total_waited as f32 / max_wait_secs as f32) * 65.0;
            emit_progress(
                StepPhase::Verifying,
                &format!("waiting for port {}... ({}s)", port, total_waited),
                pct,
            );

            tokio::time::sleep(Duration::from_secs(1)).await;

            if is_port_listening(port) {
                emit_progress(StepPhase::Done, "gateway ready", 100.0);
                sentinel::log_sentinel_event(&SentinelEvent::applied(
                    "gateway",
                    "",
                    "gateway started successfully",
                ));
                return StepResult::ok_fixed(format!("gateway-ready:{}:{}", port, ui_port), fixes);
            }
        }

        // Port not ready after this round — diagnose using unified engine
        let log = pm2_last_log("openclaw");
        let ctx = capture_context(&log, "gateway_pm2", None);
        let sig = ctx.bug_signature.clone();
        let diag = crate::deploy::diagnosis::diagnose(&log, "", None);

        match diag.category {
            // Layer 2 — Self-healing: node version mismatch detected in pm2 logs.
            // Re-scan for a v22+ binary, rewrite the wrapper, kill the stale
            // daemon, and restart with the correct --interpreter.
            clawno_core::types::ErrorCategory::NodeVersionMismatch => {
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "gateway",
                    &sig,
                    "node version mismatch — rescanning for v22+",
                ));
                emit_progress(
                    StepPhase::Retrying,
                    "node version mismatch — rescanning",
                    30.0,
                );
                fixes.push("self-heal-node-version-mismatch".to_string());

                // Invalidate the cached path (it pointed to a wrong version)
                let _ = std::fs::remove_file(node_cache_path());

                // Re-scan for a v22+ binary and update outer state so
                // subsequent rounds use the corrected paths.
                node_exe = verify_or_recover_node(&mut fixes);
                let new_interp = interp_for(&node_exe);

                if let Some(new_wrapper) = write_cjs_wrapper(&mjs, port, &node_exe, &mut fixes) {
                    wrapper_path = new_wrapper;
                    cleanup_pm2_openclaw(&mut fixes);
                    run_pm2(&["kill"]);
                    tokio::time::sleep(Duration::from_millis(2000)).await;
                    run_pm2(&["flush"]);
                    pm2_start_with_retry(&wrapper_path, new_interp.as_deref(), &mut fixes);
                    sentinel::log_sentinel_event(&SentinelEvent::applied(
                        "gateway",
                        &sig,
                        "node_version_rescan remedy applied",
                    ));
                }
            }
            clawno_core::types::ErrorCategory::PortInUse => {
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "gateway",
                    &sig,
                    "port in use — killing occupant",
                ));
                emit_progress(StepPhase::Retrying, "port in use, killing occupant", 30.0);
                fixes.push(format!("kill-port-occupant:{}", port));
                kill_port_occupant(port);
                tokio::time::sleep(Duration::from_millis(500)).await;
                cleanup_pm2_openclaw(&mut fixes);
                let cur_interp = interp_for(&node_exe);
                pm2_start_with_retry(&wrapper_path, cur_interp.as_deref(), &mut fixes);
                sentinel::log_sentinel_event(&SentinelEvent::applied(
                    "gateway",
                    &sig,
                    "port_kill remedy applied",
                ));
            }
            clawno_core::types::ErrorCategory::ConfigCorrupt => {
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "gateway",
                    &sig,
                    "config corruption detected",
                ));
                if round == 0 {
                    emit_progress(StepPhase::Retrying, "resetting corrupt config", 30.0);
                    fixes.push("reset-corrupt-config".to_string());
                    let home_claw = path_join(&user_home(), ".openclaw");
                    if std::path::Path::new(&home_claw).exists() {
                        let _ = std::fs::rename(&home_claw, format!("{home_claw}.bak"));
                    }
                    shell_output("openclaw onboard --yes");
                    cleanup_pm2_openclaw(&mut fixes);
                    let cur_interp = interp_for(&node_exe);
                    pm2_start_with_retry(&wrapper_path, cur_interp.as_deref(), &mut fixes);
                    sentinel::log_sentinel_event(&SentinelEvent::applied(
                        "gateway",
                        &sig,
                        "config_patch remedy applied",
                    ));
                }
            }
            _ => {
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "gateway",
                    &sig,
                    &format!("crash/timeout (round {round})"),
                ));
                if round >= 1 && !log.is_empty() {
                    return StepResult::err_fixed(
                        format!("gateway-crash: {}", first_line(&log)),
                        fixes,
                    );
                }
                if !log.is_empty() {
                    emit_progress(StepPhase::Retrying, "restarting pm2 daemon", 30.0);
                    fixes.push("restart-pm2-daemon".to_string());
                    run_pm2(&["kill"]);
                    tokio::time::sleep(Duration::from_millis(3500)).await;
                    cleanup_pm2_openclaw(&mut fixes);
                    let cur_interp = interp_for(&node_exe);
                    pm2_start_with_retry(&wrapper_path, cur_interp.as_deref(), &mut fixes);
                    sentinel::log_sentinel_event(&SentinelEvent::applied(
                        "gateway",
                        &sig,
                        "pm2_restart remedy applied",
                    ));
                }
            }
        }
    }

    let log = pm2_last_log("openclaw");
    let detail = if log.is_empty() {
        format!(
            "gateway-timeout: port {} not listening after ~{}s",
            port, total_waited
        )
    } else {
        format!("gateway-timeout: {}", first_line(&log))
    };
    let ctx = capture_context(&detail, "gateway_pm2", None);
    sentinel::log_sentinel_event(&SentinelEvent::captured(
        "gateway",
        &ctx.bug_signature,
        &detail,
    ));
    StepResult::err_fixed(detail, fixes)
}

#[tauri::command]
pub async fn start_local_service(port: Option<u16>, app: tauri::AppHandle) -> StepResult {
    deploy_step_start(Some(port.unwrap_or(18789)), app).await
}

// ── Dashboard URL ─────────────────────────────────────────────────────────────

/// Try to get the dashboard URL by asking a running openclaw process.
/// This works when openclaw is in PATH (Windows, Linux) but often fails on macOS
/// due to GUI app PATH isolation.  It is used as an OPTIONAL enhancement only.
fn openclaw_dashboard_url_from_cli() -> Option<String> {
    let out = crate::platform::shell_cmd("openclaw dashboard --no-open", false).ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Dashboard URL:") {
            let url = rest.trim().to_string();
            if !url.is_empty() {
                return Some(url);
            }
        }
    }
    None
}

/// Scan common openclaw UI ports to find which one is actually listening.
/// The UI port is always the gateway port + 2.  We probe a range of gateway
/// ports (18789 ± 10) and return the first UI port that is reachable.
fn find_listening_ui_port(hint_ui_port: u16) -> Option<u16> {
    // Try the hinted port first
    if is_port_listening(hint_ui_port) {
        return Some(hint_ui_port);
    }
    // Scan gateway ports 18780..18800; UI = gateway + 2
    for gw in 18780u16..=18800 {
        let ui = gw + 2;
        if ui != hint_ui_port && is_port_listening(ui) {
            return Some(ui);
        }
    }
    None
}

#[tauri::command]
pub async fn get_browser_url(ui_port: Option<u16>) -> String {
    // Priority 1: ask openclaw CLI for the actual dashboard URL (works on Windows/Linux)
    if let Some(url) = openclaw_dashboard_url_from_cli() {
        return url;
    }
    // Priority 2: use the port the frontend passed in (comes from deploy result)
    let hint = ui_port.unwrap_or(18789 + 2);
    // Priority 3: port discovery — maybe the instance uses a custom port
    let actual = find_listening_ui_port(hint).unwrap_or(hint);
    format!("http://127.0.0.1:{}/", actual)
}

// ── Open in system browser ────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), String> {
    // Validate URL: only allow http/https schemes to prevent command injection
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("Invalid URL scheme: {}", url));
    }

    #[cfg(target_os = "windows")]
    {
        // Use ShellExecuteW via cmd's `start` — pass URL as a separate argument
        // to avoid injection through special characters in the URL.
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", &url]);
        c.creation_flags(CREATE_NO_WINDOW);
        if c.spawn().is_ok() {
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    {
        if Command::new("open").arg(&url).spawn().is_ok() {
            return Ok(());
        }
    }

    #[cfg(target_os = "linux")]
    {
        if Command::new("xdg-open").arg(&url).spawn().is_ok() {
            return Ok(());
        }
    }

    Err(format!("Failed to open URL: {}", url))
}

// ── Embed OpenClaw dashboard as a child webview ──────────────────────────────
//
// OpenClaw sets `X-Frame-Options: DENY` + `frame-ancestors 'none'`, so it
// cannot be loaded in an iframe.  We use Tauri's multiwebview API to embed
// a child WebView inside the main window at the exact position of the
// ChatPage's placeholder area.  Requires the `unstable` feature flag.

const CHAT_WEBVIEW_LABEL: &str = "openclaw-chat";

#[tauri::command]
pub async fn mount_chat_webview(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    eprintln!("[chat-webview] mount x={x} y={y} w={width} h={height}");

    if let Some(wv) = app.get_webview(CHAT_WEBVIEW_LABEL) {
        wv.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| format!("{e}"))?;
        wv.set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("{e}"))?;
        return Ok(());
    }

    let url = get_browser_url(None).await;
    let window = app.get_window("main").ok_or("main window not found")?;

    eprintln!(
        "[chat-webview] creating child webview at ({x}, {y}) size ({width}, {height}) url={url}"
    );

    window
        .add_child(
            tauri::webview::WebviewBuilder::new(
                CHAT_WEBVIEW_LABEL,
                tauri::WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?),
            ),
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| format!("mount failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn unmount_chat_webview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(CHAT_WEBVIEW_LABEL) {
        wv.close().map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_chat_webview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(CHAT_WEBVIEW_LABEL) {
        wv.set_position(tauri::LogicalPosition::new(-9999.0, -9999.0))
            .map_err(|e| format!("{e}"))?;
        wv.set_size(tauri::LogicalSize::new(0.0, 0.0))
            .map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_chat_webview(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(CHAT_WEBVIEW_LABEL) {
        wv.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| format!("{e}"))?;
        wv.set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

// ── Active model query ───────────────────────────────────────────────────────

/// Fetch the model string of the "main" agent from a running gateway instance.
///
/// Calls `GET http://127.0.0.1:{port}/agents` and uses the shared
/// `parse_agents_model` parser to extract the model field.
#[tauri::command]
pub async fn get_main_agent_model(port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{}/agents", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    let agents: Vec<serde_json::Value> = resp.json().await.ok()?;
    clawno_core::chat::parse_agents_model(&agents)
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
    fn diagnosis_engine_port_in_use() {
        let d = crate::deploy::diagnosis::diagnose(
            "listen EADDRINUSE: address already in use",
            "",
            None,
        );
        assert_eq!(d.category, clawno_core::types::ErrorCategory::PortInUse);
    }
}
