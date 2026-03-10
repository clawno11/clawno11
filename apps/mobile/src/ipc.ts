/**
 * Mobile IPC bridge — type-safe wrappers for all Tauri backend commands.
 *
 * Key differences from desktop:
 *  - No deploy / pm2 / firewall commands (mobile is a remote client)
 *  - probe_instance_health / get_main_agent_model take gateway_url (not port)
 *  - stream_chat uses direct HTTP SSE to the gateway (not subprocess)
 *  - Added probe_gateway_url for ConnectPage URL validation
 */

import { invoke } from "@tauri-apps/api/core";

// ── Shared types ─────────────────────────────────────────────────────────

export interface ProbeResult {
  online: boolean;
  latency_ms: number;
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;
  version: string | null;
}

export interface McpScanResult {
  risk_level: "safe" | "caution" | "danger";
  factors: string[];
  reachable: boolean;
}

// ── Gateway / Instance commands ──────────────────────────────────────────

/** Probe a gateway by full URL and return online status + latency. */
export const probeInstanceHealth = (gatewayUrl: string) =>
  invoke<ProbeResult>("probe_instance_health", { gatewayUrl });

/** Fetch the active model string from a running gateway. */
export const getMainAgentModel = (gatewayUrl: string) =>
  invoke<string | null>("get_main_agent_model", { gatewayUrl });

/** Read a text file by absolute path (for RAG ingestion). */
export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });

// ── Tailscale / Connectivity ─────────────────────────────────────────────

/** Detect Tailscale VPN status on this device. */
export const getTailscaleStatus = () =>
  invoke<TailscaleStatus>("get_tailscale_status");

/** Probe whether a gateway URL is reachable (used by ConnectPage). */
export const probeGatewayUrl = (url: string) =>
  invoke<boolean>("probe_gateway_url", { url });

// ── Secure store ─────────────────────────────────────────────────────────

export const setSecureValue = (key: string, value: string) =>
  invoke<void>("set_secure_value", { key, value });

export const getSecureValue = (key: string) =>
  invoke<string | null>("get_secure_value", { key });

export const deleteSecureValue = (key: string) =>
  invoke<void>("delete_secure_value", { key });

export const listSecureKeys = () =>
  invoke<string[]>("list_secure_keys");

export const wipeSecureStore = () =>
  invoke<void>("wipe_secure_store");

// ── MCP ──────────────────────────────────────────────────────────────────

export const scanMcpServer = (endpoint: string, transport: string) =>
  invoke<McpScanResult>("scan_mcp_server", { endpoint, transport });

// ── SSH remote deployment ─────────────────────────────────────────────────

/** Test SSH connection. Returns remote `uname -a` string on success. */
export const sshTestConnection = (
  host: string,
  sshPort: number,
  username: string,
  password: string,
) => invoke<string>("ssh_test_connection", { host, sshPort, username, password });

/** Deploy OpenClaw on a remote server via SSH. Emits `deploy-progress` events.
 *  Returns the gateway URL (e.g. "http://1.2.3.4:18789") on success. */
export const sshDeploy = (
  host: string,
  sshPort: number,
  username: string,
  password: string,
  openclawPort: number,
) => invoke<string>("ssh_deploy", { host, sshPort, username, password, openclawPort });
