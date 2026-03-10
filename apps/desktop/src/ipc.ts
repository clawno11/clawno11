/**
 * Centralized type-safe IPC bridge for all Tauri backend commands.
 *
 * All `invoke()` calls should go through this module so that:
 *  - Command names are defined in one place (rename-safe)
 *  - Return types are statically verified
 *  - The call site reads like a regular async function
 */

import { invoke } from "@tauri-apps/api/core";

// ── Shared types ────────────────────────────────────────────────────────────

export interface StepResult {
  ok: boolean;
  detail: string;
  fixes_applied: string[];
}

export interface ProbeResult {
  online: boolean;
  latency_ms: number;
}

export interface ServiceInfo {
  name: string;
  status: string;
  pid: number | null;
  uptime: number | null;
  restarts: number | null;
}

export interface SecurityCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "danger" | "unknown";
  detail: string;
}

export interface SecurityReport {
  score: number;
  checks: SecurityCheck[];
}

export interface PortConnection {
  local_addr: string;
  remote_addr: string;
  state: string;
  pid: string;
  is_local: boolean;
}

export interface McpScanResult {
  risk_level: "safe" | "caution" | "danger";
  factors: string[];
  reachable: boolean;
}

export interface FeishuTestResult {
  ok: boolean;
  msg: string;
  missing_scopes: string[];
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;
  version: string | null;
}

export interface LanInfo {
  ip: string;
  subnet: string;
}

// ── Deploy status & update ───────────────────────────────────────────────────

export interface DeployStatus {
  openclaw_installed: boolean;
  openclaw_version: string;
  service_running: boolean;
}

export const checkDeployStatus          = ()             => invoke<DeployStatus>("check_deploy_status");
export const updateOpenclaw             = ()             => invoke<StepResult>("update_openclaw");
export const uninstallLocalInstance     = ()             => invoke<StepResult>("uninstall_local_instance");
export const listConfiguredProviders    = ()             => invoke<string[]>("list_configured_providers");

// ── Deploy commands ─────────────────────────────────────────────────────────

export const deployCheckNode        = ()                         => invoke<StepResult>("deploy_step_check_node");
export const deployInstallOpenclaw  = ()                         => invoke<StepResult>("deploy_step_install_openclaw");
export const deployInstallPm2       = ()                         => invoke<StepResult>("deploy_step_install_pm2");
export const deployOnboard          = ()                         => invoke<StepResult>("deploy_step_onboard");
export const deployStart            = (port?: number)            => invoke<StepResult>("deploy_step_start", { port });

// ── SSH remote deploy ────────────────────────────────────────────────────────

export interface SshArgs {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  gatewayPort: number;
}

export const deployRemoteConnect           = (args: SshArgs) => invoke<StepResult>("deploy_remote_connect", { args });
export const deployRemoteCheckNode         = (args: SshArgs) => invoke<StepResult>("deploy_remote_check_node", { args });
export const deployRemoteInstallOpenclaw   = (args: SshArgs) => invoke<StepResult>("deploy_remote_install_openclaw", { args });
export const deployRemoteOnboard           = (args: SshArgs) => invoke<StepResult>("deploy_remote_onboard", { args });
export const deployRemoteStartGateway      = (args: SshArgs) => invoke<StepResult>("deploy_remote_start_gateway", { args });

export const getLocalServiceInfo    = ()                         => invoke<ServiceInfo>("get_local_service_info");
export const startLocalService      = (port?: number)            => invoke<StepResult>("start_local_service", { port });
export const stopLocalService       = ()                         => invoke<void>("stop_local_service");
export const restartLocalService    = ()                         => invoke<void>("restart_local_service");
export const getBrowserUrl          = ()                         => invoke<string>("get_browser_url", {});
export const openInBrowser          = (url: string)              => invoke<void>("open_in_browser", { url });
export const probeInstanceHealth    = (port: number)             => invoke<ProbeResult>("probe_instance_health", { port });
/** Fetch the active model string (e.g. "anthropic/claude-3-5-sonnet") from the running gateway. */
export const getMainAgentModel      = (port: number)             => invoke<string | null>("get_main_agent_model", { port });
export const configureApiKey        = (provider: string, apiKey: string) => invoke<StepResult>("configure_api_key", { provider, apiKey });
/** Run on app startup: auto-fix default model if it has no auth, rebuild fallback chain. */
export const fixModelConfig         = ()                               => invoke<string>("fix_model_config");

// ── Security commands ───────────────────────────────────────────────────────

export const scanSecurityStatus     = (port: number)             => invoke<SecurityReport>("scan_security_status", { port });
export const getPortConnections     = (port: number)             => invoke<PortConnection[]>("get_port_connections", { port });
export const applyLocalOnlyFirewall = (port: number)             => invoke<string>("apply_local_only_firewall", { port });
export const removeLocalOnlyFirewall= (port: number)             => invoke<string>("remove_local_only_firewall", { port });

// ── Secure store commands ───────────────────────────────────────────────────

export const setSecureValue         = (key: string, value: string)  => invoke<void>("set_secure_value", { key, value });
export const getSecureValue         = (key: string)                  => invoke<string | null>("get_secure_value", { key });
export const deleteSecureValue      = (key: string)                  => invoke<void>("delete_secure_value", { key });
export const listSecureKeys         = ()                              => invoke<string[]>("list_secure_keys");
export const wipeSecureStore        = ()                              => invoke<void>("wipe_secure_store");

