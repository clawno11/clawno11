/// SSH remote deployment — step-by-step deployment to a remote Linux server via SSH.
///
/// All scripts are wrapped in a `bash << 'CLAWDEPLOY'` heredoc so they always
/// execute in bash, regardless of the user's login shell on the server (e.g. dash
/// on Debian/Ubuntu where /bin/sh is not bash).
///
/// Supported auth methods (tried in order):
///   1. Private key (PEM / OpenSSH format, pasted by user)
///   2. Password

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::time::Duration;
use async_trait::async_trait;
use serde::Deserialize;
use tokio::time::timeout;

use crate::types::StepResult;

// ── SSH connection args (passed from frontend per step) ───────────────────────

#[derive(Deserialize, Clone)]
pub struct SshArgs {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    #[serde(rename = "privateKey")]
    pub private_key: Option<String>,
    #[serde(rename = "gatewayPort")]
    pub gateway_port: u16,
}

// ── TOFU (Trust On First Use) SSH host key verification ───────────────────────
//
// First connection to a host:port → accept the key and persist its fingerprint.
// Subsequent connections → reject if the fingerprint has changed (MITM defence).
// Known hosts are stored in ~/.clawno11/ssh_known_hosts.json.

fn known_hosts_path() -> String {
    crate::platform::path_join(
        &crate::platform::path_join(&crate::platform::user_home(), ".clawno11"),
        "ssh_known_hosts.json",
    )
}

fn load_known_hosts() -> HashMap<String, String> {
    std::fs::read_to_string(known_hosts_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_known_host(host_id: &str, fingerprint: &str) {
    let path = known_hosts_path();
    if let Some(dir) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut hosts = load_known_hosts();
    hosts.insert(host_id.to_string(), fingerprint.to_string());
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&hosts).unwrap_or_default());
}

struct TofuHandler {
    expected_fp: Option<String>,
    actual_fp: Arc<std::sync::Mutex<Option<String>>>,
    rejected: Arc<AtomicBool>,
}

#[async_trait]
impl russh::client::Handler for TofuHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        use russh_keys::PublicKeyBase64;
        let fp = format!("{}:{}", server_public_key.name(), server_public_key.public_key_base64());

        if let Ok(mut guard) = self.actual_fp.lock() {
            *guard = Some(fp.clone());
        }

        match &self.expected_fp {
            None => Ok(true),
            Some(expected) if expected == &fp => Ok(true),
            Some(_) => {
                self.rejected.store(true, Ordering::SeqCst);
                Ok(false)
            }
        }
    }
}

// ── Core SSH exec helper ──────────────────────────────────────────────────────

