/// WeChat (微信) OpenClaw channel plugin — install, status, QR-code login.
///
/// clawno11 acts as a thin UI layer: buttons trigger OpenClaw / plugin CLI
/// commands, and the QR code output is captured for display. All installation
/// logic, module resolution, and channel management is handled natively by
/// OpenClaw and the `@tencent-weixin/openclaw-weixin` plugin.
use clawno_core::types::StepResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CHANNEL_ID: &str = "openclaw-weixin";

/// Known upstream error patterns and their user-friendly messages.
fn friendly_diagnosis(raw: &str) -> Option<&'static str> {
    if raw.contains("Cannot find module 'openclaw/plugin-sdk'")
        || raw.contains("Cannot find module \"openclaw/plugin-sdk\"")
    {
        return Some(
            "微信插件版本暂不兼容当前 OpenClaw，请等待插件更新。\n\
             （错误详情：plugin-sdk 模块路径不兼容）",
        );
    }
    if raw.contains("is not a function") && raw.contains("plugin-sdk") {
        return Some(
            "微信插件版本暂不兼容当前 OpenClaw，请等待插件更新。\n\
             （错误详情：plugin-sdk 接口不兼容）",
        );
    }
    None
}

fn shell_cmd(cmd: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", cmd])
            .env("PATH", crate::platform::augmented_path())
            .creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", cmd])
            .env("PATH", crate::platform::augmented_path());
        c
    }
}

/// Check whether the WeChat channel plugin is installed and not in error state.
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
        let is_weixin = id == CHANNEL_ID || id.contains("weixin") || id.contains("wechat");
        if !is_weixin {
            return false;
        }
        let status = p["status"].as_str().unwrap_or("");
        status != "error"
    })
}

/// Install the WeChat channel plugin via the official Tencent CLI installer.
///
/// Uses `npx @tencent-weixin/openclaw-weixin-cli@latest install` which handles
/// plugin download, dependency setup, and gateway configuration natively.
#[tauri::command]
pub async fn install_weixin_plugin() -> StepResult {
    tokio::task::spawn_blocking(|| {
        let cmd = "npx -y @tencent-weixin/openclaw-weixin-cli@latest install 2>&1";
        match shell_cmd(cmd).output() {
            Ok(o) => {
                let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                let combined = format!("{out}\n{err}");

                let files_ok = combined.contains("插件就绪")
                    || combined.contains("already at")
                    || combined.contains("Installed plugin")
                    || combined.contains("Installing to");

                if let Some(hint) = friendly_diagnosis(&combined) {
                    if files_ok {
                        return StepResult {
                            ok: true,
                            detail: hint.to_string(),
                            fixes_applied: vec![],
                        };
                    }
                    return StepResult::err(hint.to_string());
                }

                if o.status.success() || files_ok {
                    StepResult::ok("微信插件安装成功".to_string())
                } else {
                    let msg = if err.is_empty() { out } else { err };
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
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")))
}

/// Restart the OpenClaw gateway so newly installed plugins are loaded.
///
/// Tries `openclaw gateway restart` first; falls back to `pm2 restart openclaw`
/// on platforms where the primary method is unsupported (e.g. Windows / SIGUSR1).
#[tauri::command]
pub async fn restart_weixin_gateway() -> StepResult {
    tokio::task::spawn_blocking(|| {
        let (ok, stdout, stderr) = crate::platform::shell_result("openclaw gateway restart");
        if ok {
            return StepResult::ok(if stdout.is_empty() { stderr } else { stdout });
        }
        let (ok2, stdout2, stderr2) = crate::platform::shell_result("pm2 restart openclaw");
        if ok2 {
            StepResult::ok(if stdout2.is_empty() {
                "网关已通过 pm2 重启".to_string()
            } else {
                stdout2
            })
        } else {
            StepResult::err(format!(
                "网关重启失败：{}",
                if stderr2.is_empty() { stderr } else { stderr2 }
            ))
        }
    })
    .await
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")))
}

/// Spawn `openclaw channels login`, capture the terminal QR block characters,
/// and return them for display. The child process keeps running in the
/// background — it waits for the user to scan, saves credentials, then exits.
#[tauri::command]
pub async fn get_weixin_qr_url() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        use std::io::BufRead;

        let cmd = format!("openclaw channels login --channel {CHANNEL_ID} 2>&1");
        let mut child = shell_cmd(&cmd)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法执行登录命令：{e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法读取命令输出".to_string())?;

        let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            let mut qr_lines: Vec<String> = Vec::new();
            let mut in_qr = false;
            let mut all_output = String::new();

            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        all_output.push_str(&l);
                        all_output.push('\n');
                        let has_block = l.contains('\u{2584}')
                            || l.contains('\u{2580}')
                            || l.contains('\u{2588}');
                        if has_block {
                            in_qr = true;
                            qr_lines.push(l);
                        } else if in_qr {
                            let _ = tx.send(Ok(qr_lines.join("\n")));
                            return;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("读取输出失败：{e}")));
                        return;
                    }
                }
            }
            if !qr_lines.is_empty() {
                let _ = tx.send(Ok(qr_lines.join("\n")));
            } else if let Some(hint) = friendly_diagnosis(&all_output) {
                let _ = tx.send(Err(hint.to_string()));
            } else {
                let _ = tx.send(Err("未检测到二维码输出，请确认插件已安装".to_string()));
            }
        });

        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(result) => result,
            Err(_) => {
                let _ = child.kill();
                Err("获取二维码超时，请确认 OpenClaw 网关已启动".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/// Check the WeChat channel connection status via the OpenClaw CLI.
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

    let out = crate::platform::shell_output("openclaw channels status --json 2>&1");
    if out.is_empty() {
        return WeixinChannelStatus {
            installed: true,
            connected: false,
            account_name: None,
        };
    }

    let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) else {
        return WeixinChannelStatus {
            installed: true,
            connected: false,
            account_name: None,
        };
    };

    if let Some(ch) = json.get("channels").and_then(|c| c.get(CHANNEL_ID)) {
        let connected = ch["connected"].as_bool().unwrap_or(false);
        let account_name = ch["accountName"]
            .as_str()
            .or_else(|| ch["name"].as_str())
            .map(str::to_string);
        return WeixinChannelStatus {
            installed: true,
            connected,
            account_name,
        };
    }

    let connected = json["connected"].as_bool().unwrap_or(false);
    let account_name = json["accountName"].as_str().map(str::to_string);
    WeixinChannelStatus {
        installed: true,
        connected,
        account_name,
    }
}
