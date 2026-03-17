use clawno_core::types::{DepSource, DepStatus, DependencyInfo, EnvironmentReport, StepResult};

use crate::node::{inject_dir, node_major, openclaw_semver, scan_openclaw_bin_dir};
use crate::platform::{detect_platform, shell_output};

use super::trust;

const NODE_VERSION: &str = "v22.16.0";

/// One-shot environment scan: detects platform capabilities, installed
/// dependencies and their versions, and builds a download source list
/// for each missing/outdated dependency.
#[tauri::command]
pub async fn scan_environment() -> EnvironmentReport {
    let profile = detect_platform();
    let pms = profile.package_manager_versions();

    let deps = vec![
        scan_node(&profile),
        scan_npm(),
        scan_git(),
        scan_openclaw(&profile),
        scan_pm2(&profile),
        scan_ollama(),
    ];

    EnvironmentReport {
        os: profile.os.clone(),
        os_version: profile.os_version.clone(),
        arch: profile.arch.clone(),
        total_memory_mb: profile.total_memory_mb,
        free_disk_mb: profile.free_disk_mb,
        is_admin: profile.is_admin,
        is_chinese_locale: profile.is_chinese_locale,
        http_proxy: profile.http_proxy.clone(),
        package_managers: pms,
        dependencies: deps,
    }
}

fn scan_node(profile: &crate::platform::PlatformProfile) -> DependencyInfo {
    let ver_raw = shell_output("node --version");
    let major = node_major(&ver_raw);

    let (status, current) = if major >= 22 {
        (DepStatus::Satisfied, Some(ver_raw.trim().to_string()))
    } else if major > 0 {
        (DepStatus::NeedsUpgrade, Some(ver_raw.trim().to_string()))
    } else {
        (DepStatus::NotInstalled, None)
    };

    let sources = trust::node_sources(
        NODE_VERSION,
        &profile.os,
        &profile.arch,
        profile.is_chinese_locale,
    );

    let mut strategies = Vec::new();
    #[cfg(target_os = "windows")]
    {
        strategies.push("direct-msi".into()); // 官方 MSI 优先，可可靠触发 UAC
        if profile.has_nvm {
            strategies.push("nvm".into());
        }
        if profile.has_fnm {
            strategies.push("fnm".into());
        }
        if profile.has_winget {
            strategies.push("winget".into());
        }
        if profile.has_choco {
            strategies.push("choco".into());
        }
    }
    #[cfg(target_os = "macos")]
    {
        if profile.has_nvm {
            strategies.push("nvm".into());
        }
        if profile.has_fnm {
            strategies.push("fnm".into());
        }
        if profile.has_brew {
            strategies.push("brew".into());
        }
    }
    #[cfg(target_os = "linux")]
    {
        if profile.has_nvm {
            strategies.push("nvm".into());
        }
        if profile.has_apt {
            strategies.push("apt-nodesource".into());
        }
        if profile.has_dnf {
            strategies.push("dnf".into());
        }
        if profile.has_pacman {
            strategies.push("pacman".into());
        }
        if profile.has_fnm {
            strategies.push("fnm".into());
        }
    }
    strategies.push("direct-download".into());

    DependencyInfo {
        id: "nodejs".into(),
        display_name: "Node.js".into(),
        required_version: ">= 22".into(),
        current_version: current,
        status,
        sources,
        strategies,
        size_estimate_mb: 30,
        is_optional: false,
    }
}

fn scan_npm() -> DependencyInfo {
    let ver_raw = shell_output("npm --version").trim().to_string();
    let has_npm = !ver_raw.is_empty()
        && ver_raw
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);

    DependencyInfo {
        id: "npm".into(),
        display_name: "npm".into(),
        required_version: "bundled with Node.js".into(),
        current_version: if has_npm { Some(ver_raw) } else { None },
        status: if has_npm {
            DepStatus::Satisfied
        } else {
            DepStatus::NotInstalled
        },
        sources: vec![DepSource {
            url: "https://nodejs.org".into(),
            label: "nodejs.org (bundled)".into(),
            trust_level: clawno_core::types::TrustLevel::Official,
            expected_sha256: None,
            is_primary: true,
        }],
        strategies: vec!["bundled-with-node".into()],
        size_estimate_mb: 0,
        is_optional: false,
    }
}

