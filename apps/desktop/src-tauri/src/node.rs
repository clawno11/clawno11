/// Node.js and openclaw npm-package management.
///
/// Handles detection, version checking, automatic installation/upgrade of
/// Node.js, and global installation of the `openclaw` CLI package.

use crate::platform::{
    data_local, first_line,
    shell_ok, shell_output, shell_result, path_join,
};
use crate::types::StepResult;

// ?? npm error classification ?????????????????????????????????????????????????

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

// ?? npm install with automatic fallbacks ????????????????????????????????????

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
            // wmic is Windows-only and deprecated on Win11 ? use PowerShell as fallback.
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

// ?? Node.js scan / install ???????????????????????????????????????????????????

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
                if m >= 10 && m < 100 { return m; }
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
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };

    let mut path_hint_v22 = String::new();
    let mut first_executable = String::new();
    let mut first_existing  = String::new();

    for dir in path_env.split(sep) {
        let candidate = std::path::Path::new(dir).join(exe_name);
        if !candidate.exists() { continue; }
        let s = candidate.to_string_lossy().to_string();
        match std::process::Command::new(&s).arg("--version").output() {
            Ok(o) => {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let major = ver.trim_start_matches('v').split('.').next()
                    .unwrap_or("0").parse::<u32>().unwrap_or(0);
                if major >= 22 { return s; }
                if first_executable.is_empty() { first_executable = s; }
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
    if !path_hint_v22.is_empty() { return path_hint_v22; }
    if !first_executable.is_empty() { return first_executable; }
    if !first_existing.is_empty() { return first_existing; }
    exe_name.to_string()
}

/// Inject a binary's parent directory into the current process PATH.
/// Returns the injected directory path.
fn inject_bin_dir(bin_path: &str) -> String {
    let parent = std::path::Path::new(bin_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if !parent.is_empty() {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
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
fn nvm_dir() -> String {
    // User may have set NVM_DIR to a custom location in their shell profile.
    // The Tauri GUI process might not inherit this, so we try both.
    if let Ok(dir) = std::env::var("NVM_DIR") {
        let nvm_sh = format!("{dir}/nvm.sh");
        if !dir.is_empty() && std::path::Path::new(&nvm_sh).exists() {
            return dir;
        }
    }
    // Standard default location
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
fn nvm_which_node() -> String {
    let nvm = nvm_dir();
    let nvm_sh = format!("{nvm}/nvm.sh");
    if !std::path::Path::new(&nvm_sh).exists() {
        return String::new();
    }
    let cmd = format!(
        "export NVM_DIR=\"{nvm}\" && . \"{nvm_sh}\" 2>/dev/null && which node 2>/dev/null"
    );
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
            // Inject the dir into current process PATH so npm/pm2 steps can use it
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
    let home  = crate::platform::user_home();
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
        // fnm: openclaw.cmd may be in fnm version dirs
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
                        } else { None }
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
        // nvm: scan all installed node versions for the openclaw binary
        let nvm_vers_dir = format!("{}/versions/node", nvm_dir());
        if let Ok(entries) = std::fs::read_dir(&nvm_vers_dir) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') { Some(format!("{nvm_vers_dir}/{s}/bin")) } else { None }
                })
                .collect();
            versions.sort(); // ascending ? newest ends up at insert-pos-0 after all inserts
            for ver_bin in versions { candidates.insert(0, ver_bin); }
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
    let home  = crate::platform::user_home();
    let local = data_local();

    // On Windows npm installs to {prefix}\node_modules\ (no `lib` subdir).
    // On macOS/Linux it's {prefix}/lib/node_modules/.
    #[cfg(target_os = "windows")]
    let mut candidates: Vec<String> = vec![
        format!("{local}\\clawno-npm-global\\node_modules\\openclaw\\openclaw.mjs"),
    ];
    #[cfg(not(target_os = "windows"))]
    let mut candidates: Vec<String> = vec![
        format!("{local}/clawno-npm-global/lib/node_modules/openclaw/openclaw.mjs"),
    ];

    #[cfg(not(target_os = "windows"))]
    {
        // nvm: scan all node versions
        let nvm_vers_mjs = format!("{}/versions/node", nvm_dir());
        if let Ok(entries) = std::fs::read_dir(&nvm_vers_mjs) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') {
                        Some(format!("{nvm_vers_mjs}/{s}/lib/node_modules/openclaw/openclaw.mjs"))
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort(); // ascending ? newest ends up at insert-pos-0 after all inserts
            for p in versions { candidates.insert(0, p); }
        }
        candidates.push(format!("{home}/.npm-global/lib/node_modules/openclaw/openclaw.mjs"));
        candidates.push("/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs".to_string());
        candidates.push("/usr/local/lib/node_modules/openclaw/openclaw.mjs".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let roaming = crate::platform::data_roaming();
        // Standard npm global install locations
        candidates.push(format!("{roaming}\\npm\\node_modules\\openclaw\\openclaw.mjs"));
        candidates.push(format!("{local}\\Programs\\nodejs\\node_modules\\openclaw\\openclaw.mjs"));
        candidates.push(r"C:\Program Files\nodejs\node_modules\openclaw\openclaw.mjs".to_string());
        // fnm version dirs: {local}\fnm\node-versions\vX.Y.Z\installation\lib\node_modules\
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
                fnm_mjs.sort(); // ascending: last insert at pos 0 = newest version first
                for p in fnm_mjs { candidates.insert(0, p); }
            }
        }
    }

    let _ = home; // suppress unused warning on Windows
    candidates.into_iter().find(|p| std::path::Path::new(p).exists())
}

/// Search well-known directories for an existing `node.exe` / `node` binary.
pub fn scan_node_paths() -> Option<String> {
    let home  = crate::platform::user_home();
    let local = data_local();

    #[cfg(target_os = "windows")]
    let candidates = {
        let mut v = vec![
            format!("{local}\\Programs\\nodejs"),
            r"C:\Program Files\nodejs".to_string(),
            r"C:\Program Files (x86)\nodejs".to_string(),
            // nvm-windows: creates a symlink at %LOCALAPPDATA%\nvm\current
            format!("{local}\\nvm\\current"),
            format!("{home}\\AppData\\Local\\nvm\\current"),
            r"C:\nvm\nodejs".to_string(),
            // Volta: shim launcher in ~/.volta/bin
            format!("{local}\\Volta\\bin"),
            format!("{home}\\.volta\\bin"),
            // Chocolatey
            r"C:\ProgramData\chocolatey\lib\nodejs\tools".to_string(),
            r"C:\ProgramData\chocolatey\bin".to_string(),
            // Scoop
            format!("{home}\\scoop\\apps\\nodejs\\current"),
            format!("{home}\\scoop\\shims"),
        ];
        // fnm on Windows: actual node binaries are at
        // %LOCALAPPDATA%\fnm\node-versions\vX.Y.Z\installation\
        // NOT at %LOCALAPPDATA%\fnm directly.
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
                fnm_vers.sort(); // ascending ? newest ends up at insert-pos-0
                for dir in fnm_vers { v.insert(0, dir); }
            }
        }
        v
    };

    #[cfg(not(target_os = "windows"))]
    let candidates = {
        let mut v = vec![
            format!("{home}/.volta/bin"),
            "/opt/homebrew/bin".to_string(), // Apple Silicon Homebrew
            "/usr/local/bin".to_string(),     // Intel Mac Homebrew / pkg installer
            "/usr/bin".to_string(),
            format!("{home}/.npm-global/bin"),
            format!("{home}/.local/bin"),
        ];

        // ?? nvm: scan all installed versions (respects custom NVM_DIR) ?????????
        let nvm_base = nvm_dir();
        let nvm_vers = format!("{nvm_base}/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_vers) {
            let mut versions: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.starts_with('v') { Some(format!("{nvm_vers}/{s}/bin")) } else { None }
                })
                .collect();
            versions.sort(); // ascending ? newest ends up at insert-pos-0
            for ver_bin in versions { v.insert(0, ver_bin); }
        }

        // ?? fnm: actual version directories (not just the current symlink) ??????
        // fnm stores versions at ~/.local/share/fnm/node-versions/vX.Y.Z/installation/bin/
        // The ~/.fnm/current/bin symlink only works in the active shell, not GUI apps.
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
                        } else { None }
                    })
                    .collect();
                fnm_bins.sort(); // ascending: last insert at pos 0 = newest version first
                for bin in fnm_bins { v.insert(0, bin); }
            }
        }

        // ?? mise (formerly rtx): ~/.local/share/mise/installs/node/X.Y.Z/bin/ ??
        let mise_dir = format!("{home}/.local/share/mise/installs/node");
        if let Ok(entries) = std::fs::read_dir(&mise_dir) {
            let mut mise_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    // mise uses bare version numbers like "22.14.0" (no 'v' prefix)
                    if s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                        Some(format!("{mise_dir}/{s}/bin"))
                    } else { None }
                })
                .collect();
            mise_bins.sort(); // ascending: last insert at pos 0 = newest version first
            for bin in mise_bins { v.insert(0, bin); }
        }

        // ?? asdf: ~/.asdf/installs/nodejs/X.Y.Z/bin/ ?????????????????????????
        let asdf_dir = format!("{home}/.asdf/installs/nodejs");
        if let Ok(entries) = std::fs::read_dir(&asdf_dir) {
            let mut asdf_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let s = e.file_name().to_string_lossy().to_string();
                    if s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                        Some(format!("{asdf_dir}/{s}/bin"))
                    } else { None }
                })
                .collect();
            asdf_bins.sort(); // ascending: last insert at pos 0 = newest version first
            for bin in asdf_bins { v.insert(0, bin); }
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
            // nvm use 22 updates the %LOCALAPPDATA%\nvm\current symlink.
            // augmented_path() already includes this dir, so shell_output should pick it up.
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
            // Fallback: scan nvm dirs directly if shell didn't see the symlink change
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 { return StepResult::ok_fixed(ver2, fixes); }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
            // fnm on Windows requires evaluating `fnm env` in the current shell to update
            // PATH ? that's not possible in a subprocess. Instead, scan the fnm version
            // directories directly and inject the v22 path into the current process.
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 { return StepResult::ok_fixed(ver2, fixes); }
        }
        // Volta: if installed via volta, it manages node automatically
        if !shell_output("volta --version").is_empty() {
            fixes.push(format!("volta-upgrade:{}", current_ver));
            shell_ok("volta install node@22");
            let ver = shell_output("node --version");
            if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
            let ver2 = node_version_direct();
            if node_major(&ver2) >= 22 { return StepResult::ok_fixed(ver2, fixes); }
        }
    }
    // macOS/Linux: nvm is a shell function ? must source nvm.sh before calling it
    #[cfg(not(target_os = "windows"))]
    {
        let nvm = nvm_dir();
        let nvm_sh = format!("{nvm}/nvm.sh");
        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push(format!("nvm-upgrade:{}", current_ver));
            // Install, set as default, AND get the path ? all in ONE subprocess.
            // nvm use 22 only affects the current shell; alias default 22 persists.
            // Redirect nvm noise to /dev/null so stdout is only the `which node` result.
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
                    if ver.is_empty() { "nvm-upgraded".to_string() } else { ver },
                    fixes,
                );
            }
        }
        if !shell_output("fnm --version").is_empty() {
            fixes.push(format!("fnm-upgrade:{}", current_ver));
            shell_ok("fnm install 22");
            shell_ok("fnm default 22");
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
        // winget updates the Windows registry PATH but NOT the current process PATH.
        // Read the new machine PATH + user PATH from the registry and inject them so
        // node is immediately usable without requiring an app restart.
        let new_path = shell_output(
            "powershell -NoProfile -Command \"\
             $m=[System.Environment]::GetEnvironmentVariable('PATH','Machine'); \
             $u=[System.Environment]::GetEnvironmentVariable('PATH','User'); \
             \"$m;$u\"\""
        );
        if !new_path.is_empty() {
            fixes.push("injected-registry-path".to_string());
            let current = std::env::var("PATH").unwrap_or_default();
            std::env::set_var("PATH", format!("{};{}", new_path, current));
        }
        let ver = shell_output("node --version");
        if node_major(&ver) >= 22 { return StepResult::ok_fixed(ver, fixes); }
        // Filesystem scan as final fallback (in case PATH injection missed something)
        let ver_direct = node_version_direct();
        if node_major(&ver_direct) >= 22 {
            fixes.push("found-via-scan-after-winget".to_string());
            return StepResult::ok_fixed(ver_direct, fixes);
        }
        return StepResult::err_fixed("node-installed-restart-required".to_string(), fixes);
    }

    // macOS/Linux: nvm first (fast, no brew-update overhead), then Homebrew, then guide user
    #[cfg(not(target_os = "windows"))]
    {
        let nvm = nvm_dir();
        let nvm_sh = format!("{nvm}/nvm.sh");

        // ?? Strategy 1: nvm already installed ? fastest path ??????????????????????????????
        if std::path::Path::new(&nvm_sh).exists() {
            fixes.push("install-via-nvm".to_string());
            // Install v22, set as default, AND get the path ? all in ONE subprocess.
            // This avoids the "nvm use only affects current shell" problem where a new
            // subprocess would see the old default version.
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
                } else { ver };
                return StepResult::ok_fixed(ver, fixes);
            }
            // `which node` returned nothing ? PATH will update after app restart
            return StepResult::err_fixed("node-installed-restart-required".to_string(), fixes);
        }

        // ?? Strategy 2: Homebrew (macOS only) ?????????????????????????????????????????????
        #[cfg(target_os = "macos")]
        if !shell_output("brew --version").is_empty() {
            fixes.push("brew-install-node".to_string());
            // HOMEBREW_NO_AUTO_UPDATE=1 skips `brew update` ? saves 1-3 minutes
            let (ok, _, _) = shell_result(
                "HOMEBREW_NO_AUTO_UPDATE=1 NONINTERACTIVE=1 brew install node"
            );
            if ok {
                let ver = node_version_direct();
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
                let ver = node_version_direct();
                if node_major(&ver) >= 22 {
                    return StepResult::ok_fixed(ver, fixes);
                }
            }
        }

        // ?? Strategy 3: install nvm via curl, then install node 22 ????????????????????????
        fixes.push("install-nvm-then-node".to_string());
        shell_ok(
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
        );
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
                    if ver.is_empty() { "nvm-installed".to_string() } else { ver },
                    fixes,
                );
            }
        }

        StepResult::err_fixed(
            "node-not-found: install Node.js >= 22 via https://nodejs.org or your package manager".to_string(),
            fixes,
        )
    }
}

