use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

// ── Shared event payloads ────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub req_id: String,
    pub delta: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ChatDone {
    pub req_id: String,
    pub error: Option<String>,
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bug_signature: Option<String>,
}

// ── Error-detection helpers ──────────────────────────────────────────────

pub fn is_tools_error(text: &str) -> bool {
    text.contains("does not support tools") || text.contains("Ollama API error")
}

pub fn extract_model_from_tools_error(error: &str) -> Option<String> {
    if let Some(idx) = error.find("library/") {
        let rest = &error[idx + 8..];
        if let Some(end) = rest.find(" does not") {
            let model = rest[..end].to_string();
            if !model.is_empty() {
                return Some(model);
            }
        }
    }
    None
}

// ── Precise fallback detection ───────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackReason {
    QuotaExhausted,
    NetworkDown,
}

/// Check whether an error string indicates that the cloud provider's
/// quota / balance / credits have been exhausted.
pub fn is_quota_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("insufficient_funds")
        || lower.contains("insufficient funds")
        || lower.contains("quota_exceeded")
        || lower.contains("quota exceeded")
        || lower.contains("billing")
        || lower.contains("credit")
        || lower.contains("exceeded your current quota")
        || lower.contains("rate_limit_exceeded")
        || lower.contains("rate limit exceeded")
        || lower.contains("out of credits")
        || lower.contains("balance")
        || lower.contains("http-gateway-402")
        || lower.contains("status: 402")
        || lower.contains("http 402")
}

/// Check whether an error string indicates a network-level failure
/// (DNS, connection refused, timeout) as opposed to an application error.
pub fn is_network_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("connect timeout")
        || lower.contains("connection refused")
        || lower.contains("dns error")
        || lower.contains("dns resolve")
        || lower.contains("network unreachable")
        || lower.contains("no route to host")
        || lower.contains("ws-connect-timeout")
        || lower.contains("ws-connect-error")
        || lower.contains("timed out")
        || lower.contains("connection reset")
        || lower.contains("connection closed")
        || lower.contains("broken pipe")
}

/// Decide whether a failed chat request should fall back to local Ollama.
///
/// Returns `Some(reason)` when fallback is appropriate:
///   - `QuotaExhausted`: cloud provider returned a billing / quota error
///   - `NetworkDown`: could not reach the gateway at all
///
/// Returns `None` for all other errors (tools incompatibility, auth errors,
/// server bugs, etc.) — those should be reported directly to the user.
pub fn should_fallback(error: &str) -> Option<FallbackReason> {
    if is_quota_error(error) {
        Some(FallbackReason::QuotaExhausted)
    } else if is_network_error(error) {
        Some(FallbackReason::NetworkDown)
    } else {
        None
    }
}

/// A model string that does NOT contain `/` is treated as a local Ollama model.
/// Cloud models always use the `provider/model-name` format.
pub fn is_local_model(model: Option<&str>) -> bool {
    model.is_some_and(|m| !m.is_empty() && !m.contains('/'))
}

// ── SSE parsing helpers (pure, no Tauri dependency) ──────────────────────

/// Extract delta text from an SSE `data:` line. Returns `None` for
/// non-data lines, empty data, or `[DONE]`.  If a model name is found
/// in the JSON payload, `*model` is updated.
pub fn extract_sse_delta(line: &str, model: &mut Option<String>) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    if data == "[DONE]" || data.is_empty() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(data).ok()?;

    if model.is_none() {
        update_model_from_json(&json, model);
    }

    json.pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub fn is_sse_done(line: &str) -> bool {
    line.strip_prefix("data:")
        .is_some_and(|d| d.trim() == "[DONE]")
}

fn update_model_from_json(json: &serde_json::Value, model: &mut Option<String>) {
    if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
        let m = m.trim();
        if !m.is_empty() && m != "main" && m != "default" && m != "unknown" {
            *model = Some(m.to_string());
        }
    }
}

