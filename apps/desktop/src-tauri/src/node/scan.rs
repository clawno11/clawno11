#[cfg(not(target_os = "windows"))]
use crate::platform::shell_output;
/// Filesystem scanning for Node.js and openclaw binaries across well-known
/// install locations (nvm, fnm, volta, mise, asdf, Homebrew, winget, etc.).
use crate::platform::{data_local, path_join};

/// Parse the major version number from a `v24.0.0` style string.
pub fn node_major(ver: &str) -> u32 {
    ver.trim_start_matches('v')
        .split('.')
        .next()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0)
}

/// Extract a major version number from a binary path like `.../v22.1.0/bin/node`.
/// Used as fallback when the binary cannot be executed (quarantine, Rosetta, etc.).
fn major_from_path(path: &str) -> u32 {
    let p = path.replace('\\', "/");
    for segment in p.split('/') {
        let digits = segment.trim_start_matches('v');
        if let Some(m_str) = digits.split('.').next() {
            if let Ok(m) = m_str.parse::<u32>() {
                if (10..100).contains(&m) {
                    return m;
                }
            }
        }
    }
    0
}

/// Find the first `node` / `node.exe` binary in the current process PATH (including
/// dirs injected during the deploy step) that is version 22 or newer.
/// Falls back to path-name heuristics when the binary cannot be executed.
///
/// Used by the chat module and gateway CJS wrapper to bypass hardcoded
/// shebangs in the openclaw/pm2 wrapper scripts.
pub fn find_node_exe() -> String {
    #[cfg(target_os = "windows")]
    let exe_name = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "node";

    let path_env = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };

    let mut path_hint_v22 = String::new();
    let mut first_executable = String::new();
    let mut first_existing = String::new();

    for dir in path_env.split(sep) {
        let candidate = std::path::Path::new(dir).join(exe_name);
        if !candidate.exists() {
            continue;
        }
        let s = candidate.to_string_lossy().to_string();
        match std::process::Command::new(&s).arg("--version").output() {
            Ok(o) => {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let major = ver
                    .trim_start_matches('v')
                    .split('.')
                    .next()
                    .unwrap_or("0")
                    .parse::<u32>()
                    .unwrap_or(0);
                if major >= 22 {
                    return s;
                }
                if first_executable.is_empty() {
                    first_executable = s;
                }
            }
            Err(_) => {
                if major_from_path(&s) >= 22 && path_hint_v22.is_empty() {
                    path_hint_v22 = s;
                } else if first_existing.is_empty() {
                    first_existing = s;
                }
            }
        }
    }
    if !path_hint_v22.is_empty() {
        return path_hint_v22;
    }
    if !first_executable.is_empty() {
        return first_executable;
    }
    if !first_existing.is_empty() {
        return first_existing;
    }
    exe_name.to_string()
}

/// Inject a binary's parent directory into the current process PATH.
/// Returns the injected directory path.
pub(super) fn inject_bin_dir(bin_path: &str) -> String {
    let parent = std::path::Path::new(bin_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if !parent.is_empty() {
        let sep = if cfg!(target_os = "windows") {
            ";"
        } else {
            ":"
        };
        let current = std::env::var("PATH").unwrap_or_default();
        if !current.contains(&parent) {
            std::env::set_var("PATH", format!("{}{}{}", parent, sep, current));
        }
    }
    parent
}

/// Resolve the nvm data directory, respecting custom NVM_DIR env var.
/// Default: ~/.nvm  (override: export NVM_DIR=/custom/path in shell profile)
#[cfg(not(target_os = "windows"))]
pub(super) fn nvm_dir() -> String {
    if let Ok(dir) = std::env::var("NVM_DIR") {
        let nvm_sh = format!("{dir}/nvm.sh");
        if !dir.is_empty() && std::path::Path::new(&nvm_sh).exists() {
            return dir;
        }
    }
    format!("{}/.nvm", crate::platform::user_home())
}

/// Source nvm.sh in a subprocess and run `which node` to get the absolute path
/// to the currently active node binary.  This is the most reliable method for
/// nvm-managed installations because it lets nvm resolve its own PATH instead of
/// us guessing the version directory.
///
/// Returns the full binary path (e.g. ~/.nvm/versions/node/v22.x.x/bin/node)
/// or an empty string if nvm is not installed or node is not found.
#[cfg(not(target_os = "windows"))]
pub(super) fn nvm_which_node() -> String {
    let nvm = nvm_dir();
    let nvm_sh = format!("{nvm}/nvm.sh");
    if !std::path::Path::new(&nvm_sh).exists() {
        return String::new();
    }
    let cmd =
        format!("export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" 2>/dev/null && which node 2>/dev/null");
    let path = shell_output(&cmd).trim().to_string();
    if !path.is_empty() && std::path::Path::new(&path).exists() {
        path
    } else {
        String::new()
    }
}

/// Run the node binary by its **full path** (bypasses shell PATH entirely).
/// Used as a fallback when `shell_output("node --version")` returns empty
/// due to Tauri sandbox PATH isolation on macOS.
pub(super) fn node_version_direct() -> String {
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
            if !ver.is_empty() {
                inject_bin_dir(&bin);
            }
            return ver;
        }
    }
    String::new()
}

