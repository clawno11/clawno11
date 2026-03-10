/// Security scanning and network monitoring for Claw Guard dashboard.

use serde::{Deserialize, Serialize};
use crate::platform::{shell_output as run_cmd, shell_result};

// ── Tool permissions (exec-approvals) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissions {
    /// "deny" | "ask" | "allow"
    pub exec_mode: String,
    pub allowlist: Vec<String>,
}

fn exec_approvals_path() -> String {
    crate::platform::path_join(
        &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
        "exec-approvals.json",
    )
}

fn read_approvals_json() -> serde_json::Value {
    let path = exec_approvals_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({
            "version": 1,
            "defaults": { "mode": "ask" },
            "allowlist": []
        }))
}

/// Return the current exec approval mode and allowlist.
#[tauri::command]
pub fn get_tool_permissions() -> ToolPermissions {
    let json = read_approvals_json();
    let exec_mode = json
        .pointer("/defaults/mode")
        .and_then(|v| v.as_str())
        .unwrap_or("ask")
        .to_string();
    let allowlist = json
        .get("allowlist")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    ToolPermissions { exec_mode, allowlist }
}

/// Persist the exec approval mode to ~/.openclaw/exec-approvals.json.
#[tauri::command]
pub fn set_exec_mode(mode: String) -> Result<(), String> {
    // Validate against the only three legal values accepted by the openclaw CLI.
    if !matches!(mode.as_str(), "deny" | "ask" | "allow") {
        return Err(format!("invalid exec mode: {mode:?}; must be 'deny', 'ask', or 'allow'"));
    }
    let mut json = read_approvals_json();
    if let Some(obj) = json.as_object_mut() {
        obj.insert("defaults".to_string(), serde_json::json!({ "mode": mode }));
    }
    let path = exec_approvals_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Add a glob pattern to the exec allowlist via the OpenClaw CLI.
#[tauri::command]
pub fn add_exec_allowlist_entry(pattern: String) -> Result<(), String> {
    // Update the JSON file directly so the change is instant.
    let mut json = read_approvals_json();
    let entry = serde_json::Value::String(pattern.clone());
    if let Some(list) = json.get_mut("allowlist").and_then(|v| v.as_array_mut()) {
        if !list.contains(&entry) { list.push(entry); }
    } else {
        json["allowlist"] = serde_json::json!([pattern]);
    }
    let path = exec_approvals_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a glob pattern from the exec allowlist.
#[tauri::command]
pub fn remove_exec_allowlist_entry(pattern: String) -> Result<(), String> {
    let mut json = read_approvals_json();
    if let Some(list) = json.get_mut("allowlist").and_then(|v| v.as_array_mut()) {
        list.retain(|v| v.as_str() != Some(&pattern));
    }
    let path = exec_approvals_path();
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ── IP allowlist firewall ─────────────────────────────────────────────────

/// Sanitise an IP string into a suffix safe for use in a Windows Firewall rule name.
/// Only dots and alphanumeric characters are kept (colons for IPv6 become underscores).
fn safe_ip(ip: &str) -> String {
    ip.chars()
        .map(|c| if c.is_alphanumeric() || c == '.' { c } else { '_' })
        .collect()
}

fn ip_allow_rule_name(port: u16, ip: &str) -> String {
    format!("ClawNo11_Allow_IP_{port}_{}", safe_ip(ip))
}

/// Path to the JSON file that persists the IP allowlist.
fn ip_allowlist_path() -> String {
    crate::platform::path_join(
        &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
        "ip-allowlist.json",
    )
}

fn read_ip_allowlist_json() -> serde_json::Value {
    std::fs::read_to_string(ip_allowlist_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({ "ips": {} }))
}

fn write_ip_allowlist_json(v: &serde_json::Value) -> Result<(), String> {
    let path = ip_allowlist_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowedIpEntry {
    pub ip: String,
    pub label: String,   // user-supplied friendly name, e.g. "我的 iPhone 15"
    pub port: u16,
    pub active: bool,
}

/// Return all IP whitelist entries for the given port (plus entries with port == 0 as "any port").
#[tauri::command]
pub fn get_allowed_ips(port: u16) -> Vec<AllowedIpEntry> {
    let json = read_ip_allowlist_json();
    let map = match json.get("ips").and_then(|v| v.as_object()) {
        Some(m) => m.clone(),
        None    => return vec![],
    };
    map.values()
        .filter_map(|v| serde_json::from_value::<AllowedIpEntry>(v.clone()).ok())
        .filter(|e| e.port == port || e.port == 0)
        .collect()
}

/// Add a new IP to the whitelist and create a Windows Firewall allow-rule for it.
///
/// `label`  — human-readable name (e.g. "iPhone 15").  May be empty.
/// `ip`     — IPv4 or IPv6 address.
/// `port`   — gateway port to open for this IP.
#[tauri::command]
pub fn add_allowed_ip(port: u16, ip: String, label: String) -> Result<AllowedIpEntry, String> {
    // Basic validation: reject obviously wrong strings.
    let ip = ip.trim().to_string();
    if ip.is_empty() {
        return Err("IP 地址不能为空".into());
    }
    if ip.contains('"') || ip.contains('\'') || ip.contains(';') {
        return Err("IP 地址含有非法字符".into());
    }

    // Windows Firewall: add a specific allow rule for this IP BEFORE any block rule,
    // so it takes priority (Windows evaluates allow before block when both match).
    let rule_name = ip_allow_rule_name(port, &ip);
    let (ok, _, err) = shell_result(&format!(
        "netsh advfirewall firewall add rule \
         name=\"{rule_name}\" \
         protocol=TCP dir=in localport={port} \
         remoteip={ip} action=allow"
    ));
    if !ok {
        return Err(format!("防火墙规则添加失败（可能需要管理员权限）: {err}"));
    }

    // Persist to JSON.
    let entry = AllowedIpEntry {
        ip: ip.clone(),
        label: if label.trim().is_empty() { ip.clone() } else { label },
        port,
        active: true,
    };
    let mut json = read_ip_allowlist_json();
    let key = format!("{port}_{}", safe_ip(&ip));
    if let Some(ips) = json.get_mut("ips").and_then(|v| v.as_object_mut()) {
        ips.insert(key, serde_json::to_value(&entry).unwrap_or_default());
    } else {
        json["ips"] = serde_json::json!({ key: serde_json::to_value(&entry).unwrap_or_default() });
    }
    write_ip_allowlist_json(&json)?;

    Ok(entry)
}

/// Remove an IP from the whitelist and delete its Windows Firewall rule.
#[tauri::command]
pub fn remove_allowed_ip(port: u16, ip: String) -> Result<(), String> {
    let rule_name = ip_allow_rule_name(port, &ip);
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"{rule_name}\""
    ));

    // Remove from JSON.
    let mut json = read_ip_allowlist_json();
    let key = format!("{port}_{}", safe_ip(&ip));
    if let Some(ips) = json.get_mut("ips").and_then(|v| v.as_object_mut()) {
        ips.remove(&key);
    }
    write_ip_allowlist_json(&json)?;

    Ok(())
}

/// Discover live hosts on the local network using the ARP cache (instant, no admin required).
/// Returns a list of IP strings seen by Windows in its ARP table.
#[tauri::command]
pub fn scan_lan_devices() -> Vec<String> {
    let output = run_cmd("arp -a");
    // Lines look like:  "  192.168.1.5            aa-bb-cc-dd-ee-ff     dynamic"
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 { return None; }
            let ip = parts[0];
            // Skip multicast (224.x, 239.x) and broadcast (255.x), keep 192.168.x, 10.x, 172.x
            let ok = ip.starts_with("192.168.")
                || ip.starts_with("10.")
                || (ip.starts_with("172.") && {
                    let second: u8 = ip.split('.').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
                    (16..=31).contains(&second)
                });
            if ok { Some(ip.to_string()) } else { None }
        })
        .collect()
}

