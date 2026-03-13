/// Mobile chat streaming via the desktop's chat proxy.
///
/// Mobile does not have direct WS access to the OpenClaw gateway.
/// All requests go through the desktop's LAN-accessible chat proxy
/// (port 18800-18810), which bridges HTTP → WS.
///
/// Model selection is per-request: the `model` field is passed through
/// to the chat proxy, which forwards it as the WS `agentId` parameter.
use clawno_core::chat::{consume_sse_stream, ChatChunk, ChatDone};
use clawno_core::sentinel::{self, SentinelEvent};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

fn done(
    req_id: &str,
    error: Option<String>,
    model: Option<String>,
    sig: Option<String>,
) -> ChatDone {
    ChatDone {
        req_id: req_id.to_string(),
        error,
        model,
        bug_signature: sig,
    }
}

#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    gateway_url: String,
    messages: Vec<Value>,
    req_id: String,
    model: Option<String>,
    auth_token: Option<String>,
    session_key: Option<String>,
) -> Result<(), String> {
    // Mobile always routes through the desktop's chat proxy.
    // The gateway_url from the frontend is already the chat proxy URL.
    stream_via_chat_proxy(
        &app,
        &gateway_url,
        &messages,
        &req_id,
        model,
        auth_token.as_deref(),
        session_key.as_deref(),
    )
    .await
}

// ── SSE helpers ──────────────────────────────────────────────────────────

async fn emit_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    req_id: &str,
) -> Result<(), String> {
    let rid = req_id.to_string();
    let emitter = app.clone();

    let result = consume_sse_stream(response, 0, |delta| {
        let _ = emitter.emit(
            "chat-chunk",
            ChatChunk {
                req_id: rid.clone(),
                delta: delta.to_string(),
            },
        );
    })
    .await;

    match result {
        Ok(model) => {
            let _ = app.emit("chat-done", done(req_id, None, model, None));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("chat-done", done(req_id, Some(e), None, None));
            Ok(())
        }
    }
}

// ── Chat proxy relay ─────────────────────────────────────────────────────

const CHAT_PROXY_PORT_START: u16 = 18800;
const CHAT_PROXY_PORT_END: u16 = 18810;

fn extract_host(url: &str) -> &str {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    without_scheme.split(':').next().unwrap_or("127.0.0.1")
}

async fn stream_via_chat_proxy(
    app: &AppHandle,
    gateway_url: &str,
    messages: &[Value],
    req_id: &str,
    model: Option<String>,
    auth_token: Option<&str>,
    session_key: Option<&str>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let model_name = model.unwrap_or_else(|| "main".into());
    let host = extract_host(gateway_url);

    sentinel::log_sentinel_event(&SentinelEvent::applied(
        "mobile_chat",
        "",
        &format!("chat proxy at {host} for model={model_name}"),
    ));

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": messages,
        "stream": true,
    });
    if let Some(sk) = session_key {
        body["session_key"] = serde_json::Value::String(sk.to_string());
    }

    for port in CHAT_PROXY_PORT_START..=CHAT_PROXY_PORT_END {
        let proxy_url = format!("http://{host}:{port}/v1/chat/completions");
        let mut req = client
            .post(&proxy_url)
            .header("Content-Type", "application/json")
            .json(&body);
        if let Some(token) = auth_token {
            if !token.is_empty() {
                req = req.header("Authorization", format!("Bearer {token}"));
            }
        }

        match req.send().await {
            Ok(r) if r.status().is_success() => {
                return emit_sse_stream(app, r, req_id).await;
            }
            Ok(r) if r.status().as_u16() == 401 => continue,
            Ok(r) => {
                let status = r.status().as_u16();
                let text = r.text().await.unwrap_or_default();
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "mobile_chat",
                    "",
                    &format!("chat proxy {port} returned {status}: {text}"),
                ));
                break;
            }
            Err(_) => continue,
        }
    }

    let _ = app.emit(
        "chat-done",
        done(
            req_id,
            Some("桌面端 chat proxy 不可达，请检查桌面端是否正在运行".into()),
            None,
            None,
        ),
    );
    Ok(())
}