// ?? openclaw CLI ?????????????????????????????????????????????????????????????

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

// ?? Tauri commands ???????????????????????????????????????????????????????????

#[tauri::command]
pub async fn deploy_step_check_node() -> StepResult {
    let mut fixes: Vec<String> = Vec::new();

    // ?? 1. shell PATH ?????augmented_path ??? nvm/brew ?????????????
    let ver = shell_output("node --version");
    if !ver.is_empty() && node_major(&ver) >= 22 { return StepResult::ok(ver); }

    // ?? 2. ?????? + ??????? augmented_path ??????????????????
    let ver_direct = node_version_direct();
    if !ver_direct.is_empty() {
        if node_major(&ver_direct) >= 22 {
            fixes.push("found-via-direct-path".to_string());
            return StepResult::ok_fixed(ver_direct, fixes);
        }
        return upgrade_node(&ver_direct, fixes);
    }

    // ?? 3. ? nvm ???? node ???????source nvm.sh + which node?????????
    // This handles cases where node is installed via nvm but our path scan missed it.
    // nvm knows exactly where its binaries are; we just need to ask it.
    #[cfg(not(target_os = "windows"))]
    {
        let node_path = nvm_which_node();
        if !node_path.is_empty() {
            inject_bin_dir(&node_path);
            // Try running the binary directly for the version string
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
            // Binary found but can't execute (quarantine / arch issue) ? treat as ?22
            // nvm only installs the requested version, so trust that it's correct
            fixes.push("found-via-nvm-which-no-exec".to_string());
            return StepResult::ok_fixed("found-via-nvm".to_string(), fixes);
        }
    }

    // ?? 4. ????? ? ???? ?????????????????????????????????????????????
    install_node_auto(fixes)
}

