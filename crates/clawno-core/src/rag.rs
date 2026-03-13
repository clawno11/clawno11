//! RAG file ingestion — shared validation and reading logic.
//!
//! The app layer calls [`validate_and_read`] (async, desktop) or
//! [`validate_and_read_sync`] (mobile) with a platform-specific
//! [`RagFileConfig`].  All extension allowlisting, size checks,
//! and path-traversal defence live here.

use std::path::Path;

/// Platform-specific RAG file ingestion settings.
pub struct RagFileConfig {
    pub allowed_extensions: &'static [&'static str],
    pub max_file_bytes: u64,
    /// When true, canonicalize the path and reject `..` segments.
    pub check_path_traversal: bool,
}

#[cfg(all(feature = "desktop", not(feature = "mobile")))]
pub const PLATFORM_CONFIG: RagFileConfig = RagFileConfig {
    allowed_extensions: &[
        "txt", "md", "markdown", "csv", "log", "json", "yaml", "yml", "rst", "html", "htm", "tex",
        "org", "toml", "conf", "ini",
    ],
    max_file_bytes: 10 * 1024 * 1024,
    check_path_traversal: true,
};

#[cfg(feature = "mobile")]
pub const PLATFORM_CONFIG: RagFileConfig = RagFileConfig {
    allowed_extensions: &[
        "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "html", "htm", "xml", "rs",
        "py", "js", "ts", "go", "java", "c", "cpp", "h", "hpp", "sh", "toml", "ini", "conf", "log",
    ],
    max_file_bytes: 5 * 1024 * 1024,
    check_path_traversal: false,
};

#[cfg(not(any(feature = "desktop", feature = "mobile")))]
pub const PLATFORM_CONFIG: RagFileConfig = RagFileConfig {
    allowed_extensions: &["txt", "md", "csv", "json", "yaml", "yml", "toml", "log"],
    max_file_bytes: 10 * 1024 * 1024,
    check_path_traversal: true,
};

/// Validate the file extension against the allowlist.
pub fn validate_extension(path: &Path, config: &RagFileConfig) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if !config.allowed_extensions.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的文件类型「.{}」。\
             支持的格式：txt、md、csv、json、yaml、html 等文本格式。",
            ext
        ));
    }
    Ok(())
}

/// Validate file size against the configured limit.
pub fn validate_file_size(file_len: u64, config: &RagFileConfig) -> Result<(), String> {
    if file_len > config.max_file_bytes {
        return Err(format!(
            "文件过大（{:.1} MiB），最大支持 {:.0} MiB。请拆分后分批导入。",
            file_len as f64 / 1_048_576.0,
            config.max_file_bytes as f64 / 1_048_576.0,
        ));
    }
    Ok(())
}

/// Check for path traversal (`..` segments).
pub fn check_path_traversal(path: &Path) -> Result<(), String> {
    let components: Vec<_> = path.components().collect();
    if components
        .iter()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("检测到路径遍历（..），已拒绝读取。".to_string());
    }
    Ok(())
}

/// Produce a user-friendly error for non-UTF-8 files.
pub fn utf8_read_error(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::InvalidData {
        "文件编码不受支持（非 UTF-8）。\
         请用记事本或 VS Code 将文件另存为「UTF-8」编码后重新导入。"
            .to_string()
    } else {
        format!("读取文件失败：{e}")
    }
}

/// Async validate-and-read (used by desktop).
///
/// Performs path-traversal check, extension allowlist, file-size guard,
/// then reads the file contents as UTF-8.
#[cfg(feature = "ssh-exec")]
pub async fn validate_and_read_async(path: &str, config: &RagFileConfig) -> Result<String, String> {
    if path.is_empty() {
        return Err("文件路径为空".to_string());
    }

    let canonical = tokio::fs::canonicalize(path)
        .await
        .map_err(|e| format!("路径无效或文件不存在：{e}"))?;

    if config.check_path_traversal {
        check_path_traversal(Path::new(path))?;
    }

    validate_extension(canonical.as_path(), config)?;

    let meta = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| format!("无法读取文件信息：{e}"))?;
    validate_file_size(meta.len(), config)?;

    tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| utf8_read_error(&e))
}

/// Synchronous validate-and-read (used by mobile).
pub fn validate_and_read_sync(path: &str, config: &RagFileConfig) -> Result<String, String> {
    if path.is_empty() {
        return Err("文件路径为空".to_string());
    }

    let p = Path::new(path);
    validate_extension(p, config)?;

    let meta = std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败：{e}"))?;
    validate_file_size(meta.len(), config)?;

    std::fs::read_to_string(path).map_err(|e| utf8_read_error(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> RagFileConfig {
        RagFileConfig {
            allowed_extensions: &["txt", "md", "json"],
            max_file_bytes: 1024,
            check_path_traversal: true,
        }
    }

    #[test]
    fn extension_allowed() {
        let config = test_config();
        assert!(validate_extension(Path::new("doc.txt"), &config).is_ok());
        assert!(validate_extension(Path::new("doc.md"), &config).is_ok());
        assert!(validate_extension(Path::new("DOC.TXT"), &config).is_ok());
    }

    #[test]
    fn extension_rejected() {
        let config = test_config();
        assert!(validate_extension(Path::new("virus.exe"), &config).is_err());
        assert!(validate_extension(Path::new("noext"), &config).is_err());
    }

    #[test]
    fn size_within_limit() {
        let config = test_config();
        assert!(validate_file_size(512, &config).is_ok());
        assert!(validate_file_size(1024, &config).is_ok());
    }

    #[test]
    fn size_exceeds_limit() {
        let config = test_config();
        assert!(validate_file_size(1025, &config).is_err());
    }

    #[test]
    fn path_traversal_detected() {
        assert!(check_path_traversal(Path::new("../etc/passwd")).is_err());
        assert!(check_path_traversal(Path::new("foo/../../bar")).is_err());
    }

    #[test]
    fn normal_path_ok() {
        assert!(check_path_traversal(Path::new("/home/user/doc.txt")).is_ok());
        assert!(check_path_traversal(Path::new("relative/path.md")).is_ok());
    }
}
