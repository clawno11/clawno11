use super::npm::npm_install_with_fallback;
#[cfg(not(target_os = "windows"))]
use super::scan::inject_bin_dir;
use super::scan::{node_major, node_version_direct, openclaw_semver, scan_openclaw_bin_dir};
/// Node.js install/upgrade logic and openclaw CLI management Tauri commands.
use crate::platform::{first_line, shell_ok, shell_output, shell_result};
use crate::types::StepResult;

fn upgrade_node(current_ver: &str, mut fixes: Vec<String>) -> StepResult {
    #[cfg(target_os = "windows")]
    {
        if !shell_output("nvm version").is_empty() {
            fixes.push(format!("nvm-upgrade:{}", current_ver));
            shell_ok("nvm install 22");
            shell_ok("nvm use 22");
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 {
                return StepResult::ok_fixed(ver, fixes);
            }
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 {
                return StepResult::ok_fixed(ver2, fixes);
            }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 {
                return StepResult::ok_fixed(ver2, fixes);
            }
        }
        if !shell_output("volta --version").is_empty() {
            fixes.push(format!("volta-upgrade:{}", current_ver));
            shell_ok("volta install node@22");
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 {
                return StepResult::ok_fixed(ver, fixes);
            }
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 {
                return StepResult::ok_fixed(ver2, fixes);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let nvm = super::scan::nvm_dir();
        let nvm_sh = format!("{nvm}/nvm.sh");
        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push(format!("nvm-upgrade:{}", current_ver));
            let cmd = format!(
                "export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" \
                 && nvm install 22 >/dev/null 2>&1 \
                 && nvm use 22 >/dev/null 2>&1 \
                 && nvm alias default 22 >/dev/null 2>&1 \
                 && which node 2>/dev/null"
            );
            let node_path = shell_output(&cmd).trim().to_string();
            if !node_path.is_empty() && std::path::Path::new(&node_path).exists() {
                inject_bin_dir(&node_path);
                let ver = std::process::Command::new(&node_path)
                    .arg("--version")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_else(|_| "v22".to_string());
                return StepResult::ok_fixed(
                    if ver.is_empty() {
                        "nvm-upgraded".to_string()
                    } else {
                        ver
                    },
                    fixes,
                );
            }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
            let ver = node_version_direct();
            if node_major(&ver) >= 22 {
                return StepResult::ok_fixed(ver, fixes);
            }
        }
    }
    install_node_auto(fixes)
}

fn install_node_auto(mut fixes: Vec<String>) -> StepResult {
    #[cfg(target_os = "windows")]
    {
        if shell_output("winget --version").is_empty() {
            return StepResult::err(
                "node-not-found: please install Node.js >= 22 from https://nodejs.org".to_string(),
            );
        }
        fixes.push("winget-install-node-lts".to_string());
        let (ok, _, stderr) = shell_result(
            "winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements",
        );
        if !ok {
            return StepResult::err_fixed(
                format!(
                    "winget-failed: {} | visit https://nodejs.org",
                    first_line(&stderr)
                ),
                fixes,
            );
        }
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
        let ver = shell_output("node --version");
        if node_major(&ver) >= 22 {
            return StepResult::ok_fixed(ver, fixes);
        }
        let ver_direct = node_version_direct();
        if node_major(&ver_direct) >= 22 {
            fixes.push("found-via-scan-after-winget".to_string());
            return StepResult::ok_fixed(ver_direct, fixes);
        }
        return StepResult::err_fixed("node-installed-restart-required".to_string(), fixes);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let nvm = super::scan::nvm_dir();
        let nvm_sh = format!("{nvm}/nvm.sh");

        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push("install-via-nvm".to_string());
            let cmd = format!(
                "export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" \
                 && nvm install 22 >/dev/null 2>&1 \
                 && nvm use 22 >/dev/null 2>&1 \
                 && nvm alias default 22 >/dev/null 2>&1 \
                 && which node 2>/dev/null"
            );
            let node_path = shell_output(&cmd).trim().to_string();
            if !node_path.is_empty() && std::path::Path::new(&node_path).exists() {
                inject_bin_dir(&node_path);
                let ver = std::process::Command::new(&node_path)
                    .arg("--version")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_default();
                let ver = if ver.is_empty() {
                    fixes.push("nvm-binary-found-no-exec".to_string());
                    "nvm-installed".to_string()
                } else {
                    ver
                };
                return StepResult::ok_fixed(ver, fixes);
            }
            return StepResult::err_fixed("node-installed-restart-required".to_string(), fixes);
        }

        #[cfg(target_os = "macos")]
        if !shell_output("brew --version").is_empty() {
            fixes.push("brew-install-node".to_string());
            let (ok, _, _) =
                shell_result("HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1 brew install node");
            if ok {
                let ver = node_version_direct();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
            }
            let (ok2, _, _) = shell_result(
                "HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1 brew install node@22 && brew link node@22 --force --overwrite"
            );
            if ok2 {
                let brew_bin = shell_output("brew --prefix node@22 2>/dev/null");
                if !brew_bin.is_empty() {
                    let node_bin = format!("{}/bin", brew_bin.trim());
                    let current = std::env::var("PATH").unwrap_or_default();
                    if !current.contains(&node_bin) {
                        std::env::set_var("PATH", format!("{}:{}", node_bin, current));
                    }
                }
                let ver = node_version_direct();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
            }
        }

        fixes.push("install-nvm-then-node".to_string());
        shell_ok("curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash");
        if std::path::Path::new(&nvm_sh).exists() {
            let cmd = format!(
                "export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" \
                 && nvm install 22 >/dev/null 2>&1 \
                 && nvm use 22 >/dev/null 2>&1 \
                 && nvm alias default 22 >/dev/null 2>&1 \
                 && which node 2>/dev/null"
            );
            let node_path = shell_output(&cmd).trim().to_string();
            if !node_path.is_empty() && std::path::Path::new(&node_path).exists() {
                inject_bin_dir(&node_path);
                let ver = std::process::Command::new(&node_path)
                    .arg("--version")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_else(|_| "v22".to_string());
                return StepResult::ok_fixed(
                    if ver.is_empty() {
                        "nvm-installed".to_string()
                    } else {
                        ver
                    },
                    fixes,
                );
            }
        }

        StepResult::err_fixed(
            "node-not-found: install Node.js >= 22 via https://nodejs.org or your package manager"
                .to_string(),
            fixes,
        )
    }
}