// ── Network Access Mode ───────────────────────────────────────────────────
//
// Three modes control which remote devices may reach the OpenClaw gateway port:
//   "off"       — no restriction; any IP can connect (default)
//   "subnet"    — allow only the machine's own LAN subnet (e.g. 192.168.1.0/24)
//   "tailscale" — allow only the Tailscale CGNAT range (100.64.0.0/10)
//
// The mode is enforced via Windows Firewall: a catch-all block rule is added,
// with preceding allow rules for localhost + the permitted range.

/// Detected LAN address info returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanInfo {
    /// Machine's primary LAN IP (e.g. "192.168.1.100")
    pub ip: String,
    /// CIDR subnet the machine sits in (e.g. "192.168.1.0/24")
    pub subnet: String,
    /// Prefix length derived from the subnet mask (e.g. 24)
    pub prefix: u8,
}

/// Convert a dotted-decimal subnet mask string to a CIDR prefix length.
fn mask_to_prefix(mask: &str) -> Option<u8> {
    let parts: Vec<u8> = mask.split('.').filter_map(|s| s.trim().parse().ok()).collect();
    if parts.len() != 4 { return None; }
    let bits = parts.iter().fold(0u32, |acc, &b| (acc << 8) | u32::from(b));
    Some(bits.count_ones() as u8)
}

