/// Chat proxy — relays messages to the OpenClaw gateway and returns the
/// response via Tauri events so the frontend can render it progressively.
///
/// Strategy (in priority order):
///   1. HTTP SSE  — POST /v1/chat/completions?stream=true to the gateway.
///                  Gives real progressive streaming; both Clawno11 and the
///                  OpenClaw dashboard share the same agent session.
///   2. CLI fallback — `openclaw agent --agent main --json -m <text>` when
///                  no gateway URL is reachable (e.g. gateway not yet started).

use futures_util::StreamExt;
use tauri::Emitter;

// ── Event payloads ─────────────────────────────────────────────────────────

/// Payload emitted when a text chunk arrives.
#[derive(Clone, serde::Serialize)]
pub struct ChatChunk {
    pub req_id: String,
    pub delta: String,
}

/// Payload emitted when the turn is complete or has errored.
#[derive(Clone, serde::Serialize)]
pub struct ChatDone {
    pub req_id: String,
    pub error: Option<String>,
    /// Actual model string returned by the gateway (e.g. "anthropic/claude-3-5-sonnet-20241022").
    pub model: Option<String>,
}

// ── Main command ───────────────────────────────────────────────────────────

/// Send one user message to the OpenClaw gateway and emit the reply
/// back to the frontend via Tauri events.
///
/// `messages` is the full context array `[{role, content}]`.
///
/// Events emitted on `app`:
/// - `chat-chunk` → `ChatChunk { req_id, delta }`  (zero or more, one per SSE chunk)
/// - `chat-done`  → `ChatDone  { req_id, error }`  (always emitted last)
#[tauri::command]
pub async fn stream_chat(
    app: tauri::AppHandle,
    gateway_url: String,
    messages: serde_json::Value,
    req_id: String,
    model: Option<String>,
) -> Result<(), String> {
    // Try HTTP SSE first whenever a gateway URL is provided.
    let use_http = !gateway_url.is_empty()
        && (gateway_url.starts_with("http://") || gateway_url.starts_with("https://"));

    if use_http {
        // Attempt HTTP SSE; fall back to CLI on any transport or routing error
        // so the user always gets a response.
        //
        // Fallback triggers on:
        //   "http-connect-error:"  — gateway not reachable
        //   "http-request-error:"  — TCP/TLS failure
        //   "http-endpoint-404:"   — no chat endpoint at this URL (wrong API version)
        //   "http-endpoint-405:"   — method not allowed (same root cause)
        let result = stream_chat_http(app.clone(), &gateway_url, &messages, &req_id, model).await;
        if let Err(ref e) = result {
            if e.starts_with("http-connect-error:")
                || e.starts_with("http-request-error:")
                || e.starts_with("http-endpoint-404:")
                || e.starts_with("http-endpoint-405:")
            {
                return stream_chat_cli(app, &messages, &req_id).await;
            }
        }
        result
    } else {
        stream_chat_cli(app, &messages, &req_id).await
    }
}

// ── HTTP SSE path ──────────────────────────────────────────────────────────

