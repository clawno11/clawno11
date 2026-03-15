use super::npm::{download_and_install_npm_package, npm_install_with_fallback};
#[cfg(not(target_os = "windows"))]
use super::scan::inject_bin_dir;
use super::scan::{
    inject_dir, node_major, node_version_direct, openclaw_semver, scan_openclaw_bin_dir,
};
use crate::deploy::executor::{StepContext, Strategy, StrategyChain, StrategyOutcome};
use crate::deploy::watchdog;
use crate::platform::{detect_platform, first_line, shell_output, shell_result, PlatformProfile};
use clawno_core::types::{StepPhase, StepProgress, StepResult};
use std::time::Duration;

// ── Node.js install strategies ───────────────────────────────────────────────

fn verify_node() -> Option<String> {
    let ver = shell_output("node --version");
    if node_major(&ver) >= 22 {
        return Some(ver);
    }
    let ver_d = node_version_direct();
    if node_major(&ver_d) >= 22 {
        return Some(ver_d);
    }
    None
}

/// Verify both node >= 22 AND npm are available.
/// Returns `Some("vXX.Y.Z (npm vA.B.C)")` when both work, `None` otherwise.
fn verify_node_and_npm() -> Option<String> {
    let node_ver = verify_node()?;
    if is_npm_available() {
        let npm_ver = shell_output("npm --version").trim().to_string();
        Some(format!("{} (npm v{})", node_ver.trim(), npm_ver))
    } else {
        Some(format!("{} (npm missing)", node_ver.trim()))
    }
}

pub fn is_npm_available() -> bool {
    let out = shell_output("npm --version");
    let trimmed = out.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
}

/// If node is present but npm is missing, attempt to bootstrap npm.
/// Returns a list of fixes applied, and whether npm is now available.
pub fn ensure_npm(fixes: &mut Vec<String>) -> bool {
    if is_npm_available() {
        return true;
    }
    fixes.push("npm-missing-attempting-repair".to_string());

    // Strategy A: corepack (bundled with Node 16.9+)
    let (ok_cp, _, _) = shell_result("corepack enable");
    if ok_cp {
        fixes.push("corepack-enable-ok".to_string());
        if is_npm_available() {
            return true;
        }
    }

    // Strategy B (Windows): reinstall Node via winget to get full package
    #[cfg(target_os = "windows")]
    {
        let profile = detect_platform();
        // Try refreshing PATH first — npm might exist but not in PATH
        refresh_windows_path(fixes);
        if is_npm_available() {
            fixes.push("npm-found-after-path-refresh".to_string());
            return true;
        }
        // Try winget repair
        if profile.has_winget {
            fixes.push("winget-reinstall-node".to_string());
            let (ok, _, _) = shell_result(
                "winget install OpenJS.NodeJS.LTS -e --silent --scope user \
                 --accept-package-agreements --accept-source-agreements",
            );
            if ok {
                refresh_windows_path(fixes);
                if is_npm_available() {
                    return true;
                }
            }
        }
        // Try choco
        if profile.has_choco {
            fixes.push("choco-reinstall-node".to_string());
            let (ok, _, _) = shell_result("choco install nodejs-lts -y --force");
            if ok {
                refresh_windows_path(fixes);
                if is_npm_available() {
                    return true;
                }
            }
        }
    }

    // Strategy B (macOS): brew reinstall
    #[cfg(target_os = "macos")]
    {
        fixes.push("brew-reinstall-node".to_string());
        let (ok, _, _) = shell_result("brew reinstall node@22");
        if ok && is_npm_available() {
            return true;
        }
        let (ok2, _, _) = shell_result("brew link --overwrite node@22");
        if ok2 && is_npm_available() {
            return true;
        }
    }

    // Strategy B (Linux): install npm package separately
    #[cfg(target_os = "linux")]
    {
        let profile = detect_platform();
        if profile.has_apt {
            fixes.push("apt-install-npm".to_string());
            let (ok, _, _) =
                shell_result("apt-get install -y npm 2>/dev/null || sudo apt-get install -y npm");
            if ok && is_npm_available() {
                return true;
            }
        }
        if profile.has_dnf {
            fixes.push("dnf-install-npm".to_string());
            let (ok, _, _) =
                shell_result("dnf install -y npm 2>/dev/null || sudo dnf install -y npm");
            if ok && is_npm_available() {
                return true;
            }
        }
        if profile.has_pacman {
            fixes.push("pacman-install-npm".to_string());
            let (ok, _, _) = shell_result(
                "pacman -Sy --noconfirm npm 2>/dev/null || sudo pacman -Sy --noconfirm npm",
            );
            if ok && is_npm_available() {
                return true;
            }
        }
    }

    // Strategy C: download Node.js full package as last resort
    // (the DirectDownloadNodeStrategy already installs full node+npm)
    fixes.push("npm-repair-exhausted".to_string());
    false
}

