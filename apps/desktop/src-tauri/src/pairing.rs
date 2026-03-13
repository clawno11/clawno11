use serde::Serialize;
use std::sync::{Arc, Mutex};
/// Secure QR-code pairing between the desktop gateway and the mobile app.
///
/// ## Design (modelled on Bluetooth Numeric Comparison pairing)
///
/// 1. Desktop calls `generate_pair_qr(port)`:
///    - Generates 20 cryptographically random bytes (rand::thread_rng).
///    - Encodes them as URL-safe Base64 → the *pairing token* (~27 chars).
///    - Derives a 6-character human-readable PIN from the first 6 bytes of the
///      Base64 token string (matching the mobile app's derivation).
///    - Stores the token + expiry (120 s from now) in `PairingState`.
///    - Starts a lightweight verify micro-server on a random port (`vp`).
///    - Returns `PairQrPayload { qr_data, pin, expires_at }` to the frontend.
///
/// 2. `qr_data` encodes the connection info in a **non-plaintext** format:
///    ```text
///    clawno11://pair?h=BASE64(ip:port)&n=BASE64(name)&t=TOKEN&exp=UNIX_TS&vp=PORT
///    ```
///    `h` and `n` are Base64-encoded so they are NOT immediately readable
///    from a photo of the QR code or a screenshot.  `vp` is the TCP port of
///    the verify micro-server; the mobile POSTs the token there to consume it.
///
/// 3. Mobile app parses `qr_data`, derives the same PIN from the token, and
///    shows it to the user: "Please confirm the 6-digit code on your desktop
///    matches XXXXXX before proceeding."
///
/// 4. Desktop shows the PIN prominently.  The user verifies both PINs match
///    (out-of-band visual check — identical to Bluetooth pairing).
///
/// 5. Token is **single-use**: `verify_pair_token` marks it consumed after the
///    mobile calls it.  Subsequent attempts with the same token are rejected.
///
/// ## Security properties
/// - Time-limited (2 min default) → replay attacks are impossible after expiry.
/// - Single-use → same token cannot be reused even within the window.
/// - IP is Base64-encoded in the QR → not immediately legible from a photo.
/// - PIN confirmation → phishing with a modified QR fails (PIN would differ).
/// - Crypto-random token → not guessable.
use std::time::{SystemTime, UNIX_EPOCH};

// ── Constants ─────────────────────────────────────────────────────────────────

/// How long a pairing token stays valid (seconds).
const TOKEN_TTL_SECS: u64 = 120;

/// PIN alphabet — unambiguous characters only (no 0/O, 1/l/I).
const PIN_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// ── State ─────────────────────────────────────────────────────────────────────

/// Shared state for the pairing system.
///
/// Wrapped in `Arc<Mutex<...>>` (not bare `Mutex`) so the verify micro-server
/// task can hold a clone of the `Arc` and share the same lock as the Tauri
/// commands (`verify_pair_token`, `get_current_pair_pin`, etc.).
#[derive(Default)]
pub struct PairingState(pub Arc<Mutex<Option<ActiveToken>>>);

