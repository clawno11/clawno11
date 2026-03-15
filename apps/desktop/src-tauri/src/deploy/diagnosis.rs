use clawno_core::types::{Diagnosis, ErrorCategory, Remedy, RetryPolicy};

/// Unified error diagnosis engine.
///
/// Merges and extends the previously scattered classification logic from
/// `npm::classify_npm_error` and `gateway::diagnose_gateway_log` into a
/// single entry point that works for all deploy steps.
pub fn diagnose(stderr: &str, stdout: &str, exit_code: Option<i32>) -> Diagnosis {
    let combined = format!("{} {}", stderr, stdout).to_lowercase();
    let (category, signature) = classify(&combined, exit_code);
    let policy = retry_policy(&category);
    let remedies = suggest_remedies(&category);
    let raw_message = extract_error_line(stderr, stdout);

    Diagnosis {
        category,
        policy,
        signature,
        remedies,
        raw_message,
    }
}

fn classify(combined: &str, _exit_code: Option<i32>) -> (ErrorCategory, String) {
    // Disk full — must be checked first because ENOSPC can co-occur with others.
    if combined.contains("enospc") || combined.contains("no space left") {
        return (ErrorCategory::DiskFull, "enospc".into());
    }

    // Permission denied
    if combined.contains("eacces")
        || combined.contains("eperm")
        || combined.contains("permission denied")
        || combined.contains("access denied")
    {
        return (ErrorCategory::PermissionDenied, "eacces".into());
    }

    // Port already in use (gateway-specific)
    if combined.contains("eaddrinuse") || combined.contains("address already in use") {
        return (ErrorCategory::PortInUse, "eaddrinuse".into());
    }

    // Network timeout / unreachable
    if combined.contains("etimedout")
        || combined.contains("econnreset")
        || combined.contains("econnrefused")
        || combined.contains("enotfound")
        || combined.contains("fetch failed")
        || combined.contains("connect timeout")
        || combined.contains("network timeout")
    {
        return (ErrorCategory::NetworkTimeout, "network-timeout".into());
    }
    if combined.contains("enetunreach") || combined.contains("network is unreachable") {
        return (
            ErrorCategory::NetworkUnreachable,
            "network-unreachable".into(),
        );
    }

    // SSL / certificate
    if combined.contains("cert") || combined.contains("ssl") || combined.contains("certificate") {
        return (ErrorCategory::SslError, "ssl-error".into());
    }

    // npm cache corruption
    if combined.contains("enotempty")
        || combined.contains("eexist")
        || combined.contains("integrity")
        || combined.contains("checksum")
    {
        return (ErrorCategory::CacheCorrupt, "cache-corrupt".into());
    }

    // Config corruption (gateway / onboard)
    if (combined.contains("config") || combined.contains("json"))
        && (combined.contains("invalid")
            || combined.contains("parse")
            || combined.contains("unexpected token"))
    {
        return (ErrorCategory::ConfigCorrupt, "config-corrupt".into());
    }

    // Node.js version mismatch — openclaw or other tools require v22+
    // Patterns: "Node.js v22.12+ is required (current: v20.20.1)"
    //           "node.js v22+ is required"
    if (combined.contains("is required") && combined.contains("node"))
        || (combined.contains("node.js v") && combined.contains("required"))
        || (combined.contains("current: v") && combined.contains("required"))
    {
        return (
            ErrorCategory::NodeVersionMismatch,
            "node-version-mismatch".into(),
        );
    }

    // Git not installed — npm needs git to resolve git:// dependencies
    if combined.contains("spawn git") || (combined.contains("enoent") && combined.contains("git")) {
        return (ErrorCategory::GitNotInstalled, "git-not-installed".into());
    }

    // Binary / command not found
    if combined.contains("not found")
        || combined.contains("not recognized")
        || combined.contains("no such file")
        || combined.contains("command not found")
    {
        return (ErrorCategory::BinaryNotFound, "binary-not-found".into());
    }

    // Process crash indicators
    if combined.contains("segfault")
        || combined.contains("sigsegv")
        || combined.contains("sigabrt")
        || combined.contains("panic")
    {
        return (ErrorCategory::ProcessCrash, "process-crash".into());
    }

    (ErrorCategory::Unknown, "unknown".into())
}

pub fn retry_policy(category: &ErrorCategory) -> RetryPolicy {
    match category {
        ErrorCategory::NetworkTimeout
        | ErrorCategory::NetworkUnreachable
        | ErrorCategory::CacheCorrupt
        | ErrorCategory::SslError
        | ErrorCategory::ProcessStalled
        | ErrorCategory::ProcessCrash
        | ErrorCategory::PortInUse
        | ErrorCategory::ConfigCorrupt
        | ErrorCategory::BinaryNotFound
        | ErrorCategory::VersionTooOld
        | ErrorCategory::NodeVersionMismatch
        | ErrorCategory::Unknown => RetryPolicy::AutoRetry,

        ErrorCategory::PermissionDenied | ErrorCategory::GitNotInstalled => RetryPolicy::UserPrompt,

        ErrorCategory::DiskFull => RetryPolicy::Abort,
    }
}

