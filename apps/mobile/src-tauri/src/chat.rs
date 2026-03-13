/// Mobile chat streaming via the desktop's chat proxy.
///
/// Mobile does not have direct WS access to the OpenClaw gateway.
/// All requests go through the desktop's LAN-accessible chat proxy
/// (port 18800-18810), which bridges HTTP → WS.
///
/// Model selection is per-request: the `model` field is passed through
/// to the chat proxy, which forwards it as the WS `agentId` parameter.
use std::collections::HashMap;
use std::sync::OnceLock;

use clawno_core::chat::{consume_sse_stream, ChatChunk, ChatDone};
use clawno_core::sentinel::{self, SentinelEvent};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

// ── Cancel map for stop_chat_stream ──────────────────────────────────────

type CancelMap = Mutex<HashMap<String, oneshot::Sender<()>>>;

static CANCEL: OnceLock<CancelMap> = OnceLock::new();

fn cancel_map() -> &'static CancelMap {
    CANCEL.get_or_init(|| Mutex::new(HashMap::new()))
}

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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    gateway_url: String,
    proxy_url: Option<String>,
    messages: Vec<Value>,
    req_id: String,
    model: Option<String>,
    auth_token: Option<String>,
    session_key: Option<String>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    cancel_map().lock().await.insert(req_id.clone(), cancel_tx);

    let result = tokio::select! {
        r = do_stream(
            &app, &gateway_url, proxy_url.as_deref(), &messages, &req_id,
            model.clone(), auth_token.as_deref(), session_key.as_deref(),
        ) => r,
        _ = cancel_rx => {
            let _ = app.emit("chat-done", done(&req_id, None, model, None));
            Ok(())
        }
    };

    cancel_map().lock().await.remove(&req_id);
    result
}

#[tauri::command]
pub async fn stop_chat_stream(req_id: String) -> Result<(), String> {
    if let Some(tx) = cancel_map().lock().await.remove(&req_id) {
        let _ = tx.send(());
    }
    Ok(())
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

// ── Stream orchestrator ──────────────────────────────────────────────────
//
// Priority:
//   1. If `proxy_url` is set (frontend already discovered it) → direct hit
//   2. Scan ports 18800-18810 on gateway host (legacy/fallback path)
//   3. Direct HTTP to `gateway_url` (the original OpenClaw gateway)

const CHAT_PROXY_PORT_START: u16 = 18800;
const CHAT_PROXY_PORT_END: u16 = 18810;

#[allow(clippy::too_many_arguments)]
async fn do_stream(
    app: &AppHandle,
    gateway_url: &str,
    proxy_url: Option<&str>,
    messages: &[Value],
    req_id: &str,
    model: Option<String>,
    auth_token: Option<&str>,
    session_key: Option<&str>,
) -> Result<(), String> {
    let model_name = model.clone().unwrap_or_else(|| "main".into());

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": messages,
        "stream": true,
    });
    if let Some(sk) = session_key {
        body["session_key"] = Value::String(sk.to_string());
    }

    // ── 1. Try pre-discovered proxy URL (instant, no scanning) ──
    if let Some(pu) = proxy_url {
        sentinel::log_sentinel_event(&SentinelEvent::applied(
            "mobile_chat",
            "",
            &format!("direct proxy hit {pu} model={model_name}"),
        ));
        match try_post(pu, &body, auth_token, 5).await {
            Ok(resp) => return emit_sse_stream(app, resp, req_id).await,
            Err(e) => {
                sentinel::log_sentinel_event(&SentinelEvent::captured(
                    "mobile_chat",
                    "",
                    &format!("proxy direct hit failed: {e}"),
                ));
            }
        }
    }

    // ── 2. Port-scan fallback (only if proxy_url was not provided) ──
    if proxy_url.is_none() {
        let host = extract_host(gateway_url);
        sentinel::log_sentinel_event(&SentinelEvent::applied(
            "mobile_chat",
            "",
            &format!("scanning proxy ports on {host} for model={model_name}"),
        ));
        for port in CHAT_PROXY_PORT_START..=CHAT_PROXY_PORT_END {
            let scan_url = format!("http://{host}:{port}");
            match try_post(&scan_url, &body, auth_token, 2).await {
                Ok(resp) => return emit_sse_stream(app, resp, req_id).await,
                Err(_) => continue,
            }
        }
    }

    // ── 3. Direct to OpenClaw gateway ──
    sentinel::log_sentinel_event(&SentinelEvent::applied(
        "mobile_chat",
        "",
        &format!("fallback direct to gateway {gateway_url}"),
    ));
    match try_post(gateway_url, &body, None, 5).await {
        Ok(resp) => emit_sse_stream(app, resp, req_id).await,
        Err(e) => {
            let _ = app.emit(
                "chat-done",
                done(req_id, Some(format!("无法连接: {e}")), model, None),
            );
            Ok(())
        }
    }
}

async fn try_post(
    base_url: &str,
    body: &Value,
    auth_token: Option<&str>,
    connect_timeout_secs: u64,
) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(connect_timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(body);
    if let Some(token) = auth_token {
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(resp)
    } else {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("HTTP {status}: {text}"))
    }
}

fn extract_host(url: &str) -> &str {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    without_scheme.split(':').next().unwrap_or("127.0.0.1")
}
