use sha2::{Digest, Sha256};

use super::DiagnosisRequest;

/// Extract the first `max_lines` non-empty lines from stderr output.
fn extract_lines(stderr: &str, max_lines: usize) -> Vec<String> {
    stderr
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(max_lines)
        .map(|l| l.to_string())
        .collect()
}

/// Compute a stable bug signature from stderr by hashing the first 3
/// non-empty lines.  The resulting hex string is truncated to 16 chars
/// so it is compact enough for database indexes and log messages.
pub fn compute_signature(stderr: &str) -> String {
    let key_lines: Vec<&str> = stderr
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(3)
        .collect();

    let joined = key_lines.join("\n");
    let hash = Sha256::digest(joined.as_bytes());
    hex_encode(&hash[..8])
}

/// Build a `DiagnosisRequest` from a crash / error context.
pub fn capture_context(stderr: &str, source: &str, instance_id: Option<&str>) -> DiagnosisRequest {
    let stderr_lines = extract_lines(stderr, 20);
    let bug_signature = compute_signature(stderr);
    let platform = current_platform().to_string();

    DiagnosisRequest {
        stderr_lines,
        bug_signature,
        source: source.to_string(),
        instance_id: instance_id.map(|s| s.to_string()),
        openclaw_version: None,
        platform,
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_stability() {
        let stderr = "Error: EADDRINUSE\nport 18789 already in use\nstack trace...";
        let sig1 = compute_signature(stderr);
        let sig2 = compute_signature(stderr);
        assert_eq!(sig1, sig2);
        assert_eq!(sig1.len(), 16);
    }

    #[test]
    fn signature_differs_for_different_errors() {
        let a = compute_signature("Error: EADDRINUSE\nport 18789");
        let b = compute_signature("Error: config invalid\nparse failed");
        assert_ne!(a, b);
    }

    #[test]
    fn capture_context_basic() {
        let ctx = capture_context("line1\nline2\nline3", "chat_http", Some("inst-1"));
        assert_eq!(ctx.stderr_lines.len(), 3);
        assert_eq!(ctx.source, "chat_http");
        assert_eq!(ctx.instance_id, Some("inst-1".to_string()));
        assert!(!ctx.bug_signature.is_empty());
    }
}
