import { useState, useEffect, useRef, useCallback } from "react";
import { HardDrive, Server, CheckCircle, XCircle, Loader, Circle, Clock, ExternalLink, Wrench, KeyRound, ChevronDown, RefreshCw, Zap, RotateCcw, Package, Eye, EyeOff, Terminal, Info, FolderOpen, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  deployCheckNode, deployInstallOpenclaw, deployInstallPm2,
  deployOnboard, deployStart, configureApiKey,
  getBrowserUrl, openInBrowser, checkDeployStatus, updateOpenclaw,
  deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
  deployRemoteOnboard, deployRemoteStartGateway,
  type StepResult, type DeployStatus, type SshArgs,
} from "../ipc";
import i18n from "../i18n";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { useAiConfigStore } from "../store/aiConfig";
import { verifyProviderKey, DIRECT_PROVIDER_IDS, type VerifyStatus } from "../store/aiVerify";

// ---------------------------------------------------------------------------
// Translate backend English keys to Chinese
// ---------------------------------------------------------------------------
/** Prettify raw backend key for English display when no mapping exists */
function prettifyKey(raw: string): string {
  return raw
    .replace(/[-_:]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function translateDetail(raw: string): string {
  if (!raw) return raw;
  const isEn = i18n.language === "en";

  // Exact key matches
  const exactMap: Record<string, string> = {
    "config-initialized": "配置初始化完成",
    "config-initialized-alt-dir": "配置已初始化（备用目录）",
    "config-reset-and-initialized": "配置已重置并重新初始化",
    "config-skipped-using-defaults": "跳过配置，使用默认值",
    "installed-user-prefix": "已安装到用户目录",
    "node-installed-restart-required": "Node.js 已安装，请重启应用后重试",
    "remote-deploy-not-implemented": "服务器部署功能开发中，请先使用本机部署",
  };
  if (isEn) {
    // English: pass through raw value; prettify pure keys
    if (exactMap[raw]) return prettifyKey(raw); // key known but no EN translation — beautify it
    // fall through to prefix map for dynamic values
  } else {
    if (exactMap[raw]) return exactMap[raw];
  }

  // Prefix key:value matches
  const prefixMap: [string, (v: string) => string][] = [
    ["already-installed:", (v) => `已安装 ${v}`],
    ["installed:", (v) => `已安装 ${v}`],
    ["installed via npmmirror", () => "通过 npmmirror 安装成功"],
    ["installed after cache clean", () => "清理缓存后安装成功"],
    ["installed after ssl fix", () => "修复 SSL 后安装成功"],
    ["installed to user prefix", () => "已安装到用户目录"],
    ["found-node-at:", (v) => `在 ${v} 找到 Node.js`],
    ["nvm-upgrade:", (v) => `已通过 nvm 升级（旧版本 ${v}）`],
    ["fnm-upgrade:", (v) => `已通过 fnm 升级（旧版本 ${v}）`],
    ["winget-install-node-lts", () => "已通过 winget 安装 Node.js LTS"],
    ["gateway-ready:", (v) => {
      const parts = v.split(":");
      // Local deploy: "gateway-ready:18789:18791" (port:uiPort)
      // Remote deploy: "gateway-ready:18789"      (port only)
      return parts[1]
        ? `Gateway :${parts[0]} 就绪，控制台 http://localhost:${parts[1]}`
        : `Gateway 端口 ${parts[0]} 已启动`;
    }],
    ["gateway-crash:", (v) => `Gateway 崩溃：${v}`],
    ["gateway-timeout:", (v) => `Gateway 超时：${v}`],
    ["npm-root-not-found:", () => "找不到 npm 全局路径，请重启应用后重试"],
    ["openclaw-mjs-not-found:", (v) => `找不到 openclaw 主文件：${v}`],
    ["wrapper-write-failed:", () => "无法写入启动脚本（磁盘权限问题）"],
    ["pm2-start-failed:", () => "pm2 启动失败，请尝试以管理员身份运行"],
    ["network-failed:", (v) => `网络错误：${v}`],
    ["cache-clean-failed:", (v) => `清缓存后仍失败：${v}`],
    ["ssl-fix-failed:", (v) => `SSL 修复失败：${v}`],
    ["disk-full:", (v) => `磁盘空间不足：${v}`],
    ["install-failed:", (v) => `安装失败：${v}`],
    ["user-prefix-failed:", (v) => `用户目录安装失败：${v}`],
    ["config-reset-failed:", (v) => `配置重置失败：${v}`],
    ["winget-failed:", (v) => `winget 安装失败：${v}`],
    // node-not-found: dynamic — shows extra detail if present, generic message otherwise
    ["node-not-found:", (v) => `未找到 Node.js${v ? "：" + v : "，请从 https://nodejs.org 手动安装 v18+"}`],
    ["installed-but-not-found:", () => "已安装但未找到命令，请重启应用后重试"],
    ["alt-config-dir:", (v) => `使用备用配置目录：${v}`],
    ["api-key-configured", () => "AI 模型 API Key 已配置"],
    ["provider-or-key-empty", () => "提供商或 API Key 不能为空"],
    ["paste-token-failed:", (v) => `API Key 写入失败：${v}`],
    ["configured-provider:", (v) => `已配置 ${v}`],
    // Remote SSH deploy
    ["ssh-connected:", (v) => `SSH 连接成功：${v}`],
    ["ssh-connect-failed:", (v) => `SSH 连接失败：${v}`],
    ["ssh-auth-failed", () => "SSH 认证失败，请检查用户名和密码/私钥"],
    ["ssh-key-parse-failed:", (v) => `私钥解析失败：${v}`],
    ["ssh-exit-", (v) => { const [code, ...rest] = v.split(":"); return `命令退出码 ${code}：${rest.join(":")}`; }],
    ["gateway-start-failed", (v) => `Gateway 启动失败：${v}`],
    ["openclaw-not-found-after-install", () => "OpenClaw 安装后未找到命令，请检查 PATH 配置"],
    ["install-openclaw-failed:", (v) => `OpenClaw 安装失败：${v}`],
  ];

  for (const [prefix, fn] of prefixMap) {
    if (raw.startsWith(prefix)) return fn(raw.slice(prefix.length));
    if (raw.includes(prefix)) return fn(raw.split(prefix)[1] ?? "");
  }

  // Version string (v24.x.x or 2026.x.x) - pass through as-is
  if (/^v?\d+\.\d+/.test(raw)) return raw;

  return raw;
}

function translateFix(fix: string): string {
  const isEn = i18n.language === "en";
  if (isEn) return prettifyKey(fix);

  const exactMap: Record<string, string> = {
    "switch-npmmirror": "切换 npmmirror 镜像",
    "clean-npm-cache": "清理 npm 缓存",
    "disable-ssl-temporarily": "临时关闭 SSL 验证",
    "rebuild-pm2-home": "重建 pm2 主目录",
    "delete-stale-pm2-process": "清除旧 pm2 进程",
    "restart-pm2-daemon-and-retry": "重启 pm2 守护进程",
    "restart-pm2-daemon": "重启 pm2 守护进程",
    "wrapper-fallback-to-temp": "启动脚本写入 TEMP 目录",
    "onboard-skipped-non-fatal": "跳过初始化（使用默认配置）",
    "reset-corrupt-config": "重置损坏的配置文件",
    "winget-install-node-lts": "通过 winget 安装 Node.js LTS",
  };
  if (exactMap[fix]) return exactMap[fix];

  if (fix.startsWith("found-node-at:")) return `发现 Node.js：${fix.slice(14)}`;
  if (fix.startsWith("nvm-upgrade:")) return `nvm 升级 Node.js（原 ${fix.slice(12)}）`;
  if (fix.startsWith("fnm-upgrade:")) return `fnm 升级 Node.js（原 ${fix.slice(12)}）`;
  if (fix.startsWith("user-prefix-install:")) return `安装到用户目录：${fix.slice(20)}`;
  if (fix.startsWith("kill-port-occupant:")) return `释放端口 ${fix.slice(19)}`;
  if (fix.startsWith("backup-corrupt-config:")) return `备份损坏配置：${fix.slice(22)}`;
  if (fix.startsWith("alt-config-dir:")) return `使用备用配置目录：${fix.slice(15)}`;
  if (fix.startsWith("auth-written:")) return `已写入 ${fix.slice(13)} API Key`;
  if (fix.startsWith("model-set:")) {
    const m = fix.slice(10);
    if (m.startsWith("openrouter/")) return `已设置默认模型：${m}（通过 OpenRouter 路由）`;
    return `已设置默认模型：${m}`;
  }
  if (fix.startsWith("model-set-skipped:")) return `模型设置跳过（${fix.slice(18).slice(0, 40)}）`;

  return fix;
}

type DeployMode    = "local" | "remote";
type StepStatus    = "pending" | "running" | "done" | "error";
/** What action the user chose when an existing install is detected */
type DeployAction  = "full" | "update" | "restart";
type SshAuthMethod = "password" | "key";

interface StepDef {
  label: string;
  /** 预估秒数 */
  estimatedSec: number;
  /** 补充说明，帮用户理解为什么慢 */
  hint?: string;
}
// StepResult is imported from "../ipc" — do NOT redeclare locally.

// ── Step definitions per action ──────────────────────────────────────────────

const STEP_DEFS_BY_ACTION = {
  full: [
    { labelKey: "deploy.steps.checkNode",       estimatedSec: 2  },
    { labelKey: "deploy.steps.updateOpenclaw",   estimatedSec: 60 },
    { labelKey: "deploy.steps.installPm2",       estimatedSec: 30 },
    { labelKey: "deploy.steps.onboard",          estimatedSec: 5  },
    { labelKey: "deploy.steps.start",            estimatedSec: 5  },
  ],
  update: [
    { labelKey: "deploy.steps.updateOpenclaw",   estimatedSec: 60 },
    { labelKey: "deploy.steps.onboard",          estimatedSec: 5  },
    { labelKey: "deploy.steps.start",            estimatedSec: 5  },
  ],
  restart: [
    { labelKey: "deploy.steps.start",            estimatedSec: 5  },
  ],
} as const;

const REMOTE_STEP_DEFS = [
  { labelKey: "deploy.steps.remoteConnect",           estimatedSec: 5  },
  { labelKey: "deploy.steps.remoteCheckNode",         estimatedSec: 60 },
  { labelKey: "deploy.steps.remoteInstallOpenclaw",   estimatedSec: 90 },
  { labelKey: "deploy.steps.remoteOnboard",           estimatedSec: 5  },
  { labelKey: "deploy.steps.remoteStart",             estimatedSec: 15 },
] as const;

const STEP_FNS_BY_ACTION: Record<DeployAction, Array<(port?: number) => Promise<StepResult>>> = {
  full: [
    () => deployCheckNode(),
    // Use updateOpenclaw (not deployInstallOpenclaw) so the full reinstall
    // always upgrades to the latest version instead of skipping when openclaw
    // is already installed at an older version.
    () => updateOpenclaw(),
    () => deployInstallPm2(),
    () => deployOnboard(),
    (port) => deployStart(port),
  ],
  update: [
    () => updateOpenclaw(),
    () => deployOnboard(),
    (port) => deployStart(port),
  ],
  restart: [
    (port) => deployStart(port),
  ],
};

interface StepState extends StepDef {
  status: StepStatus;
  detail?: string;
  fixes_applied: string[];
  elapsedSec: number;
}

function fmtSec(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StepRow({ step, isActive }: { step: StepState; isActive: boolean }) {
  const { t } = useTranslation();
  const pct = isActive
    ? Math.min(99, (step.elapsedSec / step.estimatedSec) * 100)
    : step.status === "done" || step.status === "error"
    ? 100
    : 0;

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        {/* icon */}
        <div className="w-5 flex-shrink-0 mt-0.5">
          {step.status === "done"    && <CheckCircle size={18} className="text-green-500" />}
          {step.status === "error"   && <XCircle     size={18} className="text-red-500" />}
          {step.status === "running" && <Loader      size={18} className="text-primary animate-spin" />}
          {step.status === "pending" && <Circle      size={18} className="text-muted-foreground/30" />}
        </div>

        {/* label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-sm leading-tight ${
              step.status === "pending" ? "text-muted-foreground/50" :
              step.status === "error"   ? "text-red-600 font-medium" :
              step.status === "running" ? "text-foreground font-semibold" :
                                          "text-foreground"
            }`}>
              {step.label}
            </p>

            {/* time badge */}
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={11} />
              {step.status === "running" ? (
                <span className="tabular-nums">{fmtSec(step.elapsedSec)} / ~{fmtSec(step.estimatedSec)}</span>
              ) : step.status === "done" ? (
                <span className="text-green-600">{fmtSec(step.elapsedSec)}</span>
              ) : step.status === "error" ? (
                <span className="text-red-500">{fmtSec(step.elapsedSec)}</span>
              ) : (
                <span>~{fmtSec(step.estimatedSec)}</span>
              )}
            </span>
          </div>

          {/* hint when pending */}
          {step.status === "pending" && step.hint && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{step.hint}</p>
          )}

          {/* detail when done/error */}
          {step.detail && step.status !== "pending" && (
            <p className={`text-xs mt-0.5 ${step.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
              {translateDetail(step.detail)}
            </p>
          )}

          {/* auto-fixes badge */}
          {step.status === "done" && step.fixes_applied.length > 0 && (
            <div className="mt-1.5 flex items-start gap-1">
              <Wrench size={11} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-600">
                {t("deploy.autoFixed")}{step.fixes_applied.map(translateFix).join(", ")}
              </p>
            </div>
          )}

          {/* progress bar */}
          {(step.status === "running" || step.status === "done" || step.status === "error") && (
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                  step.status === "done"  ? "bg-green-500" :
                  step.status === "error" ? "bg-red-500"   : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// AI providers list — id must match what `openclaw models auth paste-token --provider` accepts
const AI_PROVIDERS = [
  { id: "zai",        label: "智谱 AI / ZAI (GLM，推荐)",  placeholder: "..." },
  { id: "deepseek",   label: "DeepSeek（深度求索）",        placeholder: "sk-..." },
  { id: "minimax",    label: "MiniMax",                     placeholder: "..." },
  { id: "anthropic",  label: "Anthropic (Claude)",          placeholder: "sk-ant-api03-..." },
  { id: "openai",     label: "OpenAI (GPT)",                placeholder: "sk-proj-..." },
  { id: "openrouter", label: "OpenRouter",                  placeholder: "sk-or-v1-..." },
] as const;

const SSH_USER_PRESETS = [
  { user: "root",     hint: "阿里云 / CentOS / Debian" },
  { user: "ubuntu",   hint: "Ubuntu" },
  { user: "ec2-user", hint: "AWS Amazon Linux" },
  { user: "admin",    hint: "Debian (AWS)" },
] as const;

// ── CPS 推广链接（服务端跳转，ID 永远不出现在源码里）────────────────────────────
// 所有请求先到 Cloudflare Worker（infra/refer-worker），由服务端附加真实 ID 后跳转。
// 即使有人 fork 并把 REFER_BASE 改成别的域名，那是他们自己的服务，不影响你的佣金。
// 修改推广 ID 只需: wrangler secret put AFFILIATE_ALIYUN（无需重新打包 App）
const REFER_BASE = "https://refer.clawno11.ai";

const CLOUD_AFFILIATES = [
  {
    group:  "domestic" as const,
    id:     "aliyun",
    name:   "阿里云 ECS",
    badge:  "新用户特惠",
    spec:   "2核 4GB · Ubuntu / CentOS",
    url:    `${REFER_BASE}/aliyun`,
  },
  {
    group:  "domestic" as const,
    id:     "tencent",
    name:   "腾讯云 CVM",
    badge:  "限时折扣",
    spec:   "2核 4GB · 高性价比",
    url:    `${REFER_BASE}/tencent`,
  },
  {
    group:  "international" as const,
    id:     "digitalocean",
    name:   "DigitalOcean",
    badge:  "$200 试用金",
    spec:   "2vCPU 4GB · 全球机房",
    url:    `${REFER_BASE}/digitalocean`,
  },
  {
    group:  "international" as const,
    id:     "vultr",
    name:   "Vultr",
    badge:  "GPU 实例可选",
    spec:   "2vCPU 4GB · 按时计费",
    url:    `${REFER_BASE}/vultr`,
  },
  {
    group:  "international" as const,
    id:     "linode",
    name:   "Linode / Akamai",
    badge:  "老牌稳定",
    spec:   "2vCPU 4GB · 长期分佣",
    url:    `${REFER_BASE}/linode`,
  },
];

export function DeployPage() {
  const { t } = useTranslation();
  const [mode, setMode]               = useState<DeployMode>("local");
  const [steps, setSteps]             = useState<StepState[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [finalResult, setFinalResult] = useState<{
    success: boolean;
    serviceStarted: boolean;
    message: string;
    inst?: ClawInstance;
  } | null>(null);
  const [activeIdx, setActiveIdx]     = useState<number>(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addOrUpdate = useInstanceStore((s) => s.addOrUpdate);

  // ── SSH form state ──────────────────────────────────────────────────────────
  const [sshHost, setSshHost]             = useState("");
  const [sshPort, setSshPort]             = useState(22);
  const [sshUser, setSshUser]             = useState("root");
  const [sshAuthMethod, setSshAuthMethod] = useState<SshAuthMethod>("password");
  const [sshPassword, setSshPassword]     = useState("");
  const [sshPrivateKey, setSshPrivateKey] = useState("");
  const [sshGatewayPort, setSshGatewayPort] = useState(18789);
  const [showPassword, setShowPassword]   = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  // ── Pre-deploy status check ─────────────────────────────────────────────────
  const [checkPhase, setCheckPhase]   = useState<"checking" | "fresh" | "installed">("checking");
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [isRechecking, setIsRechecking] = useState(false);

  const runStatusCheck = useCallback(async (silent = false) => {
    if (!silent) setCheckPhase("checking");
    setIsRechecking(true);
    try {
      const status = await checkDeployStatus();
      setDeployStatus(status);
      setCheckPhase(status.openclaw_installed ? "installed" : "fresh");
    } catch {
      setCheckPhase("fresh");
    } finally {
      setIsRechecking(false);
    }
  }, []);

  useEffect(() => { runStatusCheck(); }, [runStatusCheck]);

  // Step 6: Configure AI model
  const [aiProvider, setAiProvider]         = useState<string>("anthropic");
  const [aiApiKey, setAiApiKey]             = useState("");
  const [isConfiguringAI, setIsConfiguringAI] = useState(false);
  const [aiConfigResult, setAiConfigResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiVerifyStatus, setAiVerifyStatus] = useState<VerifyStatus>("idle");
  const [aiVerifyMsg, setAiVerifyMsg]       = useState<string | undefined>();

  // elapsed ticker – increments the current active step's elapsedSec every second
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeIdx < 0 || !isDeploying) return;

    timerRef.current = setInterval(() => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === activeIdx ? { ...s, elapsedSec: s.elapsedSec + 1 } : s,
        ),
      );
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeIdx, isDeploying]);

  const updateStep = (index: number, patch: Partial<StepState>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  // ── Shared pipeline engine ───────────────────────────────────────────────────
  //
  // Handles the step loop, state updates, and error teardown.
  // Callers supply business-logic callbacks:
  //   onStepSuccess(i, result) — called after each successful step (side-effects)
  //   onAbort(i, result|msg)   — called when a step fails (set finalResult, etc.)

  const runDeployPipeline = async (
    stepDefs: StepDef[],
    stepFns: Array<() => Promise<StepResult>>,
    onStepSuccess: (i: number, result: StepResult) => void,
    onAbort: (i: number, result: StepResult | string) => void,
  ): Promise<void> => {
    const fresh: StepState[] = stepDefs.map((d) => ({
      ...d, status: "pending" as const, elapsedSec: 0, fixes_applied: [],
    }));
    setSteps(fresh);
    setFinalResult(null);
    setIsDeploying(true);

    for (let i = 0; i < stepFns.length; i++) {
      setActiveIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running", elapsedSec: 0, fixes_applied: [] } : s)),
      );

      try {
        const res = await stepFns[i]();

        if (res.ok) {
          updateStep(i, { status: "done", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          onStepSuccess(i, res);
        } else {
          updateStep(i, { status: "error", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          onAbort(i, res);
          setIsDeploying(false);
          setActiveIdx(-1);
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateStep(i, { status: "error", detail: msg, fixes_applied: [] });
        onAbort(i, msg);
        setIsDeploying(false);
        setActiveIdx(-1);
        return;
      }
    }

    setActiveIdx(-1);
    setIsDeploying(false);
  };

  // ── Local deploy ─────────────────────────────────────────────────────────────

  const handleLocalDeploy = async (action: DeployAction = "full") => {
    const port = 18789;
    const stepDefs: StepDef[] = STEP_DEFS_BY_ACTION[action].map((k) => ({
      label: t(k.labelKey), estimatedSec: k.estimatedSec,
    }));
    const boundStepFns = STEP_FNS_BY_ACTION[action].map((fn) => () => fn(port));
    const LAST = boundStepFns.length - 1;

    await runDeployPipeline(
      stepDefs,
      boundStepFns,
      (i) => {
        // After onboard (second-to-last) → register as offline (installed, not started)
        if (i === LAST - 1) {
          addOrUpdate({
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://127.0.0.1:${port}`, uiUrl: `http://127.0.0.1:${port}`,
            httpUrl: `http://127.0.0.1:${port}`, port, deployedAt: Date.now(), health: "offline",
          });
        }
        // After start (last) → update to online and set final result
        if (i === LAST) {
          const inst: ClawInstance = {
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
            httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "online",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: true, message: t("deploy.success"), inst });
        }
      },
      (i, result) => {
        const detail = typeof result === "string" ? result : result.detail;
        // Last step failure = service failed to start, but install succeeded
        if (i === LAST) {
          const inst: ClawInstance = {
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
            httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "offline",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: false, message: detail, inst });
        } else {
          setFinalResult({ success: false, serviceStarted: false, message: detail });
        }
      },
    );
  };

  // ── Test SSH connection ──────────────────────────────────────────────────────

  const handleTestConnection = async () => {
    if (!sshHost.trim()) return;
    const sshArgs: SshArgs = {
      host: sshHost.trim(),
      port: sshPort,
      username: sshUser.trim() || "root",
      password:    sshAuthMethod === "password" ? sshPassword   : undefined,
      privateKey:  sshAuthMethod === "key"      ? sshPrivateKey : undefined,
      gatewayPort: sshGatewayPort,
    };
    setIsTestingConn(true);
    setConnTestResult(null);
    try {
      const res = await deployRemoteConnect(sshArgs);
      setConnTestResult({
        ok:  res.ok,
        msg: res.ok
          ? (i18n.language === "en" ? "Connection successful" : "连接成功")
          : translateDetail(res.detail),
      });
    } catch (e) {
      setConnTestResult({ ok: false, msg: String(e) });
    } finally {
      setIsTestingConn(false);
    }
  };

  // ── Remote (SSH) deploy ──────────────────────────────────────────────────────

  const handleRemoteDeploy = async () => {
    if (!sshHost.trim()) return;

    const sshArgs: SshArgs = {
      host: sshHost.trim(),
      port: sshPort,
      username: sshUser.trim() || "root",
      password: sshAuthMethod === "password" ? sshPassword : undefined,
      privateKey: sshAuthMethod === "key" ? sshPrivateKey : undefined,
      gatewayPort: sshGatewayPort,
    };

    const port = sshGatewayPort;
    const stepDefs: StepDef[] = REMOTE_STEP_DEFS.map((k) => ({
      label: t(k.labelKey), estimatedSec: k.estimatedSec,
    }));
    const stepFns: Array<() => Promise<StepResult>> = [
      () => deployRemoteConnect(sshArgs),
      () => deployRemoteCheckNode(sshArgs),
      () => deployRemoteInstallOpenclaw(sshArgs),
      () => deployRemoteOnboard(sshArgs),
      () => deployRemoteStartGateway(sshArgs),
    ];
    const LAST = stepFns.length - 1;

    await runDeployPipeline(
      stepDefs,
      stepFns,
      (i) => {
        if (i === LAST) {
          const inst: ClawInstance = {
            id: `remote-${sshArgs.host}-${port}`,
            name: `${sshArgs.host}:${port}`,
            kind: "remote" as const,
            gatewayUrl: `ws://${sshArgs.host}:${port}`,
            uiUrl: `http://${sshArgs.host}:${port}`,
            httpUrl: `http://${sshArgs.host}:${port}`,
            port,
            deployedAt: Date.now(),
            health: "online",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: true, message: t("deploy.success"), inst });
        }
      },
      (_, result) => {
        const detail = typeof result === "string" ? result : result.detail;
        setFinalResult({ success: false, serviceStarted: false, message: detail });
      },
    );
  };

  const handleDeploy = (action: DeployAction = "full") => {
    if (mode === "local") {
      handleLocalDeploy(action);
    } else {
      handleRemoteDeploy();
    }
  };

  const reset = () => {
    setSteps([]); setFinalResult(null); setActiveIdx(-1);
    setAiApiKey(""); setAiConfigResult(null);
    // Keep SSH form values so user can retry without re-entering credentials
  };

  const resetAndRecheck = () => {
    reset();
    runStatusCheck();
  };

  const { markConfigured: markAiConfigured } = useAiConfigStore();

  const handleConfigureAI = async () => {
    if (!aiApiKey.trim()) return;
    setIsConfiguringAI(true);
    setAiConfigResult(null);
    setAiVerifyStatus("idle");
    const key = aiApiKey.trim();
    try {
      const res = await configureApiKey(aiProvider, key);
      setAiConfigResult({ ok: res.ok, msg: translateDetail(res.detail) });
      if (res.ok) {
        setAiApiKey("");
        await markAiConfigured(aiProvider);
        // Auto-verify the key
        setAiVerifyStatus("verifying");
        const v = await verifyProviderKey(aiProvider, key, DIRECT_PROVIDER_IDS.has(aiProvider));
        setAiVerifyStatus(v.status);
        setAiVerifyMsg(v.message);
      }
    } catch (e) {
      setAiConfigResult({ ok: false, msg: String(e) });
    } finally {
      setIsConfiguringAI(false);
    }
  };

  const handleOpenDashboard = async () => {
    try {
      if (mode === "remote" && finalResult?.inst?.uiUrl) {
        await openInBrowser(finalResult.inst.uiUrl);
      } else {
        const url = await getBrowserUrl();
        await openInBrowser(url);
      }
    } catch (e) {
      console.error("open_in_browser failed:", e);
    }
  };

  const totalEstSec   = steps.reduce((s, d) => s + d.estimatedSec, 0);
  const doneSec       = steps.filter((s) => s.status === "done" || s.status === "error").reduce((s, d) => s + d.elapsedSec, 0);
  const activeSec     = steps[activeIdx]?.elapsedSec ?? 0;
  const overallPct    = steps.length === 0 ? 0 : Math.min(99, ((doneSec + activeSec) / totalEstSec) * 100);
  const freshEstSec   = STEP_DEFS_BY_ACTION.full.reduce((s, d) => s + d.estimatedSec, 0);
  return (
    <div className="page-enter p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("deploy.title")}</h1>
        <span className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "rgba(6,182,212,0.1)", color: "hsl(187,85%,40%)", border: "1px solid rgba(6,182,212,0.2)" }}>
          OpenClaw
        </span>
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        {mode === "remote" ? t("deploy.remoteDesc") : t("deploy.desc")}
      </p>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["local", "remote"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); reset(); }}
            disabled={isDeploying}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors disabled:opacity-50 ${
              mode === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            {m === "local" ? <HardDrive size={28} /> : <Server size={28} />}
            <span className="font-semibold">{m === "local" ? t("deploy.local") : t("deploy.remote")}</span>
            <span className="text-xs text-muted-foreground text-center">
              {m === "local" ? t("deploy.localDesc") : t("deploy.remoteDesc")}
            </span>
          </button>
        ))}
      </div>

      {/* SSH form (remote mode, before deploy starts) */}
      {mode === "remote" && steps.length === 0 && !finalResult && (
        <div className="mb-5 space-y-3">

          {/* ── ① 推荐云服务器（CPS 推广） ── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-primary flex-shrink-0" />
                <span className="text-sm font-semibold text-foreground">还没有云服务器？</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">推荐配置：2核 4GB RAM · 公网 IP</span>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* 国内推荐 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">🇨🇳 国内推荐</p>
                <div className="grid grid-cols-2 gap-2">
                  {CLOUD_AFFILIATES.filter((p) => p.group === "domestic").map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openInBrowser(p.url).catch(console.error)}
                      className="flex flex-col items-start gap-1.5 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-colors"
                    >
                      <div className="flex items-center justify-between w-full gap-1">
                        <span className="text-sm font-semibold truncate">{p.name}</span>
                        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">{p.badge}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{p.spec}</span>
                      <div className="flex items-center gap-1 text-xs text-primary">
                        <ExternalLink size={11} />
                        <span>前往购买</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 国际推荐 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">🌐 国际推荐（出海 / GPU）</p>
                <div className="grid grid-cols-3 gap-2">
                  {CLOUD_AFFILIATES.filter((p) => p.group === "international").map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openInBrowser(p.url).catch(console.error)}
                      className="flex flex-col items-start gap-1.5 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-colors"
                    >
                      <div className="flex items-center justify-between w-full gap-1">
                        <span className="text-xs font-semibold truncate">{p.name}</span>
                        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium whitespace-nowrap">{p.badge}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">{p.spec}</span>
                      <div className="flex items-center gap-1 text-[11px] text-primary">
                        <ExternalLink size={10} />
                        <span>前往购买</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 透明披露 */}
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed border-t border-border/40 pt-2.5">
                🤝 通过以上链接购买服务器，OpenClaw 将获得少量推广佣金（不影响您的价格），用于支持项目持续开发与维护。感谢支持！
              </p>
            </div>
          </div>

          {/* ── ② SSH 连接信息指南（始终展开） ── */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/10 border-b border-border/50">
              <Info size={14} className="text-primary flex-shrink-0" />
              <span className="text-sm font-medium text-foreground">{t("deploy.ssh.whereToFind")}</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">{t("deploy.ssh.whereToFindSub")}</span>
            </div>
            <div className="px-4 pb-4 pt-3 bg-muted/10">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left py-1.5 pr-3 font-medium w-24">填写内容</th>
                      <th className="text-left py-1.5 pr-3 font-medium">阿里云 ECS</th>
                      <th className="text-left py-1.5 pr-3 font-medium">腾讯云 CVM</th>
                      <th className="text-left py-1.5 font-medium">AWS EC2</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    <tr>
                      <td className="py-2 pr-3 font-medium text-foreground">公网IP</td>
                      <td className="py-2 pr-3 text-muted-foreground">实例详情 → <span className="font-semibold text-foreground">公网IP</span></td>
                      <td className="py-2 pr-3 text-muted-foreground">实例详情 → <span className="font-semibold text-foreground">公网IP</span></td>
                      <td className="py-2 text-muted-foreground">实例 → <span className="font-semibold text-foreground">Public IPv4</span></td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-foreground">用户名</td>
                      <td className="py-2 pr-3 text-muted-foreground">Alibaba Linux / CentOS: <b>root</b><br/>Ubuntu 镜像: <b>root</b></td>
                      <td className="py-2 pr-3 text-muted-foreground">Ubuntu: <b>ubuntu</b><br/>其他镜像: <b>root</b></td>
                      <td className="py-2 text-muted-foreground">Amazon Linux: <b>ec2-user</b><br/>Ubuntu: <b>ubuntu</b></td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-foreground">认证方式</td>
                      <td className="py-2 pr-3 text-muted-foreground">创建时选密码→用密码<br/>选密钥对→用 .pem</td>
                      <td className="py-2 pr-3 text-muted-foreground">创建时选密码→用密码<br/>绑定密钥→用 .pem</td>
                      <td className="py-2 text-muted-foreground">通常为密钥对<br/>（创建实例时下载 .pem）</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
                💡 忘记密码？登录云厂商控制台 → 实例详情 → 重置实例密码
              </p>
            </div>
          </div>

          {/* ── ② Connection card ── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Terminal size={15} className="text-primary" />
              <p className="text-sm font-semibold">{t("deploy.ssh.title")}</p>
              <span className="ml-auto text-[10px] text-muted-foreground">{t("deploy.ssh.tipLinuxOnly")}</span>
            </div>

            {/* Host + SSH Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground block">{t("deploy.ssh.host")}</label>
                <input
                  type="text"
                  value={sshHost}
                  onChange={(e) => { setSshHost(e.target.value); setConnTestResult(null); }}
                  placeholder={t("deploy.ssh.hostPlaceholder")}
                  disabled={isDeploying}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.hostHint")}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground block">{t("deploy.ssh.port")}</label>
                <input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value) || 22)}
                  disabled={isDeploying}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.portHint")}</p>
              </div>
            </div>

            {/* Username + quick-select chips */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground block">{t("deploy.ssh.username")}</label>
              <input
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="root"
                disabled={isDeploying}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-muted-foreground">{t("deploy.ssh.usernameQuickLabel")}</span>
                {SSH_USER_PRESETS.map(({ user, hint }) => (
                  <button
                    key={user}
                    type="button"
                    onClick={() => setSshUser(user)}
                    disabled={isDeploying}
                    title={hint}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                      sshUser === user
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {user}
                  </button>
                ))}
              </div>
            </div>

            {/* Auth method toggle */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">{t("deploy.ssh.authMethod")}</label>
              <div className="grid grid-cols-2 gap-2">
                {(["password", "key"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSshAuthMethod(m)}
                    disabled={isDeploying}
                    className={`py-2 px-3 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                      sshAuthMethod === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <div className="text-xs font-semibold">
                      {m === "password" ? `🔑 ${t("deploy.ssh.authPassword")}` : `🗝️ ${t("deploy.ssh.authKey")}`}
                    </div>
                    <div className="text-[10px] opacity-60 mt-0.5">
                      {m === "password" ? t("deploy.ssh.authPasswordHint") : t("deploy.ssh.authKeyHint")}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Password field */}
            {sshAuthMethod === "password" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground block">{t("deploy.ssh.password")}</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder={t("deploy.ssh.passwordPlaceholder")}
                    disabled={isDeploying}
                    className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            {/* Private key field */}
            {sshAuthMethod === "key" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">{t("deploy.ssh.privateKey")}</label>
                  <button
                    type="button"
                    onClick={() => keyFileRef.current?.click()}
                    disabled={isDeploying}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                  >
                    <FolderOpen size={12} />
                    {t("deploy.ssh.privateKeyPickFile")}
                  </button>
                </div>
                {/* Hidden file input */}
                <input
                  ref={keyFileRef}
                  type="file"
                  accept=".pem,.key,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => setSshPrivateKey((evt.target?.result as string) ?? "");
                    reader.readAsText(file);
                    e.target.value = "";
                  }}
                />
                <textarea
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  placeholder={t("deploy.ssh.privateKeyPlaceholder")}
                  disabled={isDeploying}
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-none"
                />
                <p className="text-[10px] text-muted-foreground">{t("deploy.ssh.tipAuth")}</p>
              </div>
            )}

            {/* Gateway port + security group warning */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">{t("deploy.ssh.gatewayPort")}</label>
              <input
                type="number"
                value={sshGatewayPort}
                onChange={(e) => setSshGatewayPort(Number(e.target.value) || 18789)}
                disabled={isDeploying}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">{t("deploy.ssh.securityGroupWarn")}</p>
              </div>
            </div>
          </div>

          {/* ── ③ Test connection ── */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={isTestingConn || isDeploying || !sshHost.trim() || (sshAuthMethod === "password" ? !sshPassword : !sshPrivateKey.trim())}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium
                         hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isTestingConn
                ? <Loader size={14} className="animate-spin" />
                : <Terminal size={14} />}
              {isTestingConn ? t("deploy.ssh.connecting") : t("deploy.ssh.connect")}
            </button>

            {connTestResult && !isTestingConn && (
              <div className={`flex items-center gap-1.5 ${connTestResult.ok ? "text-green-600" : "text-red-500"}`}>
                {connTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
                <span className="text-xs">{connTestResult.msg}</span>
              </div>
            )}
          </div>

          {/* ── ④ Deploy button ── */}
          <button
            onClick={() => handleRemoteDeploy()}
            disabled={isDeploying || !sshHost.trim() || (sshAuthMethod === "password" ? !sshPassword : !sshPrivateKey.trim())}
            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                       hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors flex items-center justify-center gap-2"
          >
            <Server size={16} />
            {t("deploy.ssh.startRemoteDeploy")}
          </button>
        </div>
      )}

      {/* ── Pre-deploy status card (local only, before deploy starts) ── */}
      {mode === "local" && steps.length === 0 && !finalResult && (
        <>
          {/* Checking spinner */}
          {checkPhase === "checking" && (
            <div className="mb-5 rounded-xl border border-border bg-card p-5 flex items-center gap-3">
              <Loader size={18} className="text-primary animate-spin flex-shrink-0" />
              <p className="text-sm text-muted-foreground">{t("deploy.statusChecking")}</p>
            </div>
          )}

          {/* Already installed — show 3-action card */}
          {checkPhase === "installed" && deployStatus && (
            <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-5">
              {/* Status header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-primary" />
                  <span className="text-sm font-semibold">{t("deploy.statusInstalled")}</span>
                </div>
                <button
                  onClick={() => runStatusCheck()}
                  disabled={isRechecking}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isRechecking ? "animate-spin" : ""} />
                  {t("deploy.recheckStatus")}
                </button>
              </div>

              {/* Version + service status */}
              <div className="flex items-center gap-4 mb-5 px-1">
                <div className="flex items-center gap-1.5">
                  <Package size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{t("deploy.statusVersion")}:</span>
                  <span className="text-xs font-mono font-semibold">v{deployStatus.openclaw_version}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${deployStatus.service_running ? "bg-green-500" : "bg-red-400"}`} />
                  <span className="text-xs text-muted-foreground">
                    {deployStatus.service_running ? t("deploy.statusRunning") : t("deploy.statusStopped")}
                  </span>
                </div>
              </div>

              {/* 3 action buttons */}
              <div className="grid grid-cols-3 gap-2">
                {/* Update */}
                <button
                  onClick={() => handleDeploy("update")}
                  disabled={isDeploying}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Zap size={18} />
                  <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionUpdate")}</span>
                  <span className="text-[10px] opacity-70 text-center leading-tight">{t("deploy.actionUpdateDesc")}</span>
                </button>

                {/* Restart only */}
                <button
                  onClick={() => handleDeploy("restart")}
                  disabled={isDeploying}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-border hover:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={18} />
                  <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionRestart")}</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t("deploy.actionRestartDesc")}</span>
                </button>

                {/* Full reinstall */}
                <button
                  onClick={() => handleDeploy("full")}
                  disabled={isDeploying}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-border hover:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <Package size={18} />
                  <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionReinstall")}</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t("deploy.actionReinstallDesc")}</span>
                </button>
              </div>
            </div>
          )}

          {/* Fresh install — show single deploy button + tip */}
          {checkPhase === "fresh" && (
            <>
              <button
                onClick={() => handleDeploy("full")}
                disabled={isDeploying}
                className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                           hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center gap-2 mb-3"
              >
                {t("deploy.startDeploy")}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                {t("deploy.tipFirst", { time: fmtSec(freshEstSec) })}
              </p>
            </>
          )}
        </>
      )}

      {/* Overall progress bar (shown during / after deploy) */}
      {steps.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{t("deploy.deploying")}</span>
            <span>
              {isDeploying
                ? `~${fmtSec(Math.max(0, totalEstSec - doneSec - activeSec))}`
                : finalResult?.success
                ? fmtSec(steps.reduce((s, d) => s + d.elapsedSec, 0))
                : ""}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                finalResult?.success ? "bg-green-500" :
                finalResult          ? "bg-red-400"   : "bg-primary"
              }`}
              style={{ width: `${finalResult?.success ? 100 : overallPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card px-4 divide-y divide-border">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} isActive={i === activeIdx} />
          ))}
        </div>
      )}

      {/* Final result */}
      {finalResult && (
        <>
          <div className={`mb-4 rounded-xl border p-4 ${
            finalResult.success && finalResult.serviceStarted
              ? "bg-green-50 border-green-200"
              : finalResult.success
              ? "bg-amber-50 border-amber-200"
              : "bg-red-50 border-red-200"
          }`}>
            <div className="flex items-start gap-3">
              {finalResult.success && finalResult.serviceStarted
                ? <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
                : finalResult.success
                ? <CheckCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                : <XCircle     size={18} className="text-red-500   mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  finalResult.success && finalResult.serviceStarted ? "text-green-700" :
                  finalResult.success ? "text-amber-700" : "text-red-600"
                }`}>
                  {finalResult.success ? t("deploy.success") : t("deploy.failed")}
                </p>
                {(!finalResult.serviceStarted || !finalResult.success) && (
                  <p className="text-xs mt-0.5 text-muted-foreground">
                    {translateDetail(finalResult.message)}
                  </p>
                )}
                {finalResult.success && !finalResult.serviceStarted && (
                  <p className="text-xs mt-1 text-amber-600">{t("deploy.serviceRecorded")}</p>
                )}
              </div>
            </div>
          </div>

          {/* Configure AI Model — local: inline form; remote: SSH command hint */}
          {finalResult.success && finalResult.serviceStarted && mode === "local" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={16} className="text-primary" />
                <p className="text-sm font-semibold">{t("instances.ai.title")} <span className="text-red-500">*</span></p>
                <span className="ml-auto text-xs text-muted-foreground">{t("instances.ai.notConfigured")}</span>
              </div>
              <div className="relative mb-2">
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  disabled={isConfiguringAI || aiConfigResult?.ok === true}
                  className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => { setAiApiKey(e.target.value); setAiVerifyStatus("idle"); }}
                  placeholder={AI_PROVIDERS.find((p) => p.id === aiProvider)?.placeholder ?? "输入 API Key"}
                  disabled={isConfiguringAI || aiVerifyStatus === "verifying" || aiConfigResult?.ok === true}
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfigureAI(); }}
                />
                <button
                  onClick={handleConfigureAI}
                  disabled={isConfiguringAI || aiVerifyStatus === "verifying" || !aiApiKey.trim() || aiConfigResult?.ok === true}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {isConfiguringAI || aiVerifyStatus === "verifying"
                    ? <Loader size={14} className="animate-spin" />
                    : aiVerifyStatus === "ok"
                      ? <CheckCircle size={14} />
                      : aiVerifyStatus === "failed"
                        ? <AlertTriangle size={14} />
                        : <KeyRound size={14} />}
                  {isConfiguringAI
                    ? t("deploy.deploying")
                    : aiVerifyStatus === "verifying"
                      ? "验证中…"
                      : aiVerifyStatus === "ok"
                        ? "已配置（可用）"
                        : aiVerifyStatus === "failed"
                          ? "配置失败"
                          : aiVerifyStatus === "relay"
                            ? "已写入（中转）"
                            : aiConfigResult?.ok
                              ? t("instances.ai.configured")
                              : t("instances.actions.write")}
                </button>
              </div>
              {aiConfigResult && !aiConfigResult.ok && (
                <p className="text-xs mt-2 text-red-500">✗ {aiConfigResult.msg}</p>
              )}
              {aiConfigResult?.ok && aiVerifyStatus === "verifying" && (
                <p className="text-xs mt-2 text-blue-600 flex items-center gap-1">
                  <RefreshCw size={11} className="animate-spin" /> Key 写入成功，正在验证可用性…
                </p>
              )}
              {aiConfigResult?.ok && aiVerifyStatus === "ok" && (
                <p className="text-xs mt-2 text-green-600">✓ Key 验证通过，配置成功，可以开始使用</p>
              )}
              {aiConfigResult?.ok && aiVerifyStatus === "relay" && (
                <p className="text-xs mt-2 text-amber-600">✓ Key 已写入（中转模式），请确保 OpenRouter 也已配置</p>
              )}
              {aiConfigResult?.ok && aiVerifyStatus === "failed" && (
                <p className="text-xs mt-2 text-red-500">
                  ✗ Key 已写入但验证失败：{aiVerifyMsg ?? "无法连接服务商"} · 请检查 Key 是否正确
                </p>
              )}
            </div>
          )}

          {/* Remote: show SSH command the user must run on the server */}
          {finalResult.success && finalResult.serviceStarted && mode === "remote" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <KeyRound size={16} className="text-primary" />
                <p className="text-sm font-semibold">{t("instances.ai.title")}</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{t("deploy.ssh.aiKeyRemoteHint")}</p>
              <code className="block text-xs font-mono bg-muted/60 px-3 py-2 rounded-lg break-all select-all">
                {`openclaw models auth paste-token --provider PROVIDER`}
              </code>
              <p className="text-xs text-muted-foreground mt-1.5">
                {`ssh ${sshUser}@${sshHost}`}
              </p>
            </div>
          )}

          {/* Open dashboard */}
          {finalResult.success && finalResult.serviceStarted && (
            <div className="mb-4">
              <button
                onClick={handleOpenDashboard}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
              >
                <ExternalLink size={15} />
                {t("deploy.openDashboard")}
              </button>
              {mode === "local" && !aiConfigResult?.ok && (
                <p className="text-xs text-center text-muted-foreground mt-1">{t("deploy.noApiKeyHint")}</p>
              )}
            </div>
          )}

          {/* After deploy: reset button */}
          <button
            onClick={mode === "local" ? resetAndRecheck : reset}
            disabled={isDeploying}
            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                       hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors flex items-center justify-center gap-2"
          >
            {finalResult.success && finalResult.serviceStarted
              ? t("deploy.redeploy")
              : finalResult.success && !finalResult.serviceStarted
              ? t("deploy.retryStart")
              : t("deploy.startDeploy")}
          </button>
        </>
      )}
    </div>
  );
}
