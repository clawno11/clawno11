use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

use super::call_ai_gateway;
use super::BotManager;
use crate::secure_store::STORE_FILE;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordBotInfo {
    pub id: String,
    pub username: String,
    pub discriminator: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Call /users/@me to validate the bot token and get bot info.
async fn discord_get_me(token: &str) -> Result<DiscordBotInfo, String> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else {
        return Err("HTTP 客户端初始化失败".into());
    };

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
        id: json["id"].as_str().unwrap_or("").to_string(),
        username: json["username"].as_str().unwrap_or("").to_string(),
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
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let bot_id = tokio::time::timeout(std::time::Duration::from_secs(10), discord_get_me(&token))
        .await
        .ok()
        .and_then(|r| r.ok())
        .map(|i| i.id)
        .unwrap_or_default();

    'reconnect: loop {
        if !stop.load(Ordering::Relaxed) {
            break;
        }

        let gw_url = match reqwest::get("https://discord.com/api/v10/gateway").await {
            Ok(r) => r
                .json::<serde_json::Value>()
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
            if !stop.load(Ordering::Relaxed) {
                break 'reconnect;
            }

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

                        11 => {}

                        0 => {
                            sequence = payload["s"].as_i64();
                            let event = payload["t"].as_str().unwrap_or("");

                            if event == "MESSAGE_CREATE" {
                                let d = &payload["d"];

                                let author_id = d["author"]["id"].as_str().unwrap_or("");
                                if author_id == bot_id { continue; }
                                if d["author"]["bot"].as_bool().unwrap_or(false) { continue; }

                                let content = d["content"].as_str().unwrap_or("").to_string();
                                let channel_id = d["channel_id"].as_str().unwrap_or("").to_string();
                                if content.is_empty() { continue; }

                                let is_dm     = d["guild_id"].is_null();
                                let is_mention = content.contains(&format!("<@{bot_id}>"))
                                             || content.contains(&format!("<@!{bot_id}>"));
                                if !is_dm && !is_mention { continue; }

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
                                    let reply = if reply.len() > 1980 {
                                        let truncated: String = reply.chars().take(1977).collect();
                                        format!("{truncated}…")
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

                        7 => { continue 'reconnect; }

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

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_discord_config(token: String) -> Result<DiscordBotInfo, String> {
    discord_get_me(&token).await
}

#[tauri::command]
pub fn save_discord_config(app: tauri::AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Token 不能为空".into());
    }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("discord_token", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_discord_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get("discord_token")
        .and_then(|v| v.as_str().map(str::to_owned)))
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
