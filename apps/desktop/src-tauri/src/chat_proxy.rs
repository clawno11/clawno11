/// Lightweight HTTP REST proxy that exposes an OpenAI-compatible
/// `/v1/chat/completions` endpoint on a LAN-accessible port.
///
/// The openclaw gateway is WebSocket-only and does not provide a REST chat
/// API.  Desktop can fall back to the `openclaw agent` CLI, but mobile has
/// no CLI.  This proxy bridges the gap:
///
///   Mobile ──HTTP POST──▶ chat_proxy ──CLI──▶ openclaw agent ──WS──▶ gateway
///
/// The proxy binds on `0.0.0.0` so the Android emulator (via `10.0.2.2`) and
/// LAN devices can reach it.
///
/// **Security**: Every request must carry `Authorization: Bearer <token>`.
/// The token is generated once at startup and communicated to mobile clients
/// via the QR pairing flow.

use axum::{
    Router,
    routing::{get, post},
    extract::Request,
    middleware::{self, Next},
    response::{IntoResponse, Json, Response, Sse, sse::Event},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::OnceLock, time::Duration};
use futures_util::stream;

const DEFAULT_PROXY_PORT: u16 = 18800;

/// Bearer token required for all chat requests.  Generated once at startup.
static PROXY_AUTH_TOKEN: OnceLock<String> = OnceLock::new();

/// Retrieve the current proxy auth token (for embedding in QR pairing data).
pub fn get_proxy_auth_token() -> &'static str {
    PROXY_AUTH_TOKEN.get().map(|s| s.as_str()).unwrap_or("")
}

/// Middleware that rejects requests without a valid Bearer token.
/// The /health endpoint is exempt so uptime probes still work.
async fn auth_middleware(req: Request, next: Next) -> Response {
    if req.uri().path() == "/health" {
        return next.run(req).await;
    }

    let expected = match PROXY_AUTH_TOKEN.get() {
        Some(t) => t.as_str(),
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
                "error": { "message": "Proxy not ready — auth token not yet generated", "type": "server_error" }
            }))).into_response();
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
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
            "error": { "message": "Unauthorized — invalid or missing Bearer token", "type": "auth_error" }
        }))).into_response();
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

async fn chat_handler(
    Json(req): Json<ChatRequest>,
) -> Response {
    let user_text = req
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    if user_text.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": { "message": "No user message found", "type": "invalid_request_error" }
        }))).into_response();
    }

    let model = req.model.clone().unwrap_or_else(|| "main".to_string());

    let reply = match run_openclaw_agent(&user_text).await {
        Ok(raw) => {
            let parsed = parse_agent_reply(&raw);
            match parsed {
                Ok(text) => text,
                Err(e) if e.contains("does not support tools") => {
                    eprintln!("[chat-proxy][self-heal] tools error — trying Ollama direct");
                    match call_ollama_direct(&req.messages).await {
                        Ok(text) => text,
                        Err(e2) => {
                            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                                "error": { "message": format!("self-heal failed: {e2}"), "type": "server_error" }
                            }))).into_response();
                        }
                    }
                }
                Err(_) => raw,
            }
        }
        Err(e) if e.contains("does not support tools") => {
            eprintln!("[chat-proxy][self-heal] CLI tools error — trying Ollama direct");
            match call_ollama_direct(&req.messages).await {
                Ok(text) => text,
                Err(e2) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                        "error": { "message": format!("self-heal failed: {e2}"), "type": "server_error" }
                    }))).into_response();
                }
            }
        }
        Err(e) => {
            // Self-healing: generic CLI failure → try Ollama direct as last resort
            eprintln!("[chat-proxy][self-heal] CLI failed: {e} — trying Ollama direct");
            match call_ollama_direct(&req.messages).await {
                Ok(text) => text,
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                        "error": { "message": e, "type": "server_error" }
                    }))).into_response();
                }
            }
        }
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let id = format!("chatcmpl-proxy-{}", now);

    if req.stream {
        let role_chunk = ChatChunkResponse {
            id: id.clone(),
            object: "chat.completion.chunk",
            created: now,
            model: model.clone(),
            choices: vec![ChunkChoice {
                index: 0,
                delta: Delta { role: Some("assistant".into()), content: None },
                finish_reason: None,
            }],
        };
        let content_chunk = ChatChunkResponse {
            id: id.clone(),
            object: "chat.completion.chunk",
            created: now,
            model: model.clone(),
            choices: vec![ChunkChoice {
                index: 0,
                delta: Delta { role: None, content: Some(reply) },
                finish_reason: None,
            }],
        };
        let stop_chunk = ChatChunkResponse {
            id: id.clone(),
            object: "chat.completion.chunk",
            created: now,
            model,
            choices: vec![ChunkChoice {
                index: 0,
                delta: Delta { role: None, content: None },
                finish_reason: Some("stop".into()),
            }],
        };

        let events = vec![
            Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&role_chunk).unwrap_or_default())),
            Ok(Event::default().data(serde_json::to_string(&content_chunk).unwrap_or_default())),
            Ok(Event::default().data(serde_json::to_string(&stop_chunk).unwrap_or_default())),
            Ok(Event::default().data("[DONE]")),
        ];

        Sse::new(stream::iter(events))
            .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response()
    } else {
        let resp = ChatCompletionResponse {
            id,
            object: "chat.completion",
            created: now,
            model,
            choices: vec![Choice {
                index: 0,
                message: ChatMessage { role: "assistant".into(), content: reply },
                finish_reason: "stop".into(),
            }],
        };
        Json(resp).into_response()
    }
}