#[tauri::command]
pub async fn deploy_step_install_openclaw() -> StepResult {
    // ?? 1. Already installed? Check via shell then filesystem scan ???????????
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    if !sv.is_empty() { return StepResult::ok(format!("already-installed:{}", sv)); }

    // Filesystem scan: openclaw might be installed but not in shell PATH (macOS sandbox)
    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        // Inject dir into process PATH so subsequent steps can find openclaw via shell
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let current = std::env::var("PATH").unwrap_or_default();
        if !current.contains(&bin_dir) {
            std::env::set_var("PATH", format!("{}{}{}", bin_dir, sep, current));
        }
        return StepResult::ok("already-installed:found-via-scan".to_string());
    }

    // ?? 2. Not installed ? run npm install ???????????????????????????????????
    let (ok, detail, fixes) = npm_install_with_fallback("openclaw");
    if !ok { return StepResult::err_fixed(detail, fixes); }

    // ?? 3. Verify install: shell first, filesystem scan as fallback ??????????
    let ver2 = shell_output("openclaw --version");
    let sv2 = openclaw_semver(&ver2);
    if !sv2.is_empty() {
        return StepResult::ok_fixed(format!("installed:{}", sv2), fixes);
    }

    // shell_output failed (PATH isolation) ? scan filesystem directly
    if let Some(bin_dir) = scan_openclaw_bin_dir() {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
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

/// Read which AI providers already have a key configured in OpenClaw.
///
/// Uses TWO strategies to ensure reliability across all environments:
///   1. CLI: `openclaw models status --json` ? auth.providers[].provider
///   2. File: directly read auth-profiles.json from both global and agent dirs
///
/// The union of both sources is returned so the UI never falsely shows
/// "not configured" just because the CLI isn't in PATH (common on macOS).
#[tauri::command]
pub async fn list_configured_providers() -> Vec<String> {
    let mut providers = std::collections::HashSet::<String>::new();

    // Strategy 1: CLI (fast, authoritative when it works)
    let out = shell_output("openclaw models status --json");
    if !out.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) {
            if let Some(arr) = json.get("auth")
                .and_then(|a| a.get("providers"))
                .and_then(|p| p.as_array())
            {
                for entry in arr {
                    if let Some(p) = entry.get("provider").and_then(|v| v.as_str()) {
                        providers.insert(p.to_string());
                    }
                }
            }
        }
    }

    // Strategy 2: read auth-profiles.json directly (works even without CLI in PATH)
    let home = crate::platform::user_home();
    let oc = crate::platform::path_join(&home, ".openclaw");
    let files = [
        crate::platform::path_join(&oc, "auth-profiles.json"),
        crate::platform::path_join(&oc, "agents/main/agent/auth-profiles.json"),
    ];
    for path in &files {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(profiles) = doc.get("profiles").and_then(|p| p.as_object()) {
                    for (_key, val) in profiles {
                        if let Some(p) = val.get("provider").and_then(|v| v.as_str()) {
                            if let Some(tok) = val.get("token").and_then(|v| v.as_str()) {
                                if !tok.is_empty() {
                                    providers.insert(p.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    providers.into_iter().collect()
}

/// Quick pre-deploy status check: is openclaw installed? is the service running?
/// This runs fast (no npm download) and is called when the Deploy page loads.
///
/// Uses two strategies to detect openclaw:
///   1. Shell: `openclaw --version` (works when openclaw is in PATH)
///   2. Filesystem scan: check well-known install locations directly
/// This prevents false "not installed" on macOS where GUI apps have isolated PATH.
#[tauri::command]
pub async fn check_deploy_status() -> crate::types::DeployStatus {
    let ver = shell_output("openclaw --version");
    let sv = openclaw_semver(&ver);
    let mut openclaw_installed = !sv.is_empty();
    let mut version = sv;

    // Fallback: filesystem scan when shell PATH doesn't find openclaw
    if !openclaw_installed {
        if let Some(bin_dir) = scan_openclaw_bin_dir() {
            openclaw_installed = true;
            // Inject into PATH so subsequent commands work
            let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
            let current = std::env::var("PATH").unwrap_or_default();
            if !current.contains(&bin_dir) {
                std::env::set_var("PATH", format!("{}{}{}", bin_dir, sep, current));
            }
            // Try to get the version from the discovered binary
            let ver2 = shell_output("openclaw --version");
            let sv2 = openclaw_semver(&ver2);
            if !sv2.is_empty() { version = sv2; }
            else { version = "installed".to_string(); }
        }
    }

    let jlist = crate::pm2::pm2_jlist();
    let service_running =
        jlist.contains("\"openclaw\"") && jlist.contains("\"online\"");

    crate::types::DeployStatus {
        openclaw_installed,
        openclaw_version: version,
        service_running,
    }
}

/// Force-reinstall openclaw to the latest published version.
///
/// Update strategy (tried in order):
///   1. `openclaw update` ? OpenClaw's own self-update command (knows about
///      channels/releases that pre-date npm publication).
///   2. `npm install -g openclaw@latest --force` ? always re-downloads even
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
        // Keep going ? npm install is the definitive fallback.
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

    // ?? 1. Stop + remove from pm2 ?????????????????????????????????????????????
    // Use find_pm2_cmd() to locate the pm2 binary reliably, since bare `pm2`
    // may not be in PATH on macOS GUI apps or custom-prefix installs.
    if let Some(pm2) = crate::pm2::find_pm2_cmd() {
        let (stop_ok, _, _) = shell_result(&format!("\"{}\" stop openclaw", pm2));
        if stop_ok { fixes.push("pm2-stopped".to_string()); }

        let (delete_ok, _, _) = shell_result(&format!("\"{}\" delete openclaw", pm2));
        if delete_ok { fixes.push("pm2-deleted".to_string()); }

        let _ = shell_result(&format!("\"{}\" save", pm2));
    } else {
        // Fallback: try bare pm2 via augmented PATH
        let (stop_ok, _, _) = shell_result("pm2 stop openclaw");
        if stop_ok { fixes.push("pm2-stopped".to_string()); }

        let (delete_ok, _, _) = shell_result("pm2 delete openclaw");
        if delete_ok { fixes.push("pm2-deleted".to_string()); }

        let _ = shell_result("pm2 save");
    }

    // ?? 2. Uninstall openclaw npm package ?????????????????????????????????????
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

    // ?? 3. Data directory left intact ?????????????????????????????????????????
    // ~/.openclaw/ is preserved so the user can restore by re-deploying.
    fixes.push("data-preserved".to_string());

    StepResult::ok_fixed("uninstalled".to_string(), fixes)
}

// ?? Unit tests ???????????????????????????????????????????????????????????????

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