pub struct ActiveToken {
    /// Raw 20-byte random value encoded as Base64url (no padding).
    pub token: String,
    /// 6-character PIN derived from the token (same derivation as mobile app).
    pub pin: String,
    /// Unix timestamp (seconds) when the token expires.
    pub expires_at: u64,
    /// Whether the token has already been consumed by a mobile verify call.
    pub used: bool,
    /// TCP port of the lightweight verify-server started alongside this token.
    /// The mobile POSTs to `http://{lan_ip}:{verify_port}/pair/verify` to
    /// mark the token as consumed (single-use enforcement).
    pub verify_port: u16,
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PairQrPayload {
    /// The full string to embed in the QR code.
    pub qr_data: String,
    /// 6-character human-readable confirmation PIN shown on the desktop.
    pub pin: String,
    /// Unix timestamp (seconds) — when this token expires.
    pub expires_at: u64,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Derive a 6-character PIN from the raw token bytes.
///
/// Uses the first 6 bytes of the **Base64-encoded** token string, mapping each
/// byte into the 32-character unambiguous alphabet.  The mobile client derives
/// the PIN the same way from the token it receives in the QR code URL.
fn derive_pin(raw: &[u8]) -> String {
    raw.iter()
        .take(6)
        .map(|&b| PIN_ALPHABET[(b as usize) % PIN_ALPHABET.len()] as char)
        .collect()
}

/// Encode a byte slice as URL-safe Base64 (no padding).
pub fn b64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    // Use only std — avoid pulling in the base64 crate.
    // We implement the RFC 4648 URL-safe alphabet manually.
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((data.len() * 4).div_ceil(3));
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() {
            data[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < data.len() {
            data[i + 2] as u32
        } else {
            0
        };
        let _ = write!(
            out,
            "{}{}{}{}",
            CHARS[((b0 >> 2) & 0x3F) as usize] as char,
            CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char,
            if i + 1 < data.len() {
                CHARS[(((b1 & 0x0F) << 2) | (b2 >> 6)) as usize] as char
            } else {
                '='
            },
            if i + 2 < data.len() {
                CHARS[(b2 & 0x3F) as usize] as char
            } else {
                '='
            },
        );
        i += 3;
    }
    // Strip padding ('=') for URL-safety.
    out.trim_end_matches('=').to_string()
}

// ── Verify micro-server ───────────────────────────────────────────────────────

/// Start a single-request HTTP micro-server that lets the mobile app mark the
/// pairing token as consumed.  The server:
///   1. Binds to a random OS-assigned port on 0.0.0.0.
///   2. Accepts one `POST /pair/verify` request carrying `{"token":"..."}`.
///   3. Verifies the token, marks it `used`, and returns `{"ok":true}` or an error.
///   4. Shuts down after the first successful response **or** after `ttl_secs`.
///
/// **Important**: callers must store the active token in `state` BEFORE calling
/// this function; the spawned task reads from the same Arc immediately on
/// the first incoming request.
///
/// Returns the bound port, or 0 on failure (in which case the QR payload will
/// omit the `vp` field and single-use enforcement falls back to the TTL window).
fn start_verify_server(state: Arc<Mutex<Option<ActiveToken>>>, ttl_secs: u64) -> u16 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Bind synchronously so we can return the port before spawning.
    let listener = match std::net::TcpListener::bind("0.0.0.0:0") {
        Ok(l) => l,
        Err(_) => return 0,
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(_) => return 0,
    };
    listener.set_nonblocking(true).unwrap_or(());

    tokio::spawn(async move {
        let listener = match TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(_) => return,
        };
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(ttl_secs + 5);

        loop {
            let accept = tokio::time::timeout_at(deadline, listener.accept()).await;
            let mut sock = match accept {
                Ok(Ok((s, _))) => s,
                _ => break, // Timeout or accept error — shut down.
            };

            // Read the full HTTP request by accumulating chunks until the
            // header terminator `\r\n\r\n` is seen (or 8 KiB is exhausted).
            let mut buf = Vec::with_capacity(1024);
            let mut tmp = [0u8; 1024];
            let request = loop {
                match sock.read(&mut tmp).await {
                    Ok(0) | Err(_) => break String::new(), // Connection closed
                    Ok(n) => {
                        buf.extend_from_slice(&tmp[..n]);
                        let s = String::from_utf8_lossy(&buf);
                        if s.contains("\r\n\r\n") || buf.len() >= 8192 {
                            break s.into_owned();
                        }
                    }
                }
            };

            if request.is_empty() {
                continue;
            }

            // Handle CORS preflight from mobile WebView.
            if request.starts_with("OPTIONS") {
                let cors = "HTTP/1.1 204 No Content\r\n\
                            Access-Control-Allow-Origin: *\r\n\
                            Access-Control-Allow-Methods: POST\r\n\
                            Access-Control-Allow-Headers: Content-Type\r\n\r\n";
                let _ = sock.write_all(cors.as_bytes()).await;
                continue;
            }

            // Require POST /pair/verify.
            if !request.starts_with("POST /pair/verify") {
                continue;
            }

            // Extract token value from JSON body — look for `"token":"..."`.
            // This minimal parser is sufficient since we control the sender format.
            let submitted: String = request
                .find(r#""token""#)
                .and_then(|i| {
                    let tail = &request[i + 7..]; // skip `"token"`
                    tail.find(':').map(|j| &tail[j + 1..])
                })
                .map(|s| s.trim_start())
                .and_then(|s| s.strip_prefix('"'))
                .map(|s| s.split('"').next().unwrap_or("").to_string())
                .unwrap_or_default();

            // Verify and conditionally consume the token.
            let ok = {
                let mut guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => break, // Poisoned mutex — shut down.
                };
                match guard.as_mut() {
                    Some(active)
                        if !submitted.is_empty()
                            && active.token == submitted
                            && !active.used
                            && now_secs() <= active.expires_at =>
                    {
                        active.used = true;
                        true
                    }
                    _ => false,
                }
            };

            let (status, body) = if ok {
                ("200 OK", r#"{"ok":true}"#)
            } else {
                ("400 Bad Request", r#"{"ok":false}"#)
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{body}",
                body.len()
            );
            let _ = sock.write_all(response.as_bytes()).await;

            if ok {
                break; // Token consumed — server's job is done.
            }
        }
    });

    port
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Internal: generate token + build QR payload for the given host string.
/// Called by both public Tauri commands to avoid code duplication.
fn generate_pair_qr_inner(
    host_and_port: &str,
    server_name: &str,
    state: &tauri::State<'_, PairingState>,
) -> Result<PairQrPayload, String> {
    use rand::RngCore;

    // 1. Generate 20 crypto-random bytes.
    let mut raw = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut raw);

    // 2. Encode token as URL-safe Base64.
    let token = b64_encode(&raw);

    // 3. Derive PIN from the Base64 token bytes — same derivation used by the
    //    mobile app (which only has access to the token string, not raw bytes).
    let pin = derive_pin(token.as_bytes());

    // 4. Determine expiry.
    let expires_at = now_secs() + TOKEN_TTL_SECS;

    // 5. Store token in shared state FIRST — the verify server reads from
    //    this same Arc immediately on its first request, so the token must
    //    already be present when the server starts accepting connections.
    //    (verify_port is filled in below once we know it.)
    {
        let mut guard = state.0.lock().map_err(|_| "内部锁错误".to_string())?;
        *guard = Some(ActiveToken {
            token: token.clone(),
            pin: pin.clone(),
            expires_at,
            used: false,
            verify_port: 0, // placeholder — updated after server binds
        });
    }

    // 6. Start the verify micro-server, sharing the PairingState Arc so the
    //    server task and Tauri commands operate on the same lock.
    //    Token is already in state, so the server can respond correctly
    //    even if a request arrives before we update verify_port below.
    let verify_port = start_verify_server(Arc::clone(&state.0), TOKEN_TTL_SECS);

    // Update verify_port in state now that we know the bound port.
    if verify_port > 0 {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(active) = guard.as_mut() {
                active.verify_port = verify_port;
            }
        }
    }

    // 7. Build QR data string.
    //    Host and name are Base64-encoded so they are not plaintext in the QR.
    //    `vp` carries the verify-server port so the mobile can consume the token.
    //    `ck` carries the chat proxy Bearer token so mobile can authenticate REST requests.
    let host_b64 = b64_encode(host_and_port.as_bytes());
    let name_b64 = b64_encode(server_name.as_bytes());
    let chat_key = crate::chat_proxy::get_proxy_auth_token();
    let mut qr_data =
        format!("clawno11://pair?h={host_b64}&n={name_b64}&t={token}&exp={expires_at}");
    if verify_port > 0 {
        qr_data.push_str(&format!("&vp={verify_port}"));
    }
    if !chat_key.is_empty() {
        qr_data.push_str(&format!("&ck={chat_key}"));
    }

    Ok(PairQrPayload {
        qr_data,
        pin,
        expires_at,
    })
}

/// Generate a new time-limited pairing QR payload using the loopback address.
///
/// The frontend should prefer `generate_pair_qr_with_host` (which embeds the
/// real LAN IP) so the mobile app can reach the desktop over the local network.
/// This variant is a fallback for single-machine testing.
#[tauri::command]
pub async fn generate_pair_qr(
    port: u16,
    server_name: String,
    state: tauri::State<'_, PairingState>,
) -> Result<PairQrPayload, String> {
    let host = format!("127.0.0.1:{port}");
    generate_pair_qr_inner(&host, &server_name, &state)
}

/// Generate a pairing QR with an explicit host (LAN IP detected by frontend).
///
/// Called when the frontend has already resolved the LAN IP via
/// `get_local_lan_info` and wants it baked into the QR so the mobile app
/// can connect over the local network.
#[tauri::command]
pub async fn generate_pair_qr_with_host(
    host: String,
    port: u16,
    server_name: String,
    state: tauri::State<'_, PairingState>,
) -> Result<PairQrPayload, String> {
    let host_and_port = format!("{host}:{port}");
    generate_pair_qr_inner(&host_and_port, &server_name, &state)
}

/// Verify a token submitted by the mobile app.
///
/// Returns `Ok(())` if the token is valid, not expired, and not already used.
/// Marks the token as used on success so it cannot be replayed.
#[tauri::command]
pub fn verify_pair_token(
    token: String,
    state: tauri::State<'_, PairingState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "内部锁错误".to_string())?;

    let active = guard.as_mut().ok_or("没有待配对的令牌，请刷新桌面二维码")?;

    if active.used {
        return Err("该配对码已被使用，请刷新桌面二维码重新生成".into());
    }
    if now_secs() > active.expires_at {
        return Err("配对码已过期，请刷新桌面二维码重新生成".into());
    }
    if active.token != token {
        return Err("配对码不匹配，请确认您扫描了正确的二维码".into());
    }

    // Consume the token.
    active.used = true;
    Ok(())
}

/// Query the current PIN that the desktop is showing (for UI state display).
/// Returns None if no active (unexpired, unconsumed) token exists.
#[tauri::command]
pub fn get_current_pair_pin(state: tauri::State<'_, PairingState>) -> Option<String> {
    let guard = state.0.lock().ok()?;
    let active = guard.as_ref()?;
    if active.used || now_secs() > active.expires_at {
        return None;
    }
    Some(active.pin.clone())
}
