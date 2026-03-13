/// npm error classification and install helpers with automatic fallbacks.
use crate::platform::{data_local, first_line, path_join, shell_ok, shell_output, shell_result};

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
            if ok2 {
                return (true, format!("{pkg} installed via npmmirror"), fixes);
            }
            if classify_npm_error(&stderr2, "") == NpmError::PermissionDenied {
                return npm_install_user_prefix(pkg, fixes);
            }
            (
                false,
                format!("network-failed: {}", first_line(&stderr2)),
                fixes,
            )
        }
        NpmError::PermissionDenied => npm_install_user_prefix(pkg, fixes),
        NpmError::CacheCorrupted => {
            fixes.push("clean-npm-cache".to_string());
            shell_ok("npm cache clean --force");
            let (ok2, _, stderr2) = shell_result(&format!("npm install -g {pkg}"));
            if ok2 {
                return (true, format!("{pkg} installed after cache clean"), fixes);
            }
            (
                false,
                format!("cache-clean-failed: {}", first_line(&stderr2)),
                fixes,
            )
        }
        NpmError::SslError => {
            fixes.push("disable-ssl-temporarily".to_string());
            shell_ok("npm config set strict-ssl false");
            let (ok2, _, stderr2) = shell_result(&format!("npm install -g {pkg}"));
            shell_ok("npm config set strict-ssl true");
            if ok2 {
                return (true, format!("{pkg} installed after ssl fix"), fixes);
            }
            (
                false,
                format!("ssl-fix-failed: {}", first_line(&stderr2)),
                fixes,
            )
        }
        NpmError::DiskFull => {
            #[cfg(target_os = "windows")]
            let detail = {
                let free = shell_output("powershell -NoProfile -Command \"(Get-PSDrive C).Free\"");
                let free_mb = free
                    .trim()
                    .parse::<u64>()
                    .map(|b| b / 1_048_576)
                    .unwrap_or_else(|_| {
                        let wmic = shell_output(
                            "wmic logicaldisk where DeviceID='C:' get FreeSpace /value",
                        );
                        wmic.lines()
                            .find(|l| l.contains('='))
                            .and_then(|l| l.split('=').nth(1))
                            .and_then(|v| v.trim().parse::<u64>().ok())
                            .map(|b| b / 1_048_576)
                            .unwrap_or(0)
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
            if ok2 {
                return (true, format!("{pkg} installed via npmmirror"), fixes);
            }
            fixes.push("clean-npm-cache".to_string());
            shell_ok("npm cache clean --force");
            let (ok3, _, stderr3) = shell_result(&format!("npm install -g {pkg}"));
            if ok3 {
                return (true, format!("{pkg} installed after cache clean"), fixes);
            }
            fixes.push("disable-ssl-temporarily".to_string());
            shell_ok("npm config set strict-ssl false");
            let (ok4, _, stderr4) = shell_result(&format!("npm install -g {pkg}"));
            shell_ok("npm config set strict-ssl true");
            if ok4 {
                return (true, format!("{pkg} installed after ssl fix"), fixes);
            }
            let msg = if !stderr4.is_empty() {
                &stderr4
            } else if !stderr3.is_empty() {
                &stderr3
            } else {
                &stderr2
            };
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
        return (
            false,
            format!("user-prefix-failed: {}", first_line(&stderr)),
            fixes,
        );
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
    (true, format!("{pkg} installed to user prefix"), fixes)
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
