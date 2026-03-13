/// Lightweight HTTP REST proxy that exposes an OpenAI-compatible
/// `/v1/chat/completions` endpoint on a LAN-accessible port.
///
/// The openclaw gateway is WebSocket-only and does not provide a REST chat
/// API.  This proxy bridges the gap by connecting to the gateway via WebSocket:
///
///   Mobile ──HTTP POST──▶ chat_proxy ──WS──▶ openclaw gateway
///
/// All models (cloud AND local Ollama) are routed through OpenClaw — there is
/// no Ollama direct path or fallback here.  OpenClaw itself manages Ollama as
/// a provider.
///
/// **Security**: Every request must carry `Authorization: Bearer <token>`.
/// The token is generated once at startup and communicated to mobile clients
/// via the QR pairing flow.
use std::sync::{Arc, OnceLock};

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::{self, Next},
    response::{sse::Event, IntoResponse, Json, Response, Sse},
    routing::{get, post},
    Router,
};
use clawno_core::sentinel::{self, capture::capture_context, SentinelEvent};
use clawno_core::ws_chat::OpenClawWs;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_stream::wrappers::UnboundedReceiverStream;

const DEFAULT_PROXY_PORT: u16 = 18800;

static PROXY_AUTH_TOKEN: OnceLock<String> = OnceLock::new();
static GATEWAY_URL: OnceLock<String> = OnceLock::new();
static WS_CLIENT: OnceLock<Mutex<Option<Arc<OpenClawWs>>>> = OnceLock::new();
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Emit a remote-chat event to the desktop frontend for audit visibility.
fn emit_remote_chat(event_name: &str, payload: &impl Serialize) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(event_name, payload);
    }
}

#[derive(Clone, Serialize)]
struct RemoteChatEvent {
    session_key: String,
    user_text: String,
    model: String,
    assistant_text: String,
    timestamp: u64,
    error: Option<String>,
}

fn ws_client_slot() -> &'static Mutex<Option<Arc<OpenClawWs>>> {
    WS_CLIENT.get_or_init(|| Mutex::new(None))
}

pub fn get_proxy_auth_token() -> &'static str {
    PROXY_AUTH_TOKEN.get().map(|s| s.as_str()).unwrap_or("")
}

async fn auth_middleware(req: Request, next: Next) -> Response {
    if req.uri().path() == "/health" {
        return next.run(req).await;
    }

    let expected = match PROXY_AUTH_TOKEN.get() {
        Some(t) => t.as_str(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": { "message": "Proxy not ready", "type": "server_error" }
                })),
            )
                .into_response();
        }
    };

    let authorized = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t == expected)
        .unwrap_or(false);

    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": { "message": "Unauthorized", "type": "auth_error" }
            })),
        )
            .into_response();
    }

    next.run(req).await
}

#[derive(Deserialize)]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    session_key: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionResponse {
    id: String,
    object: &'static str,
    created: u64,
    model: String,
    choices: Vec<Choice>,
}

#[derive(Serialize)]
struct Choice {
    index: usize,
    message: ChatMessage,
    finish_reason: String,
}

#[derive(Serialize)]
struct ChatChunkResponse {
    id: String,
    object: &'static str,
    created: u64,
    model: String,
    choices: Vec<ChunkChoice>,
}

#[derive(Serialize)]
struct ChunkChoice {
    index: usize,
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Serialize)]
struct Delta {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}

async fn health_handler() -> impl IntoResponse {
    let token = get_proxy_auth_token();
    Json(serde_json::json!({ "status": "ok", "ck": token }))
}

async fn providers_handler() -> impl IntoResponse {
    let providers = crate::node::list_configured_providers().await;
    Json(serde_json::json!({ "providers": providers }))
}

#[derive(Deserialize)]
struct ConfigureApiKeyRequest {
    provider: String,
    api_key: String,
}

async fn configure_api_key_handler(Json(req): Json<ConfigureApiKeyRequest>) -> impl IntoResponse {
    let result = crate::deploy::configure_api_key(req.provider, req.api_key).await;
    Json(serde_json::json!({ "ok": result.ok, "detail": result.detail }))
}

async fn repair_model_handler() -> impl IntoResponse {
    let gw_url = GATEWAY_URL
        .get()
        .map(|s| s.as_str())
        .unwrap_or("http://127.0.0.1:18789");
    let port: u16 = reqwest::Url::parse(gw_url)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(18789);
    let result = crate::deploy::models::repair_model_config(port).await;
    Json(
        serde_json::json!({ "ok": result.ok, "detail": result.detail, "fixes_applied": result.fixes_applied }),
    )
}

// ── Ensure WS connection (with auto-reconnect) ──────────────────────────

