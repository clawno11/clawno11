mod discord;
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
mod telegram;

pub use discord::*;
pub use telegram::*;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

// ── Bot Manager (Tauri managed state) ─────────────────────────────────────────

/// Holds one stop-flag per named bot ("telegram" / "discord").
/// Thread-safe — can be shared across Tauri command invocations.
pub struct BotManager {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for BotManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BotManager {
    pub fn new() -> Self {
        BotManager {
            running: Mutex::new(HashMap::new()),
        }
    }

    /// Create a new running-flag for `name`, stopping any previously running instance.
    pub fn start_flag(&self, name: &str) -> Arc<AtomicBool> {
        let mut map = self.running.lock().unwrap_or_else(|e| e.into_inner());
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
        self.running
            .lock()
            .map(|m| {
                m.get(name)
                    .map(|f| f.load(Ordering::Relaxed))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }
}

// ── Shared: call local AI gateway ─────────────────────────────────────────────

/// Forward a user message to the locally running OpenClaw gateway and return
/// the AI reply as plain text.
pub(crate) async fn call_ai_gateway(port: u16, text: &str) -> String {
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
            .and_then(|j| {
                j["choices"][0]["message"]["content"]
                    .as_str()
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "AI 暂时无法响应，请稍后重试。".into()),
        Err(e) => format!("无法连接到本地 AI 网关（端口 {port}）：{e}"),
    }
}