// ── CLI response parsing (used by desktop, available for all) ────────────

pub fn parse_agent_reply(raw: &str) -> Result<String, String> {
    let json: serde_json::Value =
        serde_json::from_str(raw.trim()).map_err(|e| format!("json-parse-error: {e}"))?;

    for pointer in &["/payloads", "/result/payloads"] {
        if let Some(payloads) = json.pointer(pointer).and_then(|v| v.as_array()) {
            let parts: Vec<&str> = payloads
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect();
            if !parts.is_empty() {
                return Ok(parts.join("\n\n"));
            }
        }
    }

    for pointer in &["/result/text", "/text"] {
        if let Some(text) = json.pointer(pointer).and_then(|v| v.as_str()) {
            return Ok(text.to_string());
        }
    }

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("agent-error: {err}"));
    }

    Err(format!("unexpected-response: {raw}"))
}

pub fn extract_model_from_reply(raw: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(raw.trim()).ok()?;

    let candidates = [
        "/meta/agentMeta/model",
        "/meta/model",
        "/result/model",
        "/result/agent/model",
        "/result/metadata/model",
        "/metadata/model",
        "/model",
        "/result/provider_model",
    ];

    for path in &candidates {
        if let Some(m) = json.pointer(path).and_then(|v| v.as_str()) {
            let m = m.trim();
            if !m.is_empty() && m != "main" && m != "default" && m != "unknown" {
                return Some(m.to_string());
            }
        }
    }
    None
}

// ── SSE stream consumer (shared by desktop & mobile) ─────────────────────

/// Consume an SSE response stream, parsing OpenAI-compatible chat completion
/// deltas.
///
/// When `buffer_threshold > 0`, the first N characters of delta content are
/// buffered to detect "tools" errors before any `on_delta` calls.  Set
/// `buffer_threshold = 0` to disable buffering and emit every delta
/// immediately.
///
/// Returns `Ok(model)` on normal completion, `Err(msg)` on tools error or
/// stream failure.
pub async fn consume_sse_stream(
    response: reqwest::Response,
    buffer_threshold: usize,
    on_delta: impl Fn(&str),
) -> Result<Option<String>, String> {
    let mut byte_stream = response.bytes_stream();
    let mut model: Option<String> = None;
    let mut had_error: Option<String> = None;
    let mut line_buf = String::new();

    let mut delta_buffer: Vec<String> = Vec::new();
    let mut buffered_len: usize = 0;
    let mut flushed = buffer_threshold == 0;
    let mut raw_bytes = String::new();

    'outer: while let Some(chunk_result) = byte_stream.next().await {
        match chunk_result {
            Err(e) => {
                had_error = Some(format!("stream-read-error: {e}"));
                break;
            }
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                if !flushed {
                    raw_bytes.push_str(&text);
                }

                for ch in text.chars() {
                    if ch == '\n' {
                        let line = line_buf.trim().to_string();
                        line_buf.clear();

                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line["data:".len()..].trim();

                        if data == "[DONE]" {
                            if !flushed {
                                let full = delta_buffer.join("");
                                if is_tools_error(&full) {
                                    return Err(format!("sse-tools-error: {full}"));
                                }
                                if !full.is_empty() {
                                    on_delta(&full);
                                }
                            }
                            break 'outer;
                        }

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if model.is_none() {
                                update_model_from_json(&json, &mut model);
                            }
                            if let Some(delta) = json
                                .pointer("/choices/0/delta/content")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                            {
                                if flushed {
                                    on_delta(delta);
                                } else {
                                    buffered_len += delta.len();
                                    delta_buffer.push(delta.to_string());
                                    if buffered_len >= buffer_threshold {
                                        let full = delta_buffer.join("");
                                        if is_tools_error(&full) {
                                            return Err(format!("sse-tools-error: {full}"));
                                        }
                                        if !full.is_empty() {
                                            on_delta(&full);
                                        }
                                        flushed = true;
                                    }
                                }
                            }
                        }
                    } else {
                        line_buf.push(ch);
                    }
                }
            }
        }
    }

    // Handle remaining line.
    if !line_buf.trim().is_empty() {
        if flushed {
            if let Some(delta) = extract_sse_delta(line_buf.trim(), &mut model) {
                on_delta(&delta);
            }
        } else if let Some(delta) = extract_sse_delta(line_buf.trim(), &mut model) {
            delta_buffer.push(delta);
        }
    }

    // Flush any remaining buffered text.
    if !flushed {
        let full = delta_buffer.join("");
        if is_tools_error(&full) {
            return Err(format!("sse-tools-error: {full}"));
        }
        if full.is_empty() && is_tools_error(&raw_bytes) {
            return Err(format!("sse-tools-error: {raw_bytes}"));
        }
        if !full.is_empty() {
            on_delta(&full);
        }
    }

    if let Some(err) = had_error {
        return Err(err);
    }

    Ok(model)
}

