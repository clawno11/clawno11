import { useState } from "react";
import { HardDrive, Server, CheckCircle, XCircle, Loader } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { LocalDeployResult } from "@clawno/deploy-engine";

type DeployMode = "local" | "remote";

interface Step {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

const LOCAL_STEPS: Step[] = [
  { label: "检查 Node.js 环境", status: "pending" },
  { label: "安装 openclaw", status: "pending" },
  { label: "安装 pm2 服务管理器", status: "pending" },
  { label: "初始化配置", status: "pending" },
  { label: "启动 openclaw 服务", status: "pending" },
];

function StepRow({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-5 flex-shrink-0">
        {step.status === "done" && <CheckCircle size={18} className="text-green-500" />}
        {step.status === "error" && <XCircle size={18} className="text-red-500" />}
        {step.status === "running" && (
          <Loader size={18} className="text-primary animate-spin" />
        )}
        {step.status === "pending" && (
          <div className="w-4 h-4 rounded-full border-2 border-muted" />
        )}
      </div>
      <div className="flex-1">
        <p
          className={`text-sm ${
            step.status === "pending"
              ? "text-muted-foreground"
              : step.status === "error"
                ? "text-red-600"
                : "text-foreground"
          } ${step.status === "running" ? "font-medium" : ""}`}
        >
          {step.label}
        </p>
        {step.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
        )}
      </div>
    </div>
  );
}

export function DeployPage() {
  const [mode, setMode] = useState<DeployMode>("local");
  const [steps, setSteps] = useState<Step[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Remote SSH form
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [sshPort, setSshPort] = useState("22");

  const setStep = (index: number, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const handleLocalDeploy = async () => {
    const initialSteps = LOCAL_STEPS.map((s) => ({ ...s }));
    setSteps(initialSteps);
    setResult(null);
    setIsDeploying(true);

    // Animate through steps while Rust does the real work
    // Each step lights up in sequence; we call the Tauri command once at the end
    const tick = (i: number) =>
      new Promise<void>((res) => setTimeout(() => { setStep(i, { status: "running" }); res(); }, i * 400));

    await tick(0);
    await tick(1);
    await tick(2);
    await tick(3);
    await tick(4);

    try {
      const res = await invoke<LocalDeployResult>("deploy_local", { port: 18789 });

      if (res.success) {
        // Mark all done
        setSteps(LOCAL_STEPS.map((s) => ({ ...s, status: "done" })));
        setResult({ success: true, message: `OpenClaw 已启动！Gateway: http://localhost:${res.port}` });
      } else {
        // Mark last running step as error
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "running" ? { ...s, status: "error", detail: res.error ?? "未知错误" } : s,
          ),
        );
        setResult({ success: false, message: res.error ?? "部署失败" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSteps((prev) =>
        prev.map((s) => (s.status === "running" ? { ...s, status: "error", detail: msg } : s)),
      );
      setResult({ success: false, message: msg });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleDeploy = () => {
    if (mode === "local") {
      handleLocalDeploy();
    } else {
      setResult({ success: false, message: "服务器部署功能开发中，请先使用本机部署" });
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold mb-1">部署 OpenClaw</h1>
      <p className="text-muted-foreground text-sm mb-6">选择部署目标并一键完成安装配置</p>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["local", "remote"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setSteps([]); setResult(null); }}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
              mode === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
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
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">SSH 端口</label>
              <input
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
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
              placeholder="SSH 密码"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card p-4 space-y-1">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </div>
      )}

      {/* Result banner */}
      {result && (
        <div
          className={`mb-5 flex items-start gap-3 p-4 rounded-xl border ${
            result.success
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          {result.success ? (
            <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
          )}
          <p className={`text-sm ${result.success ? "text-green-700" : "text-red-600"}`}>
            {result.message}
          </p>
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={isDeploying}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isDeploying && <Loader size={16} className="animate-spin" />}
        {isDeploying ? "部署中..." : "一键部署"}
      </button>
    </div>
  );
}
