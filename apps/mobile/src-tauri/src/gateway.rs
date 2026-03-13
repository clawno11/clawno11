/**
 * Gateway health probing, model info, and chat proxy bridge — HTTP-based.
 *
 * Mobile connects to remote openclaw instances. All detection is done
 * via HTTP requests from the Rust side (reqwest), which bypasses WebView
 * CORS / mixed-content restrictions that block browser-side fetch().
 */
use crate::types::ProbeResult;
use serde::Serialize;

const PROXY_PORT_START: u16 = 18800;
const PROXY_PORT_RANGE: u16 = 10;

fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

// ── Gateway probing ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn probe_instance_health(gateway_url: String) -> Result<ProbeResult, String> {
    let url = format!("{}/health", gateway_url.trim_end_matches('/'));
    let start = std::time::Instant::now();
    let client = http_client(8)?;

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() < 500 => {
            let latency = start.elapsed().as_millis() as u64;
            Ok(ProbeResult {
                online: true,
                latency_ms: latency,
            })
        }
        _ => Ok(ProbeResult {
            online: false,
            latency_ms: 0,
        }),
    }
}

#[tauri::command]
pub async fn get_main_agent_model(gateway_url: String) -> Result<Option<String>, String> {
    let url = format!("{}/agents", gateway_url.trim_end_matches('/'));
    let client = http_client(5)?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let agents: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(clawno_core::chat::parse_agents_model(&agents))
}

// ── Chat proxy discovery & bridge ────────────────────────────────────────

#[derive(Serialize)]
pub struct ProxyDiscovery {
    pub found: bool,
    pub proxy_url: String,
    pub token: String,
}

/// Scan ports 18800-18810 on the same host as the gateway to find the chat proxy.
/// Returns the proxy origin URL and the auth token (from the /health `ck` field).
#[tauri::command]
pub async fn discover_chat_proxy(gateway_url: String) -> Result<ProxyDiscovery, String> {
    let base = reqwest::Url::parse(gateway_url.trim_end_matches('/'))
        .map_err(|e| format!("invalid gateway URL: {e}"))?;
    let host = base.host_str().unwrap_or("127.0.0.1");
    let scheme = base.scheme();
    let client = http_client(2)?;

    for port in PROXY_PORT_START..(PROXY_PORT_START + PROXY_PORT_RANGE) {
        let origin = format!("{scheme}://{host}:{port}");
        let url = format!("{origin}/health");
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                let token = resp
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("ck").and_then(|c| c.as_str()).map(String::from))
                    .unwrap_or_default();
                return Ok(ProxyDiscovery {
                    found: true,
                    proxy_url: origin,
                    token,
                });
            }
        }
    }

    Ok(ProxyDiscovery {
        found: false,
        proxy_url: String::new(),
        token: String::new(),
    })
}

/// Fetch the list of configured AI providers from the desktop chat proxy.
#[tauri::command]
pub async fn proxy_fetch_providers(
    proxy_url: String,
    token: String,
) -> Result<Vec<String>, String> {
    let client = http_client(10)?;
    let resp = client
        .get(format!("{}/providers", proxy_url))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("providers fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let providers = json
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(providers)
}

#[derive(Serialize)]
pub struct ConfigureResult {
    pub ok: bool,
    pub detail: String,
}

/// Configure an API key on the desktop instance via the chat proxy.
#[tauri::command]
pub async fn proxy_configure_api_key(
    proxy_url: String,
    token: String,
    provider: String,
    api_key: String,
) -> Result<ConfigureResult, String> {
    let client = http_client(15)?;
    let body = serde_json::json!({ "provider": provider, "api_key": api_key });
    let resp = client
        .post(format!("{}/configure-api-key", proxy_url))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("configure failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(ConfigureResult {
            ok: false,
            detail: format!("HTTP {}", resp.status()),
        });
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(ConfigureResult {
        ok: json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        detail: json
            .get("detail")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}