/// Call the OpenClaw gateway's chat endpoint with `stream: true` and emit
/// one `chat-chunk` event per token.
///
/// OpenClaw gateway versions differ in their chat API path. We probe the
/// candidates in order and use the first one that responds with 2xx.
/// Returns `Err("http-endpoint-404: ...")` when none of the candidates match,
/// which causes `stream_chat` to fall back to the local CLI.
async fn stream_chat_http(
    app: tauri::AppHandle,
    gateway_url: &str,
    messages: &serde_json::Value,
    req_id: &str,
    model: Option<String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        // Short connect timeout — fail fast if gateway is not reachable.
        .connect_timeout(std::time::Duration::from_secs(10))
        // No total request timeout for streaming — the SSE stream can run
        // indefinitely (model inference on large inputs can take many minutes).
        .build()
        .map_err(|e| format!("http-connect-error: {e}"))?;

    let base = gateway_url.trim_end_matches('/');

    // Probe these endpoints in order. The first one to return non-404/405
    // is used for the actual streaming request.
    let candidates = [
        format!("{base}/v1/chat/completions"),  // OpenAI-compatible gateways
        format!("{base}/chat"),                  // OpenClaw native
        format!("{base}/api/chat"),              // alternative prefix
        format!("{base}/agents/main/chat"),      // agent-scoped endpoint
    ];

    let mut body = serde_json::json!({
        "messages": messages,
        "stream": true,
        "agent": "main",
    });
    // Ollama (and other OpenAI-compatible servers) require an explicit "model" field.
    // When a model override is provided, inject it into the request body.
    if let Some(m) = model {
        body["model"] = serde_json::Value::String(m);
    }

    // Try each candidate. We look for the first that isn't 404/405.
    let mut last_404_msg = String::new();
    let mut chosen_endpoint: Option<String> = None;
    let mut chosen_resp: Option<reqwest::Response> = None;

    for endpoint in &candidates {
        let resp = client
            .post(endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("http-request-error: {e}"))?;

        let status = resp.status().as_u16();
        if status == 404 || status == 405 {
            last_404_msg = format!("http-endpoint-404: {endpoint} returned {status}");
            continue;
        }
        // Any other status (2xx or non-routing error) — commit to this endpoint.
        chosen_endpoint = Some(endpoint.clone());
        chosen_resp = Some(resp);
        break;
    }

    // If no endpoint accepted the request, propagate as Err so the caller
    // can fall back to the CLI.
    let resp = match chosen_resp {
        Some(r) => r,
        None => return Err(last_404_msg),
    };

    let endpoint = chosen_endpoint.unwrap_or_default();

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        let error_msg = format!("gateway-http-{status} ({endpoint}): {text}");
        let _ = app.emit(
            "chat-done",
            ChatDone { req_id: req_id.to_string(), error: Some(error_msg), model: None },
        );
        return Ok(());
    }

    let mut byte_stream = resp.bytes_stream();
    let mut model: Option<String> = None;
    let mut had_error: Option<String> = None;

    // SSE line buffer — gateway may split one logical SSE message across
    // multiple TCP chunks, so we accumulate bytes until we see a full line.
    let mut line_buf = String::new();

    'outer: while let Some(chunk_result) = byte_stream.next().await {
        match chunk_result {
            Err(e) => {
                had_error = Some(format!("stream-read-error: {e}"));
                break;
            }
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for ch in text.chars() {
                    if ch == '\n' {
                        let line = line_buf.trim().to_string();
                        line_buf.clear();
                        if process_sse_line(&line, &app, req_id, &mut model) {
                            break 'outer; // [DONE] received
                        }
                    } else {
                        line_buf.push(ch);
                    }
                }
            }
        }
    }

    // Flush any partial line left in the buffer when the connection closes
    // without a trailing newline (defensive — well-formed SSE always ends with \n\n).
    if !line_buf.trim().is_empty() {
        process_sse_line(line_buf.trim(), &app, req_id, &mut model);
    }

    let _ = app.emit(
        "chat-done",
        ChatDone { req_id: req_id.to_string(), error: had_error, model },
    );
    Ok(())
}

/// Parse a single SSE line and emit a `chat-chunk` event if it carries text.
/// Returns `true` when `[DONE]` is received and the outer loop should stop.
fn process_sse_line(
    line: &str,
    app: &tauri::AppHandle,
    req_id: &str,
    model: &mut Option<String>,
) -> bool {
    let Some(data) = line.strip_prefix("data:") else { return false };
    let data = data.trim();

    if data == "[DONE]" {
        return true;
    }
    if data.is_empty() {
        return false;
    }

    let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
        // Non-JSON line (keep-alive ping, comment, etc.) — ignore silently.
        return false;
    };

    // Capture model name from the first data chunk that carries it.
    if model.is_none() {
        if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
            let m = m.trim();
            if !m.is_empty() && m != "main" && m != "default" && m != "unknown" {
                *model = Some(m.to_string());
            }
        }
    }

    // OpenAI-compatible SSE delta.
    if let Some(delta) = json
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
    {
        if !delta.is_empty() {
            let _ = app.emit(
                "chat-chunk",
                ChatChunk { req_id: req_id.to_string(), delta: delta.to_string() },
            );
        }
    }

    false
}

// ── CLI fallback path ──────────────────────────────────────────────────────

