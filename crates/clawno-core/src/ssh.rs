use serde::Deserialize;
use std::collections::HashMap;

/// SSH connection arguments passed from the frontend for each deploy step.
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

/// Reject obviously malicious SSH args before any connection attempt.
pub fn validate_ssh_input(host: &str, username: &str, port: u16) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 {
        return Err("invalid-host:empty or too long".into());
    }
    if host.contains(|c: char| {
        c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$'
    }) {
        return Err("invalid-host:contains disallowed characters".into());
    }
    if username.is_empty() || username.len() > 64 {
        return Err("invalid-username:empty or too long".into());
    }
    if username.contains(|c: char| {
        c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '`' || c == '$'
    }) {
        return Err("invalid-username:contains disallowed characters".into());
    }
    if port == 0 {
        return Err("invalid-port:0".into());
    }
    Ok(())
}

/// Minimal shell-escape: wraps in single quotes and escapes embedded single quotes.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Extract the last non-blank line from command output.
pub fn last_line(out: &str) -> String {
    out.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

// ── TOFU (Trust On First Use) host key verification ─────────────────────────
//
// Shared logic for verifying SSH server host keys. Both desktop and mobile
// apps use this to persist fingerprints and detect key changes (MITM defence).
// The actual `russh::client::Handler` impl lives in each app since it depends
// on russh types that core intentionally does not depend on.

/// Result of checking a server's host key against known hosts.
#[derive(Debug, Clone, PartialEq)]
pub enum HostKeyCheck {
    /// Key matches a previously stored fingerprint — safe to proceed.
    Trusted,
    /// First connection to this host — caller should persist the fingerprint.
    FirstUse(String),
    /// Fingerprint changed since last connection — possible MITM attack.
    Changed { expected: String, actual: String },
}

/// Build the host identifier used as key in the known-hosts store.
pub fn host_key_id(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

/// Format a server public key into a comparable fingerprint string.
///
/// Callers extract `key_name` and `key_base64` from the russh `PublicKey`
/// type (via `PublicKeyBase64` trait) and pass them here so that core
/// remains free of russh dependencies.
pub fn format_fingerprint(key_name: &str, key_base64: &str) -> String {
    format!("{key_name}:{key_base64}")
}

/// Check a server's host key fingerprint against the known hosts map.
pub fn check_host_key(
    known_hosts: &HashMap<String, String>,
    host_id: &str,
    fingerprint: &str,
) -> HostKeyCheck {
    match known_hosts.get(host_id) {
        None => HostKeyCheck::FirstUse(fingerprint.to_string()),
        Some(expected) if expected == fingerprint => HostKeyCheck::Trusted,
        Some(expected) => HostKeyCheck::Changed {
            expected: expected.clone(),
            actual: fingerprint.to_string(),
        },
    }
}

/// Load known hosts from a JSON file. Returns an empty map if the file
/// doesn't exist or can't be parsed.
pub fn load_known_hosts(path: &str) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persist a host fingerprint to the known-hosts JSON file.
/// Creates parent directories if they don't exist.
pub fn save_known_host(path: &str, host_id: &str, fingerprint: &str) {
    if let Some(dir) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut hosts = load_known_hosts(path);
    hosts.insert(host_id.to_string(), fingerprint.to_string());
    let _ = std::fs::write(
        path,
        serde_json::to_string_pretty(&hosts).unwrap_or_default(),
    );
}

/// Default path for the known-hosts file: `~/.clawno11/ssh_known_hosts.json`.
pub fn default_known_hosts_path() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&home)
        .join(".clawno11")
        .join("ssh_known_hosts.json")
        .to_string_lossy()
        .to_string()
}

/// Wrap a script in a bash heredoc for remote execution.
/// Guarantees bash execution regardless of the server's default shell.
pub fn wrap_bash_heredoc(script: &str) -> String {
    format!("bash << 'CLAWDEPLOY'\n{script}\nCLAWDEPLOY")
}

/// Wrap a command in `bash -l -c '...'` for remote execution.
/// Sources the user's login profile so nvm/fnm/PATH are available.
pub fn wrap_bash_login(cmd: &str) -> String {
    format!("bash -l -c {}", shell_escape(cmd))
}

// ── Remote management command templates ──────────────────────────────────────
//
// Standardised shell snippets for managing a remote OpenClaw gateway via SSH.
// Both desktop and mobile thin-wrappers can call these to avoid hard-coding
// pm2/CLI strings in platform code.

/// PATH preamble shared by all remote management commands.
/// Ensures nvm/fnm and npm global bin are available.
const PATH_PREAMBLE: &str = r#"export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true"#;

