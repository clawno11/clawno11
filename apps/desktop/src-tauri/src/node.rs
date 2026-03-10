/// Node.js and openclaw npm-package management.
///
/// Handles detection, version checking, automatic installation/upgrade of
/// Node.js, and global installation of the `openclaw` CLI package.

use crate::platform::{
    data_local, first_line,
    shell_ok, shell_output, shell_result, path_join,
};
use crate::types::StepResult;

// ── npm error classification ─────────────────────────────────────────────────

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
    } else if c.contains("eacces") || c.contains("eperm")
           || c.contains("permission denied") || c.contains("access denied") {
        NpmError::PermissionDenied
    } else if c.contains("etimedout") || c.contains("econnreset")
           || c.contains("econnrefused") || c.contains("enotfound")
           || c.contains("fetch failed") {
        NpmError::NetworkTimeout
    } else if c.contains("enotempty") || c.contains("eexist")
           || c.contains("integrity") || c.contains("checksum") {
        NpmError::CacheCorrupted
    } else if c.contains("cert") || c.contains("ssl") || c.contains("certificate") {
        NpmError::SslError
    } else {
        NpmError::Unknown
    }
}

// ── npm install with automatic fallbacks ────────────────────────────────────

pub fn npm_install_with_fallback(pkg: &str) -> (bool, String, Vec<String>) {
    let mut fixes: Vec<String> = Vec::new();

    let (ok, stdout, stderr) = shell_result(&format!("npm install -g {pkg}"));
    if ok {
        return (true, format!("{pkg} installed"), fixes);
    }

    match classify_npm_error(&stderr, &stdout) {
        NpmError::NetworkTimeout => {
            fixes.push("switch-npmmirror".to_string());
            let (ok2, _, stderr2) = shell_result(&format!(
                "npm install -g {pkg} --registry https://registry.npmmirror.com"
            ));
            if ok2 { return (true, format!("{pkg} installed via npmmirror"), fixes); }
            if classify_npm_error(&stderr2, "") == NpmError::PermissionDenied {
                return npm_install_user_prefix(pkg, fixes);
            }
            (false, format!("network-failed: {}", first_line(&stderr2)), fixes)
        }
        NpmError::PermissionDenied => npm_install_user_prefix(pkg, fixes),
        NpmError::CacheCorrupted => {
            fixes.push("clean-npm-cache".to_string());
            shell_ok("npm cache clean --force");
            let (ok2, _, stderr2) = shell_result(&format!("npm install -g {pkg}"));
            if ok2 { return (true, format!("{pkg} installed after cache clean"), fixes); }
            (false, format!("cache-clean-failed: {}", first_line(&stderr2)), fixes)
        }
        NpmError::SslError => {
            fixes.push("disable-ssl-temporarily".to_string());
            shell_ok("npm config set strict-ssl false");
            let (ok2, _, stderr2) = shell_result(&format!("npm install -g {pkg}"));
            shell_ok("npm config set strict-ssl true");
            if ok2 { return (true, format!("{pkg} installed after ssl fix"), fixes); }
            (false, format!("ssl-fix-failed: {}", first_line(&stderr2)), fixes)
        }
        NpmError::DiskFull => {
            // wmic is Windows-only and deprecated on Win11 — use PowerShell as fallback.
            // On Unix report the error without the Windows-specific size query.
            #[cfg(target_os = "windows")]
            let detail = {
                let free = shell_output(
                    "powershell -NoProfile -Command \"(Get-PSDrive C).Free\""
                );
                let free_mb = free.trim().parse::<u64>().map(|b| b / 1_048_576).unwrap_or_else(|_| {
                    // Fallback to wmic for older Windows versions
                    let wmic = shell_output("wmic logicaldisk where DeviceID='C:' get FreeSpace /value");
                    wmic.lines()
                        .find(|l| l.contains('='))
                        .and_then(|l| l.split('=').nth(1))
                        .and_then(|v| v.trim().parse::<u64>().ok())
                        .map(|b| b / 1_048_576).unwrap_or(0)
                });
                format!("disk-full: only {free_mb}MB free on C:")
            };
            #[cfg(not(target_os = "windows"))]
            let detail = "disk-full: no space left on device".to_string();
            (false, detail, fixes)
        }
        NpmError::Unknown => {
            fixes.push("switch-npmmirror".to_string());
            let (ok2, _, stderr2) = shell_result(&format!(
                "npm install -g {pkg} --registry https://registry.npmmirror.com"
            ));
            if ok2 { return (true, format!("{pkg} installed via npmmirror"), fixes); }
            fixes.push("clean-npm-cache".to_string());
            shell_ok("npm cache clean --force");
            let (ok3, _, stderr3) = shell_result(&format!("npm install -g {pkg}"));
            if ok3 { return (true, format!("{pkg} installed after cache clean"), fixes); }
            // Last resort: corporate MITM proxies often cause SSL errors that surface as unknown errors.
            fixes.push("disable-ssl-temporarily".to_string());
            shell_ok("npm config set strict-ssl false");
            let (ok4, _, stderr4) = shell_result(&format!("npm install -g {pkg}"));
            shell_ok("npm config set strict-ssl true");
            if ok4 { return (true, format!("{pkg} installed after ssl fix"), fixes); }
            let msg = if !stderr4.is_empty() { &stderr4 } else if !stderr3.is_empty() { &stderr3 } else { &stderr2 };
            (false, format!("install-failed: {}", first_line(msg)), fixes)
        }
    }
}

