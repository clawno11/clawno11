/// Cross-platform shell execution and path resolution.
///
/// All platform-specific constants and helpers live here so that other modules
/// only import from `crate::platform` and remain platform-agnostic in their logic.
use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Directory resolution ────────────────────────────────────────────────────

pub fn user_home() -> String {
    #[cfg(target_os = "windows")]
    return std::env::var("USERPROFILE").unwrap_or_default();

    #[cfg(not(target_os = "windows"))]
    return std::env::var("HOME").unwrap_or_default();
}

pub fn data_roaming() -> String {
    #[cfg(target_os = "windows")]
    return std::env::var("APPDATA")
        .unwrap_or_else(|_| format!("{}\\AppData\\Roaming", user_home()));

    #[cfg(not(target_os = "windows"))]
    return std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", user_home()));
}

pub fn data_local() -> String {
    #[cfg(target_os = "windows")]
    return std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| format!("{}\\AppData\\Local", user_home()));

    #[cfg(not(target_os = "windows"))]
    return std::env::var("XDG_DATA_HOME")
        .unwrap_or_else(|_| format!("{}/.local/share", user_home()));
}

/// App-specific local data directory (e.g. %LOCALAPPDATA%\clawno on Windows).
pub fn app_data_dir() -> String {
    #[cfg(target_os = "windows")]
    return format!("{}\\clawno", data_local());

    #[cfg(not(target_os = "windows"))]
    return format!("{}/clawno", data_local());
}

/// Path separator for the current platform.
pub fn sep() -> &'static str {
    #[cfg(target_os = "windows")]
    return "\\";
    #[cfg(not(target_os = "windows"))]
    return "/";
}

/// Join two path segments.
/// Fix PL-2: use std::path::Path so trailing separators on `a` are handled correctly
/// and double-separator paths (e.g. "C:\\foo\\\\bar") are never produced.
pub fn path_join(a: &str, b: &str) -> String {
    std::path::Path::new(a)
        .join(b)
        .to_string_lossy()
        .into_owned()
}

// ── PATH augmentation ───────────────────────────────────────────────────────

/// Build a PATH string that includes all common Node.js install locations.
/// Prepended so our managed installs take precedence over system installs.
#[allow(unused_variables)]
pub fn augmented_path() -> String {
    let home = user_home();
    let roaming = data_roaming();
    let local = data_local();

    #[cfg(target_os = "windows")]
    let extra: Vec<String> = {
        let mut v = vec![
            format!("{roaming}\\npm"),
            format!("{local}\\Programs\\nodejs"),
            r"C:\Program Files\nodejs".to_string(),
            r"C:\Program Files (x86)\nodejs".to_string(),
            // nvm-windows symlink
            format!("{local}\\nvm\\current"),
            format!("{home}\\AppData\\Local\\nvm\\current"),
            r"C:\nvm\nodejs".to_string(),
            // Volta, Chocolatey, Scoop
            format!("{local}\\Volta\\bin"),
            format!("{home}\\.volta\\bin"),
            r"C:\ProgramData\chocolatey\bin".to_string(),
            format!("{home}\\scoop\\shims"),
            r"C:\scoop\shims".to_string(),
            format!("{roaming}\\npm-global\\bin"),
            format!("{local}\\clawno-npm-global"),
        ];
        // fnm on Windows: actual node binaries live in version subdirectories,
        // NOT directly in %LOCALAPPDATA%\fnm.
        // IMPORTANT: sort ASCENDING then insert at 0 each time — the last insert
        // (= highest version) ends up at position 0, matching nvm sort logic.
        for fnm_base in &[
            format!("{local}\\fnm\\node-versions"),
            format!("{home}\\.fnm\\node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(fnm_base) {
                let mut fnm_vers: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| {
                        let s = e.file_name().to_string_lossy().to_string();
                        if s.starts_with('v') {
                            Some(format!("{fnm_base}\\{s}\\installation"))
                        } else {
                            None
                        }
                    })
                    .collect();
                fnm_vers.sort(); // ascending: v20 < v22 → last insert at pos 0 wins
                for dir in fnm_vers {
                    v.insert(0, dir);
                }
            }
        }
        v
    };

    #[cfg(not(target_os = "windows"))]
    let extra: Vec<String> = {
        let mut v: Vec<String> = vec![
            // Volta (cross-platform version manager)
            format!("{home}/.volta/bin"),
            // fnm (Fast Node Manager) — check both common locations
            format!("{home}/.fnm/current/bin"),
            format!("{home}/.local/share/fnm/aliases/default/bin"),
            // Standard system binary locations
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            // Global npm packages
            format!("{home}/.npm-global/bin"),
            format!("{home}/.local/bin"),
            format!("{local}/clawno-npm-global/bin"),
        ];
        // nvm: dynamically scan all installed versions (e.g. v24.12.0, v22.5.1)
        // so we don't miss any patch/minor version.
        // IMPORTANT: sort ASCENDING then insert at 0 each time — the last insert
        // (= highest version) ends up at position 0.  Descending + insert(0) would
        // accidentally put the OLDEST version first.
        // Respect NVM_DIR env var (some users install nvm to a custom location).
        let nvm_dir = std::env::var("NVM_DIR")
            .ok()
            .filter(|d| !d.is_empty() && std::path::Path::new(d).exists())
            .map(|d| format!("{d}/versions/node"))
            .unwrap_or_else(|| format!("{home}/.nvm/versions/node"));
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name();
                    let s = name.to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(s)
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort(); // ascending: v20 < v22 < v24 → last insert wins at pos 0
            for ver in versions {
                v.insert(0, format!("{nvm_dir}/{ver}/bin"));
            }
        }
        // fnm: scan version directories (same logic as nvm)
        for fnm_base in &[
            format!("{home}/.local/share/fnm/node-versions"),
            format!("{home}/.fnm/node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(fnm_base) {
                let mut fnm_bins: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| {
                        let s = e.file_name().to_string_lossy().to_string();
                        if s.starts_with('v') {
                            Some(format!("{fnm_base}/{s}/installation/bin"))
                        } else {
                            None
                        }
                    })
                    .collect();
                fnm_bins.sort();
                for bin in fnm_bins {
                    v.insert(0, bin);
                }
            }
        }
        v
    };

    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    return format!("{};{}", extra.join(";"), current);

    #[cfg(not(target_os = "windows"))]
    return format!("{}:{}", extra.join(":"), current);
}

