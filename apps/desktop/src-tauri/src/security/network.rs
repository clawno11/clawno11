use super::{read_ip_allowlist_json, write_ip_allowlist_json, AllowedIpEntry, LanInfo};
/// IP allowlist and LAN discovery commands.
use crate::platform::{shell_output as run_cmd, shell_result};

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Sanitise an IP string into a suffix safe for use in a Windows Firewall rule name.
fn safe_ip(ip: &str) -> String {
    ip.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn ip_allow_rule_name(port: u16, ip: &str) -> String {
    format!("ClawNo11_Allow_IP_{port}_{}", safe_ip(ip))
}

/// Convert a dotted-decimal subnet mask string to a CIDR prefix length.
fn mask_to_prefix(mask: &str) -> Option<u8> {
    let parts: Vec<u8> = mask
        .split('.')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    if parts.len() != 4 {
        return None;
    }
    let bits = parts.iter().fold(0u32, |acc, &b| (acc << 8) | u32::from(b));
    Some(bits.count_ones() as u8)
}

/// Calculate the network address (host bits zeroed) for an IP + prefix length.
fn ip_to_network(ip: &str, prefix: u8) -> Option<String> {
    let parts: Vec<u8> = ip.split('.').filter_map(|s| s.parse().ok()).collect();
    if parts.len() != 4 {
        return None;
    }
    let ip_int = u32::from_be_bytes([parts[0], parts[1], parts[2], parts[3]]);
    let mask = if prefix == 0 {
        0u32
    } else {
        !0u32 << (32 - prefix)
    };
    let net = ip_int & mask;
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
            if (t.contains("IPv4") || t.contains("IP Address")) && t.contains(target_ip) {
                found = true;
            }
        } else {
            if t.contains("Subnet Mask") || t.contains("子网掩码") {
                if let Some(mask_str) = t.split(':').next_back() {
                    return mask_to_prefix(mask_str.trim());
                }
            }
            if t.contains("IPv4") || t.contains("IPv6") || t.is_empty() {
                break;
            }
        }
    }
    None
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Return all IP whitelist entries for the given port (plus entries with port == 0 as "any port").
#[tauri::command]
pub fn get_allowed_ips(port: u16) -> Vec<AllowedIpEntry> {
    let json = read_ip_allowlist_json();
    let map = match json.get("ips").and_then(|v| v.as_object()) {
        Some(m) => m.clone(),
        None => return vec![],
    };
    map.values()
        .filter_map(|v| serde_json::from_value::<AllowedIpEntry>(v.clone()).ok())
        .filter(|e| e.port == port || e.port == 0)
        .collect()
}

/// Add a new IP to the whitelist and create a Windows Firewall allow-rule for it.
#[tauri::command]
pub fn add_allowed_ip(port: u16, ip: String, label: String) -> Result<AllowedIpEntry, String> {
    let ip = ip.trim().to_string();
    if ip.is_empty() {
        return Err("IP 地址不能为空".into());
    }
    if ip.contains('"') || ip.contains('\'') || ip.contains(';') {
        return Err("IP 地址含有非法字符".into());
    }

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

    let entry = AllowedIpEntry {
        ip: ip.clone(),
        label: if label.trim().is_empty() {
            ip.clone()
        } else {
            label
        },
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

    let mut json = read_ip_allowlist_json();
    let key = format!("{port}_{}", safe_ip(&ip));
    if let Some(ips) = json.get_mut("ips").and_then(|v| v.as_object_mut()) {
        ips.remove(&key);
    }
    write_ip_allowlist_json(&json)?;

    Ok(())
}

/// Discover live hosts on the local network using the ARP cache (instant, no admin required).
#[tauri::command]
pub fn scan_lan_devices() -> Vec<String> {
    let output = run_cmd("arp -a");
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                return None;
            }
            let ip = parts[0];
            let ok = ip.starts_with("192.168.")
                || ip.starts_with("10.")
                || (ip.starts_with("172.") && {
                    let second: u8 = ip
                        .split('.')
                        .nth(1)
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    (16..=31).contains(&second)
                });
            if ok {
                Some(ip.to_string())
            } else {
                None
            }
        })
        .collect()
}

/// True when an IPv4 string falls in a common private LAN range
/// (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
fn is_private_lan_ip(ip: &str) -> bool {
    let parts: Vec<u8> = ip.split('.').filter_map(|s| s.parse().ok()).collect();
    if parts.len() != 4 {
        return false;
    }
    match parts[0] {
        10 => true,
        172 => (16..=31).contains(&parts[1]),
        192 => parts[1] == 168,
        _ => false,
    }
}

/// Detect the machine's primary outbound LAN IP and the subnet it belongs to.
///
/// When a VPN/proxy is active the default-route trick may return a virtual
/// interface IP (198.18.x.x, 100.x.x.x, etc.).  In that case we fall back
/// to enumerating all interfaces and picking the first private LAN address.
#[tauri::command]
pub fn get_local_lan_info() -> Option<LanInfo> {
    let udp_ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            Ok(s)
        })
        .ok()
        .and_then(|s| s.local_addr().ok())
        .map(|a| a.ip().to_string())
        .filter(|ip| !ip.starts_with("127."));

    let ip = match &udp_ip {
        Some(ip) if is_private_lan_ip(ip) => ip.clone(),
        _ => find_private_lan_ip().or(udp_ip)?,
    };

    let prefix = subnet_prefix_for_ip(&ip).unwrap_or(24);
    let subnet = ip_to_network(&ip, prefix)?;
    Some(LanInfo { ip, subnet, prefix })
}

/// Enumerate network interfaces via OS commands and return the first
/// private LAN IPv4 address found.
fn find_private_lan_ip() -> Option<String> {
    find_all_private_lan_ips().into_iter().next()
}

/// Enumerate ALL private LAN IPv4 addresses from all network interfaces.
fn find_all_private_lan_ips() -> Vec<String> {
    let mut ips = Vec::new();
    #[cfg(target_os = "windows")]
    {
        let out = run_cmd("ipconfig");
        for line in out.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("IPv4") {
                let addr = rest
                    .split(':')
                    .nth(1)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                if is_private_lan_ip(&addr) && !ips.contains(&addr) {
                    ips.push(addr);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let out = run_cmd("ifconfig");
        for line in out.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("inet ") && !trimmed.contains("127.0.0.1") {
                if let Some(addr) = trimmed.split_whitespace().nth(1) {
                    if is_private_lan_ip(addr) {
                        let addr = addr.to_string();
                        if !ips.contains(&addr) {
                            ips.push(addr);
                        }
                    }
                }
            }
        }
    }
    ips
}

/// Return all detected private LAN IPv4 addresses.
#[tauri::command]
pub fn get_all_lan_ips() -> Vec<String> {
    find_all_private_lan_ips()
}