/// Search well-known directories for the `openclaw` / `openclaw.cmd` binary.
/// Mirrors the same locations that npm installs to, including nvm-managed paths.
/// Returns the bin directory that contains the binary (not the binary path itself).
pub fn scan_openclaw_bin_dir() -> Option<String> {
    let home = crate::platform::user_home();
    let local = data_local();

    #[cfg(target_os = "windows")]
    {
        let roaming = crate::platform::data_roaming();
        let mut candidates = vec![
            format!("{roaming}\\npm"),
            format!("{local}\\clawno-npm-global\\bin"),
            format!("{local}\\Programs\\nodejs"),
            r"C:\Program Files\nodejs".to_string(),
        ];
        for fnm_base in &[
            format!("{local}\\fnm\\node-versions"),
            format!("{home}\\AppData\\Local\\fnm\\node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(fnm_base) {
                let mut fnm_bins: Vec<String> = entries
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
                fnm_bins.sort_by(|a, b| b.cmp(a));
                candidates.extend(fnm_bins);
            }
        }
        for dir in &candidates {
            if std::path::Path::new(&path_join(dir, "openclaw.cmd")).exists() {
                return Some(dir.clone());
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut candidates = vec![
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            format!("{home}/.npm-global/bin"),
            format!("{local}/clawno-npm-global/bin"),
        ];
        let nvm_vers_dir = format!("{}/versions/node", nvm_dir());
        if let Ok(entries) = std::fs::read_dir(&nvm_vers_dir) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(format!("{nvm_vers_dir}/{s}/bin"))
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort();
            for ver_bin in versions {
                candidates.insert(0, ver_bin);
            }
        }
        for dir in &candidates {
            if std::path::Path::new(&path_join(dir, "openclaw")).exists() {
                return Some(dir.clone());
            }
        }
        None
    }
}

/// Search well-known npm global lib paths for `openclaw/openclaw.mjs`.
/// Used as fallback when `npm root -g` fails due to shell PATH isolation.
pub fn scan_openclaw_mjs() -> Option<String> {
    let home = crate::platform::user_home();
    let local = data_local();

    #[cfg(target_os = "windows")]
    let mut candidates: Vec<String> = vec![format!(
        "{local}\\clawno-npm-global\\node_modules\\openclaw\\openclaw.mjs"
    )];
    #[cfg(not(target_os = "windows"))]
    let mut candidates: Vec<String> = vec![format!(
        "{local}/clawno-npm-global/lib/node_modules/openclaw/openclaw.mjs"
    )];

    #[cfg(not(target_os = "windows"))]
    {
        let nvm_vers_mjs = format!("{}/versions/node", nvm_dir());
        if let Ok(entries) = std::fs::read_dir(&nvm_vers_mjs) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(format!(
                            "{nvm_vers_mjs}/{s}/lib/node_modules/openclaw/openclaw.mjs"
                        ))
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort();
            for p in versions {
                candidates.insert(0, p);
            }
        }
        candidates.push(format!(
            "{home}/.npm-global/lib/node_modules/openclaw/openclaw.mjs"
        ));
        candidates.push("/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs".to_string());
        candidates.push("/usr/local/lib/node_modules/openclaw/openclaw.mjs".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let roaming = crate::platform::data_roaming();
        candidates.push(format!(
            "{roaming}\\npm\\node_modules\\openclaw\\openclaw.mjs"
        ));
        candidates.push(format!(
            "{local}\\Programs\\nodejs\\node_modules\\openclaw\\openclaw.mjs"
        ));
        candidates.push(r"C:\Program Files\nodejs\node_modules\openclaw\openclaw.mjs".to_string());
        for fnm_base in &[
            format!("{local}\\fnm\\node-versions"),
            format!("{home}\\.fnm\\node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(fnm_base) {
                let mut fnm_mjs: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| {
                        let s = e.file_name().to_string_lossy().to_string();
                        if s.starts_with('v') {
                            Some(format!("{fnm_base}\\{s}\\installation\\node_modules\\openclaw\\openclaw.mjs"))
                        } else { None }
                    })
                    .collect();
                fnm_mjs.sort();
                for p in fnm_mjs {
                    candidates.insert(0, p);
                }
            }
        }
    }

    let _ = home; // suppress unused warning on Windows
    candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
}

