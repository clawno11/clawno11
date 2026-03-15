//! Pure version-string parsing utilities shared across platforms.
//!
//! These functions have zero platform dependencies and are safe to use
//! in both desktop and mobile crates.

/// Parse the major version number from a `v24.0.0` style string.
pub fn node_major(ver: &str) -> u32 {
    ver.trim_start_matches('v')
        .split('.')
        .next()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0)
}

/// Parse the openclaw semver from CLI output like
/// `openclaw/1.2.3 linux-x64 node-v22.0.0\n1.2.3`
/// or `OpenClaw 2026.3.12 (hash)`.
pub fn openclaw_semver(raw: &str) -> String {
    for line in raw.lines() {
        let t = line.trim();
        if t.contains('.')
            && t.chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        {
            return t.to_string();
        }
        if let Some(rest) = t
            .strip_prefix("OpenClaw ")
            .or_else(|| t.strip_prefix("openclaw/"))
        {
            let ver = rest.split_whitespace().next().unwrap_or("");
            if ver.contains('.') {
                return ver.to_string();
            }
        }
    }
    String::new()
}

/// Clean pm2 version output, extracting the semver line from potentially
/// noisy output like `[PM2] Spawning PM2 daemon...\n5.3.1\n`.
pub fn clean_pm2_version(raw: &str) -> String {
    raw.lines()
        .find(|l| {
            let t = l.trim();
            !t.is_empty()
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

    #[test]
    fn openclaw_semver_new_format() {
        assert_eq!(openclaw_semver("OpenClaw 2026.3.12 (abc123)"), "2026.3.12");
    }

    #[test]
    fn clean_pm2_version_extracts_semver() {
        let raw = "\n[PM2] Spawning PM2 daemon...\n5.3.1\n";
        assert_eq!(clean_pm2_version(raw), "5.3.1");
    }

    #[test]
    fn clean_pm2_version_empty_on_no_match() {
        assert_eq!(clean_pm2_version("[PM2] error"), "");
    }
}
