/// Telegram and Discord bot background runners.
///
/// Both bots initiate **outbound** connections only — no public IP or webhook
/// is required.  They work even when the Windows Firewall is set to "local-only",
/// giving a higher security score than Feishu (which needs inbound webhooks).
///
/// Architecture:
///   - `BotManager`  — Tauri managed state; holds an `AtomicBool` stop-flag per bot.
///   - `telegram_poll_loop` — long-polls the Telegram Bot API every 25 s.
///   - `discord_gateway_loop` — connects to Discord's WSS gateway, handles
///     heartbeating, identifies with privileged intents, routes messages to the
///     local AI gateway, and posts replies via the REST API.

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use crate::secure_store::STORE_FILE;

// ── Bot Manager (Tauri managed state) ─────────────────────────────────────────

/// Holds one stop-flag per named bot ("telegram" / "discord").
/// Thread-safe — can be shared across Tauri command invocations.
pub struct BotManager {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl BotManager {
    pub fn new() -> Self {
        BotManager { running: Mutex::new(HashMap::new()) }
    }

    /// Create a new running-flag for `name`, stopping any previously running instance.
    pub fn start_flag(&self, name: &str) -> Arc<AtomicBool> {
        let mut map = self.running.lock().unwrap();
        if let Some(old) = map.get(name) {
            old.store(false, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(true));
        map.insert(name.to_string(), Arc::clone(&flag));
        flag
    }

    pub fn stop(&self, name: &str) {
        if let Ok(map) = self.running.lock() {
            if let Some(flag) = map.get(name) {
                flag.store(false, Ordering::Relaxed);
            }
        }
    }

    pub fn is_running(&self, name: &str) -> bool {
        self.running.lock()
            .map(|m| m.get(name).map(|f| f.load(Ordering::Relaxed)).unwrap_or(false))
            .unwrap_or(false)
    }
}

// ── Shared: call local AI gateway ─────────────────────────────────────────────

/// Forward a user message to the locally running OpenClaw gateway and return
/// the AI reply as plain text.
async fn call_ai_gateway(port: u16, text: &str) -> String {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    else {
        return "AI 客户端初始化失败".into();
    };

    let body = serde_json::json!({
        "model": "default",
        "messages": [{"role": "user", "content": text}],
        "stream": false,
        "max_tokens": 2000,
    });

    match client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j["choices"][0]["message"]["content"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "AI 暂时无法响应，请稍后重试。".into()),
        Err(e) => format!("无法连接到本地 AI 网关（端口 {port}）：{e}"),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TELEGRAM
// ═════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramBotInfo {
    pub id: i64,
    pub username: String,
    pub first_name: String,
}

/// Call getMe to validate the token and retrieve basic bot info.
async fn telegram_get_me(token: &str) -> Result<TelegramBotInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.telegram.org/bot{token}/getMe");
    let resp = client.get(&url).send().await.map_err(|e| format!("网络错误：{e}"))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if !json["ok"].as_bool().unwrap_or(false) {
        return Err(json["description"].as_str().unwrap_or("Token 无效").to_string());
    }
    let r = &json["result"];
    Ok(TelegramBotInfo {
        id:         r["id"].as_i64().unwrap_or(0),
        username:   r["username"].as_str().unwrap_or("").to_string(),
        first_name: r["first_name"].as_str().unwrap_or("").to_string(),
    })
}

/// Long-polling loop: getUpdates (25 s timeout) → call AI → sendMessage.
async fn telegram_poll_loop(token: String, port: u16, stop: Arc<AtomicBool>) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(35))
        .build()
    else { return };

    let mut offset = 0i64;

    while stop.load(Ordering::Relaxed) {
        let url = format!(
            "https://api.telegram.org/bot{token}/getUpdates\
             ?offset={offset}&timeout=25&allowed_updates=[\"message\"]"
        );

        let json: serde_json::Value = match client.get(&url).send().await {
            Ok(r) => match r.json().await {
                Ok(j) => j,
                Err(_) => { tokio::time::sleep(std::time::Duration::from_secs(1)).await; continue; }
            },
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        let Some(updates) = json["result"].as_array() else { continue };

        for update in updates {
            let update_id = update["update_id"].as_i64().unwrap_or(0);
            offset = update_id + 1;
            if !stop.load(Ordering::Relaxed) { return; }

            let Some(text) = update["message"]["text"].as_str() else { continue };
            let chat_id = update["message"]["chat"]["id"].as_i64().unwrap_or(0);

            // Greet on /start — don't pass to AI.
            let out_text = if text == "/start" || text == "/help" {
                "👋 我是您的专属 AI 助手。直接发送消息即可与我对话！".to_string()
            } else {
                call_ai_gateway(port, text).await
            };

            let send_url = format!("https://api.telegram.org/bot{token}/sendMessage");
            let _ = client
                .post(&send_url)
                .json(&serde_json::json!({ "chat_id": chat_id, "text": out_text }))
                .send()
                .await;
        }
    }
}

