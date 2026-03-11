/// RAG knowledge base helpers.
/// File ingestion (reading raw bytes → UTF-8 text) is handled here in Rust,
/// so the frontend can pass any path returned by the file-picker dialog.
/// All chunking and SQLite writes happen in TypeScript via tauri-plugin-sql.

/// Allowed file extensions for RAG ingestion.
/// This allowlist prevents reading arbitrary system files (path traversal mitigation).
/// Keep in sync with the dialog filter in RagPage.tsx and the i18n `rag.supportedFormats` key.
const ALLOWED_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "csv", "log",
    "json", "yaml", "yml", "rst", "html", "htm",
    "tex", "org", "toml", "conf", "ini",
];

/// Maximum file size accepted for RAG ingestion (10 MiB).
/// Larger files would produce tens of thousands of chunks and degrade DB performance.
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// Read a plain-text or Markdown file and return its contents as a String.
///
/// Security: validates the file extension against an allowlist before reading,
/// preventing path traversal attacks where an attacker could attempt to read
/// sensitive system files (e.g. /etc/passwd, C:\Windows\System32\config\SAM).
/// Files must be opened via the Tauri dialog — this function enforces that
/// only document-type extensions are readable through this IPC command.
///
/// Safety: rejects files larger than MAX_FILE_BYTES to prevent OOM on huge log files.
///
/// Encoding: requires UTF-8. Non-UTF-8 files (e.g. GBK-encoded Chinese text on Windows)
/// are rejected with a user-friendly message advising conversion.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    use std::path::Path;

    if path.is_empty() {
        return Err("文件路径为空".to_string());
    }

    // Path traversal defence: canonicalize first, then reject if the raw input
    // contained ".." segments.  Canonicalize resolves symlinks and relative
    // components, so comparing against the raw path catches traversal attempts.
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("路径无效或文件不存在：{e}"))?;

    let raw_components: Vec<_> = Path::new(&path).components().collect();
    if raw_components.iter().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("检测到路径遍历（..），已拒绝读取。".to_string());
    }

    let p = canonical.as_path();

    // Extract and normalise the extension for allowlist check.
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的文件类型「.{}」。\
             支持的格式：txt、md、markdown、csv、log、json、yaml、html 等文本格式。",
            ext
        ));
    }

    // Reject oversized files before reading to prevent OOM.
    let meta = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| format!("无法读取文件信息：{e}"))?;

    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大（{:.1} MB），最大支持 {:.0} MB。请拆分后分批导入。",
            meta.len() as f64 / 1_048_576.0,
            MAX_FILE_BYTES as f64 / 1_048_576.0,
        ));
    }

    tokio::fs::read_to_string(&canonical).await.map_err(|e| {
        // Provide a helpful hint for the most common failure on Windows:
        // files saved by Notepad or other tools in GBK / GB2312 encoding.
        if e.kind() == std::io::ErrorKind::InvalidData {
            "文件编码不受支持（非 UTF-8）。\
             请用记事本或 VS Code 将文件另存为「UTF-8」编码后重新导入。"
                .to_string()
        } else {
            format!("读取文件失败：{e}")
        }
    })
}
