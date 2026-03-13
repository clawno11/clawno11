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
        let result = watchdog::run_with_watchdog(
            "winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements",
            ctx.stall_timeout,
            |_line| {},
        ).await;

        match result {
            watchdog::WatchdogResult::Completed {
                exit_code,
                stdout,
                stderr,
            } => {
                refresh_windows_path(&mut ctx.fixes);
                if exit_code == 0 {
                    // Verify through known install paths
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
            let result = watchdog::run_with_watchdog(&cmd, ctx.stall_timeout, |_| {}).await;
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
        let result = watchdog::run_with_watchdog(cmd, Duration::from_secs(120), |_| {}).await;
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
        let version = "v22.16.0";
        let url = ctx.profile.node_download_url(version);

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

        let dest_dir = if cfg!(target_os = "windows") {
            crate::platform::path_join(&crate::platform::data_local(), "clawno\\node")
        } else {
            crate::platform::path_join(&crate::platform::user_home(), ".clawno/node")
        };
        let _ = std::fs::create_dir_all(&dest_dir);

        let ext = if ctx.profile.os == "windows" {
            "zip"
        } else {
            "tar.gz"
        };
        let archive_path =
            std::path::PathBuf::from(&dest_dir).join(format!("node-{version}.{ext}"));

        let emitter = ctx.emitter.clone();
        let step_id = "install-node".to_string();
        let total_strategies = 1u8;
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
                let mut p = StepProgress::new(&step_id, "direct-download", 0, total_strategies);
                p.phase = StepPhase::Downloading;
                p.bytes_done = done;
                p.bytes_total = total;
                p.speed_bps = speed;
                p.pct = pct;
                p.eta_secs = eta;
                p.message = format!("downloading Node.js {version}");
                emitter.emit(&p);
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

    // Quick check: is Node >= 22 already available?
    if let Some(ver) = verify_node() {
        return StepResult::ok(ver);
    }

    // Check via nvm-which on Unix
    #[cfg(not(target_os = "windows"))]
    {
        let node_path = super::scan::nvm_which_node();
        if !node_path.is_empty() {
            inject_bin_dir(&node_path);
            if let Some(ver) = verify_node() {
                fixes.push("found-via-nvm-which".into());
                return StepResult::ok_fixed(ver, fixes);
            }
        }
    }

    // Node not found or too old — run the strategy chain
    let strategies = build_node_strategies(&profile);
    let chain = StrategyChain {
        step_id: "install-node".into(),
        strategies,
        stall_timeout: Duration::from_secs(30),
        verifier: Box::new(verify_node),
    };

    chain.execute(&app, &profile).await
}

// ── Tauri command: install/update openclaw ────────────────────────────────────

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

    let (dl_ok, _dl_detail, mut fixes) =
        download_and_install_npm_package(&app, "openclaw", "openclaw").await;

    let verify = || -> Option<String> {
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
    };

    if let Some(sv) = verify() {
        if !dl_ok {
            fixes.push("download-fail-but-openclaw-verified".to_string());
        }
        return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
    }

    if !dl_ok {
        fixes.push("fallback-npm-install".to_string());
        let (ok, _detail, npm_fixes) = npm_install_with_fallback("openclaw");
        fixes.extend(npm_fixes);

        if let Some(sv) = verify() {
            if !ok {
                fixes.push("npm-reported-fail-but-openclaw-works".to_string());
            }
            return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
        }
    }

    let last_npm_detail = fixes
        .iter()
        .rev()
        .find(|f| {
            f.starts_with("install-failed:")
                || f.starts_with("network-failed:")
                || f.starts_with("user-prefix-failed:")
                || f.starts_with("download-")
        })
        .cloned()
        .unwrap_or_else(|| "npm install failed".to_string());
    StepResult::err_fixed(format!("openclaw-not-found: {}", last_npm_detail), fixes)
}

#[tauri::command]
pub async fn update_openclaw(app: tauri::AppHandle) -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

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

    let verify = || -> Option<String> {
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
    };

    if let Some(sv) = verify() {
        if !dl_ok {
            fixes.push("download-fail-but-openclaw-verified".to_string());
        }
        return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
    }

    if !dl_ok {
        fixes.push("fallback-npm-install".to_string());
        let (ok, _detail, npm_fixes) = npm_install_with_fallback("openclaw@latest");
        fixes.extend(npm_fixes);

        if let Some(sv) = verify() {
            if !ok {
                fixes.push("npm-exit-fail-but-openclaw-verified".to_string());
            }
            return StepResult::ok_fixed(format!("installed:{}", sv), fixes);
        }
    }

    if !existing_ver.is_empty() {
        if let Some(sv) = verify() {
            fixes.push("update-failed-existing-still-works".to_string());
            return StepResult::ok_fixed(format!("already-installed:{}", sv), fixes);
        }
        fixes.push("update-broke-existing-install".to_string());
    }

    let last_npm_detail = fixes
        .iter()
        .rev()
        .find(|f| {
            f.starts_with("install-failed:")
                || f.starts_with("network-failed:")
                || f.starts_with("user-prefix-failed:")
                || f.starts_with("download-")
        })
        .cloned()
        .unwrap_or_else(|| "npm install failed".to_string());
    StepResult::err_fixed(format!("openclaw-not-found: {}", last_npm_detail), fixes)
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