#[tauri::command]
pub async fn deploy_step_check_node() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    let ver = shell_output("node --version");
    if !ver.is_empty() && node_major(&ver) >= 22 {
        return StepResult::ok(ver);
    }

    let ver_direct = node_version_direct();
    if !ver_direct.is_empty() {
        if node_major(&ver_direct) >= 22 {
            fixes.push("found-via-direct-path".to_string());
            return StepResult::ok_fixed(ver_direct, fixes);
        }
        return upgrade_node(&ver_direct, fixes);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let node_path = super::scan::nvm_which_node();
        if !node_path.is_empty() {
            inject_bin_dir(&node_path);
            let ver = std::process::Command::new(&node_path)
                .arg("--version")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            if !ver.is_empty() {
                if node_major(&ver) >= 22 {
                    fixes.push("found-via-nvm-which".to_string());
                    return StepResult::ok_fixed(ver, fixes);
                }
                return upgrade_node(&ver, fixes);
            }
            fixes.push("found-via-nvm-which-no-exec".to_string());
            return StepResult::ok_fixed("found-via-nvm".to_string(), fixes);
        }
    }

    install_node_auto(fixes)
}

#[tauri::command]
pub async fn deploy_step_install_openclaw() -> StepResult {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    if !sv.is_empty() {
        return StepResult::ok(format!("already-installed:{}", sv));
    }

    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        let sep = if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        };
        let current = std::env::var("PATH").unwrap_or_default();
        if !current.contains(&bin_dir) {
            std::env::set_var("PATH", format!("{}{}{}", bin_dir, sep, current));
        }
        return StepResult::ok("already-installed:found-via-scan".to_string());
    }

    let (ok, detail, fixes) = npm_install_with_fallback("openclaw");
    if !ok {
        return StepResult::err_fixed(detail, fixes);
    }

    let ver2 = shell_output("openclaw --version");
    let sv2 = openclaw_semver(&ver2);
    if !sv2.is_empty() {
        return StepResult::ok_fixed(format!("installed:{}", sv2), fixes);
    }

    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        let sep = if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        };
        let current = std::env::var("PATH").unwrap_or_default();
        if !current.contains(&bin_dir) {
            std::env::set_var("PATH", format!("{}{}{}", bin_dir, sep, current));
        }
        return StepResult::ok_fixed("installed-found-via-scan".to_string(), fixes);
    }

    StepResult::err_fixed(
        "openclaw-not-found-after-install: check npm permissions".to_string(),
        fixes,
    )
}

