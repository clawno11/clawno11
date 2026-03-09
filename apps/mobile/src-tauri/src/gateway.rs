/**
 * Gateway health probing and model info — HTTP-based (no subprocess).
 *
 * Mobile connects to remote openclaw instances. All detection is done
 * via HTTP requests to the gateway's REST API.
 */
use crate::types::ProbeResult;

/// Probe an instance gateway at the given URL and return health status + latency.
#[tauri::command]
pub async fn probe_instance_health(gateway_url: String) -> Result<ProbeResult, String> {
    let url = format!("{}/health", gateway_url.trim_end_matches('/'));
    let start = std::time::Instant::now();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

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

/// Fetch the active model name from the gateway's /agents endpoint.
#[tauri::command]
pub async fn get_main_agent_model(gateway_url: String) -> Result<Option<String>, String> {
    let url = format!("{}/agents", gateway_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Try to extract model from agents array
    if let Some(agents) = json.as_array() {
        for agent in agents {
            if let Some(name) = agent.get("name").and_then(|n| n.as_str()) {
                if name == "main" {
                    if let Some(model) = agent
                        .get("config")
                        .and_then(|c| c.get("model"))
                        .and_then(|m| m.as_str())
                    {
                        return Ok(Some(model.to_string()));
                    }
                }
            }
        }
        // If no "main" agent found, return first agent's model
        if let Some(first) = agents.first() {
            if let Some(model) = first
                .get("config")
                .and_then(|c| c.get("model"))
                .and_then(|m| m.as_str())
            {
                return Ok(Some(model.to_string()));
            }
        }
    }

    Ok(None)
}

/// Read a text file by absolute path (for RAG ingestion via file picker).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    use std::path::Path;

    let p = Path::new(&path);

    // Whitelist of safe extensions
    let allowed = [
        "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml",
        "html", "htm", "xml", "rs", "py", "js", "ts", "go", "java",
        "c", "cpp", "h", "hpp", "sh", "toml", "ini", "conf", "log",
    ];

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !allowed.contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型: .{}", ext));
    }

    // 移动端限制 5 MiB，防止 OOM（iOS/Android WebView 内存更紧张）
    const MAX_BYTES: u64 = 5 * 1024 * 1024;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "文件过大（{:.1} MiB），最大支持 5 MiB",
            meta.len() as f64 / 1024.0 / 1024.0
        ));
    }

    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
