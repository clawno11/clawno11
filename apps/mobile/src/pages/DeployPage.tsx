/**
 * DeployPage — SSH-based remote OpenClaw deployment.
 *
 * User enters VPS SSH credentials → app SSHes in, installs Node.js + pm2 +
 * openclaw, starts the service, and auto-adds it as a connected instance.
 */
import { useState, useRef, useEffect } from "react";
import {
  Terminal, Server, Wifi, CheckCircle2, XCircle, Loader,
  ChevronRight, Eye, EyeOff, ArrowLeft,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sshTestConnection, sshDeploy } from "../ipc";
import { useInstanceStore } from "../store/instances";
import { TopBar } from "../components/TopBar";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeployProgress {
  step: string;
  message: string;
  progress: number;
  error?: string | null;
}

interface LogLine {
  id: string;
  text: string;
  type: "info" | "success" | "error";
}

// ── Step display info ─────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  connecting:           "连接服务器",
  connected:            "SSH 认证",
  "node-ok":            "Node.js 就绪",
  "installing-node":    "安装 Node.js",
  "installing-packages":"安装 pm2 & openclaw",
  "starting-service":   "启动服务",
  firewall:             "防火墙配置",
  verifying:            "验证服务",
  done:                 "部署完成",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DeployPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { add } = useInstanceStore();

  // Form
  const [host, setHost]             = useState("");
  const [sshPort, setSshPort]       = useState("22");
  const [username, setUsername]     = useState("root");
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [openclawPort, setOpenclawPort] = useState("18789");
  const [instanceName, setInstanceName] = useState("");

  // State machine
  type Phase = "form" | "testing" | "deploying" | "done" | "failed";
  const [phase, setPhase]           = useState<Phase>("form");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError]   = useState<string | null>(null);
  const [progress, setProgress]     = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [log, setLog]               = useState<LogLine[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState("");

  const logRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | undefined>(undefined);

  // Auto-scroll log
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  // Cleanup listener on unmount
  useEffect(() => () => unlistenRef.current?.(), []);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const appendLog = (text: string, type: LogLine["type"] = "info") => {
    setLog((prev) => [...prev, { id: crypto.randomUUID(), text, type }]);
  };

  const hostTrimmed     = host.trim();
  const userTrimmed     = username.trim();
  const portNum         = parseInt(sshPort, 10) || 22;
  const ocPortNum       = parseInt(openclawPort, 10) || 18789;
  const derivedName     = instanceName.trim() || hostTrimmed || "远程服务器";

  const canTest    = hostTrimmed && userTrimmed && password && phase === "form";
  const canDeploy  = canTest && (testResult !== null || testError !== null);

  // ── Test connection ─────────────────────────────────────────────────────────

  const handleTest = async () => {
    setPhase("testing");
    setTestResult(null);
    setTestError(null);
    try {
      const info = await sshTestConnection(hostTrimmed, portNum, userTrimmed, password);
      setTestResult(info);
      setTestError(null);
    } catch (e) {
      setTestError(String(e));
      setTestResult(null);
    } finally {
      setPhase("form");
    }
  };

  // ── Deploy ──────────────────────────────────────────────────────────────────

  const handleDeploy = async () => {
    setPhase("deploying");
    setLog([]);
    setProgress(0);
    setCurrentStep("");

    // Listen to progress events
    const unlisten = await listen<DeployProgress>("deploy-progress", (ev) => {
      const p = ev.payload;
      setProgress(p.progress);
      setCurrentStep(STEP_LABELS[p.step] ?? p.step);
      if (p.error) {
        appendLog(`✗ ${p.message}`, "error");
      } else if (p.progress === 100) {
        appendLog(`✓ ${p.message}`, "success");
      } else {
        appendLog(`• ${p.message}`, "info");
      }
    });
    unlistenRef.current = unlisten;

    try {
      const url = await sshDeploy(
        hostTrimmed, portNum, userTrimmed, password, ocPortNum,
      );
      setGatewayUrl(url);

      // Add to instances store
      add({
        id:      crypto.randomUUID(),
        name:    derivedName,
        httpUrl: url,
        port:    ocPortNum,
        health:  "unknown",
        type:    "remote",
      });

      setPhase("done");
    } catch (e) {
      appendLog(`✗ 部署中止: ${String(e)}`, "error");
      setPhase("failed");
    } finally {
      unlisten();
      unlistenRef.current = undefined;
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="部署服务器"
        subtitle="通过 SSH 一键部署 OpenClaw"
        left={
          <button
            onClick={() => navigate(-1)}
            className="touch-btn p-2 rounded-full text-[hsl(var(--muted-foreground))]"
          >
            <ArrowLeft size={20} />
          </button>
        }
      />

      <div className="flex-1 scrollable p-4 space-y-4 pb-8">

        {/* ── SSH Credentials ── */}
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]"
            style={{ background: "rgba(6,182,212,0.04)" }}>
            <p className="font-semibold text-sm text-[hsl(var(--primary))]">服务器 SSH 凭据</p>
          </div>
          <div className="p-4 space-y-3">
            {/* Host */}
            <div>
              <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                IP 地址 / 域名
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100 或 myserver.com"
                disabled={phase !== "form"}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
            </div>

            {/* SSH port + Username row */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  SSH 端口
                </label>
                <input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  disabled={phase !== "form"}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  用户名
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={phase !== "form"}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                SSH 密码
              </label>
              <div className="mt-1 relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="SSH 登录密码"
                  disabled={phase !== "form"}
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 touch-btn text-[hsl(var(--muted-foreground))]"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* OpenClaw port + Instance name */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  服务端口
                </label>
                <input
                  type="number"
                  value={openclawPort}
                  onChange={(e) => setOpenclawPort(e.target.value)}
                  disabled={phase !== "form"}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                  实例名称（可选）
                </label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder={hostTrimmed || "远程服务器"}
                  disabled={phase !== "form"}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Test connection result ── */}
        {testResult && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl text-xs text-green-700"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">连接成功</p>
              <p className="font-mono opacity-80 leading-relaxed break-all">{testResult}</p>
            </div>
          </div>
        )}
        {testError && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl text-xs text-red-700"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <XCircle size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">连接失败</p>
              <p className="opacity-80 break-all">{testError}</p>
            </div>
          </div>
        )}

        {/* ── Buttons (form phase) ── */}
        {phase === "form" && (
          <div className="flex flex-col gap-2.5">
            <button
              onClick={handleTest}
              disabled={!canTest}
              className="touch-btn w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border transition-colors disabled:opacity-40"
              style={{ borderColor: "rgba(6,182,212,0.4)", color: "hsl(var(--primary))" }}
            >
              <Wifi size={16} /> 测试连接
            </button>
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className="touch-btn w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-colors disabled:opacity-40"
              style={{ background: canDeploy ? "hsl(var(--primary))" : "hsl(var(--muted))", boxShadow: canDeploy ? "0 0 20px rgba(6,182,212,0.4)" : "none" }}
            >
              <Server size={16} /> 一键部署 OpenClaw <ChevronRight size={14} />
            </button>
            <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))] px-4">
              部署将在服务器上安装 Node.js、pm2 和 openclaw，并自动启动服务
            </p>
          </div>
        )}

        {/* ── Progress (deploying phase) ── */}
        {(phase === "deploying" || phase === "failed") && (
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center gap-2"
              style={{ background: phase === "failed" ? "rgba(239,68,68,0.04)" : "rgba(6,182,212,0.04)" }}>
              {phase === "deploying"
                ? <Loader size={14} className="animate-spin text-[hsl(var(--primary))]" />
                : <XCircle size={14} className="text-red-500" />}
              <p className="font-semibold text-sm" style={{ color: phase === "failed" ? "#ef4444" : "hsl(var(--primary))" }}>
                {phase === "deploying" ? (currentStep || "部署中...") : "部署失败"}
              </p>
              {phase === "deploying" && (
                <span className="ml-auto text-[11px] font-mono text-[hsl(var(--muted-foreground))]">{progress}%</span>
              )}
            </div>

            {/* Progress bar */}
            {phase === "deploying" && (
              <div className="h-1.5 bg-[hsl(var(--muted))]">
                <div
                  className="h-full transition-all duration-700 rounded-r-full"
                  style={{ width: `${progress}%`, background: "hsl(var(--primary))" }}
                />
              </div>
            )}

            {/* Log */}
            <div
              ref={logRef}
              className="p-3 max-h-52 overflow-y-auto font-mono text-[11px] space-y-1 bg-[#0f172a]"
            >
              {log.length === 0 && (
                <p className="text-slate-500">正在初始化...</p>
              )}
              {log.map((line) => (
                <p key={line.id} className={
                  line.type === "success" ? "text-green-400"
                  : line.type === "error"   ? "text-red-400"
                  : "text-slate-300"
                }>
                  {line.text}
                </p>
              ))}
            </div>

            {phase === "failed" && (
              <div className="px-4 py-3 border-t border-[hsl(var(--border))]">
                <button
                  onClick={() => { setPhase("form"); setLog([]); setProgress(0); }}
                  className="touch-btn w-full py-2.5 rounded-xl text-sm font-semibold text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]"
                >
                  返回修改
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Success (done phase) ── */}
        {phase === "done" && (
          <section className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.04)" }}>
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.12)" }}>
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <div>
                <p className="font-bold text-base text-green-700 mb-1">部署成功！</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  OpenClaw 已在你的服务器上运行
                </p>
                <p className="mt-1 font-mono text-xs text-green-700 break-all">{gatewayUrl}</p>
              </div>

              {/* Show final log */}
              <div
                ref={logRef}
                className="w-full rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-[11px] space-y-1 text-left bg-[#0f172a]"
              >
                {log.map((line) => (
                  <p key={line.id} className={
                    line.type === "success" ? "text-green-400"
                    : line.type === "error"   ? "text-red-400"
                    : "text-slate-300"
                  }>
                    {line.text}
                  </p>
                ))}
              </div>

              <div className="flex flex-col gap-2.5 w-full mt-1">
                <button
                  onClick={() => navigate("/chat")}
                  className="touch-btn w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white"
                  style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
                >
                  <Terminal size={15} /> 立即开始聊天
                </button>
                <button
                  onClick={() => navigate("/")}
                  className="touch-btn w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-semibold text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]"
                >
                  <Server size={14} /> 查看实例列表
                </button>
              </div>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