pub fn cmd_stop_gateway() -> String {
    format!("{PATH_PREAMBLE}\npm2 stop openclaw 2>/dev/null || true\necho gateway-stopped")
}

pub fn cmd_start_gateway() -> String {
    format!("{PATH_PREAMBLE}\npm2 start openclaw 2>/dev/null || true\necho gateway-started")
}

pub fn cmd_restart_gateway() -> String {
    format!("{PATH_PREAMBLE}\npm2 restart openclaw 2>/dev/null || true\necho gateway-restarted")
}

pub fn cmd_gateway_status() -> String {
    format!("{PATH_PREAMBLE}\npm2 jlist 2>/dev/null || echo no-pm2")
}

pub fn cmd_configure_api_key(provider: &str, api_key: &str) -> String {
    let escaped_provider = shell_escape(provider);
    let escaped_key = shell_escape(api_key);
    // Pipe the key via heredoc to avoid exposing it in the process argument list
    format!(
        "{PATH_PREAMBLE}\necho {escaped_key} | openclaw models auth paste-token --provider {escaped_provider} 2>&1 && echo api-key-configured || echo api-key-failed"
    )
}

pub fn cmd_check_node() -> String {
    format!("{PATH_PREAMBLE}\nnode --version 2>/dev/null || echo node-not-found")
}

// ── ClawNO11 Server deploy scripts ───────────────────────────────────────────

pub const INSTALL_CLAWNO_SERVER_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

_cs_check() {
    NPM_BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
    export PATH="$NPM_BIN_DIR:$HOME/.local/bin:$PATH"
    command -v clawno-server >/dev/null 2>&1
}

# Attempt 1: default registry
npm install -g @clawno/server 2>/dev/null && _cs_check && {
    echo "installed:$(clawno-server version 2>/dev/null || echo unknown)"; exit 0; }

# Attempt 2: China mirror
npm install -g @clawno/server --registry https://registry.npmmirror.com 2>/dev/null && _cs_check && {
    echo "installed:$(clawno-server version 2>/dev/null || echo unknown)"; exit 0; }

# Attempt 3: user prefix
USER_PREFIX="$HOME/.local"
mkdir -p "$USER_PREFIX/bin" 2>/dev/null
npm install -g @clawno/server --prefix "$USER_PREFIX" 2>/dev/null && {
    export PATH="$USER_PREFIX/bin:$PATH"
    _cs_check && { echo "installed:$(clawno-server version 2>/dev/null || echo unknown)"; exit 0; }
}

echo "clawno-server-not-found-after-install"
exit 1
"#;

pub fn start_clawno_server_script(port: u16, gateway_port: u16) -> String {
    format!(
        r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

CS_BIN=$(which clawno-server 2>/dev/null || echo "clawno-server")

if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 > /dev/null 2>&1 || true
fi

if command -v pm2 >/dev/null 2>&1; then
    pm2 delete clawno-server > /dev/null 2>&1 || true
    pm2 start "$CS_BIN" \
        --name clawno-server \
        --interpreter none \
        -- start --port {port} --gateway http://localhost:{gateway_port} > /dev/null 2>&1
    pm2 save > /dev/null 2>&1 || true
else
    pkill -f "clawno-server start" > /dev/null 2>&1 || true
    mkdir -p ~/clawno-server-logs
    nohup "$CS_BIN" start --port {port} --gateway http://localhost:{gateway_port} \
        > ~/clawno-server-logs/server.log 2>&1 &
fi

for i in $(seq 1 20); do
    if nc -z localhost {port} > /dev/null 2>&1 || \
       curl -sf "http://localhost:{port}/health" > /dev/null 2>&1; then
        echo "clawno-server-ready:{port}"
        exit 0
    fi
    sleep 1
done

echo "clawno-server-start-failed:port {port} not listening after 20s"
exit 1
"#
    )
}

pub fn cmd_check_clawno_server() -> String {
    format!("{PATH_PREAMBLE}\nclawno-server version 2>/dev/null || echo clawno-server-not-found")
}

pub fn cmd_stop_clawno_server() -> String {
    format!(
        "{PATH_PREAMBLE}\npm2 stop clawno-server 2>/dev/null || true\necho clawno-server-stopped"
    )
}

pub fn cmd_restart_clawno_server() -> String {
    format!("{PATH_PREAMBLE}\npm2 restart clawno-server 2>/dev/null || true\necho clawno-server-restarted")
}

