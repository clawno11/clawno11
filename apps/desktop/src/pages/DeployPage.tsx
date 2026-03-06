import { useState } from "react";
import { HardDrive, Server } from "lucide-react";

type DeployMode = "local" | "remote";

interface DeployProgress {
  message: string;
  percent: number;
}

export function DeployPage() {
  const [mode, setMode] = useState<DeployMode>("local");
  const [progress, setProgress] = useState<DeployProgress | null>(null);
  const [done, setDone] = useState(false);

  // Remote SSH form state
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [port, setPort] = useState("22");

  const handleDeploy = async () => {
    setDone(false);
    setProgress({ message: "准备部署...", percent: 0 });

    if (mode === "local") {
      // Dynamic import to avoid SSR issues
      const { LocalDeployer } = await import("@clawno/deploy-engine");
      const deployer = new LocalDeployer({
        onProgress: (p) => setProgress({ message: p.message, percent: p.percent }),
      });
      const result = await deployer.deploy();
      if (result.success) {
        setDone(true);
      } else {
        setProgress({ message: `错误：${result.error ?? "未知错误"}`, percent: 0 });
      }
    } else {
      const { RemoteDeployer } = await import("@clawno/deploy-engine");
      const deployer = new RemoteDeployer({
        ssh: { host, username, password, port: parseInt(port) },
        onProgress: (p) => setProgress({ message: p.message, percent: p.percent }),
      });
      const result = await deployer.deploy();
      if (result.success) {
        setDone(true);
      } else {
        setProgress({ message: `错误：${result.error ?? "未知错误"}`, percent: 0 });
      }
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold mb-2">部署 OpenClaw</h1>
      <p className="text-muted-foreground text-sm mb-6">选择部署目标并一键完成安装配置</p>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["local", "remote"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
              mode === m
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            {m === "local" ? <HardDrive size={28} /> : <Server size={28} />}
            <span className="font-semibold">{m === "local" ? "本机部署" : "服务器部署"}</span>
            <span className="text-xs text-muted-foreground text-center">
              {m === "local" ? "部署到当前电脑" : "通过 SSH 部署到 VPS"}
            </span>
          </button>
        ))}
      </div>

      {/* Remote form */}
      {mode === "remote" && (
        <div className="space-y-3 mb-6">
          <div>
            <label className="text-sm font-medium mb-1 block">服务器地址</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.1 或 example.com"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">SSH 端口</label>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="SSH 密码（或留空使用密钥）"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">{progress.message}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {done && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          部署成功！OpenClaw Gateway 已启动。
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={!!progress && !done}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {progress && !done ? "部署中..." : "一键部署"}
      </button>
    </div>
  );
}
