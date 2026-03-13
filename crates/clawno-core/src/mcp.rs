use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpScanResult {
    pub risk_level: String,
    pub factors: Vec<String>,
    pub reachable: bool,
}

/// Canonical risk-factor key strings — used by frontend i18n (`mcp.factors.*`).
pub mod factor {
    pub const SHELL_INVOCATION: &str = "shell_invocation";
    pub const REMOTE_SERVER: &str = "remote_server";
    pub const NO_TLS: &str = "no_tls";
    pub const SENSITIVE_PATH: &str = "sensitive_path";
    pub const NODE_PROCESS: &str = "node_process";
    pub const UNKNOWN_TRANSPORT: &str = "unknown_transport";
}

/// Validate an MCP plugin ID (alphanumeric + hyphens/underscores/dots).
pub fn validate_plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("empty plugin id".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("invalid plugin id: {id:?}"));
    }
    Ok(())
}

// ── Heuristic pattern lists (merged from desktop + mobile) ───────────────

const SHELL_COMMANDS: &[&str] = &[
    "bash",
    "/bin/sh",
    "/bin/bash",
    "cmd.exe",
    "cmd /",
    "powershell",
    "powershell.exe",
    "&&",
    "||",
    ";",
    "|",
    "`",
    "$(",
    "rm -",
    "sudo ",
    "chmod ",
    "chown ",
    "mshta",
    "wscript",
    "cscript",
    "rundll32",
    "regsvr32",
    "python",
    "python3",
    "ruby",
    "perl",
];

const NETWORK_TOOLS: &[&str] = &[
    "curl ",
    "curl\t",
    "wget ",
    "wget\t",
    "nc ",
    "netcat",
    "ncat",
    "python -m http",
    "python3 -m http",
];

const SENSITIVE_PATHS: &[&str] = &[
    "/etc/",
    "~/.ssh",
    ".env",
    "credentials",
    "id_rsa",
    "secrets",
    "passwd",
    "shadow",
    "hosts",
    "authorized_keys",
    ".aws/credentials",
    "\\system32",
    "\\sam",
    "\\ntlm",
    "appdata\\local\\microsoft\\credentials",
    "appdata\\roaming\\microsoft",
    "%appdata%",
    "%userprofile%",
    "%systemroot%",
];

// ── Risk scanning functions (shared by desktop + mobile) ─────────────────

/// Analyse a stdio command line for security risks.
/// Returns `(risk_level, factors)`.
pub fn scan_stdio_risk(command: &str) -> (String, Vec<String>) {
    let lower = command.to_lowercase();
    let mut factors: Vec<String> = Vec::new();
    let mut risk = "safe";

    if SHELL_COMMANDS.iter().any(|kw| lower.contains(kw)) {
        factors.push(factor::SHELL_INVOCATION.to_string());
        risk = "danger";
    }

    if NETWORK_TOOLS.iter().any(|kw| lower.contains(kw)) {
        factors.push(factor::REMOTE_SERVER.to_string());
        if risk == "safe" {
            risk = "caution";
        }
    }

    let found_sensitive = SENSITIVE_PATHS.iter().any(|kw| lower.contains(kw));
    if found_sensitive {
        factors.push(factor::SENSITIVE_PATH.to_string());
        if risk != "danger" {
            risk = "caution";
        }
    }

    if factors.is_empty() && (lower.contains("npx") || lower.contains("node")) {
        factors.push(factor::NODE_PROCESS.to_string());
    }

    (risk.to_string(), factors)
}

/// Analyse an HTTP/SSE endpoint URL for security risks.
/// Returns `(risk_level, factors)`.  Does NOT probe reachability — callers
/// that need a probe should do so themselves (requires async HTTP client).
pub fn scan_http_risk(endpoint: &str) -> (String, Vec<String>) {
    let ep = endpoint.to_lowercase();
    let mut factors: Vec<String> = Vec::new();
    let mut risk = "safe";

    let is_local = ep.contains("localhost")
        || ep.contains("127.")
        || ep.contains("[::1]")
        || ep.contains("0.0.0.0");
    let is_https = ep.starts_with("https://");

    if !is_local {
        factors.push(factor::REMOTE_SERVER.to_string());
        if risk == "safe" {
            risk = "caution";
        }
        if !is_https {
            factors.push(factor::NO_TLS.to_string());
            risk = "danger";
        }
    }

    (risk.to_string(), factors)
}

/// Unified scan: dispatches to the correct risk scanner based on transport,
/// probes HTTP reachability when applicable, and returns a single result.
pub async fn scan_server(endpoint: &str, transport: &str) -> Result<McpScanResult, String> {
    match transport {
        "http" | "sse" => {
            let (risk_level, factors) = scan_http_risk(endpoint);
            let reachable = probe_http(endpoint).await;
            Ok(McpScanResult {
                risk_level,
                factors,
                reachable,
            })
        }
        "stdio" => {
            let (risk_level, factors) = scan_stdio_risk(endpoint);
            Ok(McpScanResult {
                risk_level,
                factors,
                reachable: false,
            })
        }
        _ => Ok(McpScanResult {
            risk_level: "caution".to_string(),
            factors: vec![factor::UNKNOWN_TRANSPORT.to_string()],
            reachable: false,
        }),
    }
}

// ── Tauri command macro ──────────────────────────────────────────────────────

/// Generate the shared `scan_mcp_server` Tauri command.
///
/// ```ignore
/// clawno_core::define_scan_mcp_command!();
/// ```
#[macro_export]
macro_rules! define_scan_mcp_command {
    () => {
        pub use clawno_core::mcp::McpScanResult;

        #[tauri::command]
        pub async fn scan_mcp_server(
            endpoint: String,
            transport: String,
        ) -> Result<McpScanResult, String> {
            clawno_core::mcp::scan_server(&endpoint, &transport).await
        }
    };
}

/// HTTP HEAD probe with short timeout. Returns `true` if the endpoint responds.
pub async fn probe_http(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client.head(url).send().await.is_ok()
}
