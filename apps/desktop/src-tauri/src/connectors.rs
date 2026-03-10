/// IM connector helpers — Feishu/Lark and Tailscale integration.
///
/// ## Adding a new connector
///
/// 1. Create a named struct (e.g. `struct FeishuConnector`) and implement the
///    `Connector` trait for it (`test` + `save` + `status`).
/// 2. Expose the three methods as `#[tauri::command]` wrapper functions.
/// 3. Register them in `lib.rs → invoke_handler!`.
/// 4. Add a frontend panel in `ConnectorsPage.tsx`.
/// 5. Update `ipc.ts` with the new typed wrapper functions.

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use crate::secure_store::STORE_FILE;

// ── Connector design contract ─────────────────────────────────────────────────

/// Every connector must implement:
///   • `test`  — validate credentials against the external service
///   • `save`  — persist credentials to the encrypted store
///   • `status`— query the current connection state (installed / running / …)
///
/// Note: the trait is not object-safe (async test method), so each connector
/// is a concrete type — the trait is enforced at compile time via `impl`.
pub trait Connector {
    type Config;
    type TestResult: serde::Serialize;
    type Status: serde::Serialize;

    fn test(config: &Self::Config) -> impl std::future::Future<Output = Result<Self::TestResult, String>> + Send;
    fn save(app: &tauri::AppHandle, config: Self::Config) -> Result<String, String>;
    fn status() -> impl std::future::Future<Output = Self::Status> + Send;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/// Credentials for a Feishu self-built app.
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeishuTestResult {
    pub ok: bool,
    pub msg: String,
    /// Missing required scopes detected during validation (empty when all scopes are present).
    /// Populated by calling the bot-send API after token acquisition; empty on auth failure.
    pub missing_scopes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TailscaleStatus {
    pub installed: bool,
    pub running: bool,
    pub ip: Option<String>,
    pub version: Option<String>,
}

// ── Feishu Connector ──────────────────────────────────────────────────────────

pub struct FeishuConnector;

impl Connector for FeishuConnector {
    type Config = FeishuConfig;
    type TestResult = FeishuTestResult;
    type Status = ();

    async fn test(config: &FeishuConfig) -> Result<FeishuTestResult, String> {
        feishu_test_impl(&config.app_id, &config.app_secret).await
    }

    fn save(app: &tauri::AppHandle, config: FeishuConfig) -> Result<String, String> {
        feishu_save_impl(app, config.app_id, config.app_secret)
    }

    async fn status() -> () {}
}

/// Core Feishu test logic — shared by the `Connector` impl and the Tauri command.
async fn feishu_test_impl(app_id: &str, app_secret: &str) -> Result<FeishuTestResult, String> {
    // Basic format guard: Feishu App IDs always start with "cli_"
    if !app_id.starts_with("cli_") || app_id.len() < 8 {
        return Ok(FeishuTestResult {
            ok: false,
            msg: "App ID 格式错误，应以 \"cli_\" 开头（例：cli_xxxxxxxxx）".into(),
            missing_scopes: vec![],
        });
    }
    if app_secret.trim().is_empty() {
        return Ok(FeishuTestResult {
            ok: false,
            msg: "App Secret 不能为空".into(),
            missing_scopes: vec![],
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let body = serde_json::json!({
        "app_id": app_id,
        "app_secret": app_secret,
    });

    let resp = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("网络请求失败，请检查网络连接：{e}"))?;

    // Check HTTP-level status before attempting JSON parse
    let http_status = resp.status();
    if !http_status.is_success() {
        return Ok(FeishuTestResult {
            ok: false,
            msg: format!("飞书服务器返回 HTTP {}，请稍后重试", http_status.as_u16()),
            missing_scopes: vec![],
        });
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("响应解析失败：{e}"))?;

    let code = json["code"].as_i64().unwrap_or(-1);
    let msg = json["msg"].as_str().unwrap_or("unknown").to_string();

    match code {
        0 => {
            // Token acquired — now probe for required scope (im:message:send_as_bot).
            // We attempt a no-op bot message API call; a 99991401 response means the
            // scope is missing even though the credentials are valid.
            let token = json["tenant_access_token"].as_str().unwrap_or("").to_string();
            let missing = probe_missing_scopes(&client, &token).await;
            if missing.is_empty() {
                Ok(FeishuTestResult {
                    ok: true,
                    msg: "连接成功！App ID、App Secret 及消息权限均验证通过。".into(),
                    missing_scopes: vec![],
                })
            } else {
                Ok(FeishuTestResult {
                    ok: false,
                    msg: format!(
                        "凭据有效，但缺少必要权限：{}。请在飞书开放平台「权限管理」中开启。",
                        missing.join(", ")
                    ),
                    missing_scopes: missing,
                })
            }
        }
        10003 => Ok(FeishuTestResult {
            ok: false,
            msg: format!("App ID 不存在或格式错误：{msg}"),
            missing_scopes: vec![],
        }),
        10014 => Ok(FeishuTestResult {
            ok: false,
            msg: format!("App Secret 错误，请重新复制正确的 Secret：{msg}"),
            missing_scopes: vec![],
        }),
        99991663 => Ok(FeishuTestResult {
            ok: false,
            msg: "应用未发布或未在飞书工作台启用，请先在飞书开放平台发布应用版本。".into(),
            missing_scopes: vec![],
        }),
        _ => Ok(FeishuTestResult {
            ok: false,
            msg: format!("飞书 API 返回未知错误（code={code}）：{msg}"),
            missing_scopes: vec![],
        }),
    }
}

/// Probe whether the tenant token has `im:message:send_as_bot` scope by calling
/// the message send endpoint with a clearly invalid chat_id. A 99991401 response
/// means "no permission"; any other response (including chat-not-found errors)
/// means the scope is present.
///
/// Uses a dedicated 5-second timeout so the probe does not double the overall
/// latency when the Feishu API is slow.
async fn probe_missing_scopes(client: &reqwest::Client, token: &str) -> Vec<String> {
    if token.is_empty() {
        return vec![];
    }
    // Build a short-lived client for the probe to cap its timeout independently.
    let probe_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| client.clone());
    let probe = probe_client
        .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "receive_id": "__clawno_probe__",
            "msg_type": "text",
            "content": "{\"text\":\"probe\"}"
        }))
        .send()
        .await;

