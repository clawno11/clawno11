/// npm error classification and install helpers with automatic fallbacks.
use crate::platform::{data_local, path_join, shell_ok, shell_output, shell_result};
use serde::Serialize;

/// Timeout flags appended to every `npm install` to prevent hangs.
/// fetch-timeout=120s (openclaw is ~224MB), retry-maxtimeout=15s, max 2 retries.
const NPM_TIMEOUT_FLAGS: &str =
    "--fetch-timeout=120000 --fetch-retry-maxtimeout=15000 --fetch-retries=2";

const NPMMIRROR: &str = "https://registry.npmmirror.com";
const DEPLOY_PROGRESS_EVENT: &str = "deploy-download-progress";

#[derive(Serialize, Clone)]
pub struct DeployDownloadProgress {
    pub step: String,
    pub phase: String,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub speed_bps: f64,
}

fn likely_chinese_locale() -> bool {
    crate::platform::detect_chinese_locale()
}

/// Build an `npm install -g` command with timeout flags and optional registry override.
fn npm_install_cmd(pkg: &str, registry: Option<&str>) -> String {
    match registry {
        Some(reg) => format!("npm install -g {pkg} --registry {reg} {NPM_TIMEOUT_FLAGS}"),
        None => format!("npm install -g {pkg} {NPM_TIMEOUT_FLAGS}"),
    }
}

fn npm_error_line(s: &str) -> String {
    crate::deploy::diagnosis::extract_error_line(s, "")
}

#[derive(Debug, PartialEq)]
pub enum NpmError {
    PermissionDenied,
    NetworkTimeout,
    CacheCorrupted,
    SslError,
    DiskFull,
    Unknown,
}

pub fn classify_npm_error(stderr: &str, stdout: &str) -> NpmError {
    let c = format!("{} {}", stderr, stdout).to_lowercase();
    if c.contains("enospc") || c.contains("no space left") {
        NpmError::DiskFull
    } else if c.contains("eacces")
        || c.contains("eperm")
        || c.contains("permission denied")
        || c.contains("access denied")
    {
        NpmError::PermissionDenied
    } else if c.contains("etimedout")
        || c.contains("econnreset")
        || c.contains("econnrefused")
        || c.contains("enotfound")
        || c.contains("fetch failed")
    {
        NpmError::NetworkTimeout
    } else if c.contains("enotempty")
        || c.contains("eexist")
        || c.contains("integrity")
        || c.contains("checksum")
    {
        NpmError::CacheCorrupted
    } else if c.contains("cert") || c.contains("ssl") || c.contains("certificate") {
        NpmError::SslError
    } else {
        NpmError::Unknown
    }
}

