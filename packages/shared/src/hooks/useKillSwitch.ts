import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSecureValue, sshKillSwitch, type SshArgs } from "../ipc/types";

export interface KillSwitchInstance {
  id: string;
  kind: "local" | "remote";
}

interface UseKillSwitchOptions {
  platform: "desktop" | "mobile";
  instances: KillSwitchInstance[];
  port?: number;
}

interface UseKillSwitchReturn {
  running: boolean;
  trigger: () => Promise<{ ok: boolean; detail: string }>;
}

/**
 * Shared hook that abstracts kill-switch invocation across platforms.
 *
 * - **mobile**: SSH credential lookup → `ssh_kill_switch`
 * - **desktop**: local firewall-based `kill_switch_offline`
 */
export function useKillSwitch({
  platform,
  instances,
  port,
}: UseKillSwitchOptions): UseKillSwitchReturn {
  const [running, setRunning] = useState(false);

  const trigger = useCallback(async (): Promise<{
    ok: boolean;
    detail: string;
  }> => {
    setRunning(true);
    try {
      if (platform === "desktop") {
        if (port == null) return { ok: false, detail: "no_port" };
        const result = await invoke<string>("kill_switch_offline", { port });
        return { ok: true, detail: result };
      }

      const remoteInst = instances.find((i) => i.kind === "remote");
      if (!remoteInst) {
        return { ok: false, detail: "no_remote_instance" };
      }

      const credsJson = await getSecureValue(`ssh_creds_${remoteInst.id}`);
      const pass = await getSecureValue(`ssh_pass_${remoteInst.id}`);
      if (!credsJson || !pass) {
        return { ok: false, detail: "no_credentials" };
      }

      const creds = JSON.parse(credsJson) as {
        host: string;
        port: number;
        username: string;
        gatewayPort: number;
      };
      const args: SshArgs = { ...creds, password: pass };
      const res = await sshKillSwitch(args);
      return { ok: res.ok, detail: res.detail };
    } catch (e) {
      return { ok: false, detail: String(e) };
    } finally {
      setRunning(false);
    }
  }, [platform, instances, port]);

  return { running, trigger };
}