/// Calculate the network address (host bits zeroed) for an IP + prefix length.
fn ip_to_network(ip: &str, prefix: u8) -> Option<String> {
    let parts: Vec<u8> = ip.split('.').filter_map(|s| s.parse().ok()).collect();
    if parts.len() != 4 { return None; }
    let ip_int = u32::from_be_bytes([parts[0], parts[1], parts[2], parts[3]]);
    let mask   = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
    let net    = ip_int & mask;
    let [a, b, c, d] = net.to_be_bytes();
    Some(format!("{a}.{b}.{c}.{d}/{prefix}"))
}

/// Walk ipconfig output looking for the subnet mask that belongs to `target_ip`.
fn subnet_prefix_for_ip(target_ip: &str) -> Option<u8> {
    let output = run_cmd("ipconfig");
    let mut found = false;
    for line in output.lines() {
        let t = line.trim();
        if !found {
            // Match lines like "IPv4 Address. . . : 192.168.1.100"
            if (t.contains("IPv4") || t.contains("IP Address")) && t.contains(target_ip) {
                found = true;
            }
        } else {
            if t.contains("Subnet Mask") || t.contains("子网掩码") {
                if let Some(mask_str) = t.split(':').last() {
                    return mask_to_prefix(mask_str.trim());
                }
            }
            // Stop if we've moved past this adapter's block.
            if t.contains("IPv4") || t.contains("IPv6") || t.is_empty() {
                break;
            }
        }
    }
    None
}

/// Detect the machine's primary outbound LAN IP and the subnet it belongs to.
/// Uses a UDP connect trick (no packets sent) to find the correct interface.
#[tauri::command]
pub fn get_local_lan_info() -> Option<LanInfo> {
    let ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; Ok(s) })
        .ok()
        .and_then(|s| s.local_addr().ok())
        .map(|a| a.ip().to_string())
        .filter(|ip| !ip.starts_with("127."))?;

    let prefix = subnet_prefix_for_ip(&ip).unwrap_or(24);
    let subnet = ip_to_network(&ip, prefix)?;
    Some(LanInfo { ip, subnet, prefix })
}

/// Return the current network access mode stored for the given port.
#[tauri::command]
pub fn get_network_access_mode(port: u16) -> String {
    let json = read_ip_allowlist_json();
    json.get(&format!("access_mode_{port}"))
        .and_then(|v| v.as_str())
        .unwrap_or("off")
        .to_string()
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
    // Allow localhost unconditionally.
    let (ok, _, err) = shell_result(&format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Allow_Local_{port}\" \
         protocol=TCP dir=in localport={port} remoteip=127.0.0.1 action=allow"
    ));
    if !ok {
        return Err(format!("防火墙本机放行规则失败（需管理员权限）: {err}"));
    }
    // Allow the specified range.
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
    // Block everything else.
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

/// Apply (or remove) the network access restriction for a given port.
///
/// Modes:
///   "off"       — remove all ClawNo11 rules for this port; any device can connect.
///   "subnet"    — detect LAN subnet automatically and allow only that range + localhost.
///   "tailscale" — allow only Tailscale CGNAT range (100.64.0.0/10) + localhost.
#[tauri::command]
pub fn set_network_access_mode(port: u16, mode: String) -> Result<String, String> {
    // Start fresh: remove existing ClawNo11 rules (allow-local, block, subnet, tailscale).
    remove_rules_for_port(port);
    remove_network_mode_rules(port);

    let msg = match mode.as_str() {
        "local" | "local_only" => {
            // Rules were already cleared by the two remove calls above.
            // Just add Allow_Local + Block; skip the redundant cleans inside
            // apply_local_only_firewall by calling the shared rule-add logic directly.
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
            let info = get_local_lan_info()
                .ok_or_else(|| "无法检测本机局域网地址，请确保已连接到 WiFi 或以太网。".to_string())?;
            apply_restricted_rules(
                port,
                &format!("ClawNo11_Allow_Subnet_{port}"),
                &info.subnet,
            )?;
            format!(
                "家庭网络限制已启用：仅允许 {} 网段的设备访问端口 {port}。",
                info.subnet
            )
        }
        "tailscale" => {
            // Tailscale CGNAT range per RFC 6598 as used by Tailscale.
            apply_restricted_rules(
                port,
                &format!("ClawNo11_Allow_Tailscale_{port}"),
                "100.64.0.0/10",
            )?;
            format!("Tailscale 限制已启用：仅允许 Tailscale 设备（100.64.0.0/10）访问端口 {port}。")
        }
        _ => return Err(format!("未知访问模式: {mode}")),
    };

    // Persist the chosen mode.
    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String(mode);
    write_ip_allowlist_json(&json)?;

    Ok(msg)
}

