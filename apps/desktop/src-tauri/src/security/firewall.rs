use super::{read_ip_allowlist_json, write_ip_allowlist_json};
/// Firewall rules, kill switch, and network access mode management.
use crate::platform::{shell_output as run_cmd, shell_result};

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Delete both ClawNo.11 firewall rules for the given port (idempotent).
fn remove_rules_for_port(port: u16) {
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Block_Port_{port}\""
    ));
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
    ));
}

/// Remove any subnet/tailscale allow rules left from a previous mode (idempotent).
fn remove_network_mode_rules(port: u16) {
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Subnet_{port}\""
    ));
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Tailscale_{port}\""
    ));
}

/// Internal: localhost-allow + subnet-allow + block-all.
/// `allow_rule_name` is the name for the subnet/tailscale allow rule.
/// `remoteip` is the value passed to `netsh` (e.g. "192.168.1.0/24" or "100.64.0.0/10").
fn apply_restricted_rules(port: u16, allow_rule_name: &str, remoteip: &str) -> Result<(), String> {
    let (ok, _, err) = shell_result(&format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Allow_Local_{port}\" \
         protocol=TCP dir=in localport={port} remoteip=127.0.0.1 action=allow"
    ));
    if !ok {
        return Err(format!("防火墙本机放行规则失败（需管理员权限）: {err}"));
    }
    let (ok, _, err) = shell_result(&format!(
        "netsh advfirewall firewall add rule name=\"{allow_rule_name}\" \
         protocol=TCP dir=in localport={port} remoteip={remoteip} action=allow"
    ));
    if !ok {
        let _ = shell_result(&format!(
            "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
        ));
        return Err(format!("防火墙网段放行规则失败: {err}"));
    }
    let (ok, _, err) = shell_result(&format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Block_Port_{port}\" \
         protocol=TCP dir=in localport={port} action=block"
    ));
    if !ok {
        let _ = shell_result(&format!(
            "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
        ));
        let _ = shell_result(&format!(
            "netsh advfirewall firewall delete rule name=\"{allow_rule_name}\""
        ));
        return Err(format!("防火墙封锁规则失败: {err}"));
    }
    Ok(())
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Return the current network access mode stored for the given port.
#[tauri::command]
pub fn get_network_access_mode(port: u16) -> String {
    let json = read_ip_allowlist_json();
    json.get(format!("access_mode_{port}"))
        .and_then(|v| v.as_str())
        .unwrap_or("off")
        .to_string()
}

/// Apply (or remove) the network access restriction for a given port.
///
/// Modes:
///   "off"       — remove all ClawNo11 rules for this port; any device can connect.
///   "subnet"    — detect LAN subnet automatically and allow only that range + localhost.
///   "tailscale" — allow only Tailscale CGNAT range (100.64.0.0/10) + localhost.
#[tauri::command]
pub fn set_network_access_mode(port: u16, mode: String) -> Result<String, String> {
    remove_rules_for_port(port);
    remove_network_mode_rules(port);

    let msg = match mode.as_str() {
        "local" | "local_only" => {
            let (allow_ok, _, allow_err) = shell_result(&format!(
                "netsh advfirewall firewall add rule name=\"ClawNo11_Allow_Local_{port}\" \
                 protocol=TCP dir=in localport={port} remoteip=127.0.0.1 action=allow"
            ));
            if !allow_ok {
                return Err(format!("防火墙放行规则失败（需管理员权限）: {allow_err}"));
            }
            let (block_ok, _, block_err) = shell_result(&format!(
                "netsh advfirewall firewall add rule name=\"ClawNo11_Block_Port_{port}\" \
                 protocol=TCP dir=in localport={port} action=block"
            ));
            if !block_ok {
                let _ = shell_result(&format!(
                    "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
                ));
                return Err(format!("防火墙阻断规则失败，已回滚: {block_err}"));
            }
            format!("本机限制已启用：仅允许本机（127.0.0.1）访问端口 {port}。")
        }
        "off" => {
            format!("访问限制已关闭：所有设备均可连接端口 {port}。")
        }
        "subnet" => {
            let info = super::network::get_local_lan_info().ok_or_else(|| {
                "无法检测本机局域网地址，请确保已连接到 WiFi 或以太网。".to_string()
            })?;
            apply_restricted_rules(port, &format!("ClawNo11_Allow_Subnet_{port}"), &info.subnet)?;
            format!(
                "家庭网络限制已启用：仅允许 {} 网段的设备访问端口 {port}。",
                info.subnet
            )
        }
        "tailscale" => {
            apply_restricted_rules(
                port,
                &format!("ClawNo11_Allow_Tailscale_{port}"),
                "100.64.0.0/10",
            )?;
            format!("Tailscale 限制已启用：仅允许 Tailscale 设备（100.64.0.0/10）访问端口 {port}。")
        }
        _ => return Err(format!("未知访问模式: {mode}")),
    };

    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String(mode);
    write_ip_allowlist_json(&json)?;

    Ok(msg)
}