fn suggest_remedies(category: &ErrorCategory) -> Vec<Remedy> {
    match category {
        ErrorCategory::PermissionDenied => {
            vec![Remedy::UseUserPrefix, Remedy::TryNextStrategy]
        }
        ErrorCategory::NetworkTimeout | ErrorCategory::NetworkUnreachable => {
            vec![
                Remedy::SwitchRegistry,
                Remedy::TryNextStrategy,
                Remedy::DirectDownload,
            ]
        }
        ErrorCategory::DiskFull => vec![],
        ErrorCategory::CacheCorrupt => {
            vec![Remedy::CleanNpmCache, Remedy::TryNextStrategy]
        }
        ErrorCategory::SslError => {
            vec![
                Remedy::DisableSsl,
                Remedy::SwitchRegistry,
                Remedy::TryNextStrategy,
            ]
        }
        ErrorCategory::PortInUse => {
            vec![Remedy::KillPortOccupant, Remedy::RestartDaemon]
        }
        ErrorCategory::ConfigCorrupt => {
            vec![Remedy::ResetConfig, Remedy::RestartDaemon]
        }
        ErrorCategory::GitNotInstalled => {
            vec![Remedy::InstallGit]
        }
        ErrorCategory::BinaryNotFound => {
            vec![
                Remedy::RefreshPath,
                Remedy::TryNextStrategy,
                Remedy::DirectDownload,
            ]
        }
        ErrorCategory::VersionTooOld => {
            vec![Remedy::TryNextStrategy, Remedy::DirectDownload]
        }
        ErrorCategory::NodeVersionMismatch => {
            vec![
                Remedy::RescanNodeVersion,
                Remedy::RestartDaemon,
                Remedy::DirectDownload,
            ]
        }
        ErrorCategory::ProcessStalled => {
            vec![Remedy::TryNextStrategy]
        }
        ErrorCategory::ProcessCrash => {
            vec![Remedy::RestartDaemon, Remedy::TryNextStrategy]
        }
        ErrorCategory::Unknown => {
            vec![Remedy::TryNextStrategy]
        }
    }
}

pub fn extract_error_line(stderr: &str, stdout: &str) -> String {
    let combined = format!("{}\n{}", stderr, stdout);
    let lines: Vec<&str> = combined
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if let Some(err_line) = lines.iter().rev().find(|l| {
        let low = l.to_lowercase();
        (low.contains("error") || low.contains("err!") || low.contains("404"))
            && !low.contains("complete log of this run")
    }) {
        return err_line.to_string();
    }

    lines
        .iter()
        .rev()
        .find(|l| !l.to_lowercase().contains("complete log of this run"))
        .unwrap_or(lines.last().unwrap_or(&""))
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnoses_permission_denied() {
        let d = diagnose("Error: EACCES permission denied", "", None);
        assert_eq!(d.category, ErrorCategory::PermissionDenied);
        assert_eq!(d.policy, RetryPolicy::UserPrompt);
        assert!(d.remedies.contains(&Remedy::UseUserPrefix));
    }

    #[test]
    fn diagnoses_network_timeout() {
        let d = diagnose("ETIMEDOUT connect", "", None);
        assert_eq!(d.category, ErrorCategory::NetworkTimeout);
        assert_eq!(d.policy, RetryPolicy::AutoRetry);
        assert!(d.remedies.contains(&Remedy::SwitchRegistry));
    }

    #[test]
    fn diagnoses_disk_full() {
        let d = diagnose("ENOSPC no space left on device", "", None);
        assert_eq!(d.category, ErrorCategory::DiskFull);
        assert_eq!(d.policy, RetryPolicy::Abort);
    }

    #[test]
    fn diagnoses_port_in_use() {
        let d = diagnose("listen EADDRINUSE: address already in use", "", None);
        assert_eq!(d.category, ErrorCategory::PortInUse);
        assert!(d.remedies.contains(&Remedy::KillPortOccupant));
    }

    #[test]
    fn diagnoses_ssl_error() {
        let d = diagnose("SSL certificate problem", "", None);
        assert_eq!(d.category, ErrorCategory::SslError);
        assert!(d.remedies.contains(&Remedy::DisableSsl));
    }

    #[test]
    fn diagnoses_cache_corrupt() {
        let d = diagnose("integrity checksum failed", "", None);
        assert_eq!(d.category, ErrorCategory::CacheCorrupt);
        assert!(d.remedies.contains(&Remedy::CleanNpmCache));
    }

    #[test]
    fn diagnoses_config_corrupt() {
        let d = diagnose("config: invalid JSON unexpected token", "", None);
        assert_eq!(d.category, ErrorCategory::ConfigCorrupt);
        assert!(d.remedies.contains(&Remedy::ResetConfig));
    }

    #[test]
    fn diagnoses_node_version_mismatch() {
        let d = diagnose(
            "openclaw: Node.js v22.12+ is required (current: v20.20.1)",
            "",
            None,
        );
        assert_eq!(d.category, ErrorCategory::NodeVersionMismatch);
        assert_eq!(d.policy, RetryPolicy::AutoRetry);
        assert!(d.remedies.contains(&Remedy::RescanNodeVersion));
    }

    #[test]
    fn diagnoses_git_not_installed() {
        let d = diagnose(
            "npm error code ENOENT\nnpm error syscall spawn git\nnpm error path git\nnpm error errno -4058\nnpm error enoent An unknown git error occurred",
            "",
            Some(1),
        );
        assert_eq!(d.category, ErrorCategory::GitNotInstalled);
        assert_eq!(d.policy, RetryPolicy::UserPrompt);
        assert!(d.remedies.contains(&Remedy::InstallGit));
    }

    #[test]
    fn diagnoses_unknown() {
        let d = diagnose("some random error", "", None);
        assert_eq!(d.category, ErrorCategory::Unknown);
        assert_eq!(d.policy, RetryPolicy::AutoRetry);
    }
}
