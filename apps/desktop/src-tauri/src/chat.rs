/// Chat — relays messages to the OpenClaw gateway and returns the
/// response via Tauri events so the frontend can render it progressively.
///
/// Strategy:
///   - Local model (no `/` in name) → Ollama direct on localhost:11434
///   - Cloud/auto model → WS to OpenClaw gateway with model as agentId
///     → On quota/network failure → fallback to Ollama (if available)
///     → On other errors → report directly
///
/// Model selection is per-request via the WS `agentId` parameter.
/// No CLI-based global switching is needed.
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use clawno_core::chat::{
    build_ollama_body, consume_sse_stream, discover_ollama_model, is_local_model, ollama_chat_url,
    should_fallback, ChatChunk, ChatDone, FallbackReason,
};
use clawno_core::sentinel::{self, capture::capture_context, SentinelEvent};
use clawno_core::ws_chat::OpenClawWs;
use tauri::Emitter;
use tokio::sync::Mutex;

// ── WS connection pool ──────────────────────────────────────────────────

type WsPool = Mutex<HashMap<String, Arc<OpenClawWs>>>;

static POOL: OnceLock<WsPool> = OnceLock::new();

fn ws_pool() -> &'static WsPool {
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn get_or_create_ws(gateway_url: &str) -> Arc<OpenClawWs> {
    let mut pool = ws_pool().lock().await;
    if let Some(ws) = pool.get(gateway_url) {
        return Arc::clone(ws);
    }
    let ws = Arc::new(OpenClawWs::new(gateway_url));
    pool.insert(gateway_url.to_string(), Arc::clone(&ws));
    ws
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

fn fallback_label(reason: FallbackReason) -> &'static str {
    match reason {
        FallbackReason::QuotaExhausted => "quota_exhausted",
        FallbackReason::NetworkDown => "network_down",
    }
}

fn fallback_msg_zh(reason: FallbackReason) -> &'static str {
    match reason {
        FallbackReason::QuotaExhausted => "云端余额不足，已切换到本地模型",
        FallbackReason::NetworkDown => "网络不可达，已切换到本地模型",
    }
}

// ── Main command ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn stream_chat(
    app: tauri::AppHandle,
    gateway_url: String,
    messages: serde_json::Value,
    req_id: String,
    model: Option<String>,
    #[allow(unused_variables)] auth_token: Option<String>,
    session_key: Option<String>,
) -> Result<(), String> {
    // ── Route: local model → Ollama direct ───────────────────────────────
    if is_local_model(model.as_deref()) {
        sentinel::log_sentinel_event(&SentinelEvent::applied(
            "chat",
            "",
            &format!(
                "local model '{}' → Ollama direct",
                model.as_deref().unwrap_or("")
            ),
        ));
        return stream_chat_ollama_direct(&app, &messages, &req_id, model).await;
    }

    // ── Route: cloud/auto → WS to OpenClaw gateway ───────────────────────
    let has_gateway = !gateway_url.is_empty()
        && (gateway_url.starts_with("http://") || gateway_url.starts_with("https://"));

    if !has_gateway {
        let _ = app.emit(
            "chat-done",
            done(
                &req_id,
                Some("无网关地址，请先部署或选择实例".into()),
                None,
                None,
            ),
        );
        return Ok(());
    }

    let ws = get_or_create_ws(&gateway_url).await;

    if let Err(e) = ws.ensure_connected().await {
        sentinel::log_sentinel_event(&SentinelEvent::captured(
            "chat_ws",
            "",
            &format!("WS connect failed: {e}"),
        ));

        if let Some(reason) = should_fallback(&e) {
            sentinel::log_sentinel_event(&SentinelEvent::applied(
                "chat_fallback",
                "",
                &format!("{} → Ollama", fallback_label(reason)),
            ));
            let _ = app.emit(
                "chat-chunk",
                ChatChunk {
                    req_id: req_id.clone(),
                    delta: format!("⚠️ {}\n\n", fallback_msg_zh(reason)),
                },
            );
            return stream_chat_ollama_direct(&app, &messages, &req_id, None).await;
        }

        let _ = app.emit(
            "chat-done",
            done(&req_id, Some(format!("无法连接网关: {e}")), None, None),
        );
        return Ok(());
    }

    let emitter = app.clone();
    let rid = req_id.clone();
    let ws_result = ws
        .chat_full_streaming(
            messages.as_array().map(|a| a.as_slice()).unwrap_or(&[]),
            model.as_deref(),
            session_key.as_deref(),
            move |delta| {
                let _ = emitter.emit(
                    "chat-chunk",
                    ChatChunk {
                        req_id: rid.clone(),
                        delta: delta.to_string(),
                    },
                );
            },
        )
        .await;

    match ws_result {
        Ok(_resp) => {
            let _ = app.emit("chat-done", done(&req_id, None, model, None));
            Ok(())
        }
        Err(e) => {
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_ws",
                "",
                &format!("WS chat failed: {e}"),
            ));

            // Drop broken connection from pool so next call reconnects.
            if e.contains("ws-closed") || e.contains("ws-recv-error") || e.contains("ws-send-error")
            {
                let mut pool = ws_pool().lock().await;
                pool.remove(&gateway_url);
            }

            if let Some(reason) = should_fallback(&e) {
                sentinel::log_sentinel_event(&SentinelEvent::applied(
                    "chat_fallback",
                    "",
                    &format!("{} → Ollama", fallback_label(reason)),
                ));
                let _ = app.emit(
                    "chat-chunk",
                    ChatChunk {
                        req_id: req_id.clone(),
                        delta: format!("⚠️ {}\n\n", fallback_msg_zh(reason)),
                    },
                );
                return stream_chat_ollama_direct(&app, &messages, &req_id, None).await;
            }

            let _ = app.emit("chat-done", done(&req_id, Some(e), None, None));
            Ok(())
        }
    }
}