/// Emergency kill switch: apply firewall + stop the OpenClaw pm2 process.
/// Does NOT delete any data — restoring is just a matter of reversing both steps.
#[tauri::command]
pub fn kill_switch_offline(port: u16) -> Result<String, String> {
    // 1. Block all external connections to the gateway port.
    apply_local_only_firewall(port)?;
    // 2. Gracefully stop the OpenClaw process managed by pm2.
    run_cmd("pm2 stop openclaw");
    Ok(format!("紧急断网已激活：端口 {port} 已封锁，OpenClaw 服务已暂停。数据完好，随时可恢复。"))
}

/// Restore from kill-switch: remove firewall + restart OpenClaw.
#[tauri::command]
pub fn kill_switch_restore(port: u16) -> Result<String, String> {
    remove_local_only_firewall(port)?;
    run_cmd("pm2 start openclaw");
    Ok(format!("已恢复：端口 {port} 防火墙规则已移除，OpenClaw 服务已重启。"))
}

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityCheck {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "notice" | "warn" | "danger" | "unknown"
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityReport {
    pub score: u8,
    pub checks: Vec<SecurityCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortConnection {
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: String,
    pub is_local: bool,
    /// True when the socket is in LISTENING state (no remote peer yet).
    /// Frontend uses this to exclude listening rows from the "external connection" count.
    pub is_listening: bool,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Detect whether OpenClaw is bound to 0.0.0.0 (public-facing) or 127.0.0.1 (local-only).
/// Fix S-7: distinguish "no LISTENING" from "local LISTENING", fix S-8: LISTENING is not is_local.
fn check_port_exposure(port: u16) -> SecurityCheck {
    let output = run_cmd(&format!("netstat -ano | findstr \":{port}\""));

    let listening_lines: Vec<&str> = output
        .lines()
        .filter(|l| l.contains("LISTENING"))
        .collect();

    if listening_lines.is_empty() {
        // Service is not listening. Check whether the port is already blocked by
        // a ClawNo11 firewall rule — if so this is actually a safe state.
        let blocked = run_cmd(&format!(
            "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
        )).contains(&format!("ClawNo11_Block_Port_{port}"));

        return if blocked {
            SecurityCheck {
                id:     "port_exposure".into(),
                label:  "端口暴露检测".into(),
                status: "ok".into(),
                detail: format!(
                    "服务当前未运行，且端口 {port} 已被防火墙规则封锁，无任何暴露风险。\
                     即使服务重启，防火墙规则依然生效。"
                ),
            }
        } else {
            SecurityCheck {
                id:     "port_exposure".into(),
                label:  "端口暴露检测".into(),
                status: "warn".into(),
                detail: format!(
                    "服务当前未运行，端口 {port} 暂无监听。\
                     若服务启动且缺少防火墙规则，端口将完全对外暴露。\
                     建议在「网络访问」面板设置「仅本机」或「仅内网」。"
                ),
            }
        };
    }

    let exposed = listening_lines
        .iter()
        .any(|l| l.contains(&format!("0.0.0.0:{port}")) || l.contains(&format!("[::]:{port}")));

    if exposed {
        SecurityCheck {
            id: "port_exposure".into(),
            label: "端口暴露检测".into(),
            status: "danger".into(),
            detail: format!("端口 {port} 绑定在 0.0.0.0，服务已暴露至公网，建议立即启用防火墙规则。"),
        }
    } else {
        SecurityCheck {
            id: "port_exposure".into(),
            label: "端口暴露检测".into(),
            status: "ok".into(),
            detail: format!("端口 {port} 仅绑定在本地地址，无公网暴露风险。"),
        }
    }
}

/// Check whether Node.js version is in a known-vulnerable range.
fn check_node_version() -> SecurityCheck {
    let ver = run_cmd("node --version");
    if ver.is_empty() {
        return SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "unknown".into(),
            detail: "未检测到 Node.js，部署可能未完成。".into(),
        };
    }

    let major: u32 = ver
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if major < 18 {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "danger".into(),
            detail: format!("当前版本 {ver} 已停止安全维护（EOL），存在已知 CVE 漏洞，建议升级至 v20+。"),
        }
    } else if major < 20 {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "warn".into(),
            detail: format!("当前版本 {ver} 仍在维护期，但建议升级至长期支持版 v20+。"),
        }
    } else {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "ok".into(),
            detail: format!("当前版本 {ver}，处于活跃安全维护周期。"),
        }
    }
}

