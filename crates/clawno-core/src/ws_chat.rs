//! Protocol-compliant WebSocket client for the OpenClaw gateway.
//!
//! Implements the full OpenClaw connection lifecycle:
//!   1. TCP + WS upgrade
//!   2. Receive `connect.challenge` event (nonce + ts)
//!   3. Send `connect` request (operator role, client identity)
//!   4. Receive `hello-ok` response (protocol version, device token)
//!   5. Send chat via `agent` method with correct framing
//!   6. Maintain persistent connection; auto-reconnect on drop
//!
//! Device authentication uses the OpenClaw CLI's Ed25519 identity
//! stored at `~/.openclaw/identity/`.  The signature payload follows
//! the V2 format: `v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

use crate::sentinel::{self, SentinelEvent};

/// Map Rust `std::env::consts::OS` to Node.js `process.platform` values,
/// since OpenClaw's device pairing pins the platform string.
fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other, // "linux", "freebsd", etc. match Node.js
    }
}

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsChatResponse {
    pub text: String,
    pub tokens_used: Option<u64>,
    pub tool_calls: Vec<serde_json::Value>,
}

// ── Internal helpers ─────────────────────────────────────────────────────────

static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).unwrap_or_default();
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn gen_id() -> String {
    let n = REQ_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("clawno-{ts}-{n}")
}

fn to_ws_url(gateway_url: &str) -> String {
    let base = gateway_url
        .trim_end_matches('/')
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    if base.starts_with("ws://") || base.starts_with("wss://") {
        base
    } else {
        format!("ws://{base}")
    }
}

/// OpenClaw device identity stored at `~/.openclaw/identity/`.
struct DeviceIdentity {
    device_id: String,
    public_key_b64url: String,
    signing_key: ed25519_dalek::SigningKey,
    device_token: Option<String>,
    gateway_token: Option<String>,
}

fn resolve_openclaw_home() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(std::path::PathBuf::from(home).join(".openclaw"))
}

/// Load the OpenClaw CLI device identity from disk.
/// Falls back gracefully — if files don't exist, returns None.
fn load_device_identity() -> Option<DeviceIdentity> {
    let oc_home = resolve_openclaw_home()?;
    let id_dir = oc_home.join("identity");

    let device_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(id_dir.join("device.json")).ok()?).ok()?;

    let device_id = device_json.get("deviceId")?.as_str()?.to_string();
    let private_pem = device_json.get("privateKeyPem")?.as_str()?;

    use ed25519_dalek::pkcs8::DecodePrivateKey;
    let signing_key = ed25519_dalek::SigningKey::from_pkcs8_pem(private_pem).ok()?;

    use ed25519_dalek::VerifyingKey;
    let verifying = VerifyingKey::from(&signing_key);
    use base64::{engine::general_purpose, Engine as _};
    let public_key_b64url = general_purpose::URL_SAFE_NO_PAD.encode(verifying.as_bytes());

    let device_token = std::fs::read_to_string(id_dir.join("device-auth.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.pointer("/tokens/operator/token")
                .and_then(|t| t.as_str())
                .map(String::from)
        });

    let gateway_token = std::fs::read_to_string(oc_home.join("openclaw.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.pointer("/gateway/auth/token")
                .and_then(|t| t.as_str())
                .map(String::from)
        });

    Some(DeviceIdentity {
        device_id,
        public_key_b64url,
        signing_key,
        device_token,
        gateway_token,
    })
}

/// Build the V2 device auth payload and sign it with Ed25519.
///
/// OpenClaw verifies: `v2|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}`
fn build_and_sign_payload(
    key: &ed25519_dalek::SigningKey,
    device_id: &str,
    client_id: &str,
    client_mode: &str,
    role: &str,
    scopes: &[&str],
    signed_at_ms: u64,
    token: Option<&str>,
    nonce: &str,
) -> String {
    let scopes_str = scopes.join(",");
    let token_str = token.unwrap_or("");
    let payload = format!(
        "v2|{device_id}|{client_id}|{client_mode}|{role}|{scopes_str}|{signed_at_ms}|{token_str}|{nonce}"
    );

    use ed25519_dalek::Signer;
    let sig = key.sign(payload.as_bytes());
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes())
}

// ── Low-level WS stream type ─────────────────────────────────────────────────

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct ActiveConn {
    ws: WsStream,
    #[allow(dead_code)]
    protocol: u32,
}

// ── Persistent client ────────────────────────────────────────────────────────

