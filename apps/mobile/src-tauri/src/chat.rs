/**
 * Mobile chat streaming via direct HTTP SSE to the openclaw gateway.
 *
 * Unlike desktop (which spawns `openclaw agent --json`), mobile makes
 * a direct HTTP POST to the gateway's /v1/chat/completions endpoint with
 * stream=true, parses SSE chunks, and emits Tauri events to the frontend.
 */
use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    gateway_url: String,
    messages: Vec<Value>,
    req_id: String,
    model: Option<String>,
    auth_token: Option<String>,
) -> Result<(), String> {
    let url = format!(
        "{}/v1/chat/completions",
        gateway_url.trim_end_matches('/')
    );

    let model_field = model.unwrap_or_else(|| "main".to_string());
    let body = serde_json::json!({
        "model": model_field,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);

    if let Some(ref token) = auth_token {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
    }

    let response = match request.send().await
    {
        Ok(r) => r,
        Err(e) => {
            let err = format!("连接网关失败: {}", e);
            let _ = app.emit(
                "chat-done",
                serde_json::json!({"req_id": req_id, "error": err}),
            );
            return Ok(());
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let err_body = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect::<String>();
        let err = format!("网关返回错误 {}: {}", status, err_body);
        let _ = app.emit(
            "chat-done",
            serde_json::json!({"req_id": req_id, "error": err}),
        );
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let _ = app.emit(
                    "chat-done",
                    serde_json::json!({"req_id": req_id, "error": e.to_string()}),
                );
                return Ok(());
            }
        };

        buf.push_str(&String::from_utf8_lossy(&bytes));

        // Process all complete SSE lines in the buffer
        loop {
            if let Some(pos) = buf.find('\n') {
                let line = buf[..pos].trim().to_string();
                buf.drain(..=pos);

                if line.starts_with("data: ") {
                    let data = &line["data: ".len()..];

                    if data == "[DONE]" {
                        let _ = app.emit(
                            "chat-done",
                            serde_json::json!({"req_id": req_id, "error": null}),
                        );
                        return Ok(());
                    }

                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                        // OpenAI SSE format: choices[0].delta.content
                        if let Some(delta) = v
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            if !delta.is_empty() {
                                let _ = app.emit(
                                    "chat-chunk",
                                    serde_json::json!({"req_id": req_id, "delta": delta}),
                                );
                            }
                        }
                    }
                }
            } else {
                break;
            }
        }
    }

    // Stream ended without [DONE] token
    let _ = app.emit(
        "chat-done",
        serde_json::json!({"req_id": req_id, "error": null}),
    );
    Ok(())
}