const PROXY_TOKEN_STORE_KEY: &str = "chat_proxy_auth_token";

fn generate_and_persist_token(app: &tauri::AppHandle) -> String {
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = crate::pairing::b64_encode(&buf);
    let _ = crate::secure_store::set_secure_value(app.clone(), PROXY_TOKEN_STORE_KEY.into(), token.clone());
    eprintln!("[chat-proxy] new auth token generated & persisted ({} chars)", token.len());
    token
}

/// Start the REST chat proxy in a background Tokio task.
/// Tries DEFAULT_PROXY_PORT first, then increments until a free port is found.
/// Returns the port that will be attempted (actual binding is async).
///
/// The auth token is persisted in the secure store so mobile clients don't need
/// to re-pair after every desktop restart.
pub fn start_proxy(app: &tauri::AppHandle, _gateway_port: u16) -> u16 {
    let port = DEFAULT_PROXY_PORT;

    // Try to reuse a previously persisted token so mobile stays paired across restarts.
    let existing = crate::secure_store::get_secure_value(app.clone(), PROXY_TOKEN_STORE_KEY.into()).ok().flatten();

    let token = if let Some(ref t) = existing {
        if !t.is_empty() {
            eprintln!("[chat-proxy] reusing persisted auth token ({} chars)", t.len());
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

// ── Self-healing: direct Ollama fallback ─────────────────────────────────

async fn call_ollama_direct(messages: &[ChatMessage]) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("ollama-error: {e}"))?;

    let model_name = discover_ollama_model_proxy(&client)
        .await
        .unwrap_or_else(|| "llama3.2".into());

    eprintln!("[chat-proxy][self-heal] calling Ollama with model={model_name}");

    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let body = serde_json::json!({
        "model": model_name,
        "messages": msgs,
        "stream": false,
    });

    let resp = client
        .post("http://localhost:11434/v1/chat/completions")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama-error: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ollama-error: {text}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("ollama-json-error: {e}"))?;

    json.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "ollama-error: no content in response".to_string())
}

async fn discover_ollama_model_proxy(client: &reqwest::Client) -> Option<String> {
    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;
    body["models"]
        .as_array()?
        .first()?
        .get("name")?
        .as_str()
        .map(|s| s.to_string())
}

// ── CLI helpers (reused from chat.rs with slight modifications) ──────────

async fn run_openclaw_agent(message: &str) -> Result<String, String> {
    let augmented = crate::platform::augmented_path();
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
        if stdout.trim_start().starts_with('{') {
            return Ok(stdout);
        }
        return Err(format!("openclaw-exit-error: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn parse_agent_reply(raw: &str) -> Result<String, String> {
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