    match probe {
        Ok(r) => {
            if let Ok(j) = r.json::<serde_json::Value>().await {
                if j["code"].as_i64() == Some(99991401) {
                    return vec!["im:message:send_as_bot".into()];
                }
            }
            vec![]
        }
        Err(_) => vec![], // Network error during probe — don't block the happy path
    }
}

/// Core Feishu save logic — shared by the `Connector` impl and the Tauri command.
fn feishu_save_impl(app: &tauri::AppHandle, app_id: String, app_secret: String) -> Result<String, String> {
    if app_id.trim().is_empty() || app_secret.trim().is_empty() {
        return Err("App ID 和 App Secret 不能为空".into());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开加密存储失败：{e}"))?;
    store.set("feishu_app_id".to_string(), serde_json::Value::String(app_id));
    store.set("feishu_app_secret".to_string(), serde_json::Value::String(app_secret));
    store.save().map_err(|e| format!("保存飞书凭据失败：{e}"))?;
    Ok("飞书凭据已保存".to_string())
}

// ── Feishu Tauri commands ──────────────────────────────────────────────────────

/// Test a Feishu app credential by obtaining a tenant access token,
/// then probing for required IM scopes.
#[tauri::command]
pub async fn test_feishu_connection(
    app_id: String,
    app_secret: String,
) -> Result<FeishuTestResult, String> {
    feishu_test_impl(&app_id, &app_secret).await
}

/// Write Feishu credentials into the secure store after validating they are non-empty.
#[tauri::command]
pub fn save_feishu_config(
    app: tauri::AppHandle,
    app_id: String,
    app_secret: String,
) -> Result<String, String> {
    feishu_save_impl(&app, app_id, app_secret)
}

/// Read back the saved Feishu App ID so the UI can show "already configured".
/// Returns None if no credentials have been saved yet.
/// The App Secret is intentionally not returned — only the App ID is shown.
#[tauri::command]
pub fn get_feishu_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开加密存储失败：{e}"))?;
    Ok(store.get("feishu_app_id").and_then(|v| v.as_str().map(str::to_owned)))
}

// ── Tailscale Connector ───────────────────────────────────────────────────────

pub struct TailscaleConnector;

impl Connector for TailscaleConnector {
    type Config = ();
    type TestResult = TailscaleStatus;
    type Status = TailscaleStatus;

    async fn test(_config: &()) -> Result<TailscaleStatus, String> {
        tokio::task::spawn_blocking(tailscale_status_impl)
            .await
            .map_err(|e| e.to_string())
    }

    fn save(_app: &tauri::AppHandle, _config: ()) -> Result<String, String> {
        Ok(String::new()) // Tailscale needs no credentials stored
    }

    async fn status() -> TailscaleStatus {
        tokio::task::spawn_blocking(tailscale_status_impl)
            .await
            .unwrap_or(TailscaleStatus {
                installed: false,
                running: false,
                ip: None,
                version: None,
            })
    }
}

/// Core Tailscale detection logic — shared by the `Connector` impl and the Tauri command.
fn tailscale_status_impl() -> TailscaleStatus {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let run = |args: &[&str]| -> Option<String> {
        let mut c = Command::new("tailscale");
        c.args(args);
        #[cfg(target_os = "windows")]
        c.creation_flags(CREATE_NO_WINDOW);
        c.output().ok().and_then(|o| {
            // Treat non-zero exit code as "no output" — e.g. tailscale ip -4 exits 1 when not running
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            } else {
                None
            }
        })
    };

    // Check if tailscale binary exists
    let version_raw = run(&["version"]);
    if version_raw.is_none() {
        return TailscaleStatus {
            installed: false,
            running: false,
            ip: None,
            version: None,
        };
    }

    // Try IPv4 first, fall back to IPv6
    let ip_v4 = run(&["ip", "-4"])
        .filter(|s| s.parse::<std::net::Ipv4Addr>().is_ok());
    let ip_v6 = if ip_v4.is_none() {
        run(&["ip", "-6"])
            .filter(|s| s.parse::<std::net::Ipv6Addr>().is_ok())
    } else {
        None
    };
    let ip = ip_v4.or(ip_v6);
    let running = ip.is_some();

    TailscaleStatus {
        installed: true,
        running,
        ip,
        version: version_raw.map(|v| v.lines().next().unwrap_or("").to_string()),
    }
}

/// Detect Tailscale installation status and current IP on this machine.
#[tauri::command]
pub async fn get_tailscale_status() -> TailscaleStatus {
    // Run the blocking process check on a dedicated thread to avoid starving
    // the async runtime.
    tokio::task::spawn_blocking(tailscale_status_impl)
        .await
        .unwrap_or(TailscaleStatus {
            installed: false,
            running: false,
            ip: None,
            version: None,
        })
}