// ── Telegram Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_telegram_config(token: String) -> Result<TelegramBotInfo, String> {
    telegram_get_me(&token).await
}

#[tauri::command]
pub fn save_telegram_config(app: tauri::AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() { return Err("Token 不能为空".into()); }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("telegram_token", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_telegram_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get("telegram_token").and_then(|v| v.as_str().map(str::to_owned)))
}

#[tauri::command]
pub fn start_telegram_bot(
    app: tauri::AppHandle,
    port: u16,
    state: tauri::State<'_, BotManager>,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let token = store
        .get("telegram_token")
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or("请先保存 Telegram Bot Token")?;

    let flag = state.start_flag("telegram");
    tokio::spawn(async move {
        telegram_poll_loop(token, port, flag).await;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_telegram_bot(state: tauri::State<'_, BotManager>) {
    state.stop("telegram");
}

#[tauri::command]
pub fn get_telegram_bot_status(state: tauri::State<'_, BotManager>) -> bool {
    state.is_running("telegram")
}

// ═════════════════════════════════════════════════════════════════════════════
//  DISCORD
// ═════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordBotInfo {
    pub id:            String,
    pub username:      String,
    pub discriminator: String,
}

/// Call /users/@me to validate the bot token and get bot info.
async fn discord_get_me(token: &str) -> Result<DiscordBotInfo, String> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else { return Err("HTTP 客户端初始化失败".into()); };

    let resp = client
        .get("https://discord.com/api/v10/users/@me")
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| format!("网络错误：{e}"))?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(msg) = json["message"].as_str() {
        return Err(format!("Discord API 错误：{msg}"));
    }
    if json["id"].is_null() {
        return Err("Token 无效或未启用 Bot 功能".into());
    }

    Ok(DiscordBotInfo {
        id:            json["id"].as_str().unwrap_or("").to_string(),
        username:      json["username"].as_str().unwrap_or("").to_string(),
        discriminator: json["discriminator"].as_str().unwrap_or("0").to_string(),
    })
}