/// Check whether pm2 is managing the openclaw process.
/// Fix S-5: parse pm2 jlist as JSON rather than substring-matching to avoid false positives.
fn check_pm2_status() -> SecurityCheck {
    let output = run_cmd("pm2 jlist");

    let running = serde_json::from_str::<serde_json::Value>(&output)
        .ok()
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter().any(|proc| {
                    let name_ok = proc
                        .get("name")
                        .and_then(|n| n.as_str())
                        == Some("openclaw");
                    let status_ok = proc
                        .get("pm2_env")
                        .and_then(|e| e.get("status"))
                        .and_then(|s| s.as_str())
                        == Some("online");
                    name_ok && status_ok
                })
            })
        })
        .unwrap_or(false);

    if running {
        SecurityCheck {
            id: "pm2_status".into(),
            label: "进程守护状态".into(),
            status: "ok".into(),
            detail: "OpenClaw 由 pm2 托管运行，进程异常退出后将自动重启。".into(),
        }
    } else {
        SecurityCheck {
            id: "pm2_status".into(),
            label: "进程守护状态".into(),
            status: "warn".into(),
            detail: "未检测到 pm2 托管的 openclaw 进程，服务可能未启动或未使用进程守护。".into(),
        }
    }
}

/// Detect whether a local API baseURL is configured (offline/local-model mode).
/// Fix S-6: parse config as JSON and check specific URL fields to avoid comment false-positives.
fn check_offline_mode() -> SecurityCheck {
    let candidate_paths = [
        crate::platform::path_join(
            &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
            "config.json",
        ),
        crate::platform::path_join(
            &crate::platform::path_join(&crate::platform::data_roaming(), "openclaw"),
            "config.json",
        ),
    ];

    let local_keywords = ["127.0.0.1", "localhost", "ollama"];
    let url_fields    = ["baseUrl", "apiUrl", "endpoint", "api_base", "base_url"];

    for config_path in &candidate_paths {
        let content = match std::fs::read_to_string(config_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let is_local = url_fields.iter().any(|field| {
                json.get(field)
                    .and_then(|v| v.as_str())
                    .map(|url| local_keywords.iter().any(|kw| url.contains(kw)))
                    .unwrap_or(false)
            });

            if is_local {
                return SecurityCheck {
                    id: "offline_mode".into(),
                    label: "离线模式检测".into(),
                    status: "ok".into(),
                    detail: "检测到本地 API 配置，当前为 100% 离线模式，数据不出本机。".into(),
                };
            }

            // Config found but API points to external service — that's known, not unknown.
            return SecurityCheck {
                id:     "offline_mode".into(),
                label:  "离线模式检测".into(),
                status: "warn".into(),
                detail: "当前使用远端 AI 服务（非本地模型），对话内容将发送至第三方 API 提供商处理。\
                         如需最高隐私保护，建议使用本地 Ollama 模型。".into(),
            };
        }
    }

    // Config file not found — service may not be set up yet, or uses factory defaults.
    SecurityCheck {
        id:     "offline_mode".into(),
        label:  "离线模式检测".into(),
        status: "warn".into(),
        detail: "未找到 OpenClaw 配置文件，无法判断数据流向。\
                 服务可能尚未初始化，或使用内置默认配置。".into(),
    }
}

