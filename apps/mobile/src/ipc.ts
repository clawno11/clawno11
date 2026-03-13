/**
 * Mobile IPC bridge — type-safe wrappers for all Tauri backend commands.
 *
 * Shared types and functions are imported from @clawno/shared/ipc/types.
 * Mobile-only commands (probe by URL, chat proxy, SSH management) remain here.
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
  sshKillSwitch,
} from "@clawno/shared/ipc/types";

import type { ProbeResult, StepResult, SshArgs } from "@clawno/shared/ipc/types";

// ── Gateway / Instance commands (mobile: by URL, not port) ───────────────

export const probeInstanceHealth = (gatewayUrl: string) =>
  invoke<ProbeResult>("probe_instance_health", { gatewayUrl });

export const getMainAgentModel = (gatewayUrl: string) =>
  invoke<string | null>("get_main_agent_model", { gatewayUrl });

// ── Mobile-only connectivity ─────────────────────────────────────────────

export const probeGatewayUrl = (url: string) =>
  invoke<boolean>("probe_gateway_url", { url });

export const fetchChatProxyToken = (gatewayUrl: string) =>
  invoke<string | null>("fetch_chat_proxy_token", { gatewayUrl });

// ── Chat proxy bridge (Rust-side HTTP, bypasses WebView CORS) ────────────

export interface ProxyDiscovery {
  found: boolean;
  proxy_url: string;
  token: string;
}

export const discoverChatProxy = (gatewayUrl: string) =>
  invoke<ProxyDiscovery>("discover_chat_proxy", { gatewayUrl });

export const proxyFetchProviders = (proxyUrl: string, token: string) =>
  invoke<string[]>("proxy_fetch_providers", { proxyUrl, token });

export interface ConfigureResult {
  ok: boolean;
  detail: string;
}

export const proxyConfigureApiKey = (
  proxyUrl: string,
  token: string,
  provider: string,
  apiKey: string,
) => invoke<ConfigureResult>("proxy_configure_api_key", { proxyUrl, token, provider, apiKey });


// ── SSH remote management (mobile-only management commands) ───────────────

export const sshStopInstance       = (args: SshArgs) => invoke<StepResult>("ssh_stop_instance", { args });
export const sshStartInstance      = (args: SshArgs) => invoke<StepResult>("ssh_start_instance", { args });
export const sshRestartInstance    = (args: SshArgs) => invoke<StepResult>("ssh_restart_instance", { args });
export const sshConfigureApiKey    = (args: SshArgs, provider: string, apiKey: string) =>
  invoke<StepResult>("ssh_configure_api_key", { args, provider, apiKey });