async fn get_ws_client() -> Result<Arc<OpenClawWs>, String> {
    let slot = ws_client_slot();
    {
        let guard = slot.lock().await;
        if let Some(ref ws) = *guard {
            if ws.is_connected().await {
                return Ok(Arc::clone(ws));
            }
        }
    }

    let gw_url = GATEWAY_URL
        .get()
        .map(|s| s.as_str())
        .unwrap_or("http://127.0.0.1:18789");
    let ws = Arc::new(OpenClawWs::new(gw_url));
    ws.connect().await?;
    let mut guard = slot.lock().await;
    *guard = Some(Arc::clone(&ws));
    Ok(ws)
}

// ── Chat handler ─────────────────────────────────────────────────────────

async fn chat_handler(Json(req): Json<ChatRequest>) -> Response {
    let user_text = req
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    if user_text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "message": "No user message found", "type": "invalid_request_error" }
            })),
        )
            .into_response();
    }

    let model = req.model.clone().unwrap_or_else(|| "main".to_string());

    sentinel::log_sentinel_event(&SentinelEvent::applied(
        "chat_proxy",
        "",
        &format!("WS chat for model={model}"),
    ));

    let msgs_value: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let ws = match get_ws_client().await {
        Ok(ws) => ws,
        Err(e) => {
            let ctx = capture_context(&e, "chat_proxy", None);
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_proxy",
                &ctx.bug_signature,
                &format!("WS connect failed: {e}"),
            ));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": { "message": e, "type": "server_error" }
                })),
            )
                .into_response();
        }
    };

    let session_key = req.session_key.clone().unwrap_or_default();
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    emit_remote_chat(
        "remote-chat-request",
        &RemoteChatEvent {
            session_key: session_key.clone(),
            user_text: user_text.clone(),
            model: model.clone(),
            assistant_text: String::new(),
            timestamp: now_ts,
            error: None,
        },
    );

    if req.stream {
        return build_streaming_ws_response(
            ws,
            model,
            msgs_value,
            req.session_key,
            user_text,
            session_key,
            now_ts,
        )
        .await;
    }

    let ws_result = ws
        .chat_full(&msgs_value, Some(&model), req.session_key.as_deref())
        .await;

    match ws_result {
        Ok(resp) => {
            emit_remote_chat(
                "remote-chat-done",
                &RemoteChatEvent {
                    session_key,
                    user_text,
                    model: model.clone(),
                    assistant_text: resp.text.clone(),
                    timestamp: now_ts,
                    error: None,
                },
            );
            build_non_streaming_response(&model, resp.text)
        }
        Err(e) => {
            emit_remote_chat(
                "remote-chat-done",
                &RemoteChatEvent {
                    session_key,
                    user_text,
                    model: model.clone(),
                    assistant_text: String::new(),
                    timestamp: now_ts,
                    error: Some(e.clone()),
                },
            );
            let ctx = capture_context(&e, "chat_proxy", None);
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_proxy",
                &ctx.bug_signature,
                &format!("WS failed: {e}"),
            ));
            if e.contains("ws-closed") || e.contains("ws-recv-error") || e.contains("ws-send-error")
            {
                let mut guard = ws_client_slot().lock().await;
                *guard = None;
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": { "message": e, "type": "server_error" }
                })),
            )
                .into_response()
        }
    }
}

fn build_non_streaming_response(model: &str, reply: String) -> Response {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let id = format!("chatcmpl-proxy-{}", now);
    let resp = ChatCompletionResponse {
        id,
        object: "chat.completion",
        created: now,
        model: model.to_string(),
        choices: vec![Choice {
            index: 0,
            message: ChatMessage {
                role: "assistant".into(),
                content: reply,
            },
            finish_reason: "stop".into(),
        }],
    };
    Json(resp).into_response()
}