/// Calculate overall security score using a **weighted** model.
///
/// ## Weight distribution (total = 100 points)
///
/// | Check ID        | Weight | Rationale                                     |
/// |-----------------|--------|-----------------------------------------------|
/// | network_access  |   40   | Biggest attack-surface factor                 |
/// | im_connector    |   20   | External IM = cloud relay = exposure risk     |
/// | port_exposure   |   15   | Direct port reachability                      |
/// | node_version    |   10   | Dependency hygiene                            |
/// | pm2_status      |   10   | Process manager health                        |
/// | offline_mode    |    5   | Air-gap bonus                                 |
///
/// ## Points awarded per status
///
/// - `ok`:      full weight
/// - `notice`:  85 % (home LAN subnet — local devices only, mid-high trust)
/// - `warn`:    75 % for `network_access` (VPN); 60 % for all other checks
/// - `unknown`: 50 % of weight
/// - `danger`:  0 points
///
/// ## Intended score ranges
///
/// | Range  | Meaning              | Typical scenario                          |
/// |--------|----------------------|-------------------------------------------|
/// | 90–100 | Excellent            | Local-only, no external IM, all green     |
/// | 75–89  | Good                 | VPN-only or minor secondary issues        |
/// | 60–74  | Fair                 | Open access + partial protections         |
/// | < 60   | Needs improvement    | Open + external IM exposed                |
fn calculate_score(checks: &[SecurityCheck]) -> u8 {
    // Weight assigned to each named check (must sum to 100).
    let weight_of = |id: &str| -> u32 {
        match id {
            "network_access" => 40,
            "im_connector"   => 20,
            "port_exposure"  => 15,
            "node_version"   => 10,
            "pm2_status"     => 10,
            "offline_mode"   =>  5,
            _                =>  0, // unknown check IDs don't contribute
        }
    };

    let score: u32 = checks.iter().map(|c| {
        let w = weight_of(&c.id);
        match c.status.as_str() {
            "ok"     => w,
            // "notice" = home LAN subnet: local devices only, mid-high trust (85 %)
            "notice" => w * 85 / 100,
            // "warn"   = Tailscale VPN: authenticated remote devices (75 %)
            "warn"   => {
                if c.id == "network_access" { w * 75 / 100 } else { w * 60 / 100 }
            }
            "unknown" => w * 50 / 100,
            _ => 0, // "danger"
        }
    }).sum();

    score.min(100) as u8
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Delete both ClawNo.11 firewall rules for the given port (idempotent — ignores "not found").
fn remove_rules_for_port(port: u16) {
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Block_Port_{port}\""
    ));
    let _ = shell_result(&format!(
        "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
    ));
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Check network access restriction level for the given port.
///
/// Reads actual Windows Firewall rules (not just the stored JSON mode) so the
/// score reflects the real OS state rather than a cached value.
///
/// Scoring:
///   ok      — Block present, only localhost allowed (most secure)
///   notice  — Block present, LAN subnet allowed (mid-high; home devices only)
///   warn    — Block present, Tailscale VPN allowed (mid; remote but authenticated)
///   danger  — No block rule; port is open to any remote host (least secure)
fn check_network_access_mode(port: u16) -> SecurityCheck {
    let block_active = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    )).contains(&format!("ClawNo11_Block_Port_{port}"));
    check_network_access_mode_cached(port, block_active)
}

/// Same as `check_network_access_mode` but accepts a pre-queried `block_active`
/// to avoid a duplicate netsh call when called from `scan_security_status`.
fn check_network_access_mode_cached(port: u16, block_active: bool) -> SecurityCheck {

    if !block_active {
        return SecurityCheck {
            id:     "network_access".into(),
            label:  "网络访问限制".into(),
            status: "danger".into(),
            detail: format!(
                "端口 {port} 未设置防火墙封锁规则，任何设备均可直接访问。\
                 建议在「网络访问」面板选择「仅本机」或「仅内网」。"
            ),
        };
    }

    // Block rule exists — determine how permissive the allow rules are.
    let has_subnet = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Subnet_{port}\""
    )).contains(&format!("ClawNo11_Allow_Subnet_{port}"));

    let has_tailscale = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Tailscale_{port}\""
    )).contains(&format!("ClawNo11_Allow_Tailscale_{port}"));

    if has_subnet || has_tailscale {
        // Subnet (home LAN) is more trusted than Tailscale VPN:
        //   - subnet: only devices physically on your local network (router-gated)
        //   - tailscale: authenticated but allows remote devices from anywhere
        // Give subnet a "notice" (mid-level) status so it scores above VPN's "warn".
        if has_tailscale && !has_subnet {
            SecurityCheck {
                id:     "network_access".into(),
                label:  "网络访问限制".into(),
                status: "warn".into(),
                detail: format!(
                    "已限制为 Tailscale VPN 网段访问端口 {port}。\
                     如需更高安全等级，可切换为「仅本机」或「家庭网络」模式。"
                ),
            }
        } else {
            // subnet mode (possibly with tailscale also present but subnet takes precedence)
            SecurityCheck {
                id:     "network_access".into(),
                label:  "网络访问限制".into(),
                status: "notice".into(),
                detail: format!(
                    "已限制为家庭局域网网段访问端口 {port}（仅本地设备可连接）。\
                     如需最高安全等级，可切换为「仅本机」模式。"
                ),
            }
        }
    } else {
        SecurityCheck {
            id:     "network_access".into(),
            label:  "网络访问限制".into(),
            status: "ok".into(),
            detail: format!(
                "端口 {port} 已限制为仅本机（127.0.0.1）访问，外部连接已全部封锁。"
            ),
        }
    }
}

/// Check whether any IM connector (Feishu / Telegram / Discord) is configured
/// and whether that creates an external exposure risk given the current network mode.
///
/// Risk logic:
///   - Any bot configured + network open ("off") → danger
///   - Any bot configured + network restricted → warn (bot won't work; tradeoff)
///   - No bots configured → ok
fn check_im_connector_exposure(port: u16) -> SecurityCheck {
    let block_active = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    )).contains(&format!("ClawNo11_Block_Port_{port}"));
    check_im_connector_exposure_cached(port, block_active)
}

