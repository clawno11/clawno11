/// MCP (Model Context Protocol) security scanner + OpenClaw plugin discovery.
///
/// Performs static + live analysis on MCP server configurations:
///   - URL-based: local vs remote, TLS, reachability
///   - Stdio-based: command-line risk heuristics
///
/// Also surfaces OpenClaw's own native plugin inventory via
/// `openclaw plugins list --json` so users can manage them from ClawNo.11.

use std::sync::OnceLock;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Process-wide HTTP client — reused across all probe calls to avoid
/// per-request TLS handshake and connection-pool overhead.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_default()
    })
}

#[derive(serde::Serialize)]
pub struct McpScanResult {
    /// "safe" | "caution" | "danger"
    pub risk_level: String,
    /// Machine-readable risk factor keys (translated in the frontend)
    pub factors: Vec<String>,
    /// Whether a TCP connection to the endpoint could be established
    pub reachable: bool,
}

/// Classify risk of an MCP server endpoint.
/// `transport` is one of: "http", "sse", "stdio".
#[tauri::command]
pub async fn scan_mcp_server(endpoint: String, transport: String) -> Result<McpScanResult, String> {
    let mut factors: Vec<String> = Vec::new();
    let mut risk = "safe";

    match transport.as_str() {
        "http" | "sse" => {
            let ep = endpoint.to_lowercase();

            // Detect local addresses: loopback (127.x, [::1]), localhost hostname, 0.0.0.0.
            // IPv6 loopback appears as [::1] inside URL brackets.
            let is_local = ep.contains("localhost")
                || ep.contains("127.")
                || ep.contains("[::1]")
                || ep.contains("0.0.0.0");

            let is_https = ep.starts_with("https://");

            if !is_local {
                factors.push("remote_server".to_string());
                if risk == "safe" {
                    risk = "caution";
                }
                if !is_https {
                    factors.push("no_tls".to_string());
                    risk = "danger";
                }
            }

            // Probe reachability (best-effort, short timeout)
            let reachable = probe_http(&endpoint).await;
            return Ok(McpScanResult {
                risk_level: risk.to_string(),
                factors,
                reachable,
            });
        }
        "stdio" => {
            let cmd = endpoint.to_lowercase();

            // Heuristic: shell invocations and interpreter executables that can run arbitrary code.
            // Use path-anchored or space/tab-delimited patterns to avoid false positives.
            // Notably "sh " (with trailing space) is NOT used to prevent matching "ssh ".
            let shell_keywords: &[&str] = &[
                // Unix/Windows shells
                "bash", "/bin/sh", "cmd.exe", "cmd /", "powershell", "powershell.exe",
                // Download/execution utilities — delimited to avoid partial matches
                "curl ", "curl\t", "wget ", "wget\t",
                // Windows script hosts (LOLBins)
                "mshta", "wscript", "cscript", "rundll32", "regsvr32",
                // Scripting language runtimes
                "python", "python3", "ruby", "perl",
            ];
            for kw in shell_keywords {
                if cmd.contains(kw) {
                    factors.push("shell_invocation".to_string());
                    risk = "danger";
                    break;
                }
            }

            // Heuristic: Unix sensitive paths
            let unix_sensitive: &[&str] = &[
                "/etc/", "~/.ssh", ".env", "credentials", "id_rsa", "secrets",
                "passwd", "shadow", "hosts", "authorized_keys",
            ];
            // Heuristic: Windows sensitive paths
            let win_sensitive: &[&str] = &[
                "\\system32", "\\sam", "\\ntlm",
                "appdata\\local\\microsoft\\credentials",
                "appdata\\roaming\\microsoft",
                "%appdata%", "%userprofile%", "%systemroot%",
            ];

            let found_sensitive = unix_sensitive.iter().chain(win_sensitive.iter())
                .any(|kw| cmd.contains(kw));
            if found_sensitive {
                factors.push("sensitive_path".to_string());
                if risk != "danger" {
                    risk = "caution";
                }
            }

            // Heuristic: npm/npx-based MCP servers are common and generally safe
            if (cmd.contains("npx") || cmd.contains("node")) && factors.is_empty() {
                factors.push("node_process".to_string());
                // stays "safe" but we note it
            }
        }
        _ => {
            factors.push("unknown_transport".to_string());
            risk = "caution";
        }
    }

    Ok(McpScanResult {
        risk_level: risk.to_string(),
        factors,
        reachable: false, // stdio servers don't have a URL to probe
    })
}

/// Fire a HEAD request and return true if the server responds within 3 s.
/// Reuses the process-wide HTTP client to avoid per-call overhead.
async fn probe_http(url: &str) -> bool {
    get_http_client().head(url).send().await.is_ok()
}

// ── OpenClaw plugin discovery ───────────────────────────────────────────────

/// Slimmed-down plugin descriptor returned to the frontend.
#[derive(serde::Serialize)]
pub struct OpenClawPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    /// "bundled" | "npm" | "local"
    pub origin: String,
    pub enabled: bool,
    /// "loaded" | "disabled" | "error"
    pub status: String,
    /// Tool names exposed by this plugin (may be empty).
    pub tool_names: Vec<String>,
}

/// List all plugins known to the local OpenClaw installation.
///
/// Runs `openclaw plugins list --json`, parses the output, and returns the
/// subset of fields the UI needs.  Returns an empty Vec on any error so the
/// frontend degrades gracefully (shows "no plugins found").
#[tauri::command]
pub async fn list_openclaw_plugins() -> Vec<OpenClawPlugin> {
    let out = crate::platform::shell_output("openclaw plugins list --json");
    if out.is_empty() {
        return Vec::new();
    }

    // The JSON root has shape { "workspaceDir": "...", "plugins": [...] }.
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&out) else {
        return Vec::new();
    };
    let Some(arr) = root.get("plugins").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    arr.iter().filter_map(|p| {
        Some(OpenClawPlugin {
            id:          p["id"]         .as_str().unwrap_or("").to_string(),
            name:        p["name"]       .as_str().unwrap_or("").to_string(),
            description: p["description"].as_str().unwrap_or("").to_string(),
            version:     p["version"]    .as_str().unwrap_or("").to_string(),
            origin:      p["origin"]     .as_str().unwrap_or("bundled").to_string(),
            enabled:     p["enabled"]    .as_bool().unwrap_or(false),
            status:      p["status"]     .as_str().unwrap_or("disabled").to_string(),
            tool_names:  p["toolNames"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default(),
        })
    }).collect()
}

/// Enable or disable an OpenClaw plugin by its ID.
///
/// Calls `openclaw plugins enable <id>` or `openclaw plugins disable <id>`.
/// Uses Command::new with an explicit args array to prevent shell injection.
/// Returns the combined stdout+stderr output so the frontend can surface errors.
#[tauri::command]
pub async fn toggle_openclaw_plugin(id: String, enable: bool) -> Result<String, String> {
    // Validate: plugin IDs are alphanumeric + hyphens/underscores only.
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err(format!("invalid plugin id: {id:?}"));
    }

    let verb = if enable { "enable" } else { "disable" };

    #[cfg(target_os = "windows")]
    let openclaw_bin = "openclaw.cmd";
    #[cfg(not(target_os = "windows"))]
    let openclaw_bin = "openclaw";

    let mut cmd = std::process::Command::new(openclaw_bin);
    cmd.args(["plugins", verb, &id])
        .env("PATH", crate::platform::augmented_path());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output()
        .map_err(|e| format!("failed to run openclaw: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(if stdout.is_empty() { stderr } else { stdout })
}