pub fn cmd_check_openclaw() -> String {
    format!("{PATH_PREAMBLE}\nopenclaw --version 2>/dev/null || echo openclaw-not-found")
}

/// Validate SshArgs fields (convenience wrapper).
pub fn validate_ssh_args(args: &SshArgs) -> Result<(), String> {
    validate_ssh_input(&args.host, &args.username, args.port)
}

// ── Deploy shell script constants ────────────────────────────────────────────
//
// Shared across desktop and mobile. The `include_system_fallback` parameter
// controls whether apt/yum fallback is included (desktop = true, mobile = false).

pub fn check_node_script(include_system_fallback: bool) -> String {
    let mut s = String::from(
        r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

if command -v node >/dev/null 2>&1; then
    VER=$(node --version)
    MAJOR=$(echo "$VER" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -ge 22 ] 2>/dev/null; then
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
"#,
    );

    if include_system_fallback {
        s.push_str(
            r#"
# Fallback: system package managers (require passwordless sudo)
if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -n -E bash - > /dev/null 2>&1 || true
    sudo -n apt-get install -y nodejs > /dev/null 2>&1 || true
elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -n bash - > /dev/null 2>&1 || true
    sudo -n yum install -y nodejs > /dev/null 2>&1 || true
fi
"#,
        );
    }

    s.push_str(
        r#"
if command -v node >/dev/null 2>&1; then
    echo "installed:$(node --version)"
else
    echo "node-not-found:"
    exit 1
fi
"#,
    );
    s
}

pub const INSTALL_OPENCLAW_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

_oc_check() {
    NPM_BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
    export PATH="$NPM_BIN_DIR:$HOME/.local/bin:$PATH"
    command -v openclaw >/dev/null 2>&1
}

# Attempt 1: default registry
npm install -g openclaw 2>/dev/null && _oc_check && {
    echo "installed:$(openclaw --version 2>/dev/null || echo unknown)"; exit 0; }

# Attempt 2: China mirror (npmmirror)
npm install -g openclaw --registry https://registry.npmmirror.com 2>/dev/null && _oc_check && {
    echo "installed:$(openclaw --version 2>/dev/null || echo unknown)"; exit 0; }

# Attempt 3: permission fix — install to user prefix
USER_PREFIX="$HOME/.local"
mkdir -p "$USER_PREFIX/bin" 2>/dev/null
npm install -g openclaw --prefix "$USER_PREFIX" 2>/dev/null && {
    export PATH="$USER_PREFIX/bin:$PATH"
    _oc_check && { echo "installed:$(openclaw --version 2>/dev/null || echo unknown)"; exit 0; }
}

# Attempt 4: clean cache + retry with mirror
npm cache clean --force 2>/dev/null
npm install -g openclaw --registry https://registry.npmmirror.com 2>/dev/null && _oc_check && {
    echo "installed:$(openclaw --version 2>/dev/null || echo unknown)"; exit 0; }

echo "openclaw-not-found-after-install"
exit 1
"#;

pub const ONBOARD_SCRIPT: &str = r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

openclaw onboard --yes > /dev/null 2>&1 || true
openclaw config set agents.defaults.models '{}' > /dev/null 2>&1 || true
echo "config-initialized"
"#;

pub fn start_gateway_script(port: u16) -> String {
    format!(
        r#"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true
export PATH="$HOME/.fnm:$HOME/.local/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"
eval "$(~/.fnm/fnm env --shell bash 2>/dev/null)" 2>/dev/null || true

CLAW_BIN=$(which openclaw 2>/dev/null || echo "openclaw")

if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 > /dev/null 2>&1 || true
fi

if command -v pm2 >/dev/null 2>&1; then
    pm2 delete openclaw > /dev/null 2>&1 || true
    pm2 start "$CLAW_BIN" \
        --name openclaw \
        --interpreter none \
        -- gateway --port {port} --allow-unconfigured > /dev/null 2>&1
    pm2 save > /dev/null 2>&1 || true
else
    pkill -f "openclaw gateway" > /dev/null 2>&1 || true
    mkdir -p ~/openclaw-logs
    nohup "$CLAW_BIN" gateway --port {port} --allow-unconfigured \
        > ~/openclaw-logs/gateway.log 2>&1 &
fi

for i in $(seq 1 30); do
    if nc -z localhost {port} > /dev/null 2>&1 || \
       curl -sf "http://localhost:{port}/" > /dev/null 2>&1; then
        echo "gateway-ready:{port}"
        exit 0
    fi
    sleep 1
done

echo "gateway-start-failed:port {port} not listening after 30s"
exit 1
"#
    )
}