/// Add a Windows Firewall rule to allow only localhost access to the given port.
#[tauri::command]
pub fn apply_local_only_firewall(port: u16) -> Result<String, String> {
    remove_rules_for_port(port);
    remove_network_mode_rules(port);

    let allow_cmd = format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Allow_Local_{port}\" \
         protocol=TCP dir=in localport={port} remoteip=127.0.0.1 action=allow"
    );
    let block_cmd = format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Block_Port_{port}\" \
         protocol=TCP dir=in localport={port} action=block"
    );

    let (allow_ok, _, allow_err) = shell_result(&allow_cmd);
    if !allow_ok {
        return Err(format!(
            "⚠️ 防火墙放行规则设置失败（可能缺少管理员权限），端口 {port} 未做任何修改。\n\
             请以管理员身份重新运行本应用。\n错误: {allow_err}"
        ));
    }

    let (block_ok, _, block_err) = shell_result(&block_cmd);
    if !block_ok {
        let _ = shell_result(&format!(
            "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
        ));
        return Err(format!(
            "⚠️ 防火墙阻断规则设置失败，已自动回滚放行规则，端口 {port} 未受任何修改。\n\
             错误: {block_err}"
        ));
    }

    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String("local".to_string());
    let _ = write_ip_allowlist_json(&json);

    Ok(format!("防火墙规则已应用：端口 {port} 仅允许本机访问。"))
}

/// Remove the ClawNo.11 firewall rules for the given port.
#[tauri::command]
pub fn remove_local_only_firewall(port: u16) -> Result<String, String> {
    let was_active = super::scan::check_firewall_active(port);
    remove_rules_for_port(port);
    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String("off".to_string());
    let _ = write_ip_allowlist_json(&json);
    if was_active {
        Ok(format!("端口 {port} 的防火墙规则已移除。"))
    } else {
        Ok(format!("端口 {port} 无活跃防火墙规则，无需移除。"))
    }
}

/// Emergency kill switch: apply firewall + stop the OpenClaw pm2 process.
#[tauri::command]
pub fn kill_switch_offline(port: u16) -> Result<String, String> {
    apply_local_only_firewall(port)?;
    run_cmd("pm2 stop openclaw");
    Ok(format!(
        "紧急断网已激活：端口 {port} 已封锁，OpenClaw 服务已暂停。数据完好，随时可恢复。"
    ))
}

/// Restore from kill-switch: remove firewall + restart OpenClaw.
#[tauri::command]
pub fn kill_switch_restore(port: u16) -> Result<String, String> {
    remove_local_only_firewall(port)?;
    run_cmd("pm2 start openclaw");
    Ok(format!(
        "已恢复：端口 {port} 防火墙规则已移除，OpenClaw 服务已重启。"
    ))
}
