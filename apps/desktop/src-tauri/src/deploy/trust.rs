use clawno_core::types::{DepSource, TrustLevel};

/// Compile-time embedded list of trusted download domains.
/// URLs whose host does not match any entry are flagged as `Community`.
const TRUSTED_OFFICIAL: &[&str] = &[
    "nodejs.org",
    "registry.npmjs.org",
    "npmjs.com",
    "github.com",
    "objects.githubusercontent.com",
    "ollama.com",
];

const TRUSTED_MIRRORS: &[&str] = &[
    "registry.npmmirror.com",
    "npmmirror.com",
    "cdn.npmmirror.com",
    "npm.taobao.org",
    "mirrors.tuna.tsinghua.edu.cn",
    "mirrors.ustc.edu.cn",
    "mirrors.aliyun.com",
];

/// Known SHA256 checksums for Node.js v22.16.0 official binaries.
/// Source: <https://nodejs.org/dist/v22.16.0/SHASUMS256.txt>
const NODE_V22_16_0_CHECKSUMS: &[(&str, &str)] = &[
    (
        "node-v22.16.0-win-x64.zip",
        "ab52470bad9ae2add73f27a5a4494f048d6e37e44a3aaf1e2e65ffe2ca9a08bf",
    ),
    (
        "node-v22.16.0-win-arm64.zip",
        "ae7d3e6e15310b590e84a8e247929a5afbbd89d01d2f8b5a8ee6c5d4965e2b8b",
    ),
    (
        "node-v22.16.0-darwin-x64.tar.gz",
        "37dc1e9ef8a4a844bae89b09a9fe1a645e0dacfba85cba5c21c65bdf55d85e84",
    ),
    (
        "node-v22.16.0-darwin-arm64.tar.gz",
        "4476d5408877a4d00eda15a9b7ea3c1a44e53f01f505e3f0e2c84511ed497db2",
    ),
    (
        "node-v22.16.0-linux-x64.tar.gz",
        "e8493c53e228f9c4f00f2e07b8a8f1dce498ffa1cf9e1e920217c0635a0ee56e",
    ),
    (
        "node-v22.16.0-linux-arm64.tar.gz",
        "e6e56ca62e02c8f87fc50bf13b2a58afef543e2a28dd862643f9c9e7e2d0e7c6",
    ),
];

/// Determine the trust level of a URL based on its domain.
pub fn classify_url(url: &str) -> TrustLevel {
    let host = extract_host(url);
    if TRUSTED_OFFICIAL
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
    {
        return TrustLevel::Official;
    }
    if TRUSTED_MIRRORS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
    {
        return TrustLevel::OfficialMirror;
    }
    TrustLevel::Community
}

/// Check whether a URL is on the trusted whitelist (Official or OfficialMirror).
pub fn is_trusted(url: &str) -> bool {
    !matches!(classify_url(url), TrustLevel::Community)
}

/// Look up the expected SHA256 for a Node.js archive filename.
pub fn node_expected_sha256(filename: &str) -> Option<&'static str> {
    NODE_V22_16_0_CHECKSUMS
        .iter()
        .find(|(f, _)| *f == filename)
        .map(|(_, h)| *h)
}

/// Verify SHA256 of a file on disk against an expected hash.
pub fn verify_sha256(path: &std::path::Path, expected: &str) -> Result<bool, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file =
        std::fs::File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read error: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hex = format!("{:x}", hasher.finalize());
    Ok(hex == expected)
}

/// Build the default source list for Node.js.
pub fn node_sources(version: &str, os: &str, arch: &str, is_chinese: bool) -> Vec<DepSource> {
    let os_part = match os {
        "windows" => "win",
        "macos" => "darwin",
        _ => "linux",
    };
    let arch_part = match arch {
        "aarch64" => "arm64",
        "x86_64" | "x86" => "x64",
        other => other,
    };
    let ext = if os == "windows" { "zip" } else { "tar.gz" };
    let filename = format!("node-{version}-{os_part}-{arch_part}.{ext}");
    let sha = node_expected_sha256(&filename).map(|s| s.to_string());

    let mut sources = vec![DepSource {
        url: format!("https://nodejs.org/dist/{version}/{filename}"),
        label: "nodejs.org".into(),
        trust_level: TrustLevel::Official,
        expected_sha256: sha.clone(),
        is_primary: !is_chinese,
    }];

    if is_chinese {
        sources.insert(
            0,
            DepSource {
                url: format!("https://cdn.npmmirror.com/binaries/node/{version}/{filename}"),
                label: "npmmirror.com".into(),
                trust_level: TrustLevel::OfficialMirror,
                expected_sha256: sha,
                is_primary: true,
            },
        );
    }
    sources
}

/// Build the default source list for an npm package (openclaw / pm2).
pub fn npm_sources(package_name: &str, is_chinese: bool) -> Vec<DepSource> {
    let mut sources = vec![DepSource {
        url: format!("https://registry.npmjs.org/{package_name}"),
        label: "npmjs.org".into(),
        trust_level: TrustLevel::Official,
        expected_sha256: None,
        is_primary: !is_chinese,
    }];
    if is_chinese {
        sources.insert(
            0,
            DepSource {
                url: format!("https://registry.npmmirror.com/{package_name}"),
                label: "npmmirror.com".into(),
                trust_level: TrustLevel::OfficialMirror,
                expected_sha256: None,
                is_primary: true,
            },
        );
    }
    sources
}

/// Build the default source list for Ollama.
pub fn ollama_sources() -> Vec<DepSource> {
    vec![DepSource {
        url: "https://ollama.com/download".into(),
        label: "ollama.com".into(),
        trust_level: TrustLevel::Official,
        expected_sha256: None,
        is_primary: true,
    }]
}

fn extract_host(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_official() {
        assert_eq!(
            classify_url("https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip"),
            TrustLevel::Official
        );
        assert_eq!(
            classify_url("https://registry.npmjs.org/openclaw"),
            TrustLevel::Official
        );
    }

    #[test]
    fn classifies_mirror() {
        assert_eq!(
            classify_url("https://registry.npmmirror.com/openclaw"),
            TrustLevel::OfficialMirror
        );
        assert_eq!(
            classify_url(
                "https://cdn.npmmirror.com/binaries/node/v22.16.0/node-v22.16.0-win-x64.zip"
            ),
            TrustLevel::OfficialMirror
        );
    }

    #[test]
    fn classifies_community() {
        assert_eq!(
            classify_url("https://evil-site.com/node.zip"),
            TrustLevel::Community
        );
    }

    #[test]
    fn finds_known_sha256() {
        assert!(node_expected_sha256("node-v22.16.0-win-x64.zip").is_some());
        assert!(node_expected_sha256("node-v99.0.0-win-x64.zip").is_none());
    }
}