// ── Ollama direct (local fallback) ───────────────────────────────────────

async fn stream_chat_ollama_direct(
    app: &tauri::AppHandle,
    messages: &serde_json::Value,
    req_id: &str,
    model_hint: Option<String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("ollama-direct-error: {e}"))?;

    let model_name = if let Some(ref hint) = model_hint {
        hint.clone()
    } else {
        discover_ollama_model(&client)
            .await
            .unwrap_or_else(|| "llama3.2".into())
    };

    sentinel::log_sentinel_event(&SentinelEvent::applied(
        "chat_ollama",
        "",
        &format!("Ollama direct with model={model_name}"),
    ));

    let body = build_ollama_body(&model_name, messages, true);
    let resp = client.post(ollama_chat_url()).json(&body).send().await;

    match resp {
        Err(e) => {
            let ctx = capture_context(&e.to_string(), "chat_ollama", None);
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_ollama",
                &ctx.bug_signature,
                &format!("Ollama connection failed: {e}"),
            ));
            let _ = app.emit(
                "chat-done",
                done(
                    req_id,
                    Some("Ollama 未运行或无法连接，请确认已启动 Ollama".into()),
                    None,
                    Some(ctx.bug_signature),
                ),
            );
            Ok(())
        }
        Ok(r) if !r.status().is_success() => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            let ctx = capture_context(&text, "chat_ollama", None);
            sentinel::log_sentinel_event(&SentinelEvent::captured(
                "chat_ollama",
                &ctx.bug_signature,
                &format!("Ollama {status}: {text}"),
            ));
            let _ = app.emit(
                "chat-done",
                done(
                    req_id,
                    Some(format!(
                        "Ollama 返回错误 ({status})，请检查模型 {model_name} 是否可用"
                    )),
                    None,
                    Some(ctx.bug_signature),
                ),
            );
            Ok(())
        }
        Ok(r) => {
            let rid = req_id.to_string();
            let emitter = app.clone();
            let result = consume_sse_stream(r, 0, |delta| {
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
                Ok(_) => {
                    let _ = app.emit("chat-done", done(req_id, None, Some(model_name), None));
                    Ok(())
                }
                Err(e) => {
                    let ctx = capture_context(&e, "chat_ollama", None);
                    sentinel::log_sentinel_event(&SentinelEvent::captured(
                        "chat_ollama",
                        &ctx.bug_signature,
                        &format!("Ollama stream error: {e}"),
                    ));
                    let _ = app.emit(
                        "chat-done",
                        done(
                            req_id,
                            Some(format!("Ollama 流式响应异常: {e}")),
                            Some(model_name),
                            Some(ctx.bug_signature),
                        ),
                    );
                    Ok(())
                }
            }
        }
    }
}