fn refresh_windows_path(#[allow(unused_variables)] fixes: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let new_path = shell_output(
            "powershell -NoProfile -Command \"\
             $m=[System.Environment]::GetEnvironmentVariable('PATH','Machine'); \
             $u=[System.Environment]::GetEnvironmentVariable('PATH','User'); \
             \"$m;$u\"\"",
        );
        if !new_path.is_empty() {
            fixes.push("injected-registry-path".to_string());
            let current = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{};{}", new_path, current));
        }
    }
}

// ── Strategy: direct MSI (Windows) — 官方 MSI 运行时可可靠触发 UAC ─────────────

#[cfg(target_os = "windows")]
struct DirectMsiNodeStrategy;

#[cfg(target_os = "windows")]
#[async_trait::async_trait]
impl Strategy for DirectMsiNodeStrategy {
    fn name(&self) -> &str {
        "direct-msi"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        use crate::deploy::trust;
        use clawno_core::types::{StepPhase, StepProgress};

        let version = "v22.16.0";
        let url = ctx.profile.node_msi_download_url(version);
        let trust_level = trust::classify_url(&url);

        let downloads_dir =
            crate::platform::path_join(&crate::platform::data_local(), "clawno\\downloads");
        let _ = std::fs::create_dir_all(&downloads_dir);
        let ver_strip = version.trim_start_matches('v');
        let arch = match ctx.profile.arch.as_str() {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            _ => "x64",
        };
        let msi_name = format!("node-{}-{}.msi", ver_strip, arch);
        let msi_path = std::path::Path::new(&downloads_dir).join(&msi_name);

        let emitter = ctx.emitter.clone();
        let step_id = "install-node".to_string();
        let step_id_dl = step_id.clone();
        let emitter_dl = emitter.clone();

        // Download
        if !msi_path.exists()
            || std::fs::metadata(&msi_path)
                .map(|m| m.len() < 10_000_000)
                .unwrap_or(true)
        {
            let mut p = StepProgress::new(&step_id, "direct-msi", 0, 1);
            p.phase = StepPhase::Downloading;
            p.message = "正在下载 Node.js 官方安装包…".to_string();
            p.source_url = Some(url.clone());
            p.source_trust = Some(trust_level.clone());
            emitter.emit(&p);

            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default();
            let resp = match client.get(&url).send().await {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    return StrategyOutcome::Failed {
                        stdout: String::new(),
                        stderr: format!("HTTP {}", r.status()),
                        exit_code: None,
                    };
                }
                Err(e) => {
                    return StrategyOutcome::Failed {
                        stdout: String::new(),
                        stderr: e.to_string(),
                        exit_code: None,
                    };
                }
            };

            let dl_url = url.clone();
            let dl_trust = trust_level.clone();
            let download_result = watchdog::download_to_file_with_watchdog(
                resp,
                &msi_path,
                ctx.stall_timeout,
                move |done, total, speed| {
                    let pct = if total > 0 {
                        (done as f32 / total as f32) * 100.0
                    } else {
                        0.0
                    };
                    let eta = if speed > 0.0 && total > 0 {
                        ((total - done) as f64 / speed) as f32
                    } else {
                        -1.0
                    };
                    let mut p = StepProgress::new(&step_id_dl, "direct-msi", 0, 1);
                    p.phase = StepPhase::Downloading;
                    p.bytes_done = done;
                    p.bytes_total = total;
                    p.speed_bps = speed;
                    p.pct = pct;
                    p.eta_secs = eta;
                    p.message = "正在下载 Node.js 官方安装包…".to_string();
                    p.source_url = Some(dl_url.clone());
                    p.source_trust = Some(dl_trust.clone());
                    emitter_dl.emit(&p);
                },
            )
            .await;

            if let Err(e) = download_result {
                return StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: e,
                    exit_code: None,
                };
            }
            ctx.fixes.push("node-msi-downloaded".into());
        }

        // Run MSI — 可可靠触发 Windows UAC
        let mut p = StepProgress::new(&step_id, "direct-msi", 0, 1);
        p.phase = StepPhase::WaitingForUser;
        p.message = "等待用户确认是否允许安装 Node.js（请在弹出的窗口中点击允许）…".to_string();
        p.source_url = Some("https://nodejs.org".into());
        p.source_trust = Some(trust_level);
        emitter.emit(&p);

        let path_str = msi_path.to_string_lossy().into_owned();
        let cmd = format!(r#"msiexec /i "{}""#, path_str);
        let result = watchdog::run_with_watchdog(&cmd, ctx.stall_timeout, |_| {}, true).await;

        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                refresh_windows_path(&mut ctx.fixes);
                // 0 = success, 3010 = ERROR_SUCCESS_REBOOT_REQUIRED（安装成功但需重启）
                if exit_code == 0 || exit_code == 3010 {
                    for dir in &[
                        r"C:\Program Files\nodejs",
                        &format!("{}\\Programs\\nodejs", crate::platform::data_local()),
                    ] {
                        let bin = format!("{}\\node.exe", dir);
                        if let Ok(o) = std::process::Command::new(&bin).arg("--version").output() {
                            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            if node_major(&v) >= 22 {
                                inject_dir(dir);
                                ctx.fixes.push("found-via-msi-install".into());
                                return StrategyOutcome::Success("direct-msi-installed".into());
                            }
                        }
                    }
                    StrategyOutcome::Success("direct-msi-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: winget ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
struct WingetStrategy;

#[cfg(target_os = "windows")]
#[async_trait::async_trait]
impl Strategy for WingetStrategy {
    fn name(&self) -> &str {
        "winget"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        use clawno_core::types::{StepPhase, StepProgress};

        // Emit WaitingForUser — progress bar shows "等待用户确认是否允许"
        // Windows UAC will pop when winget runs (allow_window=true)
        {
            let mut p = StepProgress::new(
                "install-node",
                "winget",
                ctx.strategy_idx,
                ctx.strategy_total,
            );
            p.phase = StepPhase::WaitingForUser;
            p.message = "等待用户确认是否允许安装 Node.js…".to_string();
            ctx.emitter.emit(&p);
        }

        let result = watchdog::run_with_watchdog(
            "winget install OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements",
            ctx.stall_timeout,
            |_line| {},
            true,
        ).await;

        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                refresh_windows_path(&mut ctx.fixes);
                if exit_code == 0 {
                    for dir in &[
                        r"C:\Program Files\nodejs",
                        &format!("{}\\Programs\\nodejs", crate::platform::data_local()),
                    ] {
                        let bin = format!("{}\\node.exe", dir);
                        if let Ok(o) = std::process::Command::new(&bin).arg("--version").output() {
                            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            if node_major(&v) >= 22 {
                                inject_dir(dir);
                                ctx.fixes.push("found-via-program-files".into());
                            }
                        }
                    }
                    StrategyOutcome::Success("winget-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: choco ──────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
struct ChocoStrategy;

#[cfg(target_os = "windows")]
#[async_trait::async_trait]
impl Strategy for ChocoStrategy {
    fn name(&self) -> &str {
        "choco"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let result = watchdog::run_with_watchdog(
            "choco install nodejs-lts -y --no-progress",
            ctx.stall_timeout,
            |_line| {},
            true,
        )
        .await;

        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                refresh_windows_path(&mut ctx.fixes);
                if exit_code == 0 {
                    StrategyOutcome::Success("choco-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: nvm (Unix / Windows) ───────────────────────────────────────────

struct NvmStrategy;

#[async_trait::async_trait]
impl Strategy for NvmStrategy {
    fn name(&self) -> &str {
        "nvm"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        #[cfg(target_os = "windows")]
        {
            let result = watchdog::run_with_watchdog(
                "nvm install 22 && nvm use 22",
                ctx.stall_timeout,
                |_| {},
                false,
            )
            .await;
            return match result {
                watchdog::WatchdogResult::Completed {
                    exit_code,
                    stdout,
                    stderr,
                } => {
                    if exit_code == 0 {
                        StrategyOutcome::Success("nvm-installed".into())
                    } else {
                        StrategyOutcome::Failed {
                            stdout,
                            stderr,
                            exit_code: Some(exit_code),
                        }
                    }
                }
                watchdog::WatchdogResult::Stalled {
                    partial_stdout,
                    partial_stderr,
                    ..
                } => StrategyOutcome::Stalled {
                    stdout: partial_stdout,
                    stderr: partial_stderr,
                },
                watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: msg,
                    exit_code: None,
                },
            };
        }
        #[cfg(not(target_os = "windows"))]
        {
            let nvm = super::scan::nvm_dir();
            let nvm_sh = format!("{nvm}/nvm.sh");
            if !std::path::Path::new(&nvm_sh).exists() {
                return StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: "nvm not found".into(),
                    exit_code: None,
                };
            }
            let cmd = format!(
                "export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" \
                 && nvm install 22 >/dev/null 2>&1 \
                 && nvm use 22 >/dev/null 2>&1 \
                 && nvm alias default 22 >/dev/null 2>&1 \
                 && which node 2>/dev/null"
            );
            let result = watchdog::run_with_watchdog(&cmd, ctx.stall_timeout, |_| {}, false).await;
            match result {
                watchdog::WatchdogResult::Completed {
                    exit_code,
                    stdout,
                    stderr,
                } => {
                    let node_path = stdout.trim().to_string();
                    if exit_code == 0
                        && !node_path.is_empty()
                        && std::path::Path::new(&node_path).exists()
                    {
                        inject_bin_dir(&node_path);
                        StrategyOutcome::Success("nvm-installed".into())
                    } else {
                        StrategyOutcome::Failed {
                            stdout,
                            stderr,
                            exit_code: Some(exit_code),
                        }
                    }
                }
                watchdog::WatchdogResult::Stalled {
                    partial_stdout,
                    partial_stderr,
                    ..
                } => StrategyOutcome::Stalled {
                    stdout: partial_stdout,
                    stderr: partial_stderr,
                },
                watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: msg,
                    exit_code: None,
                },
            }
        }
    }
}

// ── Strategy: fnm ────────────────────────────────────────────────────────────

struct FnmStrategy;

#[async_trait::async_trait]
impl Strategy for FnmStrategy {
    fn name(&self) -> &str {
        "fnm"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let result = watchdog::run_with_watchdog(
            "fnm install 22 && fnm default 22",
            ctx.stall_timeout,
            |_| {},
            false,
        )
        .await;
        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                if exit_code == 0 {
                    StrategyOutcome::Success("fnm-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: brew (macOS) ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
struct BrewStrategy;

#[cfg(target_os = "macos")]
#[async_trait::async_trait]
impl Strategy for BrewStrategy {
    fn name(&self) -> &str {
        "brew"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let result = watchdog::run_with_watchdog(
            "HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1 brew install node@22 && brew link node@22 --force --overwrite",
            Duration::from_secs(120),
            |_| {},
            false,
        ).await;
        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                if exit_code == 0 {
                    let brew_bin = shell_output("brew --prefix node@22 2>/dev/null");
                    if !brew_bin.is_empty() {
                        let node_bin = format!("{}/bin", brew_bin.trim());
                        let current = std::env::var("PATH").unwrap_or_default();
                        if !current.contains(&node_bin) {
                            std::env::set_var("PATH", format!("{}:{}", node_bin, current));
                        }
                    }
                    StrategyOutcome::Success("brew-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: apt (Linux) ────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
struct AptStrategy;

#[cfg(target_os = "linux")]
#[async_trait::async_trait]
impl Strategy for AptStrategy {
    fn name(&self) -> &str {
        "apt-nodesource"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let cmd = "curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | bash - >/dev/null 2>&1 && apt-get install -y nodejs >/dev/null 2>&1";
        let result =
            watchdog::run_with_watchdog(cmd, Duration::from_secs(120), |_| {}, false).await;
        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                if exit_code == 0 {
                    StrategyOutcome::Success("apt-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: dnf (Linux) ────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
struct DnfStrategy;

#[cfg(target_os = "linux")]
#[async_trait::async_trait]
impl Strategy for DnfStrategy {
    fn name(&self) -> &str {
        "dnf"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let result = watchdog::run_with_watchdog(
            "dnf install -y nodejs >/dev/null 2>&1",
            Duration::from_secs(120),
            |_| {},
            false,
        )
        .await;
        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                if exit_code == 0 {
                    StrategyOutcome::Success("dnf-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: pacman (Linux) ─────────────────────────────────────────────────

#[cfg(target_os = "linux")]
struct PacmanStrategy;

#[cfg(target_os = "linux")]
#[async_trait::async_trait]
impl Strategy for PacmanStrategy {
    fn name(&self) -> &str {
        "pacman"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        let result = watchdog::run_with_watchdog(
            "pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1",
            Duration::from_secs(120),
            |_| {},
            false,
        )
        .await;
        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                if exit_code == 0 {
                    StrategyOutcome::Success("pacman-installed".into())
                } else {
                    StrategyOutcome::Failed {
                        stdout,
                        stderr,
                        exit_code: Some(exit_code),
                    }
                }
            }
            watchdog::WatchdogResult::Stalled {
                partial_stdout,
                partial_stderr,
                ..
            } => StrategyOutcome::Stalled {
                stdout: partial_stdout,
                stderr: partial_stderr,
            },
            watchdog::WatchdogResult::SpawnFailed(msg) => StrategyOutcome::Failed {
                stdout: String::new(),
                stderr: msg,
                exit_code: None,
            },
        }
    }
}

// ── Strategy: direct download from nodejs.org ────────────────────────────────

struct DirectDownloadNodeStrategy;

#[async_trait::async_trait]
impl Strategy for DirectDownloadNodeStrategy {
    fn name(&self) -> &str {
        "direct-download"
    }

    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome {
        use crate::deploy::trust;

        let version = "v22.16.0";
        let url = ctx.profile.node_download_url(version);
        let trust_level = trust::classify_url(&url);

        let dest_dir = if cfg!(target_os = "windows") {
            crate::platform::path_join(&crate::platform::data_local(), "clawno\\node")
        } else {
            crate::platform::path_join(&crate::platform::user_home(), ".clawno/node")
        };
        let _ = std::fs::create_dir_all(&dest_dir);

        let downloads_dir = if cfg!(target_os = "windows") {
            crate::platform::path_join(&crate::platform::data_local(), "clawno\\downloads")
        } else {
            crate::platform::path_join(&crate::platform::user_home(), ".clawno/downloads")
        };
        let _ = std::fs::create_dir_all(&downloads_dir);

        let ext = if ctx.profile.os == "windows" {
            "zip"
        } else {
            "tar.gz"
        };
        let archive_path =
            std::path::PathBuf::from(&downloads_dir).join(format!("node-{version}.{ext}"));

        let emitter = ctx.emitter.clone();
        let step_id = "install-node".to_string();
        let total_strategies = 1u8;

        let cached = archive_path.exists()
            && std::fs::metadata(&archive_path)
                .map(|m| m.len() > 1024 * 1024)
                .unwrap_or(false);

        if cached {
            ctx.fixes.push("download-cached".to_string());
            let mut p = StepProgress::new(&step_id, "direct-download", 0, total_strategies);
            p.phase = StepPhase::Downloaded;
            p.message = format!("Node.js {version} already downloaded");
            p.source_url = Some(url.clone());
            p.source_trust = Some(trust_level.clone());
            emitter.emit(&p);
        } else {
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default();

            let resp = match client.get(&url).send().await {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    return StrategyOutcome::Failed {
                        stdout: String::new(),
                        stderr: format!("HTTP {}", r.status()),
                        exit_code: None,
                    };
                }
                Err(e) => {
                    return StrategyOutcome::Failed {
                        stdout: String::new(),
                        stderr: e.to_string(),
                        exit_code: None,
                    };
                }
            };

            let dl_url = url.clone();
            let dl_trust = trust_level.clone();
            let dl_emitter = emitter.clone();
            let dl_step_id = step_id.clone();
            let download_result = watchdog::download_to_file_with_watchdog(
                resp,
                &archive_path,
                ctx.stall_timeout,
                move |done, total, speed| {
                    let pct = if total > 0 {
                        (done as f32 / total as f32) * 100.0
                    } else {
                        0.0
                    };
                    let eta = if speed > 0.0 && total > 0 {
                        ((total - done) as f64 / speed) as f32
                    } else {
                        -1.0
                    };
                    let mut p =
                        StepProgress::new(&dl_step_id, "direct-download", 0, total_strategies);
                    p.phase = StepPhase::Downloading;
                    p.bytes_done = done;
                    p.bytes_total = total;
                    p.speed_bps = speed;
                    p.pct = pct;
                    p.eta_secs = eta;
                    p.message = format!("downloading Node.js {version}");
                    p.source_url = Some(dl_url.clone());
                    p.source_trust = Some(dl_trust.clone());
                    dl_emitter.emit(&p);
                },
            )
            .await;

            let downloaded = match download_result {
                Ok(size) => size,
                Err(e) => {
                    return StrategyOutcome::Failed {
                        stdout: String::new(),
                        stderr: e,
                        exit_code: None,
                    };
                }
            };

            ctx.fixes.push(format!("downloaded:{}bytes", downloaded));

            // Emit "downloaded" phase — download complete, pending install
            let mut p = StepProgress::new(&step_id, "direct-download", 0, total_strategies);
            p.phase = StepPhase::Downloaded;
            p.message = format!("Node.js {version} download complete, installing...");
            p.source_url = Some(url.clone());
            p.source_trust = Some(trust_level.clone());
            emitter.emit(&p);
        }

        // Emit installing phase
        {
            let mut p = StepProgress::new(&step_id, "direct-download", 0, total_strategies);
            p.phase = StepPhase::Installing;
            p.message = format!("extracting Node.js {version}...");
            emitter.emit(&p);
        }

        // Extract the archive
        #[cfg(target_os = "windows")]
        {
            let extract_cmd = format!(
                "powershell -NoProfile -Command \"Expand-Archive -Path '{}' -DestinationPath '{}' -Force\"",
                archive_path.display(),
                dest_dir
            );
            let (ok, _, stderr) = shell_result(&extract_cmd);
            let _ = std::fs::remove_file(&archive_path);
            if !ok {
                return StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: format!("extract-failed: {}", stderr),
                    exit_code: None,
                };
            }
            // The zip extracts to node-vXX.XX.X-win-x64/ inside dest_dir
            let inner_dir = format!(
                "{}\\node-{}-win-{}",
                dest_dir,
                version,
                if ctx.profile.arch == "aarch64" {
                    "arm64"
                } else {
                    "x64"
                }
            );
            inject_dir(&inner_dir);
            ctx.fixes.push(format!("inject-path:{}", inner_dir));
        }
        #[cfg(not(target_os = "windows"))]
        {
            let extract_cmd = format!("tar -xzf '{}' -C '{}'", archive_path.display(), dest_dir);
            let (ok, _, stderr) = shell_result(&extract_cmd);
            let _ = std::fs::remove_file(&archive_path);
            if !ok {
                return StrategyOutcome::Failed {
                    stdout: String::new(),
                    stderr: format!("extract-failed: {}", stderr),
                    exit_code: None,
                };
            }
            let os_part = if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            };
            let arch_part = if ctx.profile.arch == "aarch64" {
                "arm64"
            } else {
                "x64"
            };
            let inner_bin = format!(
                "{}/node-{}-{}-{}/bin",
                dest_dir, version, os_part, arch_part
            );
            let node_path = format!("{}/node", inner_bin);
            if std::path::Path::new(&node_path).exists() {
                inject_bin_dir(&node_path);
                ctx.fixes.push(format!("inject-path:{}", inner_bin));
            }
        }

        StrategyOutcome::Success(format!("direct-download-{}", version))
    }
}

// ── Build strategy chain based on platform ───────────────────────────────────

fn build_node_strategies(profile: &PlatformProfile) -> Vec<Box<dyn Strategy>> {
    let mut strategies: Vec<Box<dyn Strategy>> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 官方 MSI 优先：运行时可可靠触发 UAC，不同用户下更稳定
        strategies.push(Box::new(DirectMsiNodeStrategy));
        if profile.has_nvm {
            strategies.push(Box::new(NvmStrategy));
        }
        if profile.has_fnm {
            strategies.push(Box::new(FnmStrategy));
        }
        if profile.has_winget {
            strategies.push(Box::new(WingetStrategy));
        }
        if profile.has_choco {
            strategies.push(Box::new(ChocoStrategy));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if profile.has_nvm {
            strategies.push(Box::new(NvmStrategy));
        }
        if profile.has_fnm {
            strategies.push(Box::new(FnmStrategy));
        }
        if profile.has_brew {
            strategies.push(Box::new(BrewStrategy));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if profile.has_nvm {
            strategies.push(Box::new(NvmStrategy));
        }
        if profile.has_apt {
            strategies.push(Box::new(AptStrategy));
        }
        if profile.has_dnf {
            strategies.push(Box::new(DnfStrategy));
        }
        if profile.has_pacman {
            strategies.push(Box::new(PacmanStrategy));
        }
        if profile.has_fnm {
            strategies.push(Box::new(FnmStrategy));
        }
    }

    // Direct download is always the final fallback
    strategies.push(Box::new(DirectDownloadNodeStrategy));

    strategies
}

// ── Tauri command: check/install Node.js ──────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_check_node(app: tauri::AppHandle) -> StepResult {
    let profile = detect_platform();
    #[allow(unused_mut)]
    let mut fixes: Vec<String> = Vec::new();

    if profile.free_disk_mb > 0 && profile.free_disk_mb < 500 {
        return StepResult::err_fixed(
            format!(
                "disk-low: only {}MB free, need at least 500MB",
                profile.free_disk_mb
            ),
            fixes,
        );
    }

    // Quick check: is Node >= 22 AND npm already available?
    if let Some(full) = verify_node_and_npm() {
        return StepResult::ok(full);
    }

    // Node exists but npm is missing — try to repair npm first
    if verify_node().is_some() && !is_npm_available() && ensure_npm(&mut fixes) {
        if let Some(full) = verify_node_and_npm() {
            return StepResult::ok_fixed(full, fixes);
        }
    }

    // Check via nvm-which on Unix
    #[cfg(not(target_os = "windows"))]
    {
        let node_path = super::scan::nvm_which_node();
        if !node_path.is_empty() {
            inject_bin_dir(&node_path);
            if let Some(full) = verify_node_and_npm() {
                fixes.push("found-via-nvm-which".into());
                return StepResult::ok_fixed(full, fixes);
            }
            // nvm node found but npm missing
            if verify_node().is_some() && !is_npm_available() && ensure_npm(&mut fixes) {
                if let Some(full) = verify_node_and_npm() {
                    return StepResult::ok_fixed(full, fixes);
                }
            }
        }
    }

    // Node not found or too old — run the strategy chain.
    // Verifier requires BOTH node and npm to consider installation successful.
    let strategies = build_node_strategies(&profile);
    let chain = StrategyChain {
        step_id: "install-node".into(),
        strategies,
        stall_timeout: Duration::from_secs(600),
        verifier: Box::new(verify_node_and_npm),
    };

    let result = chain.execute(&app, &profile).await;

    // Post-chain: if node was installed but npm is still missing, attempt repair
    if result.ok && !is_npm_available() {
        let mut post_fixes: Vec<String> = result.fixes_applied.clone();
        if ensure_npm(&mut post_fixes) {
            let npm_ver = shell_output("npm --version").trim().to_string();
            return StepResult::ok_fixed(
                format!("{} (npm v{})", result.detail, npm_ver),
                post_fixes,
            );
        }
        return StepResult::err_fixed(
            "node-installed-but-npm-missing: npm could not be repaired automatically".into(),
            post_fixes,
        );
    }

    result
}

// ── Tauri command: install/update openclaw ────────────────────────────────────

fn verify_openclaw_installed() -> Option<String> {
    let v = shell_output("openclaw --version");
    let sv = openclaw_semver(&v);
    if !sv.is_empty() {
        return Some(sv);
    }
    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        inject_dir(&bin_dir);
        let v2 = shell_output("openclaw --version");
        let sv2 = openclaw_semver(&v2);
        if !sv2.is_empty() {
            return Some(sv2);
        }
    }
    None
}

fn extract_last_npm_detail(fixes: &[String]) -> String {
    fixes
        .iter()
        .rev()
        .find(|f| {
            f.starts_with("install-failed:")
                || f.starts_with("network-failed:")
                || f.starts_with("user-prefix-failed:")
                || f.starts_with("download-")
        })
        .cloned()
        .unwrap_or_else(|| "npm install failed".to_string())
}

#[tauri::command]
pub async fn deploy_step_install_openclaw(app: tauri::AppHandle) -> StepResult {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    if !sv.is_empty() {
        return StepResult::ok(format!("already-installed:{}", sv));
    }

    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        inject_dir(&bin_dir);
        let ver_check = shell_output("openclaw --version");
        let sv_check = openclaw_semver(&ver_check);
        if !sv_check.is_empty() {
            return StepResult::ok(format!("already-installed:{}", sv_check));
        }
    }

    // Guard: npm must be available before attempting install
    let mut fixes: Vec<String> = Vec::new();
    if !is_npm_available() && !ensure_npm(&mut fixes) {
        return StepResult::err_fixed(
            "npm-not-available: cannot install openclaw without npm".into(),
            fixes,
        );
    }

    // Guard: git is required by openclaw's npm dependencies
    let git_check = shell_output("git --version");
    if !git_check.trim().starts_with("git version") {
        return StepResult::err_fixed(
            "git-not-installed: openclaw requires Git. Please install Git from https://git-scm.com"
                .into(),
            vec!["git-missing-preflight".into()],
        );
    }

    let (dl_ok, _dl_detail, dl_fixes) =
        download_and_install_npm_package(&app, "openclaw", "openclaw").await;
    fixes.extend(dl_fixes);

    if let Some(sv) = verify_openclaw_installed() {
        if !dl_ok {
            fixes.push("download-fail-but-openclaw-verified".to_string());
        }
        return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
    }

    if !dl_ok {
        fixes.push("fallback-npm-install".to_string());
        let (ok, _detail, npm_fixes) = npm_install_with_fallback("openclaw");
        fixes.extend(npm_fixes);

        if let Some(sv) = verify_openclaw_installed() {
            if !ok {
                fixes.push("npm-reported-fail-but-openclaw-works".to_string());
            }
            return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
        }
    }

    StepResult::err_fixed(
        format!("openclaw-not-found: {}", extract_last_npm_detail(&fixes)),
        fixes,
    )
}

#[tauri::command]
pub async fn update_openclaw(app: tauri::AppHandle) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // Guard: npm must be available for fallback install paths
    if !is_npm_available() && !ensure_npm(&mut fixes) {
        return StepResult::err_fixed(
            "npm-not-available: cannot update openclaw without npm".into(),
            fixes,
        );
    }

    // Guard: git is required by openclaw's npm dependencies
    let git_check = shell_output("git --version");
    if !git_check.trim().starts_with("git version") {
        return StepResult::err_fixed(
            "git-not-installed: openclaw requires Git. Please install Git from https://git-scm.com"
                .into(),
            vec!["git-missing-preflight".into()],
        );
    }

    let existing_ver = {
        let v = shell_output("openclaw --version");
        let sv = openclaw_semver(&v);
        if sv.is_empty() {
            if let Some(bin_dir) = scan_openclaw_bin_dir() {
                inject_dir(&bin_dir);
                let v2 = shell_output("openclaw --version");
                openclaw_semver(&v2)
            } else {
                String::new()
            }
        } else {
            sv
        }
    };

    let (self_update_ok, self_update_out, _) = shell_result("openclaw update");
    if self_update_ok {
        fixes.push("self-update-ok".to_string());
        let ver = shell_output("openclaw --version");
        let sv = openclaw_semver(&ver);
        if !sv.is_empty() {
            return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
        }
        fixes.push("self-update-ok-but-verify-failed".to_string());
    } else {
        fixes.push(format!(
            "self-update-skipped:{}",
            first_line(&self_update_out)
                .chars()
                .take(60)
                .collect::<String>()
        ));
    }

    let (dl_ok, _dl_detail, dl_fixes) =
        download_and_install_npm_package(&app, "openclaw@latest", "openclaw").await;
    fixes.extend(dl_fixes);

    if let Some(sv) = verify_openclaw_installed() {
        if !dl_ok {
            fixes.push("download-fail-but-openclaw-verified".to_string());
        }
        return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
    }

    if !dl_ok {
        fixes.push("fallback-npm-install".to_string());
        let (ok, _detail, npm_fixes) = npm_install_with_fallback("openclaw@latest");
        fixes.extend(npm_fixes);

        if let Some(sv) = verify_openclaw_installed() {
            if !ok {
                fixes.push("npm-exit-fail-but-openclaw-verified".to_string());
            }
            return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
        }
    }

    if !existing_ver.is_empty() {
        if let Some(sv) = verify_openclaw_installed() {
            fixes.push("update-failed-existing-still-works".to_string());
            return StepResult::ok_fixed(format!("already-installed:{}", sv), fixes);
        }
        fixes.push("update-broke-existing-install".to_string());
    }

    StepResult::err_fixed(
        format!("openclaw-not-found: {}", extract_last_npm_detail(&fixes)),
        fixes,
    )
}

#[tauri::command]
pub async fn uninstall_local_instance() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    if let Some(pm2) = crate::pm2::find_pm2_cmd() {
        let (stop_ok, _, _) = shell_result(&format!("\"{}\" stop openclaw", pm2));
        if stop_ok {
            fixes.push("pm2-stopped".into());
        }
        let (delete_ok, _, _) = shell_result(&format!("\"{}\" delete openclaw", pm2));
        if delete_ok {
            fixes.push("pm2-deleted".into());
        }
        let _ = shell_result(&format!("\"{}\" save", pm2));
    } else {
        let (stop_ok, _, _) = shell_result("pm2 stop openclaw");
        if stop_ok {
            fixes.push("pm2-stopped".into());
        }
        let (delete_ok, _, _) = shell_result("pm2 delete openclaw");
        if delete_ok {
            fixes.push("pm2-deleted".into());
        }
        let _ = shell_result("pm2 save");
    }

    let (global_ok, _, _) = shell_result("npm uninstall -g openclaw");
    if global_ok {
        fixes.push("npm-uninstalled-global".into());
    } else {
        let local = crate::platform::data_local();
        let prefix = crate::platform::path_join(&local, "clawno-npm-global");
        let cmd = format!("npm uninstall -g openclaw --prefix \"{}\"", prefix);
        let (prefix_ok, _, _) = shell_result(&cmd);
        if prefix_ok {
            fixes.push("npm-uninstalled-user-prefix".into());
        } else {
            fixes.push("npm-uninstall-skipped-not-fatal".into());
        }
    }

    fixes.push("data-preserved".into());
    StepResult::ok_fixed("uninstalled".into(), fixes)
}
