import type { ClawInstance } from "../../store/instances";

export type { DeployStatus } from "../../ipc";
export type { VerifyStatus } from "../../store/aiVerify";

export type DeployMode    = "local" | "remote";
export type StepStatus    = "pending" | "running" | "done" | "error";
export type DeployAction  = "full" | "update" | "restart";
export type SshAuthMethod = "password" | "key";

export interface StepDef {
  label: string;
  /** 预估秒数 */
  estimatedSec: number;
  /** 补充说明，帮用户理解为什么慢 */
  hint?: string;
}

export interface DownloadProgress {
  phase: string;
  bytesDownloaded: number;
  bytesTotal: number;
  speedBps: number;
}

/** Unified progress event from the Rust self-healing engine. */
export interface StepProgress {
  stepId: string;
  phase: string;
  strategyName: string;
  strategyIdx: number;
  strategyTotal: number;
  bytesDone: number;
  bytesTotal: number;
  speedBps: number;
  pct: number;
  etaSecs: number;
  message: string;
  isRetrying: boolean;
  errorSig?: string;
  remedy?: string;
  sourceUrl?: string;
  sourceTrust?: TrustLevel;
}

export interface StepState extends StepDef {
  status: StepStatus;
  detail?: string;
  fixes_applied: string[];
  elapsedSec: number;
  /** Legacy download-only progress (backward compat). */
  downloadProgress?: DownloadProgress;
  /** New unified step progress from the self-healing engine. */
  progress?: StepProgress;
  /** Dependency metadata — present for scan-driven steps. */
  depId?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  trustLevel?: TrustLevel;
  currentVersion?: string;
  preInstalled?: boolean;
}

/** Dependency install order for the dynamic pipeline. */
export const DEP_INSTALL_ORDER = ["nodejs", "npm", "git", "openclaw", "pm2"] as const;

/** Display names for each dependency step. */
export const DEP_LABELS: Record<string, { zh: string; en: string }> = {
  nodejs:   { zh: "Node.js",       en: "Node.js" },
  npm:      { zh: "npm",           en: "npm" },
  git:      { zh: "Git",           en: "Git" },
  openclaw: { zh: "OpenClaw CLI",  en: "OpenClaw CLI" },
  pm2:      { zh: "PM2",           en: "PM2" },
};

/** Estimated install time (seconds) per dependency. */
export const DEP_ESTIMATED_SEC: Record<string, number> = {
  nodejs: 30, npm: 2, git: 30, openclaw: 60, pm2: 30,
};

/** Optional hint shown on dependency card (e.g. "一次性拉取，请耐心等待"). */
export const DEP_HINTS: Partial<Record<string, { zh: string; en: string }>> = {
  git: {
    zh: "一次性拉取中，请耐心等待…约 1–5 分钟",
    en: "Downloading in one batch, please wait…~1–5 min",
  },
};

export interface FinalResult {
  success: boolean;
  serviceStarted: boolean;
  message: string;
  inst?: ClawInstance;
}

// ── Step definitions per action ──────────────────────────────────────────────