// ── SSH deploy Tauri command macro ───────────────────────────────────────────

/// Generate the 5 shared SSH deploy step commands as `#[tauri::command]`s.
///
/// `include_system_fallback` controls whether `check_node_script` includes
/// apt/yum fallback (desktop = true, mobile = false).
///
/// ```ignore
/// clawno_core::define_ssh_deploy_commands!(include_system_fallback: true);
/// ```
#[macro_export]
macro_rules! define_ssh_deploy_commands {
    (include_system_fallback: $fallback:expr) => {
        use clawno_core::ssh::{self, SshArgs};
        use clawno_core::types::StepResult;

        fn last_line(out: &str) -> String {
            ssh::last_line(out)
        }

        #[tauri::command]
        pub async fn deploy_remote_connect(args: SshArgs) -> StepResult {
            if let Err(e) = ssh::validate_ssh_args(&args) {
                return StepResult::err(e);
            }
            match ssh::ssh_exec(
                &args,
                "echo connection-ok && uname -srm 2>/dev/null || echo ok",
            )
            .await
            {
                Ok((0, out)) => StepResult::ok(format!("ssh-connected:{}", last_line(&out))),
                Ok((code, out)) => StepResult::err(format!("ssh-exit-{code}:{out}")),
                Err(e) => StepResult::err(e),
            }
        }

        #[tauri::command]
        pub async fn deploy_remote_check_node(args: SshArgs) -> StepResult {
            let script = ssh::check_node_script($fallback);
            match ssh::ssh_exec(&args, &script).await {
                Ok((0, out)) => StepResult::ok(last_line(&out)),
                Ok((_, out)) => StepResult::err(format!("node-not-found:{}", last_line(&out))),
                Err(e) => StepResult::err(e),
            }
        }

        #[tauri::command]
        pub async fn deploy_remote_install_openclaw(args: SshArgs) -> StepResult {
            match ssh::ssh_exec(&args, ssh::INSTALL_OPENCLAW_SCRIPT).await {
                Ok((0, out)) => StepResult::ok(last_line(&out)),
                Ok((_, out)) => {
                    StepResult::err(format!("install-openclaw-failed:{}", last_line(&out)))
                }
                Err(e) => StepResult::err(e),
            }
        }

        #[tauri::command]
        pub async fn deploy_remote_onboard(args: SshArgs) -> StepResult {
            match ssh::ssh_exec(&args, ssh::ONBOARD_SCRIPT).await {
                Ok(_) => StepResult::ok("config-initialized".to_string()),
                Err(e) => StepResult::err(e),
            }
        }

        #[tauri::command]
        pub async fn deploy_remote_start_gateway(args: SshArgs) -> StepResult {
            let port = args.gateway_port;
            let script = ssh::start_gateway_script(port);
            match ssh::ssh_exec(&args, &script).await {
                Ok((0, _)) => StepResult::ok(format!("gateway-ready:{port}")),
                Ok((_, out)) => {
                    StepResult::err(format!("gateway-start-failed:{}", last_line(&out)))
                }
                Err(e) => StepResult::err(e),
            }
        }
    };
}

// ── SSH exec engine (feature-gated) ──────────────────────────────────────────

#[cfg(feature = "ssh-exec")]
mod exec {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    pub(crate) struct TofuHandler {
        pub expected_fp: Option<String>,
        pub actual_fp: Arc<std::sync::Mutex<Option<String>>>,
        pub rejected: Arc<AtomicBool>,
    }

    #[async_trait::async_trait]
    impl russh::client::Handler for TofuHandler {
        type Error = russh::Error;