pub fn npm_install_with_fallback(pkg: &str) -> (bool, String, Vec<String>) {
    let mut fixes: Vec<String> = Vec::new();
    let cn = likely_chinese_locale();

    // Determine attempt order: Chinese locale → npmmirror first, then official.
    // Other locales → official first, then npmmirror as fallback.
    let (primary_reg, fallback_reg): (Option<&str>, Option<&str>) = if cn {
        fixes.push("cn-locale-detected".to_string());
        (Some(NPMMIRROR), None)
    } else {
        (None, Some(NPMMIRROR))
    };

    // ── Attempt 1: primary registry ─────────────────────────────────────────
    let cmd1 = npm_install_cmd(pkg, primary_reg);
    let (ok1, stdout1, stderr1) = shell_result(&cmd1);
    if ok1 {
        return (true, format!("{pkg} installed"), fixes);
    }

    let err1_class = classify_npm_error(&stderr1, &stdout1);

    // ── Attempt 2: fallback registry ────────────────────────────────────────
    if matches!(err1_class, NpmError::NetworkTimeout | NpmError::Unknown) {
        if let Some(fb) = fallback_reg {
            fixes.push("switch-npmmirror".to_string());
            let cmd2 = npm_install_cmd(pkg, Some(fb));
            let (ok2, _out2, err2) = shell_result(&cmd2);
            if ok2 {
                return (true, format!("{pkg} installed via npmmirror"), fixes);
            }
            if classify_npm_error(&err2, &_out2) == NpmError::PermissionDenied {
                return npm_install_user_prefix(pkg, fixes);
            }
        } else if cn {
            // Already tried npmmirror; now try official as fallback
            fixes.push("fallback-official-registry".to_string());
            let cmd2 = npm_install_cmd(pkg, None);
            let (ok2, _out2, err2) = shell_result(&cmd2);
            if ok2 {
                return (true, format!("{pkg} installed via official"), fixes);
            }
            if classify_npm_error(&err2, &_out2) == NpmError::PermissionDenied {
                return npm_install_user_prefix(pkg, fixes);
            }
        }
    }

    // ── Attempt 3: handle specific error types ──────────────────────────────
    match err1_class {
        NpmError::PermissionDenied => {
            return npm_install_user_prefix(pkg, fixes);
        }
        NpmError::CacheCorrupted => {
            fixes.push("clean-npm-cache".to_string());
            shell_ok("npm cache clean --force");
            let cmd = npm_install_cmd(pkg, primary_reg);
            let (ok, _, _) = shell_result(&cmd);
            if ok {
                return (true, format!("{pkg} installed after cache clean"), fixes);
            }
        }
        NpmError::SslError => {
            fixes.push("disable-ssl-temporarily".to_string());
            shell_ok("npm config set strict-ssl false");
            let cmd = npm_install_cmd(pkg, primary_reg);
            let (ok, _, _) = shell_result(&cmd);
            shell_ok("npm config set strict-ssl true");
            if ok {
                return (true, format!("{pkg} installed after ssl fix"), fixes);
            }
        }
        NpmError::DiskFull => {
            #[cfg(target_os = "windows")]
            let detail = {
                let free = shell_output("powershell -NoProfile -Command \"(Get-PSDrive C).Free\"");
                let free_mb = free
                    .trim()
                    .parse::<u64>()
                    .map(|b| b / 1_048_576)
                    .unwrap_or(0);
                format!("disk-full: only {free_mb}MB free on C:")
            };
            #[cfg(not(target_os = "windows"))]
            let detail = "disk-full: no space left on device".to_string();
            return (false, detail, fixes);
        }
        _ => {}
    }

    // ── Attempt 4: user-prefix install (works without admin rights) ─────────
    fixes.push("try-user-prefix".to_string());
    let (pfx_ok, pfx_detail, pfx_fixes) = npm_install_user_prefix(pkg, fixes);
    if pfx_ok {
        return (pfx_ok, pfx_detail, pfx_fixes);
    }
    fixes = pfx_fixes;

    // ── Attempt 5: cache clean + SSL fix combo ──────────────────────────────
    fixes.push("last-resort-clean-ssl".to_string());
    shell_ok("npm cache clean --force");
    shell_ok("npm config set strict-ssl false");
    let cmd_last = npm_install_cmd(pkg, if cn { Some(NPMMIRROR) } else { None });
    let (ok_last, out_last, err_last) = shell_result(&cmd_last);
    shell_ok("npm config set strict-ssl true");
    if ok_last {
        return (true, format!("{pkg} installed after clean+ssl fix"), fixes);
    }

    let combined = format!("{}\n{}", &err_last, &out_last);
    let detail = format!("install-failed: {}", npm_error_line(&combined));
    fixes.push(detail.clone());
    (false, detail, fixes)
}

fn npm_install_user_prefix(pkg: &str, mut fixes: Vec<String>) -> (bool, String, Vec<String>) {
    let local = data_local();
    let prefix = path_join(&local, "clawno-npm-global");
    let prefix_bin = if cfg!(target_os = "windows") {
        prefix.clone()
    } else {
        path_join(&prefix, "bin")
    };
    fixes.push(format!("user-prefix-install:{}", prefix_bin));
    let _ = std::fs::create_dir_all(&prefix_bin);
    let registry_flag = if likely_chinese_locale() {
        format!(" --registry {NPMMIRROR}")
    } else {
        String::new()
    };
    let cmd =
        format!("npm install -g {pkg} --prefix \"{prefix}\" {NPM_TIMEOUT_FLAGS}{registry_flag}");
    let (ok, _, stderr) = shell_result(&cmd);
    if !ok {
        let detail = format!("user-prefix-failed: {}", npm_error_line(&stderr));
        fixes.push(detail.clone());
        return (false, detail, fixes);
    }
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.contains(&prefix_bin) {
        let sep = if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        };
        std::env::set_var("PATH", format!("{}{}{}", prefix_bin, sep, current));
    }
    persist_path_to_profile(&prefix_bin, &mut fixes);
    (true, format!("{pkg} installed to user prefix"), fixes)
}

/// Append `dir` to the user's shell profile so it persists across restarts.
fn persist_path_to_profile(dir: &str, fixes: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let _ = shell_result(&format!(
            "powershell -NoProfile -Command \
             \"$p = [Environment]::GetEnvironmentVariable('PATH','User'); \
              if ($p -notlike '*{dir}*') {{ \
                [Environment]::SetEnvironmentVariable('PATH', '{dir};' + $p, 'User') \
              }}\"",
            dir = dir.replace('\'', "''")
        ));
        fixes.push("persist-path-windows-user-env".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() {
            return;
        }
        let export_line = format!("export PATH=\"{}:$PATH\"", dir);
        let profiles = [
            ".zshrc",
            ".bashrc",
            ".zprofile",
            ".bash_profile",
            ".profile",
        ];
        for name in &profiles {
            let path = format!("{}/{}", home, name);
            if std::path::Path::new(&path).exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if content.contains(dir) {
                        continue;
                    }
                }
                let entry = format!(
                    "\n# Added by ClawNo.11 for user-prefix npm packages\n{}\n",
                    export_line
                );
                let _ = std::fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
                fixes.push(format!("persist-path-unix:{}", name));
                return;
            }
        }
    }
}