// ── Shell execution ─────────────────────────────────────────────────────────

/// Run a shell command string and return the raw `Output`.
/// When `allow_window` is true on Windows, the process is NOT created with
/// CREATE_NO_WINDOW, so UAC and installer GUIs can appear.
pub fn shell_cmd(cmd: &str, allow_window: bool) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("cmd");
        c.args(["/C", cmd]).env("PATH", augmented_path());
        if !allow_window {
            c.creation_flags(CREATE_NO_WINDOW);
        }
        c.output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = allow_window;
        Command::new("sh")
            .args(["-c", cmd])
            .env("PATH", augmented_path())
            .output()
    }
}

/// Run a command; return `(success, stdout, stderr)`.
/// Uses CREATE_NO_WINDOW on Windows (hidden).
pub fn shell_result(cmd: &str) -> (bool, String, String) {
    shell_result_opt(cmd, false, false)
}

/// Run a command; when allow_window is true on Windows, UAC/installer can show.
pub fn shell_result_visible(cmd: &str) -> (bool, String, String) {
    shell_result_opt(cmd, true, false)
}

/// Like shell_result_visible, but treats exit codes 3010 (reboot required) and
/// 1641 (installer restarted) as success — common for Windows installers.
pub fn shell_result_visible_installer(cmd: &str) -> (bool, String, String) {
    shell_result_opt(cmd, true, true)
}

fn shell_result_opt(
    cmd: &str,
    allow_window: bool,
    allow_reboot_codes: bool,
) -> (bool, String, String) {
    match shell_cmd(cmd, allow_window) {
        Ok(o) => {
            let success = if allow_reboot_codes {
                #[cfg(target_os = "windows")]
                {
                    matches!(o.status.code(), Some(0) | Some(1641) | Some(3010))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = allow_reboot_codes;
                    o.status.success()
                }
            } else {
                o.status.success()
            };
            (
                success,
                String::from_utf8_lossy(&o.stdout).trim().to_string(),
                String::from_utf8_lossy(&o.stderr).trim().to_string(),
            )
        }
        Err(e) => (false, String::new(), e.to_string()),
    }
}

