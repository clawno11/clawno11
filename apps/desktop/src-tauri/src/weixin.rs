/// WeChat (微信) OpenClaw channel plugin — install, status, QR-code login.
///
/// The QR login flow shells out to `openclaw channels login` which internally
/// fetches a QR from the iLink API, renders it as Unicode block characters,
/// waits for the user to scan, then persists credentials and exits.
/// We capture the block-character QR and hand it to the frontend for display.
use clawno_core::types::StepResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PLUGIN_SPEC: &str = "@tencent-weixin/openclaw-weixin";
const CHANNEL_ID: &str = "openclaw-weixin";

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

/// Check whether the WeChat channel plugin is already installed.
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
        id == CHANNEL_ID || id.contains("weixin") || id.contains("wechat")
    })
}

/// Install the WeChat channel plugin via OpenClaw CLI.
#[tauri::command]
pub async fn install_weixin_plugin() -> StepResult {
    tokio::task::spawn_blocking(|| {
        let cmd = format!("openclaw plugins install {PLUGIN_SPEC}");
        match shell_cmd(&cmd).output() {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                if o.status.success() {
                    StepResult::ok(if stdout.is_empty() { stderr } else { stdout })
                } else if stderr.contains("already exists") {
                    let update_cmd = format!("openclaw plugins update {CHANNEL_ID}");
                    match shell_cmd(&update_cmd).output() {
                        Ok(uo) if uo.status.success() => {
                            let out = String::from_utf8_lossy(&uo.stdout).trim().to_string();
                            StepResult::ok(if out.is_empty() {
                                "插件已更新".to_string()
                            } else {
                                out
                            })
                        }
                        _ => StepResult::err(format!(
                            "插件已存在但更新失败：{}",
                            if stderr.is_empty() { &stdout } else { &stderr }
                        )),
                    }
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
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")))
}

/// Restart the OpenClaw gateway so newly installed plugins are loaded.
#[tauri::command]
pub async fn restart_weixin_gateway() -> StepResult {
    tokio::task::spawn_blocking(|| {
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
    .unwrap_or_else(|e| StepResult::err(format!("任务执行失败：{e}")))
}

/// Spawn `openclaw channels login`, capture the terminal QR block characters,
/// and return them. The child process keeps running in the background — it
/// waits for the user to scan, saves credentials, then exits on its own.
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

            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let has_block = l.contains('\u{2584}')  // ▄
                            || l.contains('\u{2580}')           // ▀
                            || l.contains('\u{2588}'); // █
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
            } else {
                let _ = tx.send(Err("未检测到二维码输出，请确认插件已安装".to_string()));
            }
        });

        // QR typically appears within a few seconds
        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(result) => result,
            Err(_) => {
                let _ = child.kill();
                Err("获取二维码超时，请确认 OpenClaw 网关已启动".to_string())
            }
        }
        // child is NOT killed — it keeps waiting for scan and saves credentials
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/// Check the WeChat channel connection status.
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

    let cmd = format!("openclaw channels status --channel {CHANNEL_ID} --json 2>&1");
    let out = crate::platform::shell_output(&cmd);
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
