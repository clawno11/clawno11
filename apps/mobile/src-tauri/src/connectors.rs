/**
 * Connectors — mobile implementation.
 *
 * Tailscale: On mobile we can't run `tailscale version` as a subprocess.
 * Instead we detect Tailscale connectivity by:
 *   1. Trying a UDP "connect" trick to get the local IP
 *   2. Checking if the local IP is in the Tailscale CGNAT range (100.64.0.0/10)
 *
 * The user configures the remote server's Tailscale URL manually in ConnectPage.
 */
use crate::types::TailscaleStatus;
use std::net::UdpSocket;

/// Detect if Tailscale (or a compatible VPN such as xEdge) is active on this device.
///
/// Uses the UDP "connect trick": bind a UDP socket and connect to an external address.
/// The OS picks the outbound source interface without sending any packet.
/// If the resulting local IP is in the Tailscale CGNAT range (100.64.0.0/10), the VPN
/// is active.
///
/// We only probe 100.100.100.100 (Tailscale MagicDNS) because:
///   - A route to that address only exists when Tailscale/xEdge is running.
///   - Using a public address (e.g. 8.8.8.8) as fallback is incorrect — when Tailscale
///     does *not* do full-traffic routing the OS picks the default WAN interface, whose
///     IP is never in the 100.64/10 range, so the check always fails and adds confusion.
fn detect_tailscale_ip() -> Option<String> {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("100.100.100.100:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if is_tailscale_ip(&ip) {
                    return Some(ip);
                }
            }
        }
    }
    None
}

/// Check if an IPv4 address is in the Tailscale CGNAT range: 100.64.0.0/10
fn is_tailscale_ip(ip: &str) -> bool {
    if let Ok(parsed) = ip.parse::<std::net::Ipv4Addr>() {
        let octets = parsed.octets();
        // 100.64.0.0/10: first octet = 100, second octet = 64..127
        octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127
    } else {
        false
    }
}

#[tauri::command]
pub async fn get_tailscale_status() -> Result<TailscaleStatus, String> {
    let ip = detect_tailscale_ip();
    let running = ip.is_some();

    Ok(TailscaleStatus {
        // On mobile we can't detect installation via CLI; if VPN IP found, assume installed
        installed: running,
        running,
        ip,
        version: None, // Not available without CLI
    })
}

/// Probe a remote server URL and return whether it's reachable.
/// Used by ConnectPage to validate user-entered gateway URLs.
#[tauri::command]
pub async fn probe_gateway_url(url: String) -> Result<bool, String> {
    let health_url = format!("{}/health", url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&health_url).send().await {
        Ok(r) => Ok(r.status().as_u16() < 500),
        Err(_) => Ok(false),
    }
}