        async fn check_server_key(
            &mut self,
            server_public_key: &russh_keys::key::PublicKey,
        ) -> Result<bool, Self::Error> {
            use russh_keys::PublicKeyBase64;
            let fp = format_fingerprint(
                server_public_key.name(),
                &server_public_key.public_key_base64(),
            );

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

    /// Connect via SSH, authenticate, and run `script` remotely inside bash.
    ///
    /// Uses TOFU (Trust On First Use) host key verification. On first connection
    /// the fingerprint is persisted; on subsequent connections a mismatch causes
    /// rejection (MITM defence).
    pub async fn ssh_exec(args: &SshArgs, script: &str) -> Result<(u32, String), String> {
        use russh::ChannelMsg;

        let kh_path = default_known_hosts_path();
        let hid = host_key_id(&args.host, args.port);
        let known = load_known_hosts(&kh_path);
        let expected_fp = known.get(&hid).cloned();
        let actual_fp = Arc::new(std::sync::Mutex::new(None));
        let rejected = Arc::new(AtomicBool::new(false));

        let handler = TofuHandler {
            expected_fp: expected_fp.clone(),
            actual_fp: Arc::clone(&actual_fp),
            rejected: Arc::clone(&rejected),
        };

        let config = Arc::new(russh::client::Config::default());

        let mut session = tokio::time::timeout(
            Duration::from_secs(15),
            russh::client::connect(config, (args.host.as_str(), args.port), handler),
        )
        .await
        .map_err(|_| "ssh-connect-timeout".to_string())?
        .map_err(|e| {
            if rejected.load(Ordering::SeqCst) {
                format!(
                    "ssh-host-key-changed:{hid} — the server's host key has changed since the \
                     last connection, which could indicate a man-in-the-middle attack. \
                     If the server was legitimately re-provisioned, delete the entry in \
                     ~/.clawno11/ssh_known_hosts.json and retry."
                )
            } else {
                format!("ssh-connect-failed:{e}")
            }
        })?;

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

        if expected_fp.is_none() {
            if let Ok(guard) = actual_fp.lock() {
                if let Some(ref fp) = *guard {
                    save_known_host(&kh_path, &hid, fp);
                }
            }
        }

        let bash_cmd = wrap_bash_heredoc(script);

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

    /// Execute a script over SSH with line-by-line streaming output.
    ///
    /// Each line of stdout/stderr is passed to `on_line` as it arrives,
    /// enabling real-time progress display in the frontend.
    /// The full output is still collected and returned.
    pub async fn ssh_exec_streaming<F>(
        args: &SshArgs,
        script: &str,
        on_line: F,
    ) -> Result<(u32, String), String>
    where
        F: Fn(&str) + Send + 'static,
    {
        use russh::ChannelMsg;

        let kh_path = default_known_hosts_path();
        let hid = host_key_id(&args.host, args.port);
        let known = load_known_hosts(&kh_path);
        let expected_fp = known.get(&hid).cloned();
        let actual_fp = Arc::new(std::sync::Mutex::new(None));
        let rejected = Arc::new(AtomicBool::new(false));

        let handler = TofuHandler {
            expected_fp: expected_fp.clone(),
            actual_fp: Arc::clone(&actual_fp),
            rejected: Arc::clone(&rejected),
        };

        let config = Arc::new(russh::client::Config::default());

        let mut session = tokio::time::timeout(
            Duration::from_secs(15),
            russh::client::connect(config, (args.host.as_str(), args.port), handler),
        )
        .await
        .map_err(|_| "ssh-connect-timeout".to_string())?
        .map_err(|e| {
            if rejected.load(Ordering::SeqCst) {
                format!("ssh-host-key-changed:{hid} — the server's host key has changed.")
            } else {
                format!("ssh-connect-failed:{e}")
            }
        })?;

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

        if expected_fp.is_none() {
            if let Ok(guard) = actual_fp.lock() {
                if let Some(ref fp) = *guard {
                    save_known_host(&kh_path, &hid, fp);
                }
            }
        }

        let bash_cmd = wrap_bash_heredoc(script);
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("ssh-channel-failed:{e}"))?;

        channel
            .exec(true, bash_cmd)
            .await
            .map_err(|e| format!("ssh-exec-failed:{e}"))?;

        let mut output = String::new();
        let mut line_buf = String::new();
        let mut exit_code = 0u32;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    let text = String::from_utf8_lossy(data);
                    output.push_str(&text);
                    line_buf.push_str(&text);
                    while let Some(pos) = line_buf.find('\n') {
                        let line = line_buf[..pos].trim_end_matches('\r').to_string();
                        on_line(&line);
                        line_buf = line_buf[pos + 1..].to_string();
                    }
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    let text = String::from_utf8_lossy(data);
                    output.push_str(&text);
                    line_buf.push_str(&text);
                    while let Some(pos) = line_buf.find('\n') {
                        let line = line_buf[..pos].trim_end_matches('\r').to_string();
                        on_line(&line);
                        line_buf = line_buf[pos + 1..].to_string();
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = exit_status;
                }
                None => break,
                _ => {}
            }
        }

        // Flush any remaining partial line
        if !line_buf.trim().is_empty() {
            on_line(line_buf.trim());
        }

        Ok((exit_code, output.trim().to_string()))
    }
}

#[cfg(feature = "ssh-exec")]
pub use exec::ssh_exec;
#[cfg(feature = "ssh-exec")]
pub use exec::ssh_exec_streaming;
