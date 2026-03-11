/// Cross-platform shell execution and path resolution.
///
/// All platform-specific constants and helpers live here so that other modules
/// only import from `crate::platform` and remain platform-agnostic in their logic.

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
    return std::env::var("XDG_CONFIG_HOME")
        .unwrap_or_else(|_| format!("{}/.config", user_home()));
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
    std::path::Path::new(a).join(b).to_string_lossy().into_owned()
}

// ── PATH augmentation ───────────────────────────────────────────────────────

/// Build a PATH string that includes all common Node.js install locations.
/// Prepended so our managed installs take precedence over system installs.
pub fn augmented_path() -> String {
    let home    = user_home();
    let roaming = data_roaming();
    let local   = data_local();

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
            format!("{local}\\clawno-npm-global\\bin"),
        ];
        // fnm on Windows: actual node binaries live in version subdirectories,
        // NOT directly in %LOCALAPPDATA%\fnm.
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
                        } else { None }
                    })
                    .collect();
                fnm_vers.sort_by(|a, b| b.cmp(a)); // newest first (v22 before v20)
                for dir in fnm_vers { v.insert(0, dir); }
            }
        }
        v
    };

    #[cfg(not(target_os = "windows"))]
    let extra: Vec<String> = {
        let mut v: Vec<String> = vec![
            // Volta (cross-platform version manager)
            format!("{home}/.volta/bin"),
            // fnm (Fast Node Manager)
            format!("{home}/.fnm/current/bin"),
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
        let nvm_dir = format!("{home}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name();
                    let s = name.to_string_lossy().to_string();
                    if s.starts_with('v') { Some(s) } else { None }
                })
                .collect();
            // Sort descending so newest version appears first in PATH.
            versions.sort_by(|a, b| b.cmp(a));
            for ver in versions {
                v.insert(0, format!("{nvm_dir}/{ver}/bin"));
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
pub fn shell_cmd(cmd: &str) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("cmd");
        c.args(["/C", cmd]).env("PATH", augmented_path());
        c.creation_flags(CREATE_NO_WINDOW);
        c.output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .args(["-c", cmd])
            .env("PATH", augmented_path())
            .output()
    }
}

/// Run a command; return `(success, stdout, stderr)`.
pub fn shell_result(cmd: &str) -> (bool, String, String) {
    match shell_cmd(cmd) {
        Ok(o) => (
            o.status.success(),
            String::from_utf8_lossy(&o.stdout).trim().to_string(),
            String::from_utf8_lossy(&o.stderr).trim().to_string(),
        ),
        Err(e) => (false, String::new(), e.to_string()),
    }
}

/// Run a command; return `true` if it exits with code 0.
pub fn shell_ok(cmd: &str) -> bool {
    shell_cmd(cmd).map(|o| o.status.success()).unwrap_or(false)
}

/// Run a command; return trimmed stdout (empty string on error).
pub fn shell_output(cmd: &str) -> String {
    shell_cmd(cmd)
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Run a command; return stdout if non-empty, otherwise stderr.
pub fn shell_output_both(cmd: &str) -> String {
    shell_cmd(cmd)
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            if out.is_empty() { err } else { out }
        })
        .unwrap_or_default()
}

/// Return the first non-empty, trimmed line of a multi-line string.
pub fn first_line(s: &str) -> &str {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or(s).trim()
}

// ── Unit tests ──────────────────────────────────────────────────────────────

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
