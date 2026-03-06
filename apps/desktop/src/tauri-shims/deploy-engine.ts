/**
 * Renderer-side shim for @clawno/deploy-engine.
 *
 * The actual deploy logic runs in the Tauri main process (Node sidecar or Rust).
 * The renderer communicates via Tauri IPC `invoke()` calls.
 * This shim mirrors the deploy-engine API surface so existing page components
 * can remain largely unchanged.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  LocalDeployOptions,
  LocalDeployResult,
  RemoteDeployOptions,
  RemoteDeployResult,
  ServiceInfo,
} from "@clawno/deploy-engine";

export type { LocalDeployOptions, LocalDeployResult, RemoteDeployOptions, RemoteDeployResult, ServiceInfo };

export class LocalDeployer {
  constructor(private options: LocalDeployOptions = {}) {}

  async deploy(): Promise<LocalDeployResult> {
    const result = await invoke<LocalDeployResult>("deploy_local", {
      port: this.options.port ?? 18789,
      configDir: this.options.configDir,
    });
    return result;
  }

  async getServiceInfo(): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("get_local_service_info");
  }

  async stop(): Promise<void> {
    return invoke("stop_local_service");
  }

  async restart(): Promise<void> {
    return invoke("restart_local_service");
  }
}

export class RemoteDeployer {
  constructor(private options: RemoteDeployOptions) {}

  async deploy(): Promise<RemoteDeployResult> {
    const result = await invoke<RemoteDeployResult>("deploy_remote", {
      host: this.options.ssh.host,
      port: this.options.ssh.port ?? 22,
      username: this.options.ssh.username,
      password: this.options.ssh.password,
      privateKey: this.options.ssh.privateKey,
      gatewayPort: this.options.gatewayPort ?? 18789,
      useDocker: this.options.useDocker ?? false,
    });
    return result;
  }

  async getServiceInfo(): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("get_remote_service_info", {
      host: this.options.ssh.host,
      port: this.options.ssh.port ?? 22,
      username: this.options.ssh.username,
      password: this.options.ssh.password,
    });
  }
}