fn npm_install_user_prefix(pkg: &str, mut fixes: Vec<String>) -> (bool, String, Vec<String>) {
    let local = data_local();
    let prefix = path_join(&local, "clawno-npm-global");
    let prefix_bin = path_join(&prefix, "bin");
    fixes.push(format!("user-prefix-install:{}", prefix_bin));
    let _ = std::fs::create_dir_all(&prefix_bin);
    let (ok, _, stderr) = shell_result(&format!("npm install -g {pkg} --prefix \"{prefix}\""));
    if !ok {
        return (false, format!("user-prefix-failed: {}", first_line(&stderr)), fixes);
    }
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.contains(&prefix_bin) {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        std::env::set_var("PATH", format!("{}{}{}", prefix_bin, sep, current));
    }
    (true, format!("{pkg} installed to user prefix"), fixes)
}

// ── Node.js scan / install ───────────────────────────────────────────────────

/// Parse the major version number from a `v24.0.0` style string.
pub fn node_major(ver: &str) -> u32 {
    ver.trim_start_matches('v')
        .split('.')
        .next()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0)
}

/// Run the node binary by its **full path** (bypasses shell PATH entirely).
/// Used as a fallback when `shell_output("node --version")` returns empty
/// due to Tauri sandbox PATH isolation on macOS.
fn node_version_direct() -> String {
    if let Some(dir) = scan_node_paths() {
        #[cfg(target_os = "windows")]
        let bin = format!("{}\\node.exe", dir);
        #[cfg(not(target_os = "windows"))]
        let bin = format!("{}/node", dir);

        if std::path::Path::new(&bin).exists() {
            let ver = std::process::Command::new(&bin)
                .arg("--version")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            // Also inject the dir into current process PATH so npm/pm2 steps can use it
            if !ver.is_empty() {
                let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
                let current = std::env::var("PATH").unwrap_or_default();
                if !current.contains(&dir) {
                    std::env::set_var("PATH", format!("{}{}{}", dir, sep, current));
                }
            }
            return ver;
        }
    }
    String::new()
}

/// Search well-known directories for an existing `node.exe` / `node` binary.
pub fn scan_node_paths() -> Option<String> {
    let home  = crate::platform::user_home();
    let local = data_local();

    #[cfg(target_os = "windows")]
    let candidates = vec![
        format!("{local}\\Programs\\nodejs"),
        r"C:\Program Files\nodejs".to_string(),
        r"C:\Program Files (x86)\nodejs".to_string(),
        format!("{local}\\nvm\\current"),
        format!("{home}\\AppData\\Local\\nvm\\current"),
        r"C:\nvm\nodejs".to_string(),
        format!("{local}\\fnm"),
        format!("{local}\\Volta\\bin"),
        format!("{home}\\.volta\\bin"),
        r"C:\ProgramData\chocolatey\lib\nodejs\tools".to_string(),
        r"C:\ProgramData\chocolatey\bin".to_string(),
        format!("{home}\\scoop\\apps\\nodejs\\current"),
        format!("{home}\\scoop\\shims"),
    ];

    #[cfg(not(target_os = "windows"))]
    let candidates = {
        let mut v = vec![
            format!("{home}/.volta/bin"),
            format!("{home}/.fnm/current/bin"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            format!("{home}/.npm-global/bin"),
            format!("{home}/.local/bin"),
        ];
        // nvm stores versions at ~/.nvm/versions/node/vX.Y.Z/bin — scan all of them
        let nvm_dir = format!("{home}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') { Some(format!("{nvm_dir}/{s}/bin")) } else { None }
                })
                .collect();
            versions.sort_by(|a, b| b.cmp(a)); // newest first
            for ver_bin in versions { v.insert(0, ver_bin); }
        }
        v
    };

    #[cfg(target_os = "windows")]
    let exe = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let exe = "node";

    for dir in &candidates {
        if std::path::Path::new(&path_join(dir, exe)).exists() {
            return Some(dir.clone());
        }
    }
    None
}

