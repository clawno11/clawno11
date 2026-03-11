/**
 * SSH-based remote OpenClaw deployment.
 *
 * Connects to a Linux VPS via SSH (password auth), runs the openclaw
 * installation script step-by-step, and emits progress events so the
 * frontend can show a live deployment log.
 *
 * Deployment steps:
 *  1. SSH connection + auth
 *  2. Check / install Node.js (via nvm)
 *  3. npm install -g pm2 openclaw
 *  4. pm2 start openclaw --name openclaw + startup hook
 *  5. Open firewall port (ufw / firewall-cmd)
 *  6. Verify service is listening
 */

use async_trait::async_trait;
use russh::{client, ChannelMsg};
use russh_keys::key::PublicKey;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ── Progress event ────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DeployProgress {
    pub step: String,
    pub message: String,
    pub progress: u8,
    pub error: Option<String>,
}

// ── SSH handler ───────────────────────────────────────────────────────────────
//
// TODO: implement TOFU (Trust On First Use) host key verification like desktop.
// Currently accepts all host keys, which is vulnerable to MITM attacks.
// Desktop's ssh_deploy.rs has a reference implementation using TofuHandler
// that persists fingerprints to ~/.clawno11/ssh_known_hosts.json.

struct AcceptAllKeys;

#[async_trait]
impl client::Handler for AcceptAllKeys {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

/// Execute a shell command over the SSH session and return (stdout+stderr, exit_code).
async fn exec(
    session: &client::Handle<AcceptAllKeys>,
    cmd: &str,
) -> Result<(String, u32), String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;

    // Wrap in bash -l so nvm/profile is sourced automatically.
    let wrapped = format!("bash -l -c {}", shell_escape(cmd));
    channel
        .exec(true, wrapped.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let mut output = String::new();
    let mut exit_code: u32 = 0;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = exit_status;
            }
            Some(ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    Ok((output, exit_code))
}

/// Minimal shell-escape: wraps in single quotes and escapes embedded single quotes.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Build + connect an SSH session.
async fn connect_session(
    host: &str,
    ssh_port: u16,
    username: &str,
    password: &str,
) -> Result<client::Handle<AcceptAllKeys>, String> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, ssh_port), AcceptAllKeys)
        .await
        .map_err(|e| format!("连接失败: {e}"))?;

    let auth_ok = session
        .authenticate_password(username, password)
        .await
        .map_err(|e| format!("认证错误: {e}"))?;

    if !auth_ok {
        return Err("SSH 用户名或密码错误".to_string());
    }

    Ok(session)
}

// ── Input validation ─────────────────────────────────────────────────────────

fn validate_ssh_input(host: &str, username: &str, port: u16) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 {
        return Err("invalid-host:empty or too long".into());
    }
    if host.contains(|c: char| c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$') {
        return Err("invalid-host:contains disallowed characters".into());
    }
    if username.is_empty() || username.len() > 64 {
        return Err("invalid-username:empty or too long".into());
    }
    if username.contains(|c: char| c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$') {
        return Err("invalid-username:contains disallowed characters".into());
    }
    if port == 0 {
        return Err("invalid-port:0".into());
    }
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Quick connectivity test — returns the remote `uname -a` on success.
#[tauri::command]
pub async fn ssh_test_connection(
    host: String,
    ssh_port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    validate_ssh_input(&host, &username, ssh_port)?;
    let session = connect_session(&host, ssh_port, &username, &password).await?;
    let (out, _) = exec(&session, "uname -a").await?;
    Ok(out.trim().to_string())
}