/// Download an npm package tarball with real-time progress events, then
/// install from the local file.  Falls back gracefully — the caller should
/// retry via `npm_install_with_fallback` when this returns `ok == false`.
///
/// Emits both the legacy `deploy-download-progress` event and the new unified
/// `deploy-step-progress` event so both old and new frontend code works.
pub async fn download_and_install_npm_package(
    app: &tauri::AppHandle,
    pkg: &str,
    step_name: &str,
) -> (bool, String, Vec<String>) {
    use tauri::Emitter;

    let mut fixes: Vec<String> = Vec::new();
    let cn = likely_chinese_locale();
    let stall_timeout = std::time::Duration::from_secs(30);

    let emit_both =
        |app: &tauri::AppHandle, phase: &str, downloaded: u64, total: u64, speed: f64| {
            // Legacy event for backward compatibility
            let _ = app.emit(
                DEPLOY_PROGRESS_EVENT,
                DeployDownloadProgress {
                    step: step_name.to_string(),
                    phase: phase.to_string(),
                    bytes_downloaded: downloaded,
                    bytes_total: total,
                    speed_bps: speed,
                },
            );
            // New unified progress event
            let pct = if total > 0 {
                (downloaded as f32 / total as f32) * 100.0
            } else {
                0.0
            };
            let eta = if speed > 0.0 && total > downloaded {
                ((total - downloaded) as f64 / speed) as f32
            } else {
                -1.0
            };
            let step_phase = match phase {
                "resolving" => clawno_core::types::StepPhase::Probing,
                "downloading" => clawno_core::types::StepPhase::Downloading,
                "installing-deps" => clawno_core::types::StepPhase::Installing,
                "done" => clawno_core::types::StepPhase::Done,
                _ => clawno_core::types::StepPhase::Installing,
            };
            let mut p = clawno_core::types::StepProgress::new(step_name, "npm-tarball", 0, 2);
            p.phase = step_phase;
            p.bytes_done = downloaded;
            p.bytes_total = total;
            p.speed_bps = speed;
            p.pct = pct;
            p.eta_secs = eta;
            p.message = format!("{}: {}", step_name, phase);
            let _ = app.emit(clawno_core::types::STEP_PROGRESS_EVENT, &p);
        };

    emit_both(app, "resolving", 0, 0, 0.0);

    let pkg_name = pkg.split('@').next().unwrap_or(pkg);
    let (primary_reg, fallback_reg) = if cn {
        fixes.push("cn-locale-detected".to_string());
        (NPMMIRROR, "https://registry.npmjs.org")
    } else {
        ("https://registry.npmjs.org", NPMMIRROR)
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    let tarball_url = {
        let mut url: Option<String> = None;
        for reg in &[primary_reg, fallback_reg] {
            let meta_url = format!("{}/{}/latest", reg, pkg_name);
            if let Ok(resp) = client.get(&meta_url).send().await {
                if resp.status().is_success() {
                    if let Ok(meta) = resp.json::<serde_json::Value>().await {
                        if let Some(u) = meta["dist"]["tarball"].as_str() {
                            url = Some(u.to_string());
                            break;
                        }
                    }
                }
            }
            fixes.push(format!("registry-fallback:{}", reg));
        }
        match url {
            Some(u) => u,
            None => {
                fixes.push("registry-unreachable".to_string());
                return (false, "registry-unreachable".to_string(), fixes);
            }
        }
    };

    let dl_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    let download_resp = match dl_client.get(&tarball_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status();
            fixes.push(format!("download-http-{}", status.as_u16()));
            return (false, format!("download-http-{}", status), fixes);
        }
        Err(e) => {
            fixes.push(format!("download-connect-failed:{}", e));
            return (false, format!("download-connect-failed: {}", e), fixes);
        }
    };

    let temp_dir = std::env::temp_dir();
    let tarball_path = temp_dir.join(format!("{}-latest.tgz", pkg_name));

    emit_both(
        app,
        "downloading",
        0,
        download_resp.content_length().unwrap_or(0),
        0.0,
    );
    let download_start = std::time::Instant::now();

    // Use watchdog-guarded download with 30s stall detection
    let app_clone = app.clone();
    let step_name_owned = step_name.to_string();
    let download_result = crate::deploy::watchdog::download_to_file_with_watchdog(
        download_resp,
        &tarball_path,
        stall_timeout,
        move |done, total, speed| {
            let pct = if total > 0 {
                (done as f32 / total as f32) * 100.0
            } else {
                0.0
            };
            let eta = if speed > 0.0 && total > done {
                ((total - done) as f64 / speed) as f32
            } else {
                -1.0
            };
            let _ = app_clone.emit(
                DEPLOY_PROGRESS_EVENT,
                DeployDownloadProgress {
                    step: step_name_owned.clone(),
                    phase: "downloading".to_string(),
                    bytes_downloaded: done,
                    bytes_total: total,
                    speed_bps: speed,
                },
            );
            let mut p =
                clawno_core::types::StepProgress::new(&step_name_owned, "npm-tarball", 0, 2);
            p.phase = clawno_core::types::StepPhase::Downloading;
            p.bytes_done = done;
            p.bytes_total = total;
            p.speed_bps = speed;
            p.pct = pct;
            p.eta_secs = eta;
            let _ = app_clone.emit(clawno_core::types::STEP_PROGRESS_EVENT, &p);
        },
    )
    .await;

    let downloaded = match download_result {
        Ok(size) => size,
        Err(e) => {
            fixes.push(format!("download-failed:{}", e));
            return (false, e, fixes);
        }
    };

    let avg_speed = {
        let elapsed = download_start.elapsed().as_secs_f64();
        if elapsed > 0.1 {
            downloaded as f64 / elapsed
        } else {
            0.0
        }
    };

    emit_both(app, "installing-deps", downloaded, downloaded, avg_speed);

    let tarball_str = tarball_path.to_string_lossy().to_string();
    let registry_flag = if cn {
        format!(" --registry {NPMMIRROR}")
    } else {
        String::new()
    };
    let cmd = format!("npm install -g \"{tarball_str}\" {NPM_TIMEOUT_FLAGS}{registry_flag}");
    let (ok, _stdout, stderr) = shell_result(&cmd);

    if !ok {
        let err_class = classify_npm_error(&stderr, &_stdout);
        if err_class == NpmError::PermissionDenied {
            fixes.push("tarball-global-permission-denied".to_string());
            let local = data_local();
            let prefix = path_join(&local, "clawno-npm-global");
            let prefix_bin = if cfg!(target_os = "windows") {
                prefix.clone()
            } else {
                path_join(&prefix, "bin")
            };
            let _ = std::fs::create_dir_all(&prefix_bin);
            let cmd2 = format!("npm install -g \"{}\" --prefix \"{}\"", tarball_str, prefix);
            let (ok2, _, stderr2) = shell_result(&cmd2);
            let _ = std::fs::remove_file(&tarball_path);
            if ok2 {
                let current = std::env::var("PATH").unwrap_or_default();
                let sep = if cfg!(target_os = "windows") {
                    ";"
                } else {
                    ":"
                };
                if !current.contains(&prefix_bin) {
                    std::env::set_var("PATH", format!("{}{}{}", prefix_bin, sep, current));
                }
                persist_path_to_profile(&prefix_bin, &mut fixes);
                emit_both(app, "done", downloaded, downloaded, avg_speed);
                return (true, format!("{} installed to user prefix", pkg), fixes);
            }
            let detail = format!("user-prefix-failed: {}", npm_error_line(&stderr2));
            fixes.push(detail.clone());
            return (false, detail, fixes);
        }
        let _ = std::fs::remove_file(&tarball_path);
        let detail = format!(
            "install-failed: {}",
            npm_error_line(&format!("{}\n{}", &stderr, &_stdout))
        );
        fixes.push(detail.clone());
        return (false, detail, fixes);
    }

    let _ = std::fs::remove_file(&tarball_path);
    emit_both(app, "done", downloaded, downloaded, avg_speed);
    (true, format!("{} installed from tarball", pkg), fixes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_permission_denied() {
        assert_eq!(
            classify_npm_error("Error: EACCES permission denied", ""),
            NpmError::PermissionDenied
        );
    }

    #[test]
    fn classify_network_timeout() {
        assert_eq!(
            classify_npm_error("ETIMEDOUT connect", ""),
            NpmError::NetworkTimeout
        );
    }

    #[test]
    fn classify_disk_full() {
        assert_eq!(
            classify_npm_error("ENOSPC no space left on device", ""),
            NpmError::DiskFull
        );
    }

    #[test]
    fn classify_ssl_error() {
        assert_eq!(
            classify_npm_error("SSL certificate problem", ""),
            NpmError::SslError
        );
    }

    #[test]
    fn classify_unknown_fallback() {
        assert_eq!(
            classify_npm_error("some random error", ""),
            NpmError::Unknown
        );
    }
}