// ── Connector commands ──────────────────────────────────────────────────────

export const testFeishuConnection   = (appId: string, appSecret: string) => invoke<FeishuTestResult>("test_feishu_connection", { appId, appSecret });
export const saveFeishuConfig       = (appId: string, appSecret: string)  => invoke<string>("save_feishu_config", { appId, appSecret });
/** Returns the saved App ID (never the secret), or null if not yet configured. */
export const getFeishuConfig        = ()                                   => invoke<string | null>("get_feishu_config");
export const getTailscaleStatus     = ()                                   => invoke<TailscaleStatus>("get_tailscale_status");
export const getLanInfo             = ()                                   => invoke<LanInfo | null>("get_local_lan_info");

// ── Secure Pairing commands ──────────────────────────────────────────────────

export interface PairQrPayload {
  /** The full string to embed in the QR code. */
  qr_data: string;
  /** 6-character human-readable PIN shown on the desktop for confirmation. */
  pin: string;
  /** Unix timestamp (seconds) — when this token expires. */
  expires_at: number;
}

/** Generate a pairing QR (uses localhost as host — use generatePairQrWithHost for LAN). */
export const generatePairQr         = (port: number, serverName: string)              => invoke<PairQrPayload>("generate_pair_qr", { port, serverName });
/** Generate a pairing QR with an explicit LAN IP. */
export const generatePairQrWithHost = (host: string, port: number, serverName: string) => invoke<PairQrPayload>("generate_pair_qr_with_host", { host, port, serverName });
/** Verify a token from the mobile app (marks it consumed on success). */
export const verifyPairToken        = (token: string)                                  => invoke<void>("verify_pair_token", { token });
/** Get the 6-char PIN currently displayed on desktop (null if no active token). */
export const getCurrentPairPin      = ()                                               => invoke<string | null>("get_current_pair_pin");

// ── Telegram Bot commands ────────────────────────────────────────────────────

export interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

export const testTelegramConfig    = (token: string)              => invoke<TelegramBotInfo>("test_telegram_config", { token });
export const saveTelegramConfig    = (token: string)              => invoke<void>("save_telegram_config", { token });
export const getTelegramConfig     = ()                           => invoke<string | null>("get_telegram_config");
export const startTelegramBot      = (port: number)              => invoke<void>("start_telegram_bot", { port });
export const stopTelegramBot       = ()                           => invoke<void>("stop_telegram_bot");
export const getTelegramBotStatus  = ()                           => invoke<boolean>("get_telegram_bot_status");

// ── Discord Bot commands ─────────────────────────────────────────────────────

export interface DiscordBotInfo {
  id: string;
  username: string;
  discriminator: string;
}

export const testDiscordConfig     = (token: string)              => invoke<DiscordBotInfo>("test_discord_config", { token });
export const saveDiscordConfig     = (token: string)              => invoke<void>("save_discord_config", { token });
export const getDiscordConfig      = ()                           => invoke<string | null>("get_discord_config");
export const startDiscordBot       = (port: number)              => invoke<void>("start_discord_bot", { port });
export const stopDiscordBot        = ()                           => invoke<void>("stop_discord_bot");
export const getDiscordBotStatus   = ()                           => invoke<boolean>("get_discord_bot_status");

// ── MCP commands ────────────────────────────────────────────────────────────

export const scanMcpServer          = (endpoint: string, transport: string) => invoke<McpScanResult>("scan_mcp_server", { endpoint, transport });

export interface OpenClawPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  origin: "bundled" | "npm" | "local" | string;
  enabled: boolean;
  status: "loaded" | "disabled" | "error" | string;
  tool_names: string[];
}

export const listOpenClawPlugins    = ()                              => invoke<OpenClawPlugin[]>("list_openclaw_plugins");
export const toggleOpenClawPlugin   = (id: string, enable: boolean)  => invoke<string>("toggle_openclaw_plugin", { id, enable });

// ── RAG commands ────────────────────────────────────────────────────────────

export const readTextFile           = (path: string)             => invoke<string>("read_text_file", { path });

// ── Ollama local model engine ────────────────────────────────────────────────

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
}

export interface OllamaModel {
  name: string;
  /** File size in bytes */
  size: number;
  modified_at: string;
}

export interface OllamaPullProgress {
  model: string;
  status: string;
  /** 0–100 */
  percent: number;
  done: boolean;
  error: string | null;
}

export const ollamaCheckStatus        = ()                   => invoke<OllamaStatus>("ollama_check_status");
export const ollamaEnsureInstalled    = ()                   => invoke<StepResult>("ollama_ensure_installed");
export const ollamaStartServer        = ()                   => invoke<StepResult>("ollama_start_server");
export const ollamaListLocalModels    = ()                   => invoke<OllamaModel[]>("ollama_list_local_models");
export const ollamaDeleteModel        = (name: string)       => invoke<StepResult>("ollama_delete_model", { name });
export const ollamaSetModel           = (modelName: string)  => invoke<StepResult>("set_ollama_model", { modelName });
export const ollamaPullModel          = (name: string)       => invoke<StepResult>("ollama_pull_model", { name });
