/**
 * MCP (Model Context Protocol) server security scanner — mobile port.
 *
 * Performs static analysis on server configuration and optionally
 * checks reachability via HTTP request.
 */
use crate::types::McpScanResult;

/// Heuristic patterns that indicate potentially dangerous stdio MCP servers.
const SHELL_OPERATORS: &[&str] = &[
    "&&", "||", ";", "|", "`", "$(",
    "rm -", "sudo ", "chmod ", "chown ",
    "/etc/", "/bin/sh", "/bin/bash", "cmd.exe", "powershell",
];

const NETWORK_TOOLS: &[&str] = &[
    "curl", "wget", "nc ", "netcat", "ncat",
    "python -m http", "python3 -m http",
];

const SENSITIVE_PATHS: &[&str] = &[
    "~/.ssh", "/etc/passwd", "/etc/shadow",
    "id_rsa", ".aws/credentials", ".env",
    "C:\\Users", "AppData\\Roaming",
];

fn scan_stdio_endpoint(endpoint: &str) -> (String, Vec<String>) {
    let lower = endpoint.to_lowercase();
    let mut factors: Vec<String> = Vec::new();

    // Deduplicated factor keys match the frontend i18n `mcp.factors.*` keys.
    let has_shell = SHELL_OPERATORS.iter().any(|op| lower.contains(op));
    if has_shell {
        factors.push("shell_invocation".to_string());
    }

    let has_network = NETWORK_TOOLS.iter().any(|tool| lower.contains(tool));
    if has_network {
        factors.push("remote_server".to_string());
    }

    let has_sensitive = SENSITIVE_PATHS.iter().any(|path| lower.contains(&path.to_lowercase()));
    if has_sensitive {
        factors.push("sensitive_path".to_string());
    }

    let risk = if has_shell { "danger" } else if !factors.is_empty() { "caution" } else { "safe" };

    (risk.to_string(), factors)
}

async fn scan_http_endpoint(endpoint: &str) -> (String, Vec<String>, bool) {
    let mut factors: Vec<String> = Vec::new();

    // TLS check
    if !endpoint.starts_with("https://") {
        factors.push("no_tls".to_string());
    }

    // Remote endpoint check (not localhost) — key matches frontend i18n `mcp.factors.remote_server`.
    let is_local = endpoint.contains("localhost")
        || endpoint.contains("127.0.0.1")
        || endpoint.contains("::1");
    if !is_local {
        factors.push("remote_server".to_string());
    }

    // Reachability probe
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return ("caution".to_string(), factors, false);
        }
    };

    let reachable = client.get(endpoint).send().await.is_ok();

    let risk = if factors.contains(&"remote_server".to_string())
        && factors.contains(&"no_tls".to_string())
    {
        "danger"
    } else if !factors.is_empty() {
        "caution"
    } else {
        "safe"
    };

    (risk.to_string(), factors, reachable)
}

#[tauri::command]
pub async fn scan_mcp_server(endpoint: String, transport: String) -> Result<McpScanResult, String> {
    let (risk_level, factors, reachable) = match transport.as_str() {
        "stdio" => {
            let (risk, f) = scan_stdio_endpoint(&endpoint);
            (risk, f, false)
        }
        _ => scan_http_endpoint(&endpoint).await,
    };

    Ok(McpScanResult {
        risk_level,
        factors,
        reachable,
    })
}
