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

fn is_tools_error(text: &str) -> bool {
    text.contains("does not support tools") || text.contains("Ollama API error")
}

// ── SSE parsing helpers (pure, no Tauri dependency) ──────────────────────

fn update_model_from_json(json: &serde_json::Value, model: &mut Option<String>) {
    if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
        let m = m.trim();
        if !m.is_empty() && m != "main" && m != "default" && m != "unknown" {
            *model = Some(m.to_string());
        }
    }
}

/// Extract delta text from an SSE `data:` line.
fn extract_sse_delta(line: &str, model: &mut Option<String>) -> Option<String> {
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

// ── SSE stream consumer (used by mobile chat.rs) ─────────────────────────

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

    if !line_buf.trim().is_empty() {
        if flushed {
            if let Some(delta) = extract_sse_delta(line_buf.trim(), &mut model) {
                on_delta(&delta);
            }
        } else if let Some(delta) = extract_sse_delta(line_buf.trim(), &mut model) {
            delta_buffer.push(delta);
        }
    }

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