/// Run a command; return `true` if it exits with code 0.
pub fn shell_ok(cmd: &str) -> bool {
    shell_cmd(cmd, false)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a command; return trimmed stdout (empty string on error).
pub fn shell_output(cmd: &str) -> String {
    shell_cmd(cmd, false)
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Return the first non-empty, trimmed line of a multi-line string.
pub fn first_line(s: &str) -> &str {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or(s).trim()
}

// ── Unit tests ──────────────────────────────────────────────────────────────

/// Returns free disk space in MB for the drive containing `path`.
/// Returns 0 if detection fails.
pub fn free_disk_mb(path: &str) -> u64 {
    #[cfg(target_os = "windows")]
    {
        let drive = path.chars().next().unwrap_or('C');
        let out = shell_output(&format!(
            "powershell -NoProfile -Command \"(Get-PSDrive {}).Free\"",
            drive
        ));
        out.trim()
            .parse::<u64>()
            .map(|b| b / 1_048_576)
            .unwrap_or(0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let safe_path = path.replace('\'', "'\\''");
        // Use df -Pm for POSIX-portable output in 1MB blocks.
        // -P forces single-line output (no wrapping on long mount points).
        // The "Available" column is always the 4th field in POSIX mode.
        let out = shell_output(&format!("df -Pm '{}' 2>/dev/null | tail -1", safe_path));
        out.split_whitespace()
            .nth(3)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    }
}

// ── Platform capability detection ────────────────────────────────────────────

/// One-shot snapshot of the platform environment, used by the strategy-chain
/// executor to rank available install methods and choose registries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformProfile {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub total_memory_mb: u64,
    pub is_chinese_locale: bool,
    pub has_winget: bool,
    pub has_choco: bool,
    pub has_brew: bool,
    pub has_nvm: bool,
    pub has_fnm: bool,
    pub has_volta: bool,
    pub has_apt: bool,
    pub has_dnf: bool,
    pub has_pacman: bool,
    pub free_disk_mb: u64,
    pub is_admin: bool,
    pub http_proxy: Option<String>,
}

pub fn detect_platform() -> PlatformProfile {
    let home = user_home();

    PlatformProfile {
        os: std::env::consts::OS.to_string(),
        os_version: detect_os_version(),
        arch: std::env::consts::ARCH.to_string(),
        total_memory_mb: detect_total_memory_mb(),
        is_chinese_locale: detect_chinese_locale(),
        has_winget: has_command("winget --version"),
        has_choco: has_command("choco --version"),
        has_brew: has_command("brew --version"),
        has_nvm: detect_nvm(),
        has_fnm: has_command("fnm --version"),
        has_volta: has_command("volta --version"),
        has_apt: has_command_unix("which apt-get"),
        has_dnf: has_command_unix("which dnf"),
        has_pacman: has_command_unix("which pacman"),
        free_disk_mb: free_disk_mb(&home),
        is_admin: detect_admin(),
        http_proxy: std::env::var("HTTP_PROXY")
            .or_else(|_| std::env::var("http_proxy"))
            .ok()
            .filter(|s| !s.is_empty()),
    }
}

fn has_command(cmd: &str) -> bool {
    !shell_output(cmd).is_empty()
}

#[allow(unused_variables)]
fn has_command_unix(cmd: &str) -> bool {
    #[cfg(target_os = "windows")]
    return false;
    #[cfg(not(target_os = "windows"))]
    shell_ok(cmd)
}

pub fn detect_chinese_locale() -> bool {
    if let Ok(lang) = std::env::var("LANG") {
        if lang.starts_with("zh") {
            return true;
        }
    }
    if let Ok(tz) = std::env::var("TZ") {
        if tz.contains("Shanghai") || tz.contains("Chongqing") || tz.contains("Asia/Beijing") {
            return true;
        }
    }
    #[cfg(target_os = "windows")]
    {
        let locale = shell_output("powershell -NoProfile -Command \"(Get-Culture).Name\"");
        if locale.trim().starts_with("zh") {
            return true;
        }
    }
    false
}

fn detect_nvm() -> bool {
    #[cfg(target_os = "windows")]
    return !shell_output("nvm version").is_empty();

    #[cfg(not(target_os = "windows"))]
    {
        let nvm_dir = std::env::var("NVM_DIR")
            .ok()
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| format!("{}/.nvm", user_home()));
        std::path::Path::new(&format!("{}/nvm.sh", nvm_dir)).exists()
    }
}

fn detect_os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        let ver = shell_output(
            "powershell -NoProfile -Command \"[System.Environment]::OSVersion.Version.ToString()\"",
        );
        let trimmed = ver.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    #[cfg(target_os = "macos")]
    {
        let ver = shell_output("sw_vers -productVersion 2>/dev/null");
        let trimmed = ver.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    #[cfg(target_os = "linux")]
    {
        let ver = shell_output(
            "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | head -1 | cut -d= -f2 | tr -d '\"'",
        );
        let trimmed = ver.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".to_string()
}

fn detect_total_memory_mb() -> u64 {
    use sysinfo::System;
    let sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    sys.total_memory() / 1_048_576
}

fn detect_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        shell_ok("net session >nul 2>&1")
    }
    #[cfg(not(target_os = "windows"))]
    {
        shell_output("id -u").trim() == "0"
    }
}