/// Discord Gateway WebSocket loop.
///
/// Intents used:
///   GUILD_MESSAGES   (1 << 9  = 512)
///   DIRECT_MESSAGES  (1 << 12 = 4096)
///   MESSAGE_CONTENT  (1 << 15 = 32768)  ← requires privileged intent in dev portal
///
/// The bot responds to:
///   • Any message in a DM channel
///   • Messages where the bot is @mentioned in a guild channel
///
/// Auto-reconnects on disconnect.
async fn discord_gateway_loop(token: String, port: u16, stop: Arc<AtomicBool>) {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;
    use futures_util::{SinkExt, StreamExt};

    // Resolve our own bot ID so we can skip self-messages.
    let bot_id = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        discord_get_me(&token),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|i| i.id)
    .unwrap_or_default();

    'reconnect: loop {
        if !stop.load(Ordering::Relaxed) { break; }

        // Fetch the recommended gateway URL.
        let gw_url = match reqwest::get("https://discord.com/api/v10/gateway").await {
            Ok(r) => r.json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|j| j["url"].as_str().map(str::to_owned))
                .unwrap_or_else(|| "wss://gateway.discord.gg".to_string()),
            Err(_) => "wss://gateway.discord.gg".to_string(),
        };
        let url = format!("{gw_url}/?v=10&encoding=json");

        let (mut ws, _) = match connect_async(&url).await {
            Ok(v) => v,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let mut hb_interval = tokio::time::interval(std::time::Duration::from_secs(45));
        let mut sequence: Option<i64> = None;
        let mut identified = false;

        loop {
            if !stop.load(Ordering::Relaxed) { break 'reconnect; }

            tokio::select! {
                _ = hb_interval.tick() => {
                    let hb = serde_json::json!({ "op": 1, "d": sequence });
                    if ws.send(Message::Text(hb.to_string())).await.is_err() {
                        continue 'reconnect;
                    }
                }

                msg = ws.next() => {
                    let msg = match msg {
                        Some(Ok(m)) => m,
                        _ => {
                            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                            continue 'reconnect;
                        }
                    };

                    let text = match msg {
                        Message::Text(t) => t,
                        Message::Close(_) => { continue 'reconnect; }
                        _ => continue,
                    };

                    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
                    let op = payload["op"].as_i64().unwrap_or(-1);

                    match op {
                        // HELLO — set heartbeat interval and IDENTIFY
                        10 => {
                            if let Some(ms) = payload["d"]["heartbeat_interval"].as_u64() {
                                hb_interval = tokio::time::interval(
                                    std::time::Duration::from_millis(ms)
                                );
                            }
                            if !identified {
                                identified = true;
                                let identify = serde_json::json!({
                                    "op": 2,
                                    "d": {
                                        "token": token,
                                        "intents": 512 | 4096 | 32768,
                                        "properties": {
                                            "os": "windows",
                                            "browser": "clawno11",
                                            "device": "clawno11"
                                        }
                                    }
                                });
                                if ws.send(Message::Text(identify.to_string())).await.is_err() {
                                    continue 'reconnect;
                                }
                            }
                        }

                        // HEARTBEAT ACK — no action needed
                        11 => {}

                        // DISPATCH
                        0 => {
                            sequence = payload["s"].as_i64();
                            let event = payload["t"].as_str().unwrap_or("");

                            if event == "MESSAGE_CREATE" {
                                let d = &payload["d"];

                                // Skip self and other bots
                                let author_id = d["author"]["id"].as_str().unwrap_or("");
                                if author_id == bot_id { continue; }
                                if d["author"]["bot"].as_bool().unwrap_or(false) { continue; }

                                let content = d["content"].as_str().unwrap_or("").to_string();
                                let channel_id = d["channel_id"].as_str().unwrap_or("").to_string();
                                if content.is_empty() { continue; }

                                // Respond to DMs unconditionally; in guilds, require @mention.
                                let is_dm     = d["guild_id"].is_null();
                                let is_mention = content.contains(&format!("<@{bot_id}>"))
                                             || content.contains(&format!("<@!{bot_id}>"));
                                if !is_dm && !is_mention { continue; }

                                // Strip the @mention prefix before forwarding.
                                let query = content
                                    .replace(&format!("<@{bot_id}>"), "")
                                    .replace(&format!("<@!{bot_id}>"), "")
                                    .trim()
                                    .to_string();
                                if query.is_empty() { continue; }

                                let tok = token.clone();
                                let ch  = channel_id.clone();
                                tokio::spawn(async move {
                                    let reply = call_ai_gateway(port, &query).await;
                                    // Discord has a 2000-char message limit; truncate if needed.
                                    let reply = if reply.len() > 1980 {
                                        format!("{}…", &reply[..1977])
                                    } else {
                                        reply
                                    };
                                    let _ = reqwest::Client::new()
                                        .post(format!("https://discord.com/api/v10/channels/{ch}/messages"))
                                        .header("Authorization", format!("Bot {tok}"))
                                        .json(&serde_json::json!({ "content": reply }))
                                        .send()
                                        .await;
                                });
                            }
                        }

                        // RECONNECT — server requests reconnect
                        7 => { continue 'reconnect; }

                        // INVALID SESSION — wait a bit then re-identify
                        9 => {
                            identified = false;
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        }

                        _ => {}
                    }
                }
            }
        }
    }
}

// ── Discord Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_discord_config(token: String) -> Result<DiscordBotInfo, String> {
    discord_get_me(&token).await
}

#[tauri::command]
pub fn save_discord_config(app: tauri::AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() { return Err("Token 不能为空".into()); }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("discord_token", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_discord_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get("discord_token").and_then(|v| v.as_str().map(str::to_owned)))
}

#[tauri::command]
pub fn start_discord_bot(
    app: tauri::AppHandle,
    port: u16,
    state: tauri::State<'_, BotManager>,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let token = store
        .get("discord_token")
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or("请先保存 Discord Bot Token")?;

    let flag = state.start_flag("discord");
    tokio::spawn(async move {
        discord_gateway_loop(token, port, flag).await;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_discord_bot(state: tauri::State<'_, BotManager>) {
    state.stop("discord");
}

#[tauri::command]
pub fn get_discord_bot_status(state: tauri::State<'_, BotManager>) -> bool {
    state.is_running("discord")
}