async fn build_streaming_ws_response(
    ws: Arc<OpenClawWs>,
    model: String,
    msgs_value: Vec<serde_json::Value>,
    session_key: Option<String>,
    user_text: String,
    audit_session_key: String,
    audit_ts: u64,
) -> Response {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let id = format!("chatcmpl-proxy-{}", now);

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<Event, Infallible>>();

    let role_chunk = ChatChunkResponse {
        id: id.clone(),
        object: "chat.completion.chunk",
        created: now,
        model: model.clone(),
        choices: vec![ChunkChoice {
            index: 0,
            delta: Delta {
                role: Some("assistant".into()),
                content: None,
            },
            finish_reason: None,
        }],
    };
    let _ = tx.send(Ok(
        Event::default().data(serde_json::to_string(&role_chunk).unwrap_or_default())
    ));

    let tx_task = tx.clone();
    let model_task = model.clone();
    let id_task = id.clone();

    let accumulated = Arc::new(Mutex::new(String::new()));
    let accumulated_cb = Arc::clone(&accumulated);

    tokio::spawn(async move {
        let model_cb = model_task.clone();
        let id_cb = id_task.clone();
        let tx_cb = tx_task.clone();

        let ws_result = ws
            .chat_full_streaming(
                &msgs_value,
                Some(&model_task),
                session_key.as_deref(),
                move |delta| {
                    {
                        if let Ok(mut acc) = accumulated_cb.try_lock() {
                            acc.push_str(delta);
                        }
                    }
                    let chunk = ChatChunkResponse {
                        id: id_cb.clone(),
                        object: "chat.completion.chunk",
                        created: now,
                        model: model_cb.clone(),
                        choices: vec![ChunkChoice {
                            index: 0,
                            delta: Delta {
                                role: None,
                                content: Some(delta.to_string()),
                            },
                            finish_reason: None,
                        }],
                    };
                    let _ = tx_cb
                        .send(Ok(Event::default()
                            .data(serde_json::to_string(&chunk).unwrap_or_default())));
                },
            )
            .await;

        let final_text = accumulated.lock().await.clone();

        if let Err(ref e) = ws_result {
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_proxy",
                "",
                &format!("WS streaming failed: {e}"),
            ));
            if e.contains("ws-closed") || e.contains("ws-recv-error") || e.contains("ws-send-error")
            {
                let mut guard = ws_client_slot().lock().await;
                *guard = None;
            }
            emit_remote_chat(
                "remote-chat-done",
                &RemoteChatEvent {
                    session_key: audit_session_key,
                    user_text,
                    model: model_task.clone(),
                    assistant_text: final_text,
                    timestamp: audit_ts,
                    error: Some(e.clone()),
                },
            );
        } else {
            emit_remote_chat(
                "remote-chat-done",
                &RemoteChatEvent {
                    session_key: audit_session_key,
                    user_text,
                    model: model_task.clone(),
                    assistant_text: final_text,
                    timestamp: audit_ts,
                    error: None,
                },
            );
        }

        let stop_chunk = ChatChunkResponse {
            id: id_task.clone(),
            object: "chat.completion.chunk",
            created: now,
            model: model_task.clone(),
            choices: vec![ChunkChoice {
                index: 0,
                delta: Delta {
                    role: None,
                    content: None,
                },
                finish_reason: Some("stop".into()),
            }],
        };
        let _ = tx_task.send(Ok(
            Event::default().data(serde_json::to_string(&stop_chunk).unwrap_or_default())
        ));
        let _ = tx_task.send(Ok(Event::default().data("[DONE]")));
    });

    drop(tx);

    Sse::new(UnboundedReceiverStream::new(rx))
        .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

// ── Startup ──────────────────────────────────────────────────────────────

const PROXY_TOKEN_STORE_KEY: &str = "chat_proxy_auth_token";

fn generate_and_persist_token(app: &tauri::AppHandle) -> String {
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = crate::pairing::b64_encode(&buf);
    let _ = crate::secure_store::set_secure_value(
        app.clone(),
        PROXY_TOKEN_STORE_KEY.into(),
        token.clone(),
    );
    eprintln!(
        "[chat-proxy] new auth token generated & persisted ({} chars)",
        token.len()
    );
    token
}

pub fn start_proxy(app: &tauri::AppHandle, gateway_port: u16) -> u16 {
    let port = DEFAULT_PROXY_PORT;

    let _ = APP_HANDLE.set(app.clone());
    let _ = GATEWAY_URL.set(format!("http://127.0.0.1:{gateway_port}"));

    let existing = crate::secure_store::get_secure_value(app.clone(), PROXY_TOKEN_STORE_KEY.into())
        .ok()
        .flatten();
    let token = if let Some(ref t) = existing {
        if !t.is_empty() {
            eprintln!(
                "[chat-proxy] reusing persisted auth token ({} chars)",
                t.len()
            );
            t.clone()
        } else {
            generate_and_persist_token(app)
        }
    } else {
        generate_and_persist_token(app)
    };

    let _ = PROXY_AUTH_TOKEN.set(token);

    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/health", get(health_handler))
            .route("/providers", get(providers_handler))
            .route("/configure-api-key", post(configure_api_key_handler))
            .route("/api/repair-model", post(repair_model_handler))
            .route("/v1/chat/completions", post(chat_handler))
            .layer(middleware::from_fn(auth_middleware));

        let mut bound_port = port;
        let listener = loop {
            let addr = std::net::SocketAddr::from(([0, 0, 0, 0], bound_port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => break l,
                Err(e) => {
                    eprintln!("[chat-proxy] port {bound_port} busy ({e}), trying next…");
                    bound_port += 1;
                    if bound_port > port + 10 {
                        eprintln!("[chat-proxy] gave up after 10 attempts");
                        return;
                    }
                }
            }
        };

        eprintln!("[chat-proxy] listening on http://0.0.0.0:{bound_port}/");

        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[chat-proxy] server error: {e}");
        }
    });

    port
}