/// Connect, authenticate, and run `script` on the remote inside a bash shell.
///
/// Scripts are wrapped in `bash << 'CLAWDEPLOY'` so they always run in bash even
/// when the user's login shell is dash (Ubuntu/Debian default /bin/sh).
async fn ssh_exec(args: &SshArgs, script: &str) -> Result<(u32, String), String> {
    use russh::ChannelMsg;

    let host_id = format!("{}:{}", args.host, args.port);
    let known = load_known_hosts();
    let expected_fp = known.get(&host_id).cloned();
    let actual_fp = Arc::new(std::sync::Mutex::new(None));
    let rejected = Arc::new(AtomicBool::new(false));

    let handler = TofuHandler {
        expected_fp: expected_fp.clone(),
        actual_fp: Arc::clone(&actual_fp),
        rejected: Arc::clone(&rejected),
    };

    let config = Arc::new(russh::client::Config::default());

    let mut session = timeout(
        Duration::from_secs(15),
        russh::client::connect(config, (args.host.as_str(), args.port), handler),
    )
    .await
    .map_err(|_| "ssh-connect-timeout".to_string())?
    .map_err(|e| {
        if rejected.load(Ordering::SeqCst) {
            format!(
                "ssh-host-key-changed:{host_id} — the server's host key has changed since the \
                 last connection, which could indicate a man-in-the-middle attack. \
                 If the server was legitimately re-provisioned, delete the entry in \
                 ~/.clawno11/ssh_known_hosts.json and retry."
            )
        } else {
            format!("ssh-connect-failed:{e}")
        }
    })?;

    // Authenticate — private key first, then password.
    let mut authed = false;

    if let Some(ref pem) = args.private_key {
        if !pem.trim().is_empty() {
            match russh_keys::decode_secret_key(pem, None) {
                Ok(key_pair) => {
                    if let Ok(ok) = session
                        .authenticate_publickey(&args.username, Arc::new(key_pair))
                        .await
                    {
                        authed = ok;
                    }
                }
                Err(e) => return Err(format!("ssh-key-parse-failed:{e}")),
            }
        }
    }

    if !authed {
        if let Some(ref pass) = args.password {
            if !pass.is_empty() {
                authed = session
                    .authenticate_password(&args.username, pass)
                    .await
                    .unwrap_or(false);
            }
        }
    }

    if !authed {
        return Err("ssh-auth-failed".to_string());
    }

    // TOFU: persist the fingerprint after successful auth on first connection.
    if expected_fp.is_none() {
        if let Ok(guard) = actual_fp.lock() {
            if let Some(ref fp) = *guard {
                save_known_host(&host_id, fp);
            }
        }
    }

    // Wrap in bash heredoc.  The exec request goes through `/bin/sh -c`, which
    // is POSIX and handles heredoc syntax even in dash — so bash gets the script.
    let bash_cmd = format!("bash << 'CLAWDEPLOY'\n{script}\nCLAWDEPLOY");

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("ssh-channel-failed:{e}"))?;

    channel
        .exec(true, bash_cmd)
        .await
        .map_err(|e| format!("ssh-exec-failed:{e}"))?;

    let mut output = String::new();
    let mut exit_code = 0u32;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                // stderr merged into output for error reporting
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = exit_status;
            }
            None => break,
            _ => {}
        }
    }

    Ok((exit_code, output.trim().to_string()))
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn last_line(out: &str) -> String {
    out.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Reject obviously malicious SSH args before any connection attempt.
fn validate_ssh_args(args: &SshArgs) -> Result<(), String> {
    if args.host.is_empty() || args.host.len() > 253 {
        return Err("invalid-host:empty or too long".into());
    }
    if args.host.contains(|c: char| c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$') {
        return Err("invalid-host:contains disallowed characters".into());
    }
    if args.username.is_empty() || args.username.len() > 64 {
        return Err("invalid-username:empty or too long".into());
    }
    if args.username.contains(|c: char| c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$') {
        return Err("invalid-username:contains disallowed characters".into());
    }
    if args.port == 0 {
        return Err("invalid-port:0".into());
    }
    Ok(())
}

// ── Common PATH setup (inlined in each script, no shebang needed) ─────────────
//
// NVM, fnm, and the npm global bin directory are added to PATH so that
// openclaw / node / pm2 can be found regardless of how they were installed.
// The shebang line (#!/usr/bin/env bash) is intentionally omitted — it has no
// effect when a script is passed as an exec string, and the bash heredoc wrapper
// in ssh_exec already guarantees bash execution.

// ── Step 1: Test SSH connection ───────────────────────────────────────────────

#[tauri::command]
pub async fn deploy_remote_connect(args: SshArgs) -> StepResult {
    if let Err(e) = validate_ssh_args(&args) {
        return StepResult::err(e);
    }
    match ssh_exec(&args, "echo connection-ok && uname -srm 2>/dev/null || echo ok").await {
        Ok((0, out)) => StepResult::ok(format!("ssh-connected:{}", last_line(&out))),
        Ok((code, out)) => StepResult::err(format!("ssh-exit-{code}:{out}")),
        Err(e) => StepResult::err(e),
    }
}

// ── Step 2: Check / install Node.js (≥ 18) ───────────────────────────────────
//
// Strategy (in order):
//   1. Use existing node if version ≥ 18
//   2. Install via fnm (no sudo, fast, pure-user)  — preferred
//   3. Fall back to system package manager (apt / yum) — requires sudo
//   4. Report failure with node-not-found

const CHECK_NODE_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

if command -v node >/dev/null 2>&1; then
    VER=$(node --version)
    MAJOR=$(echo "$VER" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -ge 18 ] 2>/dev/null; then
        echo "already-installed:$VER"
        exit 0
    fi
fi

# Install via fnm (no sudo required)
if ! command -v fnm >/dev/null 2>&1; then
    curl -fsSL https://fnm.vercel.app/install \
        | bash -s -- --install-dir "$HOME/.fnm" --skip-shell > /dev/null 2>&1 \
        || wget -qO- https://fnm.vercel.app/install \
        | bash -s -- --install-dir "$HOME/.fnm" --skip-shell > /dev/null 2>&1 \
        || true
    export PATH="$HOME/.fnm:$PATH"
fi

if command -v fnm >/dev/null 2>&1; then
    fnm install --lts > /dev/null 2>&1 && fnm use lts-latest > /dev/null 2>&1 || true
    eval "$(fnm env --shell bash 2>/dev/null)" || true
    if command -v node >/dev/null 2>&1; then
        echo "installed:$(node --version)"
        exit 0
    fi
fi

# Fallback: system package managers (require passwordless sudo — non-interactive SSH)
# sudo -n fails immediately if a password is required (no TTY in SSH session)
if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -n -E bash - > /dev/null 2>&1 || true
    sudo -n apt-get install -y nodejs > /dev/null 2>&1 || true
elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -n bash - > /dev/null 2>&1 || true
    sudo -n yum install -y nodejs > /dev/null 2>&1 || true
fi

if command -v node >/dev/null 2>&1; then
    echo "installed:$(node --version)"
else
    echo "node-not-found:"
    exit 1
fi
"#;

#[tauri::command]
pub async fn deploy_remote_check_node(args: SshArgs) -> StepResult {
    match ssh_exec(&args, CHECK_NODE_SCRIPT).await {
        Ok((0, out)) => StepResult::ok(last_line(&out)),
        Ok((_, out)) => StepResult::err(format!("node-not-found:{}", last_line(&out))),
        Err(e) => StepResult::err(e),
    }
}

// ── Step 3: Install OpenClaw ──────────────────────────────────────────────────
//
// npm output is redirected to /dev/null to keep last_line() meaningful.
// npm prefix -g replaces the deprecated npm bin -g (removed in npm 9+).

const INSTALL_OPENCLAW_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

# Install globally; suppress npm progress noise
npm install -g @openclaw/cli > /dev/null 2>&1

# Ensure the npm global bin directory is in PATH
# npm prefix -g replaces the deprecated `npm bin -g` (removed in npm 9+)
NPM_BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
export PATH="$NPM_BIN_DIR:$PATH"

if command -v openclaw >/dev/null 2>&1; then
    VER=$(openclaw --version 2>/dev/null || echo "unknown")
    echo "installed:$VER"
    exit 0
fi

echo "openclaw-not-found-after-install"
exit 1
"#;

#[tauri::command]
pub async fn deploy_remote_install_openclaw(args: SshArgs) -> StepResult {
    match ssh_exec(&args, INSTALL_OPENCLAW_SCRIPT).await {
        Ok((0, out)) => StepResult::ok(last_line(&out)),
        Ok((_, out)) => StepResult::err(format!("install-openclaw-failed:{}", last_line(&out))),
        Err(e) => StepResult::err(e),
    }
}

// ── Step 4: Onboard ───────────────────────────────────────────────────────────

const ONBOARD_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

openclaw onboard --yes > /dev/null 2>&1 || true
echo "config-initialized"
"#;

#[tauri::command]
pub async fn deploy_remote_onboard(args: SshArgs) -> StepResult {
    match ssh_exec(&args, ONBOARD_SCRIPT).await {
        Ok(_) => StepResult::ok("config-initialized".to_string()),
        Err(e) => StepResult::err(e),
    }
}

// ── Step 5: Start gateway ─────────────────────────────────────────────────────
//
// pm2 is preferred (auto-restart on crash); nohup is the fallback.
// `--interpreter none` tells pm2 the target is a native binary/shell script,
// not a Node.js module — prevents pm2 from trying to run it with node.
// After starting, we wait up to 15 s for the port to be listening.

#[tauri::command]
pub async fn deploy_remote_start_gateway(args: SshArgs) -> StepResult {
    let port = args.gateway_port;

    let script = format!(
        r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

CLAW_BIN=$(which openclaw 2>/dev/null || echo "openclaw")

# Ensure pm2 is available (install if missing)
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 > /dev/null 2>&1 || true
fi

if command -v pm2 >/dev/null 2>&1; then
    pm2 delete openclaw-gateway > /dev/null 2>&1 || true
    # --interpreter none: treat target as a native binary, not a Node module
    pm2 start "$CLAW_BIN" \
        --name openclaw-gateway \
        --interpreter none \
        -- gateway --port {port} --allow-unconfigured > /dev/null 2>&1
    pm2 save > /dev/null 2>&1 || true
else
    # nohup fallback
    pkill -f "openclaw gateway" > /dev/null 2>&1 || true
    mkdir -p ~/openclaw-logs
    nohup "$CLAW_BIN" gateway --port {port} --allow-unconfigured \
        > ~/openclaw-logs/gateway.log 2>&1 &
fi

# Wait up to 15 seconds for the port to be listening
for i in $(seq 1 15); do
    if nc -z localhost {port} > /dev/null 2>&1 || \
       curl -sf "http://localhost:{port}/" > /dev/null 2>&1; then
        echo "gateway-ready:{port}"
        exit 0
    fi
    sleep 1
done

echo "gateway-start-failed:port {port} not listening after 15s"
exit 1
"#
    );

    match ssh_exec(&args, &script).await {
        Ok((0, _)) => StepResult::ok(format!("gateway-ready:{port}")),
        Ok((_, out)) => StepResult::err(format!("gateway-start-failed:{}", last_line(&out))),
        Err(e) => StepResult::err(e),
    }
}