/// Same as `check_im_connector_exposure` but accepts pre-queried `block_active`.
fn check_im_connector_exposure_cached(port: u16, block_active: bool) -> SecurityCheck {
    // The Feishu App ID is stored in the Tauri plugin-store file as a JSON key.
    // Since the store file is a plain JSON file (see SS-1 note in secure_store.rs),
    // we can read it directly without needing the AppHandle.
    let store_path = {
        let data = crate::platform::data_roaming();
        crate::platform::path_join(
            &crate::platform::path_join(&data, "com.clawno11.desktop"),
            "clawno_secure.bin",
        )
    };

    let store_contents = std::fs::read_to_string(&store_path).unwrap_or_default();
    let feishu_configured   = store_contents.contains("\"feishu_app_id\"");
    let telegram_configured = store_contents.contains("\"telegram_token\"");
    let discord_configured  = store_contents.contains("\"discord_token\"");

    if !feishu_configured && !telegram_configured && !discord_configured {
        return SecurityCheck {
            id:     "im_connector".into(),
            label:  "IM 连接器曝露".into(),
            status: "ok".into(),
            detail: "未配置 IM 连接器，AI 网关仅接受直连（移动 App 或 API），无外部云端中转。".into(),
        };
    }

    // At least one IM bot is configured — block_active was passed in by the caller.

    // Build a human-readable list of which bots are active.
    let mut bots: Vec<&str> = Vec::new();
    if feishu_configured   { bots.push("飞书"); }
    if telegram_configured { bots.push("Telegram"); }
    if discord_configured  { bots.push("Discord"); }
    let bot_list = bots.join("、");

    if !block_active {
        return SecurityCheck {
            id:     "im_connector".into(),
            label:  "IM 连接器曝露".into(),
            status: "danger".into(),
            detail: format!(
                "已配置 {bot_list} 机器人，且网络未设置访问限制。\
                 IM 云服务器可从公网中转请求到您的 AI 网关，\
                 外部用户理论上均可与您的 AI 交互。\
                 建议启用「仅本机」或「仅内网」访问限制。"
            ),
        };
    }

    SecurityCheck {
        id:     "im_connector".into(),
        label:  "IM 连接器曝露".into(),
        status: "warn".into(),
        detail: format!(
            "已配置 {bot_list} 机器人，但当前防火墙规则会阻止云端服务器的连接请求（IM 机器人将无法工作）。\
             如需使用 IM 连接，需开放网络访问，这会降低安全评分。\
             推荐使用「手机 App + Tailscale VPN」替代 IM 机器人，安全评分更高。"
        ),
    }
}

/// Run all security checks and return a full report with score.
#[tauri::command]
pub fn scan_security_status(port: u16) -> SecurityReport {
    // Query the block rule once and share the result to avoid duplicate netsh calls.
    let block_active = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    )).contains(&format!("ClawNo11_Block_Port_{port}"));

    let checks = vec![
        check_network_access_mode_cached(port, block_active),
        check_im_connector_exposure_cached(port, block_active),
        check_port_exposure(port),
        check_node_version(),
        check_pm2_status(),
        check_offline_mode(),
    ];
    let score = calculate_score(&checks);
    SecurityReport { score, checks }
}

/// List all active TCP/UDP connections on the given OpenClaw port.
/// Fix S-8: LISTENING rows are not "local" connections.
/// Fix S-9: UDP has no State column — parse column layout by protocol.
#[tauri::command]
pub fn get_port_connections(port: u16) -> Vec<PortConnection> {
    let output = run_cmd(&format!("netstat -ano | findstr \":{port}\""));

    output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // netstat columns:
            //   TCP:  Proto  Local  Foreign  State  PID   (5 cols)
            //   UDP:  Proto  Local  Foreign  PID    (4 cols, no State)
            if parts.len() < 4 {
                return None;
            }

            let proto       = parts[0].to_uppercase();
            let local_addr  = parts.get(1).unwrap_or(&"").to_string();
            let remote_addr = parts.get(2).unwrap_or(&"").to_string();

            let (state, pid) = if proto.starts_with("TCP") && parts.len() >= 5 {
                (
                    parts.get(3).unwrap_or(&"").to_string(),
                    parts.get(4).unwrap_or(&"-").to_string(),
                )
            } else {
                // UDP: column 3 is PID, no State
                ("".to_string(), parts.get(3).unwrap_or(&"-").to_string())
            };

            if !local_addr.contains(&format!(":{port}")) {
                return None;
            }

            let is_listening = state == "LISTENING";

            // Only established loopback connections qualify as "local".
            // LISTENING sockets have no remote peer, so they are neither local nor external.
            let is_local = !is_listening && (
                remote_addr.starts_with("127.0.0.1")
                    || remote_addr.starts_with("::1")
                    || remote_addr.starts_with("[::1]")
            );

            Some(PortConnection {
                local_addr,
                remote_addr,
                state,
                pid,
                is_local,
                is_listening,
            })
        })
        .collect()
}