export const STEP_DEFS_BY_ACTION = {
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

export const REMOTE_STEP_DEFS = [
  { labelKey: "deploy.ssh.steps.remoteConnect",           estimatedSec: 5  },
  { labelKey: "deploy.ssh.steps.remoteCheckNode",         estimatedSec: 60 },
  { labelKey: "deploy.ssh.steps.remoteInstallOpenclaw",   estimatedSec: 90 },
  { labelKey: "deploy.ssh.steps.remoteOnboard",           estimatedSec: 5  },
  { labelKey: "deploy.ssh.steps.remoteStart",             estimatedSec: 15 },
] as const;

export const AI_PROVIDERS = [
  { id: "zai",        label: "智谱 AI / ZAI (GLM)",         placeholder: "..." },
  { id: "deepseek",   label: "DeepSeek（深度求索）",        placeholder: "sk-..." },
  { id: "minimax",    label: "MiniMax",                     placeholder: "..." },
  { id: "anthropic",  label: "Anthropic (Claude)",          placeholder: "sk-ant-api03-..." },
  { id: "openai",     label: "OpenAI (GPT)",                placeholder: "sk-proj-..." },
  { id: "openrouter", label: "OpenRouter",                  placeholder: "sk-or-v1-..." },
] as const;

export const SSH_USER_PRESETS = [
  { user: "root",     hint: "阿里云 / CentOS / Debian" },
  { user: "ubuntu",   hint: "Ubuntu" },
  { user: "ec2-user", hint: "AWS Amazon Linux" },
  { user: "admin",    hint: "Debian (AWS)" },
] as const;

// ── Environment scan types ───────────────────────────────────────────────────

export type TrustLevel = "official" | "official-mirror" | "community";
export type DepStatusType = "satisfied" | "needs-upgrade" | "not-installed";

export interface DepSource {
  url: string;
  label: string;
  trustLevel: TrustLevel;
  expectedSha256?: string;
  isPrimary: boolean;
}

export interface DependencyInfo {
  id: string;
  displayName: string;
  requiredVersion: string;
  currentVersion?: string;
  status: DepStatusType;
  sources: DepSource[];
  strategies: string[];
  sizeEstimateMb: number;
  isOptional: boolean;
}

export interface PackageManagerInfo {
  name: string;
  available: boolean;
  version?: string;
}

export interface EnvironmentReport {
  os: string;
  osVersion: string;
  arch: string;
  totalMemoryMb: number;
  freeDiskMb: number;
  isAdmin: boolean;
  isChineseLocale: boolean;
  httpProxy?: string;
  packageManagers: PackageManagerInfo[];
  dependencies: DependencyInfo[];
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function fmtSec(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}

export function fmtSpeed(bps: number): string {
  if (bps <= 0) return "0KB/s";
  if (bps < 1048576) return `${(bps / 1024).toFixed(0)}KB/s`;
  return `${(bps / 1048576).toFixed(1)}MB/s`;
}

export function fmtEta(dl: DownloadProgress): string {
  if (dl.speedBps <= 0 || dl.bytesTotal <= 0) return "--";
  const remaining = (dl.bytesTotal - dl.bytesDownloaded) / dl.speedBps;
  if (remaining < 1) return "<1s";
  return fmtSec(Math.ceil(remaining));
}

export function fmtEtaFromProgress(p: StepProgress): string {
  if (p.etaSecs <= 0) return "--";
  if (p.etaSecs < 1) return "<1s";
  return fmtSec(Math.ceil(p.etaSecs));
}

// ── Phase-aware progress ──────────────────────────────────────────────────────

export const PHASE_LABELS: Record<string, { zh: string; en: string }> = {
  probing:          { zh: "正在检测…",         en: "Checking…"                },
  downloading:      { zh: "正在下载…",         en: "Downloading…"             },
  downloaded:       { zh: "下载完成，等待安装", en: "Downloaded, pending install" },
  installing:       { zh: "正在安装…",         en: "Installing…"              },
  verifying:        { zh: "正在验证…",         en: "Verifying…"               },
  retrying:         { zh: "正在重试…",         en: "Retrying…"                },
  "strategy-switch":{ zh: "切换策略…",         en: "Switching strategy…"      },
  "waiting-for-user":{ zh: "等待用户确认是否允许", en: "Waiting for user to allow" },
  done:             { zh: "完成",              en: "Done"                     },
};

/**
 * Maps raw step progress into a phase-aware effective percentage.
 *
 * Phase layout:
 *   probing      →  0 – 5 %
 *   downloading  →  5 – 55 %  (mapped from real download pct)
 *   downloaded   →       55 %  (download finished, waiting for install)
 *   installing   → 55 – 85 %  (logarithmic time-based fill)
 *   verifying    → 85 – 95 %
 *   done         →      100 %
 */
export function phaseAwarePct(
  sp: StepProgress | undefined,
  elapsedSec: number,
  estimatedSec: number,
): number {
  if (!sp) {
    return estimatedSec > 0
      ? Math.min(95, (elapsedSec / estimatedSec) * 100)
      : 50;
  }

  switch (sp.phase) {
    case "probing":
      return 3;

    case "downloading": {
      const dlPct = sp.bytesTotal > 0
        ? (sp.bytesDone / sp.bytesTotal) * 100
        : sp.pct;
      return 5 + (Math.min(100, dlPct) / 100) * 50;
    }

    case "downloaded":
      return 55;

    case "installing": {
      const tau = Math.max(10, estimatedSec * 0.4);
      const fill = 1 - Math.exp(-elapsedSec / tau);
      return 55 + fill * 30;
    }

    case "verifying":
      return 90;

    case "done":
      return 100;

    case "waiting-for-user":
      return 3;

    case "retrying":
    case "strategy-switch":
      return sp.pct > 0 ? Math.min(50, 5 + (sp.pct / 100) * 45) : 30;

    default:
      return sp.pct > 0 ? sp.pct : 50;
  }
}
