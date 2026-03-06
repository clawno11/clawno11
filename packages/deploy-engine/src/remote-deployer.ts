import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";
import type {
  RemoteDeployOptions,
  RemoteDeployResult,
  SSHCredentials,
  ServiceInfo,
} from "./types.js";

export class RemoteDeployer {
  private ssh: SSHCredentials;
  private gatewayPort: number;
  private useDocker: boolean;
  private onProgress: RemoteDeployOptions["onProgress"];

  constructor(options: RemoteDeployOptions) {
    this.ssh = options.ssh;
    this.gatewayPort = options.gatewayPort ?? 18789;
    this.useDocker = options.useDocker ?? false;
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

  /** Create an authenticated SSH connection */
  private connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on("ready", () => resolve(client));
      client.on("error", reject);

      const connectConfig: ConnectConfig = {
        host: this.ssh.host,
        port: this.ssh.port ?? 22,
        username: this.ssh.username,
        readyTimeout: 15_000,
      };

      if (this.ssh.privateKey !== undefined) {
        connectConfig.privateKey = this.ssh.privateKey;
        if (this.ssh.passphrase !== undefined) {
          connectConfig.passphrase = this.ssh.passphrase;
        }
      } else if (this.ssh.password !== undefined) {
        connectConfig.password = this.ssh.password;
      }

      client.connect(connectConfig);
    });
  }

  /** Execute a command on the remote server */
  private exec(client: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.exec(command, (err: Error | undefined, stream: any) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  /** Full remote deployment flow */
  async deploy(): Promise<RemoteDeployResult> {
    let client: Client | null = null;

    try {
      // Step 1: Connect
      this.report(`连接到 ${this.ssh.host}...`, 0);
      client = await this.connect();
      this.report("SSH 连接成功", 10);

      if (this.useDocker) {
        return await this.deployWithDocker(client);
      } else {
        return await this.deployWithNode(client);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onProgress?.({ status: "error", message: `远程部署失败: ${message}`, percent: 0 });
      return {
        success: false,
        host: this.ssh.host,
        gatewayPort: this.gatewayPort,
        gatewayUrl: `http://${this.ssh.host}:${this.gatewayPort}`,
        error: message,
      };
    } finally {
      client?.end();
    }
  }

  private async deployWithNode(client: Client): Promise<RemoteDeployResult> {
    // Check Node.js
    this.report("检查 Node.js 版本...", 15);
    const nodeResult = await this.exec(client, "node --version 2>/dev/null || echo 'not_found'");
    if (nodeResult.stdout.includes("not_found") || !nodeResult.stdout.startsWith("v")) {
      throw new Error("远程服务器未安装 Node.js，请先安装 Node.js >= 22");
    }
    const major = parseInt(nodeResult.stdout.trim().replace("v", "").split(".")[0] ?? "0");
    if (major < 22) {
      throw new Error(`远程 Node.js 版本过低 (${nodeResult.stdout.trim()})，需要 >= 22`);
    }

    // Install openclaw
    this.report("安装 openclaw...", 25);
    const installResult = await this.exec(client, "npm install -g openclaw 2>&1");
    if (installResult.code !== 0) {
      throw new Error(`openclaw 安装失败: ${installResult.stderr}`);
    }
    this.report("openclaw 安装完成", 50);

    // Install pm2
    this.report("安装 pm2...", 55);
    await this.exec(client, "npm install -g pm2 2>&1");
    this.report("pm2 安装完成", 65);

    // Run onboard
    this.report("初始化 openclaw 配置...", 70);
    await this.exec(client, "openclaw onboard --yes 2>&1");
    this.report("配置初始化完成", 80);

    // Start with pm2
    this.report("启动 openclaw 服务...", 85);
    const startResult = await this.exec(
      client,
      `OPENCLAW_PORT=${this.gatewayPort} pm2 start openclaw --name openclaw -- --port ${this.gatewayPort} 2>&1`,
    );
    if (startResult.code !== 0) {
      // Try restart if already running
      await this.exec(client, "pm2 restart openclaw 2>&1");
    }

    // Save pm2 config so it survives reboots
    await this.exec(client, "pm2 save 2>&1");
    await this.exec(client, "pm2 startup 2>&1 || true");

    this.report("部署完成！", 100);

    return {
      success: true,
      host: this.ssh.host,
      gatewayPort: this.gatewayPort,
      gatewayUrl: `http://${this.ssh.host}:${this.gatewayPort}`,
    };
  }

  private async deployWithDocker(client: Client): Promise<RemoteDeployResult> {
    // Check Docker
    this.report("检查 Docker 环境...", 15);
    const dockerCheck = await this.exec(client, "docker --version 2>/dev/null || echo 'not_found'");
    if (dockerCheck.stdout.includes("not_found")) {
      throw new Error("远程服务器未安装 Docker");
    }

    // Pull and run openclaw container
    this.report("拉取 openclaw Docker 镜像...", 30);
    await this.exec(client, "docker pull openclaw/openclaw:latest 2>&1");

    this.report("启动 openclaw 容器...", 70);
    await this.exec(
      client,
      `docker run -d --name openclaw --restart unless-stopped -p ${this.gatewayPort}:18789 openclaw/openclaw:latest 2>&1 || docker restart openclaw 2>&1`,
    );

    this.report("部署完成！", 100);

    return {
      success: true,
      host: this.ssh.host,
      gatewayPort: this.gatewayPort,
      gatewayUrl: `http://${this.ssh.host}:${this.gatewayPort}`,
    };
  }

  /** Get service status on remote */
  async getServiceInfo(): Promise<ServiceInfo> {
    let client: Client | null = null;
    try {
      client = await this.connect();
      const result = await this.exec(client, "pm2 jlist 2>/dev/null || echo '[]'");
      const list = JSON.parse(result.stdout) as Array<{
        name: string;
        pm2_env: { status: string; pm_uptime: number; restart_time: number };
        pid: number;
      }>;
      const entry = list.find((p) => p.name === "openclaw");
      if (!entry) return { name: "openclaw", status: "stopped" };
      return {
        name: "openclaw",
        status: entry.pm2_env.status === "online" ? "running" : "stopped",
        pid: entry.pid,
        uptime: entry.pm2_env.pm_uptime,
        restarts: entry.pm2_env.restart_time,
      };
    } catch {
      return { name: "openclaw", status: "unknown" };
    } finally {
      client?.end();
    }
  }
}