/// Thread-safe persistent WebSocket client that speaks the OpenClaw gateway
/// protocol.  Designed as a long-lived singleton: connect once, send many
/// messages, reconnect transparently if the connection drops.
///
/// Model switching is simply a parameter in the `agent` request — it does
/// NOT require disconnecting or re-handshaking.
pub struct OpenClawWs {
    #[allow(dead_code)]
    gateway_url: String,
    ws_url: String,
    conn: Arc<Mutex<Option<ActiveConn>>>,
    device_token: Arc<Mutex<Option<String>>>,
}

impl OpenClawWs {
    pub fn new(gateway_url: &str) -> Self {
        Self {
            gateway_url: gateway_url.to_string(),
            ws_url: to_ws_url(gateway_url),
            conn: Arc::new(Mutex::new(None)),
            device_token: Arc::new(Mutex::new(None)),
        }
    }

    /// Establish a WebSocket connection and complete the OpenClaw handshake.
    /// No-op if already connected.
    pub async fn connect(&self) -> Result<(), String> {
        let mut guard = self.conn.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let (mut ws, _) = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async(&self.ws_url),
        )
        .await
        .map_err(|_| format!("ws-connect-timeout: {}", self.ws_url))?
        .map_err(|e| format!("ws-connect-error: {e}"))?;

        let (protocol, dev_token) = Self::handshake(&mut ws, &self.device_token).await?;

        sentinel::log_sentinel_event(&SentinelEvent::applied(
            "ws_chat",
            "",
            &format!("connected to {} (protocol v{protocol})", self.ws_url),
        ));

        if let Some(ref tk) = dev_token {
            *self.device_token.lock().await = Some(tk.clone());
        }