fn upgrade_node(current_ver: &str, mut fixes: Vec<String>) -> StepResult {
    // Windows: nvm-windows is a real binary in PATH
    #[cfg(target_os = "windows")]
    {
        if !shell_output("nvm version").is_empty() {
            fixes.push(format!("nvm-upgrade:{}", current_ver));
            shell_ok("nvm install 22");
            shell_ok("nvm use 22");
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        }
    }
    // macOS/Linux: nvm is a shell function — must source nvm.sh before calling it
    #[cfg(not(target_os = "windows"))]
    {
        let home = crate::platform::user_home();
        let nvm_sh = format!("{home}/.nvm/nvm.sh");
        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push(format!("nvm-upgrade:{}", current_ver));
            let cmd = format!(
                "export NVM_DIR=\"{home}/.nvm\" && . \"{nvm_sh}\" && nvm install 22 && nvm use 22"
            );
            shell_ok(&cmd);
            // Use direct binary scan — shell PATH is unreliable in Tauri sandbox on macOS
            let ver = node_version_direct();
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
            // Use direct binary scan after fnm install as well
            let ver = node_version_direct();
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        }
    }
    install_node_auto(fixes)
}

fn install_node_auto(mut fixes: Vec<String>) -> StepResult {
    // Windows: try winget first
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
                format!("winget-failed: {} | visit https://nodejs.org", first_line(&stderr)),
                fixes,
            );
        }
        let ver = shell_output("node --version");
        if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        return StepResult::err_fixed("node-installed-restart-required".to_string(), fixes);
    }

    // macOS/Linux: nvm first (fast, no brew-update overhead), then Homebrew, then guide user
    #[cfg(not(target_os = "windows"))]
    {
        let home = crate::platform::user_home();
        let nvm_sh = format!("{home}/.nvm/nvm.sh");

        // ── 检测辅助：shell PATH 或直接路径都行 ────────────────────────────────────────────
        let node_ver = || -> String {
            let v = shell_output("node --version");
            if !v.is_empty() { return v; }
            node_version_direct() // Tauri sandbox PATH 隔离时用完整路径直接运行
        };

        // ── Strategy 1: nvm already installed — fastest path ──────────────────────────────
        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push("install-via-nvm".to_string());
            let cmd = format!(
                "export NVM_DIR=\"{home}/.nvm\" && . \"{nvm_sh}\" && nvm install 22 && nvm use 22"
            );
            let (ok, _, _) = shell_result(&cmd);
            if ok {
                let ver = node_ver();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
                // nvm reported success but still can't find node — fatal
                return StepResult::err_fixed(
                    "node-install-failed: nvm ok but binary not found".to_string(), fixes,
                );
            }
        }

        // ── Strategy 2: Homebrew (macOS only) ─────────────────────────────────────────────
        #[cfg(target_os = "macos")]
        if !shell_output("brew --version").is_empty() {
            fixes.push("brew-install-node".to_string());
            // HOMEBREW_NO_AUTO_UPDATE=1 skips `brew update` — saves 1-3 minutes
            let (ok, _, _) = shell_result(
                "HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1 brew install node"
            );
            if ok {
                let ver = node_ver();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
            }
            // Fallback: pinned node@22
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
                let ver = node_ver();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
            }
        }

        // ── Strategy 3: install nvm via curl, then install node 22 ────────────────────────
        fixes.push("install-nvm-then-node".to_string());
        shell_ok(
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
        );
        if std::path::Path::new(&nvm_sh).exists() {
            let cmd = format!(
                "export NVM_DIR=\"{home}/.nvm\" && . \"{nvm_sh}\" && nvm install 22 && nvm use 22"
            );
            let (ok, _, _) = shell_result(&cmd);
            if ok {
                let ver = node_ver();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
                return StepResult::err_fixed(
                    "node-install-failed: nvm ok but binary not found".to_string(), fixes,
                );
            }
        }

        StepResult::err_fixed(
            "node-not-found: install Node.js >= 22 via https://nodejs.org or your package manager".to_string(),
            fixes,
        )
    }
}