#[cfg(target_os = "windows")]
const GIT_DIRS: &[&str] = &[
    r"C:\Program Files\Git\cmd",
    r"C:\Program Files (x86)\Git\cmd",
    r"C:\Program Files\Git\bin",
];

/// 注入常见 Git 路径到当前进程，供 scan_git / install_git 复用，避免安装后 PATH 未刷新导致检测不到。
#[cfg(target_os = "windows")]
fn inject_git_paths() {
    let local = crate::platform::data_local();
    let user_git = format!("{}\\Programs\\Git\\cmd", local);
    crate::node::inject_dir(&user_git);
    for d in GIT_DIRS {
        crate::node::inject_dir(d);
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn inject_git_paths() {}

fn scan_git() -> DependencyInfo {
    #[cfg(target_os = "windows")]
    inject_git_paths();
    let ver_raw = shell_output("git --version").trim().to_string();
    let has_git = ver_raw.starts_with("git version");
    let version = if has_git {
        ver_raw
            .strip_prefix("git version ")
            .map(|s| s.split_whitespace().next().unwrap_or(s).to_string())
    } else {
        None
    };

    let git_url = if cfg!(target_os = "macos") {
        "https://git-scm.com/download/mac"
    } else if cfg!(target_os = "linux") {
        "https://git-scm.com/download/linux"
    } else {
        "https://git-scm.com/download/win"
    };

    let sources = vec![DepSource {
        url: git_url.into(),
        label: "git-scm.com (official)".into(),
        trust_level: clawno_core::types::TrustLevel::Official,
        expected_sha256: None,
        is_primary: true,
    }];

    let mut strategies = Vec::new();
    #[cfg(target_os = "windows")]
    {
        // winget 优先：通常更快；UAC 不弹出时再 fallback 到 direct-download
        strategies.push("winget".into());
        strategies.push("direct-download".into());
    }
    #[cfg(target_os = "macos")]
    strategies.push("brew".into());
    #[cfg(target_os = "linux")]
    {
        strategies.push("apt".into());
        strategies.push("dnf".into());
    }

    DependencyInfo {
        id: "git".into(),
        display_name: "Git".into(),
        required_version: "any".into(),
        current_version: version,
        status: if has_git {
            DepStatus::Satisfied
        } else {
            DepStatus::NotInstalled
        },
        sources,
        strategies,
        size_estimate_mb: 50,
        is_optional: false,
    }
}

fn scan_openclaw(profile: &crate::platform::PlatformProfile) -> DependencyInfo {
    let ver_raw = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver_raw);
    let mut current = if sv.is_empty() { None } else { Some(sv) };

    if current.is_none() {
        if let Some(bin_dir) = scan_openclaw_bin_dir() {
            inject_dir(&bin_dir);
            let ver2 = shell_output("openclaw --version");
            let sv2 = openclaw_semver(&ver2);
            if !sv2.is_empty() {
                current = Some(sv2);
            }
        }
    }

    let status = if current.is_some() {
        DepStatus::Satisfied
    } else {
        DepStatus::NotInstalled
    };

    DependencyInfo {
        id: "openclaw".into(),
        display_name: "OpenClaw CLI".into(),
        required_version: "latest".into(),
        current_version: current,
        status,
        sources: trust::npm_sources("openclaw", profile.is_chinese_locale),
        strategies: vec!["npm-global".into(), "npm-user-prefix".into()],
        size_estimate_mb: 15,
        is_optional: false,
    }
}

fn scan_pm2(profile: &crate::platform::PlatformProfile) -> DependencyInfo {
    let extract_ver = |raw: &str| -> Option<String> {
        raw.lines()
            .find(|l| {
                let t = l.trim();
                !t.is_empty()
                    && t.chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
            })
            .map(|l| l.trim().to_string())
    };

    // Try find_pm2_cmd first (absolute paths avoid PATH issues)
    let mut version = crate::pm2::find_pm2_cmd().and_then(|cmd| {
        let raw = shell_output(&format!("\"{}\" --version", cmd));
        extract_ver(&raw)
    });

    // Fallback: try bare `pm2 --version` via augmented PATH
    if version.is_none() {
        let raw = shell_output("pm2 --version");
        version = extract_ver(&raw);
    }

    let status = if version.is_some() {
        DepStatus::Satisfied
    } else {
        DepStatus::NotInstalled
    };

    DependencyInfo {
        id: "pm2".into(),
        display_name: "PM2".into(),
        required_version: "latest".into(),
        current_version: version,
        status,
        sources: trust::npm_sources("pm2", profile.is_chinese_locale),
        strategies: vec!["npm-global".into(), "npm-user-prefix".into()],
        size_estimate_mb: 10,
        is_optional: false,
    }
}

fn scan_ollama() -> DependencyInfo {
    let ver_raw = shell_output("ollama --version").trim().to_string();
    let has_ollama = !ver_raw.is_empty() && ver_raw.contains("ollama");
    let version = if has_ollama {
        ver_raw
            .split_whitespace()
            .find(|w| {
                w.chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
            })
            .map(|s| s.to_string())
    } else {
        None
    };

    DependencyInfo {
        id: "ollama".into(),
        display_name: "Ollama".into(),
        required_version: "latest".into(),
        current_version: version,
        status: if has_ollama {
            DepStatus::Satisfied
        } else {
            DepStatus::NotInstalled
        },
        sources: trust::ollama_sources(),
        strategies: vec!["official-installer".into()],
        size_estimate_mb: 100,
        is_optional: true,
    }
}

/// Install a single dependency by ID, reusing existing Tauri commands.
/// Supported dep_ids: "nodejs", "openclaw", "pm2", "ollama", "git".
/// "npm" is bundled with Node.js and cannot be installed separately.
#[tauri::command]
pub async fn install_single_dep(app: tauri::AppHandle, dep_id: String) -> StepResult {
    match dep_id.as_str() {
        "nodejs" => crate::node::deploy_step_check_node(app).await,
        "openclaw" => crate::node::deploy_step_install_openclaw(app).await,
        "pm2" => crate::pm2::deploy_step_install_pm2(app).await,
        "ollama" => crate::ollama::ollama_ensure_installed().await,
        "git" => install_git(app).await,
        "npm" => StepResult::err("npm is bundled with Node.js — install Node.js first".into()),
        other => StepResult::err(format!("unknown dependency: {other}")),
    }
}

async fn install_git(app: tauri::AppHandle) -> StepResult {
    use clawno_core::types::{StepPhase, StepProgress, TrustLevel};
    use tauri::Emitter;

    let emit_progress = |phase: StepPhase, msg: &str| {
        let mut p = StepProgress::new("install-git", "system", 0, 1);
        p.phase = phase;
        p.message = msg.to_string();
        p.source_url = Some("https://git-scm.com".into());
        p.source_trust = Some(TrustLevel::Official);
        let _ = app.emit("deploy-step-progress", &p);
    };

    emit_progress(StepPhase::Probing, "checking git...");

    #[cfg(target_os = "windows")]
    {
        let mut fixes = Vec::new();

        let verify_git = || -> Option<String> {
            inject_git_paths();
            let check = shell_output("git --version");
            if check.starts_with("git version") {
                return Some(check.trim().to_string());
            }
            for d in GIT_DIRS {
                let exe = format!("{}\\git.exe", d);
                if std::path::Path::new(&exe).exists() {
                    let out = shell_output(&format!("\"{}\" --version", exe));
                    if out.starts_with("git version") {
                        return Some(out.trim().to_string());
                    }
                }
            }
            None
        };

        // 已安装则直接返回，避免重复安装与误报失败
        if let Some(ver) = verify_git() {
            emit_progress(StepPhase::Done, &format!("Git already installed: {}", ver));
            return StepResult::ok_fixed(
                format!("Git installed: {}", ver),
                vec!["git-already-installed".into()],
            );
        }

        // ── Phase 1: winget 优先（通常更快）；失败时 fallback 到 direct-download（UAC 更可靠）──
        let has_winget = shell_output("winget --version").trim().starts_with('v');
        let mut winget_ok = false;

        if has_winget {
            emit_progress(StepPhase::WaitingForUser, "等待用户确认是否允许安装 Git…");
            let (ok_user, _, _) = tokio::task::spawn_blocking(|| {
                crate::platform::shell_result_visible_installer(
                    "winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements",
                )
            })
            .await
            .unwrap_or((false, String::new(), String::new()));
            winget_ok = ok_user;
            if winget_ok {
                fixes.push("winget-install-git".into());
            } else {
                fixes.push("winget-install-git-failed".into());
            }
        } else {
            fixes.push("winget-not-available".into());
        }

        // Fallback: direct-download 官方 exe（UAC 更可靠，但下载可能较慢）
        if !winget_ok {
            let profile = detect_platform();
            let arch_suffix = match profile.arch.as_str() {
                "aarch64" => "arm64",
                "x86" => "32-bit",
                _ => "64-bit",
            };
            let (version_tag, version_num) = ("v2.53.0.windows.2", "2.53.0.2");
            let exe_name = format!("Git-{}-{}.exe", version_num, arch_suffix);
            let url = format!(
                "https://github.com/git-for-windows/git/releases/download/{}/{}",
                version_tag, exe_name
            );

            let downloads_dir =
                crate::platform::path_join(&crate::platform::data_local(), "clawno\\downloads");
            let _ = std::fs::create_dir_all(&downloads_dir);
            let installer_path = std::path::Path::new(&downloads_dir).join(&exe_name);

            let mut download_err: Option<String> = None;
            let try_direct = installer_path.exists() || {
                emit_progress(
                    StepPhase::Downloading,
                    "正在下载 Git 官方安装包…（一次性拉取，约 1–5 分钟，请耐心等待）",
                );
                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(30))
                    .timeout(std::time::Duration::from_secs(900)) // 15 分钟总超时，避免卡死
                    .build()
                    .unwrap_or_default();
                match client.get(&url).send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        if status.is_success() {
                            match resp.bytes().await {
                                Ok(bytes) => {
                                    if let Err(e) = tokio::fs::write(&installer_path, &bytes).await
                                    {
                                        download_err = Some(format!("write-failed:{}", e));
                                        false
                                    } else {
                                        fixes.push("git-downloaded".into());
                                        true
                                    }
                                }
                                Err(e) => {
                                    download_err = Some(format!("download-body:{}", e));
                                    false
                                }
                            }
                        } else {
                            download_err = Some(format!("http-{}", status.as_u16()));
                            false
                        }
                    }
                    Err(e) => {
                        download_err = Some(format!("request:{}", e));
                        false
                    }
                }
            };

            if let Some(e) = &download_err {
                fixes.push(format!("git-download-error:{}", e));
            }

            if try_direct && installer_path.exists() {
                emit_progress(
                    StepPhase::WaitingForUser,
                    "等待用户确认是否允许安装 Git（请在弹出的窗口中点击允许）…",
                );
                let path_str = installer_path.to_string_lossy().into_owned();
                let cmd = format!(r#""{}""#, path_str);
                let (ok, out, err) = tokio::task::spawn_blocking(move || {
                    crate::platform::shell_result_visible_installer(&cmd)
                })
                .await
                .unwrap_or((false, String::new(), "spawn_blocking failed".into()));

                if ok {
                    fixes.push("git-direct-install-ok".into());
                } else {
                    fixes.push(format!("git-direct-install-failed: {} {}", out, err));
                }
            }
        }

        // ── Phase 2: verify ──
        emit_progress(StepPhase::Verifying, "verifying git installation...");

        if let Some(ver) = verify_git() {
            emit_progress(StepPhase::Done, &format!("Git installed: {}", ver));
            return StepResult::ok_fixed(format!("Git installed: {}", ver), fixes);
        }

        fixes.push("verify-retry-after-wait".into());
        emit_progress(StepPhase::Verifying, "waiting for installer to finalize...");
        std::thread::sleep(std::time::Duration::from_secs(3));

        if let Some(ver) = verify_git() {
            emit_progress(StepPhase::Done, &format!("Git installed: {}", ver));
            return StepResult::ok_fixed(format!("Git installed: {}", ver), fixes);
        }

        std::thread::sleep(std::time::Duration::from_secs(5));
        if let Some(ver) = verify_git() {
            fixes.push("verify-retry-2-ok".into());
            emit_progress(StepPhase::Done, &format!("Git installed: {}", ver));
            return StepResult::ok_fixed(format!("Git installed: {}", ver), fixes);
        }

        // 再等 5 秒，应对安装器收尾较慢的情况
        fixes.push("verify-retry-3-wait".into());
        emit_progress(
            StepPhase::Verifying,
            "waiting for installer to finalize (retry 3)...",
        );
        std::thread::sleep(std::time::Duration::from_secs(5));
        if let Some(ver) = verify_git() {
            fixes.push("verify-retry-3-ok".into());
            emit_progress(StepPhase::Done, &format!("Git installed: {}", ver));
            return StepResult::ok_fixed(format!("Git installed: {}", ver), fixes);
        }

        let hint = fixes
            .iter()
            .rev()
            .find(|f| {
                f.starts_with("git-download-error:") || f.starts_with("git-direct-install-failed:")
            })
            .map(|s| {
                let s = s.as_str();
                let s = s.strip_prefix("git-download-error:").unwrap_or(s);
                let s = s.strip_prefix("git-direct-install-failed:").unwrap_or(s);
                s.trim().chars().take(80).collect::<String>()
            })
            .unwrap_or_default();
        let detail = if hint.is_empty() {
            "git-install-failed: please install Git manually from https://git-scm.com/download/win"
                .into()
        } else {
            format!("git-install-failed:{}", hint)
        };
        StepResult::err_fixed(detail, fixes)
    }
    #[cfg(target_os = "macos")]
    {
        emit_progress(StepPhase::Installing, "xcode-select --install");
        let out = shell_output("xcode-select --install 2>&1");
        StepResult::err_fixed(
            format!(
                "Git not found. Run: xcode-select --install ({})",
                out.trim()
            ),
            vec!["xcode-select-hint".into()],
        )
    }
    #[cfg(target_os = "linux")]
    {
        let apt = shell_output("which apt-get").trim().to_string();
        if !apt.is_empty() {
            emit_progress(StepPhase::Installing, "installing git via apt...");
            let out = shell_output("sudo apt-get install -y git");
            let check = shell_output("git --version");
            if check.starts_with("git version") {
                emit_progress(StepPhase::Done, &format!("Git installed: {}", check.trim()));
                return StepResult::ok_fixed(
                    format!("Git installed: {}", check.trim()),
                    vec!["apt-install-git".into()],
                );
            }
            return StepResult::err(format!("apt install git failed: {}", out.trim()));
        }
        StepResult::err("git-install-failed: please install Git manually".into())
    }
}