// ── Ollama helpers (shared by desktop chat + chat_proxy) ─────────────────

pub const OLLAMA_URL: &str = "http://localhost:11434";

/// Build the OpenAI-compatible chat completions URL for Ollama.
pub fn ollama_chat_url() -> String {
    format!("{OLLAMA_URL}/v1/chat/completions")
}

/// Build a request body for Ollama's OpenAI-compatible endpoint.
pub fn build_ollama_body(
    model: &str,
    messages: &serde_json::Value,
    stream: bool,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    })
}

/// Query `localhost:11434/api/tags` and return the first available model name.
pub async fn discover_ollama_model(client: &reqwest::Client) -> Option<String> {
    let resp = client
        .get(format!("{OLLAMA_URL}/api/tags"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;
    let body: serde_json::Value = serde_json::from_str(&text).ok()?;
    body["models"]
        .as_array()?
        .first()?
        .get("name")?
        .as_str()
        .map(|s| s.to_string())
}

// ── Robust HTTP chat request (shared by desktop & mobile) ─────────────────

/// Configuration for an HTTP chat request to the OpenClaw gateway.
pub struct HttpChatConfig<'a> {
    pub gateway_url: &'a str,
    pub messages: &'a serde_json::Value,
    pub model: Option<&'a str>,
    pub auth_token: Option<&'a str>,
    pub stream: bool,
}

/// Outcome of an HTTP chat request attempt.
pub enum HttpChatOutcome {
    /// 2xx response — caller should consume the body / SSE stream.
    Success {
        response: reqwest::Response,
        endpoint: String,
    },
    /// All candidate endpoints returned 404/405.
    NoEndpoint(String),
    /// Non-retriable gateway error (4xx excluding 404/405/429, or exhausted
    /// retries on 5xx/429).
    GatewayError {
        status: u16,
        body: String,
        endpoint: String,
    },
}

const HTTP_CHAT_ENDPOINTS: &[&str] = &[
    "/v1/chat/completions",
    "/chat",
    "/api/chat",
    "/agents/main/chat",
];

const MAX_ENDPOINT_RETRIES: u32 = 3;

/// Send an HTTP chat request to the OpenClaw gateway with automatic endpoint
/// discovery and exponential-backoff retry for transient errors (5xx, 429).
///
/// Tries multiple endpoint candidates.  For each candidate, retries on
/// 5xx / 429 with backoff (500 ms → 1 s → 2 s → 4 s, capped).  Returns as
/// soon as any endpoint returns 2xx or a definitive non-retriable error.
pub async fn http_chat_request(config: &HttpChatConfig<'_>) -> Result<HttpChatOutcome, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("http-client-error: {e}"))?;

    let base = config.gateway_url.trim_end_matches('/');

    let mut body = serde_json::json!({
        "messages": config.messages,
        "stream": config.stream,
        "agent": "main",
        "model": "openclaw:main",
    });
    // Only pass model directly for non-OpenClaw targets (e.g. Ollama).
    // For OpenClaw, model switching is done via CLI before the chat request;
    // the body always routes to the "main" agent.
    if let Some(m) = config.model {
        if !m.contains('/') && m != "main" && m != "openclaw:main" {
            body["model"] = serde_json::Value::String(m.to_string());
        }
    }

    let mut last_err = String::new();

    for suffix in HTTP_CHAT_ENDPOINTS {
        let endpoint = format!("{base}{suffix}");
        let mut attempt = 0u32;
        let mut backoff_ms = 500u64;

        loop {
            let mut req = client.post(&endpoint).json(&body);
            if let Some(token) = config.auth_token {
                if !token.is_empty() {
                    req = req.header("Authorization", format!("Bearer {token}"));
                }
            }

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();

                    if status == 404 || status == 405 {
                        last_err = format!("http-endpoint-{status}: {endpoint}");
                        break;
                    }

                    if resp.status().is_success() {
                        return Ok(HttpChatOutcome::Success {
                            response: resp,
                            endpoint,
                        });
                    }

                    if (status >= 500 || status == 429) && attempt < MAX_ENDPOINT_RETRIES {
                        attempt += 1;
                        let delay = if status == 429 {
                            backoff_ms.max(3000)
                        } else {
                            backoff_ms
                        };
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        backoff_ms = (backoff_ms * 2).min(4000);
                        continue;
                    }

                    let err_body = resp.text().await.unwrap_or_default();
                    return Ok(HttpChatOutcome::GatewayError {
                        status,
                        body: err_body,
                        endpoint,
                    });
                }
                Err(e) => {
                    if attempt < MAX_ENDPOINT_RETRIES {
                        attempt += 1;
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        backoff_ms = (backoff_ms * 2).min(4000);
                        continue;
                    }
                    last_err = format!("http-connect-error: {e}");
                    break;
                }
            }
        }
    }

    Ok(HttpChatOutcome::NoEndpoint(last_err))
}