        *guard = Some(ActiveConn { ws, protocol });
        Ok(())
    }

    /// Ensure the connection is alive; reconnect transparently if it dropped.
    pub async fn ensure_connected(&self) -> Result<(), String> {
        {
            let guard = self.conn.lock().await;
            if guard.is_some() {
                return Ok(());
            }
        }
        self.connect().await
    }

    /// Send a single user message and return the complete response.
    ///
    /// `session_key` isolates OpenClaw sessions.  Pass the same key for
    /// messages within one conversation to preserve multi-turn context;
    /// pass a different key (or `None` for auto-generated) for a fresh session.
    pub async fn chat(
        &self,
        message: &str,
        model: Option<&str>,
        session_key: Option<&str>,
    ) -> Result<WsChatResponse, String> {
        self.chat_streaming(message, model, session_key, |_| {})
            .await
    }

    /// Send a single user message with a streaming callback.
    ///
    /// `on_delta` is called with each text delta as it arrives from the
    /// gateway, enabling real-time "typing effect" in the UI.
    pub async fn chat_streaming<F>(
        &self,
        message: &str,
        model: Option<&str>,
        session_key: Option<&str>,
        on_delta: F,
    ) -> Result<WsChatResponse, String>
    where
        F: Fn(&str) + Send,
    {
        self.ensure_connected().await?;

        let req_id = gen_id();
        let idem_key = uuid_v4();

        let agent_id = model.unwrap_or("main");
        let effective_session_key = match session_key {
            Some(k) if !k.is_empty() => format!("clawno11-{k}"),
            _ => format!("clawno11-{}", uuid_v4()),
        };
        let params = serde_json::json!({
            "message": message,
            "idempotencyKey": idem_key,
            "agentId": agent_id,
            "sessionKey": effective_session_key,
        });

        let frame = serde_json::json!({
            "type": "req",
            "id": req_id,
            "method": "agent",
            "params": params,
        });

        let mut guard = self.conn.lock().await;
        let conn = guard.as_mut().ok_or("ws-not-connected")?;

        let frame_text =
            serde_json::to_string(&frame).map_err(|e| format!("ws-serialize-error: {e}"))?;

        if let Err(e) = conn.ws.send(Message::Text(frame_text)).await {
            *guard = None;
            return Err(format!("ws-send-error: {e}"));
        }

        match Self::collect_agent_response(&mut conn.ws, &req_id, &on_delta).await {
            Ok(resp) => Ok(resp),
            Err(e) => {
                if e.contains("ws-closed") || e.contains("ws-recv-error") {
                    *guard = None;
                }
                Err(e)
            }
        }
    }

    /// Send a full message history (extracts the last user message).
    pub async fn chat_full(
        &self,
        messages: &[serde_json::Value],
        model: Option<&str>,
        session_key: Option<&str>,
    ) -> Result<WsChatResponse, String> {
        self.chat_full_streaming(messages, model, session_key, |_| {})
            .await
    }

    /// Send a full message history with streaming callback.
    pub async fn chat_full_streaming<F>(
        &self,
        messages: &[serde_json::Value],
        model: Option<&str>,
        session_key: Option<&str>,
        on_delta: F,
    ) -> Result<WsChatResponse, String>
    where
        F: Fn(&str) + Send,
    {
        let user_text = messages
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("");

        if user_text.is_empty() {
            return Err("ws-chat-error: no user message found".into());
        }

        self.chat_streaming(user_text, model, session_key, on_delta)
            .await
    }

    /// Gracefully close the WebSocket connection.
    pub async fn disconnect(&self) {
        let mut guard = self.conn.lock().await;
        if let Some(mut conn) = guard.take() {
            let _ = conn.ws.close(None).await;
        }
    }

    pub async fn is_connected(&self) -> bool {
        self.conn.lock().await.is_some()
    }

    // ── Handshake ────────────────────────────────────────────────────────────

    /// Perform the full OpenClaw handshake:
    ///   1. Wait for `connect.challenge` event
    ///   2. Send `connect` request with client/device identity + Ed25519 signature
    ///   3. Wait for `hello-ok` response
    async fn handshake(
        ws: &mut WsStream,
        stored_token: &Mutex<Option<String>>,
    ) -> Result<(u32, Option<String>), String> {
        // Step 1: receive connect.challenge
        let challenge = Self::read_frame(ws, Duration::from_secs(10)).await?;
        let nonce = challenge
            .pointer("/payload/nonce")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Step 2: load device identity and build the signed connect request
        let identity = load_device_identity()
            .ok_or("ws-identity-missing: cannot find ~/.openclaw/identity/device.json")?;

        let signed_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let connect_id = gen_id();

        const CLIENT_ID: &str = "cli";
        const CLIENT_MODE: &str = "cli";
        const ROLE: &str = "operator";
        const SCOPES: &[&str] = &["operator.read", "operator.write"];

        // auth.token = gateway token (primary), auth.deviceToken = device token (fallback)
        let gw_token = identity.gateway_token.as_deref();
        let dev_token_str = identity.device_token.as_deref();
        let stored = stored_token.lock().await;

        // The signed payload uses whichever token goes in auth.token
        let effective_auth_token = gw_token.or(dev_token_str).or_else(|| stored.as_deref());

        let auth_value = build_and_sign_payload(
            &identity.signing_key,
            &identity.device_id,
            CLIENT_ID,
            CLIENT_MODE,
            ROLE,
            SCOPES,
            signed_at_ms,
            effective_auth_token,
            &nonce,
        );

        let mut auth = serde_json::json!({});
        if let Some(tk) = gw_token {
            auth["token"] = serde_json::Value::String(tk.to_string());
        }
        if let Some(dt) = dev_token_str {
            auth["deviceToken"] = serde_json::Value::String(dt.to_string());
        } else if let Some(ref tk) = *stored {
            auth["deviceToken"] = serde_json::Value::String(tk.clone());
        }
        drop(stored);

        let connect_req = serde_json::json!({
            "type": "req",
            "id": connect_id,
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": CLIENT_ID,
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": node_platform(),
                    "mode": CLIENT_MODE
                },
                "role": ROLE,
                "scopes": SCOPES,
                "caps": [],
                "commands": [],
                "permissions": {},
                "auth": auth,
                "locale": "en-US",
                "userAgent": format!("clawno11/{}", env!("CARGO_PKG_VERSION")),
                "device": {
                    "id": identity.device_id,
                    "publicKey": identity.public_key_b64url,
                    "signature": auth_value,
                    "signedAt": signed_at_ms,
                    "nonce": nonce,
                }
            }
        });

        let text = serde_json::to_string(&connect_req)
            .map_err(|e| format!("ws-handshake-serialize: {e}"))?;

        ws.send(Message::Text(text))
            .await
            .map_err(|e| format!("ws-handshake-send: {e}"))?;

        // Step 3: wait for hello-ok
        let resp = Self::read_frame(ws, Duration::from_secs(10)).await?;
        let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

        if !ok {
            let err_msg = resp
                .pointer("/error/message")
                .or_else(|| resp.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown handshake error");
            return Err(format!("ws-handshake-rejected: {err_msg}"));
        }

        let payload = resp.get("payload").cloned().unwrap_or_default();
        let protocol = payload
            .get("protocol")
            .and_then(|v| v.as_u64())
            .unwrap_or(3) as u32;
        let dev_token = payload
            .pointer("/auth/deviceToken")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        sentinel::log_sentinel_event(&SentinelEvent::applied(
            "ws_chat",
            "",
            &format!(
                "handshake ok — protocol v{protocol}, device_token={}",
                dev_token.is_some()
            ),
        ));

        Ok((protocol, dev_token))
    }

    // ── Frame I/O ────────────────────────────────────────────────────────────

    async fn read_frame(ws: &mut WsStream, timeout: Duration) -> Result<serde_json::Value, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let msg = tokio::time::timeout_at(deadline, ws.next())
                .await
                .map_err(|_| "ws-timeout: no frame within deadline".to_string())?
                .ok_or_else(|| "ws-closed: connection closed".to_string())?
                .map_err(|e| format!("ws-recv-error: {e}"))?;

            match msg {
                Message::Text(t) => {
                    return serde_json::from_str(&t).map_err(|e| format!("ws-parse-error: {e}"));
                }
                Message::Close(_) => return Err("ws-closed: gateway closed connection".into()),
                Message::Ping(_) => continue,
                _ => continue,
            }
        }
    }

    /// After sending an `agent` request, collect the full response.
    ///
    /// OpenClaw response sequence:
    ///   1. Ack:    `{type:"res", ok:true, payload:{runId, status:"accepted"}}`
    ///   2. Events: `{type:"event", event:"agent", payload:{text:...}}`
    ///   3. Final:  `{type:"res", ok:true, payload:{status:"completed", summary:{text:...}}}`
    ///
    /// `on_delta` is called for each streaming text fragment as it arrives.
    async fn collect_agent_response<F>(
        ws: &mut WsStream,
        req_id: &str,
        on_delta: &F,
    ) -> Result<WsChatResponse, String>
    where
        F: Fn(&str) + Send,
    {
        let mut deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_calls: Vec<serde_json::Value> = Vec::new();
        #[allow(unused_assignments)]
        let mut tokens_used: Option<u64> = None;

        loop {
            let msg = tokio::time::timeout_at(deadline, ws.next())
                .await
                .map_err(|_| "ws-timeout: no activity for 120s".to_string())?
                .ok_or_else(|| "ws-closed: connection closed by gateway".to_string())?
                .map_err(|e| format!("ws-recv-error: {e}"))?;

            let text = match msg {
                Message::Text(t) => t,
                Message::Close(_) => return Err("ws-closed: gateway closed connection".into()),
                Message::Ping(_) => continue,
                _ => continue,
            };

            // Reset idle timeout on every valid frame
            deadline = tokio::time::Instant::now() + Duration::from_secs(120);

            let frame: serde_json::Value = match serde_json::from_str(&text) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let frame_type = frame.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match frame_type {
                // ── Standard OpenClaw response ──────────────────────────
                "res" => {
                    let fid = frame.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if fid != req_id {
                        continue;
                    }

                    let ok = frame.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !ok {
                        let err = frame
                            .pointer("/error/message")
                            .or_else(|| frame.get("error"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown error");
                        return Err(format!("ws-gateway-error: {err}"));
                    }

                    let payload = frame.get("payload").cloned().unwrap_or_default();
                    let status = payload.get("status").and_then(|v| v.as_str()).unwrap_or("");

                    if status == "accepted" {
                        continue;
                    }

                    // Final response (completed / ok / error)
                    if status == "completed" || status == "ok" || status == "error" {
                        // If streaming already collected text, prefer that
                        let had_streaming_text = !text_parts.is_empty();

                        if !had_streaming_text {
                            for path in &["/summary/text", "/result/text"] {
                                if let Some(t) = payload
                                    .pointer(path)
                                    .and_then(|v| v.as_str())
                                    .filter(|s| !s.is_empty())
                                {
                                    on_delta(t);
                                    text_parts.push(t.to_string());
                                    break;
                                }
                            }
                            if let Some(payloads) =
                                payload.get("payloads").and_then(|v| v.as_array())
                            {
                                for p in payloads {
                                    if let Some(t) = p.get("text").and_then(|v| v.as_str()) {
                                        on_delta(t);
                                        text_parts.push(t.to_string());
                                    }
                                }
                            }
                        }

                        tokens_used = payload
                            .pointer("/summary/tokensUsed")
                            .or_else(|| payload.get("tokensUsed"))
                            .and_then(|v| v.as_u64());

                        if status == "error" && text_parts.is_empty() {
                            let msg = payload
                                .pointer("/summary/error")
                                .or_else(|| payload.pointer("/result/error"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("agent error");
                            return Err(format!("ws-gateway-error: {msg}"));
                        }

                        break;
                    }

                    if let Some(t) = payload.get("text").and_then(|v| v.as_str()) {
                        on_delta(t);
                        text_parts.push(t.to_string());
                        tokens_used = payload.get("tokens_used").and_then(|v| v.as_u64());
                        break;
                    }
                }

                // ── Streaming events ────────────────────────────────────
                "event" => {
                    let event_name = frame.get("event").and_then(|v| v.as_str()).unwrap_or("");
                    match event_name {
                        "agent" => {
                            let payload = frame.get("payload").cloned().unwrap_or_default();
                            let stream =
                                payload.get("stream").and_then(|v| v.as_str()).unwrap_or("");

                            if stream == "assistant" {
                                if let Some(delta) = payload
                                    .pointer("/data/delta")
                                    .and_then(|v| v.as_str())
                                    .filter(|s| !s.is_empty())
                                {
                                    on_delta(delta);
                                    text_parts.push(delta.to_string());
                                }
                            } else if let Some(delta) = payload
                                .get("text")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                            {
                                on_delta(delta);
                                text_parts.push(delta.to_string());
                            }
                        }
                        "tool_call" | "tool_result" => {
                            if let Some(p) = frame.get("payload") {
                                tool_calls.push(p.clone());
                            }
                        }
                        // Ignore system heartbeat / presence / tick
                        _ => {}
                    }
                }

                // ── Legacy framing compatibility ────────────────────────
                "response" => {
                    let fid = frame.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if fid != req_id {
                        continue;
                    }
                    let payload = frame.get("payload").cloned().unwrap_or_default();
                    if let Some(t) = payload.get("text").and_then(|v| v.as_str()) {
                        on_delta(t);
                        text_parts.push(t.to_string());
                    }
                    tokens_used = payload.get("tokens_used").and_then(|v| v.as_u64());
                    break;
                }

                "error" => {
                    let payload = frame.get("payload").cloned().unwrap_or_default();
                    let code = payload
                        .get("code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("UNKNOWN");
                    let message = payload
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    return Err(format!("ws-gateway-error: [{code}] {message}"));
                }

                _ => {}
            }
        }

        let final_text = text_parts.join("");
        Ok(WsChatResponse {
            text: final_text,
            tokens_used,
            tool_calls,
        })
    }
}

// ── Convenience one-shot functions (backward-compatible API) ─────────────────

/// One-shot WS chat: connect → handshake → send → receive → disconnect.
///
/// For repeated calls, prefer creating an `OpenClawWs` instance and keeping
/// the persistent connection open.
pub async fn ws_chat(
    gateway_url: &str,
    message: &str,
    model: Option<&str>,
    session_key: Option<&str>,
) -> Result<WsChatResponse, String> {
    let client = OpenClawWs::new(gateway_url);
    client.connect().await?;
    let result = client.chat(message, model, session_key).await;
    client.disconnect().await;
    result
}

/// One-shot WS chat with full message history.
pub async fn ws_chat_full(
    gateway_url: &str,
    messages: &[serde_json::Value],
    model: Option<&str>,
    session_key: Option<&str>,
) -> Result<WsChatResponse, String> {
    let client = OpenClawWs::new(gateway_url);
    client.connect().await?;
    let result = client.chat_full(messages, model, session_key).await;
    client.disconnect().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_ws_url() {
        assert_eq!(to_ws_url("http://localhost:18789"), "ws://localhost:18789");
        assert_eq!(
            to_ws_url("https://example.com:443/"),
            "wss://example.com:443"
        );
        assert_eq!(to_ws_url("ws://already:18789"), "ws://already:18789");
        assert_eq!(to_ws_url("127.0.0.1:18789"), "ws://127.0.0.1:18789");
    }

    #[test]
    fn test_gen_id() {
        let id1 = gen_id();
        let id2 = gen_id();
        assert_ne!(id1, id2);
        assert!(id1.starts_with("clawno-"));
    }

    #[test]
    fn test_load_device_identity_returns_option() {
        // load_device_identity returns None in CI where ~/.openclaw doesn't exist
        let _ = load_device_identity();
    }
}
