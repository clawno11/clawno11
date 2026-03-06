export type DeployStatus =
  | "idle"
  | "checking"
  | "installing"
  | "configuring"
  | "starting"
  | "done"
  | "error";

export interface DeployProgress {
  status: DeployStatus;
  message: string;
  percent: number;
}

export type ProgressCallback = (progress: DeployProgress) => void;

// Local deployment options
export interface LocalDeployOptions {
  /** Path to store openclaw config, defaults to ~/.openclaw */
  configDir?: string;
  /** Port for openclaw gateway, defaults to 18789 */
  port?: number;
  onProgress?: ProgressCallback;
}

export interface LocalDeployResult {
  success: boolean;
  pid?: number;
  port: number;
  configDir: string;
  error?: string;
}

// Remote SSH deployment options
export interface SSHCredentials {
  host: string;
  port?: number;
  username: string;
  /** Password auth */
  password?: string;
  /** Private key content (PEM string) */
  privateKey?: string;
  passphrase?: string;
}

export interface RemoteDeployOptions {
  ssh: SSHCredentials;
  /** Port for openclaw gateway on remote, defaults to 18789 */
  gatewayPort?: number;
  /** Use Docker instead of direct Node.js */
  useDocker?: boolean;
  onProgress?: ProgressCallback;
}

export interface RemoteDeployResult {
  success: boolean;
  host: string;
  gatewayPort: number;
  gatewayUrl: string;
  error?: string;
}

// Service management
export interface ServiceInfo {
  name: string;
  status: "running" | "stopped" | "error" | "unknown";
  pid?: number;
  uptime?: number;
  restarts?: number;
}