/// Run `openclaw agent --agent main --json -m <last_user_msg>` and emit
/// the response as a single `chat-chunk` + `chat-done` pair.
///
/// This path is used when the gateway HTTP endpoint is unreachable (e.g.
/// gateway not yet started) or when no gateway URL was supplied.
async fn stream_chat_cli(
    app: tauri::AppHandle,
    messages: &serde_json::Value,
    req_id: &str,
) -> Result<(), String> {
    // Extract the last user message from the context array.
    let user_text = messages
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .rev()
                .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        })
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    if user_text.is_empty() {
        let _ = app.emit(
            "chat-done",
            ChatDone { req_id: req_id.to_string(), error: Some("empty message".into()), model: None },
        );
        return Ok(());
    }

    let output = run_openclaw_agent(&user_text).await;

    match output {
        Err(e) => {
            let _ = app.emit(
                "chat-done",
                ChatDone { req_id: req_id.to_string(), error: Some(e), model: None },
            );
        }
        Ok(raw) => {
            let model = extract_model_from_reply(&raw);
            match parse_agent_reply(&raw) {
                Err(e) => {
                    let _ = app.emit(
                        "chat-done",
                        ChatDone { req_id: req_id.to_string(), error: Some(e), model },
                    );
                }
                Ok(text) => {
                    if !text.is_empty() {
                        let _ = app.emit(
                            "chat-chunk",
                            ChatChunk { req_id: req_id.to_string(), delta: text },
                        );
                    }
                    let _ = app.emit(
                        "chat-done",
                        ChatDone { req_id: req_id.to_string(), error: None, model },
                    );
                }
            }
        }
    }

    Ok(())
}

// ── CLI helpers ────────────────────────────────────────────────────────────

/// Run `openclaw agent -m <msg> --agent main --json` and return stdout.
async fn run_openclaw_agent(message: &str) -> Result<String, String> {
    let augmented = crate::platform::augmented_path();

    // On ALL platforms, prefer explicit v22+ node + openclaw.mjs to avoid:
    //   - macOS/Linux: shebang version mismatch (shim points to v20)
    //   - Windows: openclaw.cmd not in PATH after custom-prefix install
    // Only fall back to bare `openclaw` command if openclaw.mjs is not found.
    let node_exe = crate::node::find_node_exe();
    let mjs_path = crate::node::scan_openclaw_mjs();

    #[cfg(target_os = "windows")]
    let mut cmd = {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        if let Some(ref mjs) = mjs_path {
            let mut c = tokio::process::Command::new(&node_exe);
            c.args([mjs.as_str(), "agent", "--agent", "main", "--json", "-m", message]);
            c.env("PATH", &augmented);
            c.creation_flags(0x08000000);
            c
        } else {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", "openclaw", "agent", "--agent", "main", "--json", "-m", message]);
            c.env("PATH", &augmented);
            c.creation_flags(0x08000000);
            c
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        if let Some(ref mjs) = mjs_path {
            let mut c = tokio::process::Command::new(&node_exe);
            c.args([mjs.as_str(), "agent", "--agent", "main", "--json", "-m", message]);
            c.env("PATH", &augmented);
            c
        } else {
            let mut c = tokio::process::Command::new("openclaw");
            c.args(["agent", "--agent", "main", "--json", "-m", message]);
            c.env("PATH", &augmented);
            c
        }
    };

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("openclaw-spawn-error: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        // If stdout has JSON, prefer that (agent sometimes exits non-zero but still has output).
        if stdout.trim_start().starts_with('{') {
            return Ok(stdout);
        }
        return Err(format!("openclaw-exit-error: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Extract ALL payload texts from the JSON returned by `openclaw agent --json`.
///
/// OpenClaw may return multiple payload blocks (tool calls, multiple turns, etc.).
/// Joining them all ensures the complete reply is surfaced rather than just the
/// first block.
fn parse_agent_reply(raw: &str) -> Result<String, String> {
    let json: serde_json::Value =
        serde_json::from_str(raw.trim()).map_err(|e| format!("json-parse-error: {e}"))?;

    // Try multiple JSON shapes — openclaw CLI output format varies by version:
    //   Newer:  { "payloads": [...], "meta": {...} }        (top-level)
    //   Older:  { "result": { "payloads": [...] } }         (nested under result)
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

    // Fallback: single top-level text field.
    for pointer in &["/result/text", "/text"] {
        if let Some(text) = json.pointer(pointer).and_then(|v| v.as_str()) {
            return Ok(text.to_string());
        }
    }

    // Fallback: check for error fields from the CLI.
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("agent-error: {err}"));
    }

    Err(format!("unexpected-response: {raw}"))
}

/// Try to extract the actual AI model name from the openclaw CLI JSON response.
fn extract_model_from_reply(raw: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(raw.trim()).ok()?;

    let candidates = [
        // Newer format: { "meta": { "agentMeta": { "model": "..." } } }
        "/meta/agentMeta/model",
        "/meta/model",
        // Older format: { "result": { ... } }
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