/// Force-reinstall openclaw to the latest published version.
///
/// Update strategy (tried in order):
///   1. `openclaw update` — OpenClaw's own self-update command
///   2. `npm install -g openclaw@latest --force` — always re-downloads
#[tauri::command]
pub async fn update_openclaw() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    let (self_update_ok, self_update_out, _) = shell_result("openclaw update");
    if self_update_ok {
        fixes.push("self-update-ok".to_string());
    } else {
        fixes.push(format!(
            "self-update-skipped:{}",
            first_line(&self_update_out)
                .chars()
                .take(60)
                .collect::<String>()
        ));
    }

    let (ok, detail, npm_fixes) = npm_install_with_fallback("openclaw@latest --force");
    fixes.extend(npm_fixes);
    if !ok {
        return StepResult::err_fixed(detail, fixes);
    }

    let ver2 = shell_output("openclaw --version");
    let sv2 = openclaw_semver(&ver2);
    StepResult::ok_fixed(format!("installed:{}", sv2), fixes)
}

/// Fully uninstall a local OpenClaw instance:
///   1. Stop + delete the pm2 process
///   2. Uninstall the openclaw npm package from every known install location
///
/// Data in ~/.openclaw/ is intentionally NOT deleted.
#[tauri::command]
pub async fn uninstall_local_instance() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    if let Some(pm2) = crate::pm2::find_pm2_cmd() {
        let (stop_ok, _, _) = shell_result(&format!("\"{}\" stop openclaw", pm2));
        if stop_ok {
            fixes.push("pm2-stopped".to_string());
        }

        let (delete_ok, _, _) = shell_result(&format!("\"{}\" delete openclaw", pm2));
        if delete_ok {
            fixes.push("pm2-deleted".to_string());
        }

        let _ = shell_result(&format!("\"{}\" save", pm2));
    } else {
        let (stop_ok, _, _) = shell_result("pm2 stop openclaw");
        if stop_ok {
            fixes.push("pm2-stopped".to_string());
        }

        let (delete_ok, _, _) = shell_result("pm2 delete openclaw");
        if delete_ok {
            fixes.push("pm2-deleted".to_string());
        }

        let _ = shell_result("pm2 save");
    }

    let (global_ok, _, _) = shell_result("npm uninstall -g openclaw");
    if global_ok {
        fixes.push("npm-uninstalled-global".to_string());
    } else {
        let local = crate::platform::data_local();
        let prefix = crate::platform::path_join(&local, "clawno-npm-global");
        let cmd = format!("npm uninstall -g openclaw --prefix \"{}\"", prefix);
        let (prefix_ok, _, _) = shell_result(&cmd);
        if prefix_ok {
            fixes.push("npm-uninstalled-user-prefix".to_string());
        } else {
            fixes.push("npm-uninstall-skipped-not-fatal".to_string());
        }
    }

    fixes.push("data-preserved".to_string());

    StepResult::ok_fixed("uninstalled".to_string(), fixes)
}