/// Search well-known directories for an existing `node.exe` / `node` binary.
pub fn scan_node_paths() -> Option<String> {
    let home = crate::platform::user_home();
    let local = data_local();

    #[cfg(target_os = "windows")]
    let candidates = {
        let mut v = vec![
            format!("{local}\\Programs\\nodejs"),
            r"C:\Program Files\nodejs".to_string(),
            r"C:\Program Files (x86)\nodejs".to_string(),
            format!("{local}\\nvm\\current"),
            format!("{home}\\AppData\\Local\\nvm\\current"),
            r"C:\nvm\nodejs".to_string(),
            format!("{local}\\Volta\\bin"),
            format!("{home}\\.volta\\bin"),
            r"C:\ProgramData\chocolatey\lib\nodejs\tools".to_string(),
            r"C:\ProgramData\chocolatey\bin".to_string(),
            format!("{home}\\scoop\\apps\\nodejs\\current"),
            format!("{home}\\scoop\\shims"),
        ];
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
                fnm_vers.sort();
                for dir in fnm_vers {
                    v.insert(0, dir);
                }
            }
        }
        v
    };

    #[cfg(not(target_os = "windows"))]
    let candidates = {
        let mut v = vec![
            format!("{home}/.volta/bin"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            format!("{home}/.npm-global/bin"),
            format!("{home}/.local/bin"),
        ];

        let nvm_base = nvm_dir();
        let nvm_vers = format!("{nvm_base}/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_vers) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(format!("{nvm_vers}/{s}/bin"))
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort();
            for ver_bin in versions {
                v.insert(0, ver_bin);
            }
        }

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

        let mise_dir = format!("{home}/.local/share/mise/installs/node");
        if let Ok(entries) = std::fs::read_dir(&mise_dir) {
            let mut mise_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                    {
                        Some(format!("{mise_dir}/{s}/bin"))
                    } else {
                        None
                    }
                })
                .collect();
            mise_bins.sort();
            for bin in mise_bins {
                v.insert(0, bin);
            }
        }

        let asdf_dir = format!("{home}/.asdf/installs/nodejs");
        if let Ok(entries) = std::fs::read_dir(&asdf_dir) {
            let mut asdf_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                    {
                        Some(format!("{asdf_dir}/{s}/bin"))
                    } else {
                        None
                    }
                })
                .collect();
            asdf_bins.sort();
            for bin in asdf_bins {
                v.insert(0, bin);
            }
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

/// Parse the openclaw semver from CLI output like `openclaw/1.2.3 linux-x64 node-v22.0.0\n1.2.3`.
pub(super) fn openclaw_semver(raw: &str) -> String {
    raw.lines()
        .find(|l| {
            let t = l.trim();
            t.contains('.')
                && t.chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
        })
        .unwrap_or("")
        .trim()
        .to_string()
}

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
    fn openclaw_semver_parses() {
        let raw = "openclaw/1.2.3 linux-x64 node-v22.0.0\n1.2.3";
        assert_eq!(openclaw_semver(raw), "1.2.3");
    }
}