// ── openclaw CLI ─────────────────────────────────────────────────────────────

fn openclaw_semver(raw: &str) -> String {
    raw.lines()
        .find(|l| {
            let t = l.trim();
            t.contains('.') && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
        })
        .unwrap_or("")
        .trim()
        .to_string()
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_step_check_node() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // ── 1. shell PATH 直接检测 ────────────────────────────────────────────────
    let ver = shell_output("node --version");
    if !ver.is_empty() && node_major(&ver) >= 22 { return StepResult::ok(ver); }

    // ── 2. shell PATH 找不到 → 用文件系统扫描 + 直接路径运行（Tauri sandbox 兼容）──
    let ver_direct = node_version_direct();
    if !ver_direct.is_empty() {
        // node_version_direct 内部已把目录注入了当前进程 PATH
        if node_major(&ver_direct) >= 22 {
            fixes.push("found-via-direct-path".to_string());
            return StepResult::ok_fixed(ver_direct, fixes);
        }
        // 版本过低 → 升级
        return upgrade_node(&ver_direct, fixes);
    }

    // ── 3. 完全找不到 → 自动安装 ─────────────────────────────────────────────
    install_node_auto(fixes)
}

#[tauri::command]
pub async fn deploy_step_install_openclaw() -> StepResult {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    if !sv.is_empty() { return StepResult::ok(format!("already-installed:{}", sv)); }

    let (ok, detail, fixes) = npm_install_with_fallback("openclaw");
    if !ok { return StepResult::err_fixed(detail, fixes); }

    let ver2 = shell_output("openclaw --version");
    let sv2 = openclaw_semver(&ver2);
    if sv2.is_empty() {
        let local = data_local();
        let bin = path_join(&path_join(&local, "clawno-npm-global"), "bin");
        let has_cmd = std::path::Path::new(&path_join(&bin, "openclaw.cmd")).exists()
            || std::path::Path::new(&path_join(&bin, "openclaw")).exists();
        if has_cmd {
            return StepResult::ok_fixed("installed-user-prefix".to_string(), fixes);
        }
        return StepResult::err_fixed(
            "installed-but-not-found: restart app and retry".to_string(),
            fixes,
        );
    }
    StepResult::ok_fixed(format!("installed:{}", sv2), fixes)
}

