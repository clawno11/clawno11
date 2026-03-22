/// WeChat (微信) OpenClaw channel plugin — install, status, QR-code login.
///
/// Uses `npx @tencent-weixin/openclaw-weixin-cli` for plugin installation
/// and `openclaw` CLI for channel status / login flow.
use clawno_core::types::StepResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Check whether the WeChat channel plugin is already installed in OpenClaw.
/// Returns `true` if a plugin with id containing "weixin" or "wechat" is found.
#[tauri::command]
pub async fn check_weixin_plugin() -> bool {
    let out = crate::platform::shell_output("openclaw plugins list --json");
    if out.is_empty() {
        return false;
    }
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&out) else {
        return false;
    };
    let Some(arr) = root.get("plugins").and_then(|v| v.as_array()) else {
        return false;
    };
    arr.iter().any(|p| {
        let id = p["id"].as_str().unwrap_or("");
        let name = p["name"].as_str().unwrap_or("");
        id.contains("weixin")
            || id.contains("wechat")
            || name.contains("weixin")
            || name.contains("wechat")
    })
}

/// Install the WeChat channel plugin via the official CLI installer.
/// Runs: `npx -y @tencent-weixin/openclaw-weixin-cli@latest install`
#[tauri::command]
pub async fn install_weixin_plugin() -> StepResult {
    let result = tokio::task::spawn_blocking(|| {
        let cmd = "npx -y @tencent-weixin/openclaw-weixin-cli@latest install";

        #[cfg(target_os = "windows")]
        let output = {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", cmd])
                .env("PATH", crate::platform::augmented_path())
                .creation_flags(CREATE_NO_WINDOW);
            c.output()
        };
        #[cfg(not(target_os = "windows"))]
        let output = {
            let mut c = std::process::Command::new("sh");
            c.args(["-c", cmd])
                .env("PATH", crate::platform::augmented_path());
            c.output()
        };

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                if o.status.success() {
                    StepResult::ok(if stdout.is_empty() { stderr } else { stdout })
                } else {
                    let msg = if stderr.is_empty() { stdout } else { stderr };
                    StepResult::err(format!(
                        "安装失败（exit {}）：{}",
                        o.status.code().unwrap_or(-1),
                        msg
                    ))
                }
            }
            Err(e) => StepResult::err(format!("无法执行安装命令：{e}")),
        }
    })
    .await
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")));

    result
}

/// Restart the OpenClaw gateway so the newly installed plugin is loaded.
#[tauri::command]
pub async fn restart_weixin_gateway() -> StepResult {
    let result = tokio::task::spawn_blocking(|| {
        let (ok, stdout, stderr) = crate::platform::shell_result("openclaw gateway restart");
        if ok {
            StepResult::ok(if stdout.is_empty() { stderr } else { stdout })
        } else {
            StepResult::err(format!(
                "网关重启失败：{}",
                if stderr.is_empty() { stdout } else { stderr }
            ))
        }
    })
    .await
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")));

    result
}

/// Request the WeChat channel to generate a QR-code login URL.
/// Returns the QR code content string (URL) that can be rendered as a QR image.
/// The CLI command: `openclaw channels login --channel weixin --qr-only`
#[tauri::command]
pub async fn get_weixin_qr_url() -> Result<String, String> {
    let result = tokio::task::spawn_blocking(|| {
        let out = crate::platform::shell_output(
            "openclaw channels login --channel weixin --qr-only 2>&1",
        );
        if out.is_empty() {
            return Err("未获取到二维码数据，请确认 OpenClaw 和微信插件已正确安装".to_string());
        }
        // The CLI may output a URL or the full QR content; extract the URL.
        // Look for a line that starts with http
        for line in out.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                return Ok(trimmed.to_string());
            }
        }
        // If no URL found, return the raw output (might be the QR data itself)
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?;

    result
}

/// Check the WeChat channel connection status.
/// Returns a JSON-serializable status.
#[derive(serde::Serialize)]
pub struct WeixinChannelStatus {
    pub installed: bool,
    pub connected: bool,
    pub account_name: Option<String>,
}

#[tauri::command]
pub async fn get_weixin_channel_status() -> WeixinChannelStatus {
    let installed = check_weixin_plugin().await;
    if !installed {
        return WeixinChannelStatus {
            installed: false,
            connected: false,
            account_name: None,
        };
    }

    let out =
        crate::platform::shell_output("openclaw channels status --channel weixin --json 2>&1");
    if out.is_empty() {
        return WeixinChannelStatus {
            installed: true,
            connected: false,
            account_name: None,
        };
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) {
        let connected = json["connected"].as_bool().unwrap_or(false);
        let account_name = json["accountName"].as_str().map(str::to_string);
        WeixinChannelStatus {
            installed: true,
            connected,
            account_name,
        }
    } else {
        WeixinChannelStatus {
            installed: true,
            connected: false,
            account_name: None,
        }
    }
}