/// Check whether the ClawNo.11 firewall rules for the given port are currently active.
/// Used by the frontend to restore firewall toggle state across page reloads (fix F-2).
#[tauri::command]
pub fn check_firewall_active(port: u16) -> bool {
    // The "local-only" Kill Switch is active only when the block rule exists
    // AND there are no subnet / tailscale allow rules widening the scope.
    // (subnet and tailscale modes also add a Block rule, so checking block
    // alone would cause a false-positive — the UI would show "已启用" even
    // when Tailscale/subnet mode is selected.)
    let has_block = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
    )).contains(&format!("ClawNo11_Block_Port_{port}"));

    if !has_block {
        return false;
    }

    let has_subnet = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Subnet_{port}\""
    )).contains(&format!("ClawNo11_Allow_Subnet_{port}"));

    let has_tailscale = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Tailscale_{port}\""
    )).contains(&format!("ClawNo11_Allow_Tailscale_{port}"));

    // True only when block is present with no wider-scope allow rules.
    !has_subnet && !has_tailscale
}

/// Add a Windows Firewall rule to allow only localhost access to the given port.
///
/// Fix S-1: Allow rule is added BEFORE Block so a partial failure never fully locks out the port.
/// Fix S-3: Existing rules are deleted first (idempotent — safe to call multiple times).
/// Fix S-4: Uses exit-code success check instead of English "Ok." string matching.
#[tauri::command]
pub fn apply_local_only_firewall(port: u16) -> Result<String, String> {
    // Remove stale rules first to guarantee idempotency.
    remove_rules_for_port(port);
    // Also clean up any leftover subnet / tailscale allow rules so they don't
    // override the local-only intent detected by check_network_access_mode.
    remove_network_mode_rules(port);

    let allow_cmd = format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Allow_Local_{port}\" \
         protocol=TCP dir=in localport={port} remoteip=127.0.0.1 action=allow"
    );
    let block_cmd = format!(
        "netsh advfirewall firewall add rule name=\"ClawNo11_Block_Port_{port}\" \
         protocol=TCP dir=in localport={port} action=block"
    );

    // Allow rule first — if block fails we can roll back without locking out localhost.
    let (allow_ok, _, allow_err) = shell_result(&allow_cmd);
    if !allow_ok {
        return Err(format!(
            "⚠️ 防火墙放行规则设置失败（可能缺少管理员权限），端口 {port} 未做任何修改。\n\
             请以管理员身份重新运行本应用。\n错误: {allow_err}"
        ));
    }

    let (block_ok, _, block_err) = shell_result(&block_cmd);
    if !block_ok {
        // Roll back the allow rule so no partial state is left.
        let _ = shell_result(&format!(
            "netsh advfirewall firewall delete rule name=\"ClawNo11_Allow_Local_{port}\""
        ));
        return Err(format!(
            "⚠️ 防火墙阻断规则设置失败，已自动回滚放行规则，端口 {port} 未受任何修改。\n\
             错误: {block_err}"
        ));
    }

    // Persist mode so NetworkAccessPanel reads "local" on next load.
    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String("local".to_string());
    let _ = write_ip_allowlist_json(&json);

    Ok(format!("防火墙规则已应用：端口 {port} 仅允许本机访问。"))
}

/// Remove the ClawNo.11 firewall rules for the given port.
/// Fix S-2: now reports meaningful status instead of silently discarding results.
#[tauri::command]
pub fn remove_local_only_firewall(port: u16) -> Result<String, String> {
    let was_active = check_firewall_active(port);
    remove_rules_for_port(port);
    // Reset persisted mode to "off" so NetworkAccessPanel reflects reality.
    let mut json = read_ip_allowlist_json();
    json[format!("access_mode_{port}")] = serde_json::Value::String("off".to_string());
    let _ = write_ip_allowlist_json(&json);
    if was_active {
        Ok(format!("端口 {port} 的防火墙规则已移除。"))
    } else {
        Ok(format!("端口 {port} 无活跃防火墙规则，无需移除。"))
    }
}
