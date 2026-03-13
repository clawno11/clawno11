/**
 * IPC 类型统一层 — 两端共享的 Tauri invoke 接口类型定义
 *
 * 规则：
 *  - 两端都需要的类型/接口/函数定义在此文件
 *  - 平台专属类型/函数定义在各端 ipc.ts
 *  - 新增 Tauri 命令时，先检查是否两端共用
 */

import { invoke } from "@tauri-apps/api/core";

/* ---- Shared result types ---- */

export interface StepResult {
  ok: boolean;
  detail: string;
  fixes_applied: string[];
}

export interface SshArgs {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  gatewayPort: number;
}

/* ---- Secure Store ---- */

export interface SecureStoreAPI {
  setSecureValue(key: string, value: string): Promise<void>;
  getSecureValue(key: string): Promise<string | null>;
  deleteSecureValue(key: string): Promise<void>;
  listSecureKeys(): Promise<string[]>;
  wipeSecureStore(): Promise<void>;
}

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

/* ---- Gateway Probe ---- */

export interface ProbeResult {
  online: boolean;
  latency_ms: number;
}

export interface GatewayAPI {
  probeInstanceHealth(target: string | number): Promise<ProbeResult>;
  getMainAgentModel(target: string | number): Promise<string | null>;
}

/* ---- Chat ---- */

export interface StreamChatParams {
  gateway_url: string;
  messages: Array<{ role: string; content: string }>;
  req_id: string;
  model?: string;
  auth_token?: string;
}

export interface ChatChunkEvent {
  req_id: string;
  delta: string;
}

export interface ChatDoneEvent {
  req_id: string;
  error: string | null;
  model: string | null;
}

export interface ChatAPI {
  streamChat(params: StreamChatParams): Promise<void>;
}

/* ---- MCP ---- */

export interface McpScanResult {
  risk_level: "safe" | "caution" | "danger";
  factors: string[];
  reachable: boolean;
}

export const scanMcpServer = (endpoint: string, transport: string) =>
  invoke<McpScanResult>("scan_mcp_server", { endpoint, transport });

export interface McpAPI {
  scanMcpServer(endpoint: string, transport: string): Promise<McpScanResult>;
}

/* ---- RAG ---- */

export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });

export interface RagAPI {
  readTextFile(path: string): Promise<string>;
}

/* ---- Tailscale / Connectivity ---- */

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;
  version: string | null;
}

export const getTailscaleStatus = () =>
  invoke<TailscaleStatus>("get_tailscale_status");

/* ---- SSH Kill Switch ---- */

export const sshKillSwitch = (args: SshArgs) =>
  invoke<StepResult>("ssh_kill_switch", { args });

/* ---- SSH Remote Deploy (shared 5-step pipeline) ---- */

export const deployRemoteConnect = (args: SshArgs) =>
  invoke<StepResult>("deploy_remote_connect", { args });

export const deployRemoteCheckNode = (args: SshArgs) =>
  invoke<StepResult>("deploy_remote_check_node", { args });

export const deployRemoteInstallOpenclaw = (args: SshArgs) =>
  invoke<StepResult>("deploy_remote_install_openclaw", { args });

export const deployRemoteOnboard = (args: SshArgs) =>
  invoke<StepResult>("deploy_remote_onboard", { args });

export const deployRemoteStartGateway = (args: SshArgs) =>
  invoke<StepResult>("deploy_remote_start_gateway", { args });
