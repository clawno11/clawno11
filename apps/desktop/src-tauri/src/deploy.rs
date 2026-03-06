use serde::{Deserialize, Serialize};
use std::process::Command;

// ── helpers ──────────────────────────────────────────────────────────────────

/// Run a command through the Windows shell so it can resolve `.cmd` scripts
/// and pick up the full user PATH (Node.js, npm, pm2, etc.).
fn shell(cmd: &str) -> std::io::Result<std::process::Output> {
    // Inject common Node.js install locations so they are always found
    let extra_paths = [
        r"C:\Program Files\nodejs",
        r"C:\Program Files (x86)\nodejs",
        &format!(
            r"{}\AppData\Roaming\npm",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
        &format!(
            r"{}\AppData\Local\Programs\nodejs",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
    ];

    let current_path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!("{};{}", extra_paths.join(";"), current_path);

    Command::new("cmd")
        .args(["/C", cmd])
        .env("PATH", &full_path)
        .output()
}

fn shell_ok(cmd: &str) -> bool {
    shell(cmd).map(|o| o.status.success()).unwrap_or(false)
}

fn shell_output(cmd: &str) -> String {
    shell(cmd)
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

// ── types ─────────────────────────────────────────────────────────────────────

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

// ── commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_local(port: Option<u16>, config_dir: Option<String>) -> LocalDeployResult {
    let port = port.unwrap_or(18789);
    let home = dirs_next::home_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let config_dir = config_dir.unwrap_or_else(|| format!("{}/.openclaw", home));

    // 1. Check Node.js
    let node_ver = shell_output("node --version");
    if node_ver.is_empty() {
        return LocalDeployResult {
            success: false,
            pid: None,
            port,
            config_dir,
            error: Some(
                "未检测到 Node.js，请先安装 Node.js >= 22 (https://nodejs.org)".into(),
            ),
        };
    }

    // 2. Install openclaw if needed
    let claw_ver = shell_output("openclaw --version");
    if claw_ver.is_empty() {
        let ok = shell_ok("npm install -g openclaw");
        if !ok {
            return LocalDeployResult {
                success: false,
                pid: None,
                port,
                config_dir,
                error: Some("npm install -g openclaw 失败，请检查网络或权限".into()),
            };
        }
    }

    // 3. Install pm2 if needed
    let pm2_ver = shell_output("pm2 --version");
    if pm2_ver.is_empty() {
        shell_ok("npm install -g pm2");
    }

    // 4. Onboard (init config, non-fatal)
    shell_ok("openclaw onboard --yes");

    // 5. Start / restart via pm2
    let running = shell_output("pm2 pid openclaw");
    let started = if running.trim().is_empty() || running.trim() == "undefined" {
        shell_ok(&format!(
            "pm2 start openclaw --name openclaw -- --port {}",
            port
        ))
    } else {
        shell_ok("pm2 restart openclaw")
    };

    if started {
        LocalDeployResult {
            success: true,
            pid: None,
            port,
            config_dir,
            error: None,
        }
    } else {
        LocalDeployResult {
            success: false,
            pid: None,
            port,
            config_dir,
            error: Some("pm2 start 失败，请查看系统日志".into()),
        }
    }
}

#[tauri::command]
pub async fn get_local_service_info() -> ServiceInfo {
    let out = shell_output("pm2 jlist");
    if out.contains("\"openclaw\"") && out.contains("\"online\"") {
        ServiceInfo {
            name: "openclaw".into(),
            status: "running".into(),
            pid: None,
            uptime: None,
            restarts: None,
        }
    } else if out.contains("\"openclaw\"") {
        ServiceInfo {
            name: "openclaw".into(),
            status: "stopped".into(),
            pid: None,
            uptime: None,
            restarts: None,
        }
    } else {
        ServiceInfo {
            name: "openclaw".into(),
            status: "unknown".into(),
            pid: None,
            uptime: None,
            restarts: None,
        }
    }
}

#[tauri::command]
pub async fn stop_local_service() {
    shell_ok("pm2 stop openclaw");
}

#[tauri::command]
pub async fn restart_local_service() {
    shell_ok("pm2 restart openclaw");
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