/// Non-streaming convenience wrapper: sends a chat request via HTTP and
/// returns the assistant reply as a plain `String`.
///
/// Used by `chat_proxy` to relay mobile requests without touching WebSocket.
pub async fn http_chat_simple(
    gateway_url: &str,
    messages: &serde_json::Value,
    model: Option<&str>,
) -> Result<String, String> {
    let config = HttpChatConfig {
        gateway_url,
        messages,
        model,
        auth_token: None,
        stream: false,
    };

    match http_chat_request(&config).await? {
        HttpChatOutcome::Success { response, .. } => {
            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("http-json-error: {e}"))?;
            json.pointer("/choices/0/message/content")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| {
                    format!(
                        "http-unexpected-response: {}",
                        json.to_string().chars().take(200).collect::<String>()
                    )
                })
        }
        HttpChatOutcome::NoEndpoint(msg) => Err(format!("http-no-endpoint: {msg}")),
        HttpChatOutcome::GatewayError { status, body, .. } => {
            Err(format!("http-gateway-{status}: {body}"))
        }
    }
}

// ── Gateway agents API parsing (shared by desktop & mobile) ──────────────

/// Parse the `GET /agents` response and extract the model string of the
/// "main" agent.  Handles both Desktop format (`agent.model`) and Mobile
/// format (`agent.config.model`), plus field `name` vs `id`.
pub fn parse_agents_model(agents: &[serde_json::Value]) -> Option<String> {
    let agent = agents
        .iter()
        .find(|a| {
            a.get("id").and_then(|v| v.as_str()) == Some("main")
                || a.get("name").and_then(|v| v.as_str()) == Some("main")
        })
        .or_else(|| agents.first())?;

    agent
        .get("model")
        .and_then(|v| v.as_str())
        .or_else(|| {
            agent
                .get("config")
                .and_then(|c| c.get("model"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
}