/// Read which AI providers already have a key configured in OpenClaw.
///
/// Runs `openclaw models status --json` and parses the JSON field:
///   `auth.providers[].provider`
///
/// Returns an empty list on any error (non-fatal — UI falls back gracefully).
#[tauri::command]
pub async fn list_configured_providers() -> Vec<String> {
    let out = shell_output("openclaw models status --json");
    if out.is_empty() {
        return vec![];
    }

    // Parse JSON and navigate auth.providers[].provider
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) else {
        return vec![];
    };

    json.get("auth")
        .and_then(|a| a.get("providers"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    entry.get("provider")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Quick pre-deploy status check: is openclaw installed? is the service running?
/// This runs fast (no npm download) and is called when the Deploy page loads.
#[tauri::command]
pub async fn check_deploy_status() -> crate::types::DeployStatus {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    let openclaw_installed = !sv.is_empty();

    let jlist = crate::pm2::pm2_jlist();
    let service_running =
        jlist.contains("\"openclaw\"") && jlist.contains("\"online\"");

    crate::types::DeployStatus {
        openclaw_installed,
        openclaw_version: sv,
        service_running,
    }
}

/// Force-reinstall openclaw to the latest published version.
///
/// Update strategy (tried in order):
///   1. `openclaw update` — OpenClaw's own self-update command (knows about
///      channels/releases that pre-date npm publication).
///   2. `npm install -g openclaw@latest --force` — always re-downloads even
///      if npm thinks the installed version is current.
///
/// Uses the same fallback chain as the initial install (mirrors, user-prefix).
#[tauri::command]
pub async fn update_openclaw() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // Step 1: try OpenClaw's own self-update command.
    // This reaches OpenClaw's release channel directly, so it can install a
    // version that is not yet published to the npm registry.
    let (self_update_ok, self_update_out, _) = shell_result("openclaw update");
    if self_update_ok {
        fixes.push("self-update-ok".to_string());
    } else {
        // `openclaw update` either doesn't exist or reported a non-fatal status.
        // Keep going — npm install is the definitive fallback.
        fixes.push(format!(
            "self-update-skipped:{}",
            first_line(&self_update_out).chars().take(60).collect::<String>()
        ));
    }

    // Step 2: npm install --force so npm never skips the download when it
    // incorrectly thinks the installed version matches the registry version.
    // Passing "openclaw@latest --force" appends --force to every npm command
    // in npm_install_with_fallback (primary, mirror, and user-prefix variants).
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
///   1. Stop + delete the pm2 process (service gone, no autostart on reboot)
///   2. Uninstall the openclaw npm package from every known install location
///
/// Data in ~/.openclaw/ is intentionally NOT deleted so the user can
/// restore conversations and configuration by re-deploying.
#[tauri::command]
pub async fn uninstall_local_instance() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // ── 1. Stop + remove from pm2 ─────────────────────────────────────────────
    let (stop_ok, _, _) = shell_result("pm2 stop openclaw");
    if stop_ok { fixes.push("pm2-stopped".to_string()); }

    let (delete_ok, _, _) = shell_result("pm2 delete openclaw");
    if delete_ok { fixes.push("pm2-deleted".to_string()); }

    // Persist the pm2 process list so openclaw doesn't resurrect after a reboot.
    let _ = shell_result("pm2 save");

    // ── 2. Uninstall openclaw npm package ─────────────────────────────────────
    // Try global uninstall first, then the user-prefix fallback path.
    let (global_ok, _, _) = shell_result("npm uninstall -g openclaw");
    if global_ok {
        fixes.push("npm-uninstalled-global".to_string());
    } else {
        // Fallback: user prefix (clawno-npm-global)
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

    // ── 3. Data directory left intact ─────────────────────────────────────────
    // ~/.openclaw/ is preserved so the user can restore by re-deploying.
    fixes.push("data-preserved".to_string());

    StepResult::ok_fixed("uninstalled".to_string(), fixes)
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_major_parses_standard_version() {
        assert_eq!(node_major("v22.0.0"), 22);
        assert_eq!(node_major("v20.11.1"), 20);
        assert_eq!(node_major("v18.0.0"), 18);
    }

    #[test]
    fn node_major_without_v_prefix() {
        assert_eq!(node_major("24.0.0"), 24);
    }

    #[test]
    fn node_major_invalid_returns_zero() {
        assert_eq!(node_major(""), 0);
        assert_eq!(node_major("not-a-version"), 0);
    }

    #[test]
    fn classify_permission_denied() {
        assert_eq!(classify_npm_error("Error: EACCES permission denied", ""), NpmError::PermissionDenied);
    }

    #[test]
    fn classify_network_timeout() {
        assert_eq!(classify_npm_error("ETIMEDOUT connect", ""), NpmError::NetworkTimeout);
    }

    #[test]
    fn classify_disk_full() {
        assert_eq!(classify_npm_error("ENOSPC no space left on device", ""), NpmError::DiskFull);
    }

    #[test]
    fn classify_ssl_error() {
        assert_eq!(classify_npm_error("SSL certificate problem", ""), NpmError::SslError);
    }

    #[test]
    fn classify_unknown_fallback() {
        assert_eq!(classify_npm_error("some random error", ""), NpmError::Unknown);
    }

    #[test]
    fn openclaw_semver_parses() {
        let raw = "openclaw/1.2.3 linux-x64 node-v22.0.0\n1.2.3";
        assert_eq!(openclaw_semver(raw), "1.2.3");
    }
}