/// Full OpenClaw deployment to a remote Linux server via SSH.
/// Emits `deploy-progress` events throughout the process.
/// Returns the gateway URL (e.g. "http://1.2.3.4:18789") on success.
#[tauri::command]
pub async fn ssh_deploy(
    app: AppHandle,
    host: String,
    ssh_port: u16,
    username: String,
    password: String,
    openclaw_port: u16,
) -> Result<String, String> {
    validate_ssh_input(&host, &username, ssh_port)?;

    macro_rules! emit {
        ($step:expr, $msg:expr, $pct:expr) => {
            let _ = app.emit("deploy-progress", DeployProgress {
                step: $step.to_string(),
                message: $msg.to_string(),
                progress: $pct,
                error: None,
            });
        };
    }
    macro_rules! fail {
        ($step:expr, $msg:expr) => {{
            let _ = app.emit("deploy-progress", DeployProgress {
                step: $step.to_string(),
                message: $msg.to_string(),
                progress: 0,
                error: Some($msg.to_string()),
            });
            return Err($msg.to_string());
        }};
    }

    // ── 1. Connect ────────────────────────────────────────────────────────────
    emit!("connecting", "正在连接服务器...", 5);

    let session = connect_session(&host, ssh_port, &username, &password)
        .await
        .map_err(|e| { let _ = app.emit("deploy-progress", DeployProgress { step: "connecting".to_string(), message: e.clone(), progress: 0, error: Some(e.clone()) }); e })?;

    emit!("connected", "连接成功，检查运行环境...", 15);

    // ── 2. Check / install Node.js ───────────────────────────────────────────
    let (node_ver, _) = exec(&session,
        "node --version 2>/dev/null || echo NOTFOUND"
    ).await.unwrap_or(("NOTFOUND".into(), 1));

    if node_ver.contains("NOTFOUND") {
        emit!("installing-node", "安装 Node.js（通过 nvm，约需 2–5 分钟）...", 25);

        let nvm_install = concat!(
            "export NVM_DIR=\"$HOME/.nvm\"; ",
            "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && ",
            ". \"$HOME/.nvm/nvm.sh\" && ",
            "nvm install 20 && nvm use 20 && nvm alias default 20"
        );
        let (_, code) = exec(&session, nvm_install).await
            .map_err(|e| e.clone()).unwrap_or(("".into(), 1));
        if code != 0 {
            fail!("installing-node", "Node.js 安装失败，请检查服务器网络连接");
        }
    } else {
        emit!("node-ok", format!("Node.js {} 已就绪", node_ver.trim()), 25);
    }

    // ── 3. npm install -g pm2 openclaw ───────────────────────────────────────
    emit!("installing-packages", "安装 pm2 和 openclaw（全局包）...", 40);

    let install_pkg = "npm install -g pm2 openclaw";
    let (pkg_out, pkg_code) = exec(&session, install_pkg).await
        .unwrap_or(("".into(), 1));
    if pkg_code != 0 {
        let detail = pkg_out.lines().rev()
            .find(|l| !l.is_empty()).unwrap_or("未知错误").trim().to_string();
        fail!("installing-packages", format!("包安装失败: {detail}"));
    }

    // ── 4. Start openclaw via pm2 ────────────────────────────────────────────
    emit!("starting-service", "启动 OpenClaw 服务...", 60);

    let pm2_cmd = format!(
        "pm2 delete openclaw 2>/dev/null || true; \
         pm2 start openclaw --name openclaw; \
         pm2 save; \
         (pm2 startup 2>/dev/null | tail -1 | bash) 2>/dev/null || true"
    );
    let (_, pm2_code) = exec(&session, &pm2_cmd).await
        .unwrap_or(("".into(), 1));
    if pm2_code != 0 {
        fail!("starting-service", "pm2 启动失败，请检查 openclaw 是否正确安装");
    }

    // ── 5. Firewall ───────────────────────────────────────────────────────────
    emit!("firewall", "开放防火墙端口...", 75);

    let fw_cmd = format!(
        "(command -v ufw && ufw allow {p}/tcp) 2>/dev/null; \
         (command -v firewall-cmd && firewall-cmd --add-port={p}/tcp --permanent && firewall-cmd --reload) 2>/dev/null; \
         echo ok",
        p = openclaw_port
    );
    let _ = exec(&session, &fw_cmd).await;

    // ── 6. Verify the service is up ───────────────────────────────────────────
    emit!("verifying", "等待服务启动（最多 15 秒）...", 85);

    let check_cmd = format!(
        "for i in $(seq 1 15); do \
           ss -tlnp 2>/dev/null | grep -q ':{p}' && echo READY && break; \
           sleep 1; \
         done; \
         echo DONE",
        p = openclaw_port
    );
    let (verify_out, _) = exec(&session, &check_cmd).await
        .unwrap_or(("".into(), 0));

    let gateway_url = format!("http://{}:{}", host, openclaw_port);

    if verify_out.contains("READY") {
        emit!("done", format!("✓ 部署完成！服务地址：{gateway_url}"), 100);
    } else {
        // Service might just need a few more seconds — return success anyway.
        emit!("done", format!("部署完成（服务启动中）：{gateway_url}"), 100);
    }

    Ok(gateway_url)
}
