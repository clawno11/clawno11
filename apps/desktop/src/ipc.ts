/**
 * Centralized type-safe IPC bridge for all Tauri backend commands.
 *
 * Shared types and functions (StepResult, SshArgs, SecureStore, MCP, RAG,
 * Tailscale, SSH deploy) are imported from @clawno/shared/ipc/types.
 * Desktop-only types and commands remain in this file.
 */

import { invoke } from "@tauri-apps/api/core";

export type {
  ProbeResult, McpScanResult, TailscaleStatus, StepResult, SshArgs,
} from "@clawno/shared/ipc/types";

export {
  setSecureValue, getSecureValue, deleteSecureValue, listSecureKeys, wipeSecureStore,
  scanMcpServer, readTextFile, getTailscaleStatus,
  deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
  deployRemoteOnboard, deployRemoteStartGateway,
  deployRemoteInstallClawnoServer, deployRemoteStartClawnoServer,
} from "@clawno/shared/ipc/types";

import type { StepResult, ProbeResult } from "@clawno/shared/ipc/types";

// ── Desktop-only types ──────────────────────────────────────────────────────

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

export interface FeishuTestResult {
  ok: boolean;
  msg: string;
  missing_scopes: string[];
}

export interface LanInfo {
  ip: string;
  subnet: string;
}

// ── Deploy environment scan ──────────────────────────────────────────────────

export interface EnvironmentReport {
  os: string;
  os_version: string;
  arch: string;
  total_memory_mb: number;
  free_disk_mb: number;
  is_admin: boolean;
  is_chinese_locale: boolean;
  http_proxy: string | null;
  package_managers: Array<{ name: string; available: boolean; version: string | null }>;
  dependencies: Array<{
    id: string;
    display_name: string;
    required_version: string;
    current_version: string | null;
    status: "satisfied" | "needs-upgrade" | "not-installed";
    sources: Array<{
      url: string;
      label: string;
      trust_level: "official" | "official-mirror" | "community";
      expected_sha256: string | null;
      is_primary: boolean;
    }>;
    strategies: string[];
    size_estimate_mb: number;
    is_optional: boolean;
  }>;
}

export const scanEnvironment           = ()                   => invoke<EnvironmentReport>("scan_environment");
export const installSingleDep          = (depId: string)      => invoke<StepResult>("install_single_dep", { depId });

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

// ── Local deploy commands ────────────────────────────────────────────────────

export const deployCheckNode        = ()                         => invoke<StepResult>("deploy_step_check_node");
export const deployInstallOpenclaw  = ()                         => invoke<StepResult>("deploy_step_install_openclaw");
export const deployInstallPm2       = ()                         => invoke<StepResult>("deploy_step_install_pm2");
export const deployOnboard          = ()                         => invoke<StepResult>("deploy_step_onboard");
export const deployStart            = (port?: number)            => invoke<StepResult>("deploy_step_start", { port });

// ── Local service management ─────────────────────────────────────────────────

export const getLocalServiceInfo    = ()                         => invoke<ServiceInfo>("get_local_service_info");
export const startLocalService      = (port?: number)            => invoke<StepResult>("start_local_service", { port });
export const stopLocalService       = ()                         => invoke<void>("stop_local_service");
export const restartLocalService    = ()                         => invoke<void>("restart_local_service");
export const getBrowserUrl          = ()                         => invoke<string>("get_browser_url", {});
export const openInBrowser          = (url: string)              => invoke<void>("open_in_browser", { url });
export const mountChatWebview       = (x: number, y: number, width: number, height: number) => invoke<void>("mount_chat_webview", { x, y, width, height });
export const unmountChatWebview     = ()                         => invoke<void>("unmount_chat_webview", {});
export const hideChatWebview        = ()                         => invoke<void>("hide_chat_webview", {});
export const resizeChatWebview      = (x: number, y: number, width: number, height: number) => invoke<void>("resize_chat_webview", { x, y, width, height });
export const probeInstanceHealth    = (port: number)             => invoke<ProbeResult>("probe_instance_health", { port });
export const getMainAgentModel      = (port: number)             => invoke<string | null>("get_main_agent_model", { port });
export const configureApiKey        = (provider: string, apiKey: string) => invoke<StepResult>("configure_api_key", { provider, apiKey });
export const diagnoseAuth           = ()                               => invoke<Record<string, unknown>>("diagnose_auth");
export const fixModelConfig         = ()                               => invoke<string>("fix_model_config");
export const repairModelConfig      = (port: number)                    => invoke<StepResult>("repair_model_config", { port });

// ── Security commands ───────────────────────────────────────────────────────

export const scanSecurityStatus     = (port: number)             => invoke<SecurityReport>("scan_security_status", { port });
export const getPortConnections     = (port: number)             => invoke<PortConnection[]>("get_port_connections", { port });
export const applyLocalOnlyFirewall = (port: number)             => invoke<string>("apply_local_only_firewall", { port });
export const removeLocalOnlyFirewall= (port: number)             => invoke<string>("remove_local_only_firewall", { port });

// ── Connector commands ──────────────────────────────────────────────────────

export const testFeishuConnection   = (appId: string, appSecret: string) => invoke<FeishuTestResult>("test_feishu_connection", { appId, appSecret });
export const saveFeishuConfig       = (appId: string, appSecret: string)  => invoke<string>("save_feishu_config", { appId, appSecret });
export const getFeishuConfig        = ()                                   => invoke<string | null>("get_feishu_config");
export const getLanInfo             = ()                                   => invoke<LanInfo | null>("get_local_lan_info");
export const getAllLanIps           = ()                                   => invoke<string[]>("get_all_lan_ips");

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

// ── WeChat channel plugin commands ──────────────────────────────────────────

export interface WeixinChannelStatus {
  installed: boolean;
  connected: boolean;
  account_name: string | null;
}

export const checkWeixinPlugin        = ()  => invoke<boolean>("check_weixin_plugin");
export const installWeixinPlugin      = ()  => invoke<{ ok: boolean; detail: string; fixes_applied: string[] }>("install_weixin_plugin");
export const restartWeixinGateway     = ()  => invoke<{ ok: boolean; detail: string; fixes_applied: string[] }>("restart_weixin_gateway");
export const getWeixinQrUrl           = ()  => invoke<string>("get_weixin_qr_url");
export const getWeixinChannelStatus   = ()  => invoke<WeixinChannelStatus>("get_weixin_channel_status");

// ── MCP desktop-only commands ───────────────────────────────────────────────

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

// ── Ollama local model engine ────────────────────────────────────────────────

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface OllamaPullProgress {
  model: string;
  status: string;
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
