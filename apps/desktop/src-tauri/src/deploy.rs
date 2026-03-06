use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone)]
pub struct LocalDeployResult {
    pub success: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub config_dir: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RemoteDeployResult {
    pub success: bool,
    pub host: String,
    pub gateway_port: u16,
    pub gateway_url: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub status: String,
    pub pid: Option<u32>,
    pub uptime: Option<u64>,
    pub restarts: Option<u32>,
}

#[tauri::command]
pub async fn deploy_local(port: Option<u16>, config_dir: Option<String>) -> LocalDeployResult {
    let port = port.unwrap_or(18789);
    let home = dirs_next::home_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let config_dir = config_dir.unwrap_or_else(|| format!("{}/.openclaw", home));

    // Check Node.js
    let node_check = Command::new("node").arg("--version").output();
    if node_check.is_err() {
        return LocalDeployResult {
            success: false,
            pid: None,
            port,
            config_dir,
            error: Some("Node.js 未安装，请先安装 Node.js >= 22".into()),
        };
    }

    // Install openclaw if not present
    let openclaw_check = Command::new("openclaw").arg("--version").output();
    if openclaw_check.is_err() {
        let install = Command::new("npm")
            .args(["install", "-g", "openclaw"])
            .output();
        if let Err(e) = install {
            return LocalDeployResult {
                success: false,
                pid: None,
                port,
                config_dir,
                error: Some(format!("安装 openclaw 失败: {}", e)),
            };
        }
    }

    // Install pm2 if not present
    let pm2_check = Command::new("pm2").arg("--version").output();
    if pm2_check.is_err() {
        let _ = Command::new("npm")
            .args(["install", "-g", "pm2"])
            .output();
    }

    // Run onboard
    let _ = Command::new("openclaw").args(["onboard", "--yes"]).output();

    // Start with pm2
    let start = Command::new("pm2")
        .args(["start", "openclaw", "--name", "openclaw"])
        .env("OPENCLAW_PORT", port.to_string())
        .output();

    match start {
        Ok(_) => LocalDeployResult {
            success: true,
            pid: None,
            port,
            config_dir,
            error: None,
        },
        Err(e) => LocalDeployResult {
            success: false,
            pid: None,
            port,
            config_dir,
            error: Some(format!("启动失败: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn get_local_service_info() -> ServiceInfo {
    let output = Command::new("pm2").args(["jlist"]).output();
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.contains("\"openclaw\"") && stdout.contains("\"online\"") {
                ServiceInfo {
                    name: "openclaw".into(),
                    status: "running".into(),
                    pid: None,
                    uptime: None,
                    restarts: None,
                }
            } else {
                ServiceInfo {
                    name: "openclaw".into(),
                    status: "stopped".into(),
                    pid: None,
                    uptime: None,
                    restarts: None,
                }
            }
        }
        Err(_) => ServiceInfo {
            name: "openclaw".into(),
            status: "unknown".into(),
            pid: None,
            uptime: None,
            restarts: None,
        },
    }
}

#[tauri::command]
pub async fn stop_local_service() {
    let _ = Command::new("pm2").args(["stop", "openclaw"]).output();
}

#[tauri::command]
pub async fn restart_local_service() {
    let _ = Command::new("pm2").args(["restart", "openclaw"]).output();
}

#[derive(Deserialize)]
pub struct RemoteDeployArgs {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub gateway_port: u16,
    pub use_docker: bool,
}

#[tauri::command]
pub async fn deploy_remote(args: RemoteDeployArgs) -> RemoteDeployResult {
    // Remote SSH deployment via bundled Node.js script
    // TODO: implement via ssh2 Rust crate (openssh or ssh2-rs)
    RemoteDeployResult {
        success: false,
        host: args.host.clone(),
        gateway_port: args.gateway_port,
        gateway_url: format!("http://{}:{}", args.host, args.gateway_port),
        error: Some("远程部署功能开发中".into()),
    }
}

#[tauri::command]
pub async fn get_remote_service_info(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
) -> ServiceInfo {
    ServiceInfo {
        name: "openclaw".into(),
        status: "unknown".into(),
        pid: None,
        uptime: None,
        restarts: None,
    }
}
