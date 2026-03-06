import { execa } from "execa";
import * as os from "os";
import * as path from "path";
import type {
  LocalDeployOptions,
  LocalDeployResult,
  ProgressCallback,
  ServiceInfo,
} from "./types.js";

export class LocalDeployer {
  private onProgress: ProgressCallback | undefined;

  constructor(private options: LocalDeployOptions = {}) {
    this.onProgress = options.onProgress;
  }

  private report(message: string, percent: number): void {
    const status =
      percent === 0
        ? "checking"
        : percent < 40
          ? "installing"
          : percent < 70
            ? "configuring"
            : percent < 95
              ? "starting"
              : "done";
    this.onProgress?.({ status, message, percent });
  }

  /** Check if Node.js >= 22 is installed */
  async checkNode(): Promise<{ ok: boolean; version?: string }> {
    try {
      const result = await execa("node", ["--version"]);
      const version = result.stdout.trim();
      const major = parseInt(version.replace("v", "").split(".")[0] ?? "0");
      return { ok: major >= 22, version };
    } catch {
      return { ok: false };
    }
  }

  /** Check if openclaw is already installed globally */
  async checkOpenClaw(): Promise<{ installed: boolean; version?: string }> {
    try {
      const result = await execa("openclaw", ["--version"]);
      return { installed: true, version: result.stdout.trim() };
    } catch {
      return { installed: false };
    }
  }

  /** Install openclaw globally via npm */
  async installOpenClaw(): Promise<void> {
    await execa("npm", ["install", "-g", "openclaw"], {
      all: true,
    });
  }

  /** Check if pm2 is installed */
  async checkPm2(): Promise<boolean> {
    try {
      await execa("pm2", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Install pm2 globally */
  async installPm2(): Promise<void> {
    await execa("npm", ["install", "-g", "pm2"]);
  }

  /** Run openclaw onboard to initialize config */
  async runOnboard(configDir?: string): Promise<void> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (configDir) {
      env["OPENCLAW_CONFIG_DIR"] = configDir;
    }
    await execa("openclaw", ["onboard", "--yes"], { env });
  }

  /** Start openclaw via pm2 */
  async startWithPm2(port?: number, configDir?: string): Promise<number | undefined> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (configDir) {
      env["OPENCLAW_CONFIG_DIR"] = configDir;
    }
    if (port) {
      env["OPENCLAW_PORT"] = String(port);
    }

    await execa("pm2", ["start", "openclaw", "--name", "openclaw", "--interpreter", "none"], {
      env,
    });

    // Get PID
    try {
      const result = await execa("pm2", ["pid", "openclaw"]);
      return parseInt(result.stdout.trim());
    } catch {
      return undefined;
    }
  }

  /** Full local deployment flow */
  async deploy(): Promise<LocalDeployResult> {
    const configDir = this.options.configDir ?? path.join(os.homedir(), ".openclaw");
    const port = this.options.port ?? 18789;

    try {
      // Step 1: Check Node.js
      this.report("检查 Node.js 版本...", 0);
      const nodeCheck = await this.checkNode();
      if (!nodeCheck.ok) {
        return {
          success: false,
          port,
          configDir,
          error: `需要 Node.js >= 22，当前版本: ${nodeCheck.version ?? "未安装"}`,
        };
      }

      // Step 2: Check/Install openclaw
      this.report("检查 openclaw 安装状态...", 15);
      const clawCheck = await this.checkOpenClaw();
      if (!clawCheck.installed) {
        this.report("正在安装 openclaw...", 20);
        await this.installOpenClaw();
        this.report("openclaw 安装完成", 40);
      } else {
        this.report(`openclaw 已安装 (${clawCheck.version ?? "unknown"})`, 40);
      }

      // Step 3: Check/Install pm2
      this.report("检查 pm2 服务管理器...", 45);
      const hasPm2 = await this.checkPm2();
      if (!hasPm2) {
        this.report("正在安装 pm2...", 50);
        await this.installPm2();
        this.report("pm2 安装完成", 60);
      } else {
        this.report("pm2 已安装", 60);
      }

      // Step 4: Run onboard
      this.report("初始化 openclaw 配置...", 65);
      await this.runOnboard(configDir);
      this.report("配置初始化完成", 75);

      // Step 5: Start with pm2
      this.report("正在启动 openclaw 服务...", 80);
      const pid = await this.startWithPm2(port, configDir);
      this.report("openclaw 服务已启动", 95);

      this.report("部署完成！", 100);

      const result: LocalDeployResult = { success: true, port, configDir };
      if (pid !== undefined) result.pid = pid;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onProgress?.({ status: "error", message: `部署失败: ${message}`, percent: 0 });
      return { success: false, port, configDir, error: message };
    }
  }

  /** Get openclaw service status via pm2 */
  async getServiceInfo(): Promise<ServiceInfo> {
    try {
      const result = await execa("pm2", ["jlist"]);
      const list = JSON.parse(result.stdout) as Array<{
        name: string;
        pm2_env: { status: string; pm_uptime: number; restart_time: number };
        pid: number;
      }>;
      const entry = list.find((p) => p.name === "openclaw");
      if (!entry) {
        return { name: "openclaw", status: "stopped" };
      }
      return {
        name: "openclaw",
        status: entry.pm2_env.status === "online" ? "running" : "stopped",
        pid: entry.pid,
        uptime: entry.pm2_env.pm_uptime,
        restarts: entry.pm2_env.restart_time,
      };
    } catch {
      return { name: "openclaw", status: "unknown" };
    }
  }

  /** Stop openclaw service */
  async stop(): Promise<void> {
    await execa("pm2", ["stop", "openclaw"]);
  }

  /** Restart openclaw service */
  async restart(): Promise<void> {
    await execa("pm2", ["restart", "openclaw"]);
  }
}