impl PlatformProfile {
    /// Collect version strings for all detected package managers.
    pub fn package_manager_versions(&self) -> Vec<clawno_core::types::PackageManagerInfo> {
        use clawno_core::types::PackageManagerInfo;
        let pm = |name: &str, available: bool, cmd: &str| -> PackageManagerInfo {
            PackageManagerInfo {
                name: name.to_string(),
                available,
                version: if available {
                    let v = shell_output(cmd).trim().to_string();
                    if v.is_empty() {
                        None
                    } else {
                        Some(v)
                    }
                } else {
                    None
                },
            }
        };
        vec![
            pm("winget", self.has_winget, "winget --version"),
            pm("choco", self.has_choco, "choco --version"),
            pm("brew", self.has_brew, "brew --version"),
            pm("nvm", self.has_nvm, "nvm --version"),
            pm("fnm", self.has_fnm, "fnm --version"),
            pm("volta", self.has_volta, "volta --version"),
            pm("apt", self.has_apt, "apt-get --version"),
            pm("dnf", self.has_dnf, "dnf --version"),
            pm("pacman", self.has_pacman, "pacman --version"),
        ]
    }

    /// Return the nodejs.org download URL for this platform.
    pub fn node_download_url(&self, version: &str) -> String {
        let os_part = match self.os.as_str() {
            "windows" => "win",
            "macos" => "darwin",
            _ => "linux",
        };
        let arch_part = match self.arch.as_str() {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            "x86" => "x86",
            other => other,
        };
        let ext = if self.os == "windows" {
            "zip"
        } else {
            "tar.gz"
        };
        format!("https://nodejs.org/dist/{version}/node-{version}-{os_part}-{arch_part}.{ext}")
    }

    /// Return the nodejs.org MSI installer URL for Windows (x64/arm64/x86).
    /// Used for direct install — MSI 运行时可可靠触发 UAC。
    #[cfg(target_os = "windows")]
    pub fn node_msi_download_url(&self, version: &str) -> String {
        let arch_part = match self.arch.as_str() {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            "x86" => "x86",
            _ => "x64",
        };
        let ver_strip = version.trim_start_matches('v');
        format!("https://nodejs.org/dist/{version}/node-{ver_strip}-{arch_part}.msi")
    }

    /// Preferred npm registry based on locale.
    pub fn primary_registry(&self) -> &str {
        if self.is_chinese_locale {
            "https://registry.npmmirror.com"
        } else {
            "https://registry.npmjs.org"
        }
    }

    /// Fallback npm registry (the opposite of primary).
    pub fn fallback_registry(&self) -> &str {
        if self.is_chinese_locale {
            "https://registry.npmjs.org"
        } else {
            "https://registry.npmmirror.com"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_line_skips_empty() {
        assert_eq!(first_line("\n\n  hello\nworld"), "hello");
    }

    #[test]
    fn first_line_trims_whitespace() {
        assert_eq!(first_line("   trimmed   "), "trimmed");
    }

    #[test]
    fn first_line_empty_string() {
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn path_join_uses_platform_sep() {
        let result = path_join("foo", "bar");
        assert!(result.contains("foo") && result.contains("bar"));
        assert!(result.contains(sep()));
    }

    #[test]
    fn augmented_path_nonempty() {
        assert!(!augmented_path().is_empty());
    }
}
