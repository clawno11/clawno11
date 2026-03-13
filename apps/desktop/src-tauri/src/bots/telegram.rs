use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

use super::call_ai_gateway;
use super::BotManager;
use crate::secure_store::STORE_FILE;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramBotInfo {
    pub id: i64,
    pub username: String,
    pub first_name: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Call getMe to validate the token and retrieve basic bot info.
async fn telegram_get_me(token: &str) -> Result<TelegramBotInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.telegram.org/bot{token}/getMe");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("网络错误：{e}"))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if !json["ok"].as_bool().unwrap_or(false) {
        return Err(json["description"]
            .as_str()
            .unwrap_or("Token 无效")
            .to_string());
    }
    let r = &json["result"];
    Ok(TelegramBotInfo {
        id: r["id"].as_i64().unwrap_or(0),
        username: r["username"].as_str().unwrap_or("").to_string(),
        first_name: r["first_name"].as_str().unwrap_or("").to_string(),
    })
}

/// Long-polling loop: getUpdates (25 s timeout) → call AI → sendMessage.
async fn telegram_poll_loop(token: String, port: u16, stop: Arc<AtomicBool>) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(35))
        .build()
    else {
        return;
    };

    let mut offset = 0i64;

    while stop.load(Ordering::Relaxed) {
        let url = format!(
            "https://api.telegram.org/bot{token}/getUpdates\
             ?offset={offset}&timeout=25&allowed_updates=[\"message\"]"
        );

        let json: serde_json::Value = match client.get(&url).send().await {
            Ok(r) => match r.json().await {
                Ok(j) => j,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    continue;
                }
            },
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        let Some(updates) = json["result"].as_array() else {
            continue;
        };

        for update in updates {
            let update_id = update["update_id"].as_i64().unwrap_or(0);
            offset = update_id + 1;
            if !stop.load(Ordering::Relaxed) {
                return;
            }

            let Some(text) = update["message"]["text"].as_str() else {
                continue;
            };
            let chat_id = update["message"]["chat"]["id"].as_i64().unwrap_or(0);

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

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_telegram_config(token: String) -> Result<TelegramBotInfo, String> {
    telegram_get_me(&token).await
}

#[tauri::command]
pub fn save_telegram_config(app: tauri::AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Token 不能为空".into());
    }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("telegram_token", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_telegram_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get("telegram_token")
        .and_then(|v| v.as_str().map(str::to_owned)))
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
