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

export interface StepState extends StepDef {
  status: StepStatus;
  detail?: string;
  fixes_applied: string[];
  elapsedSec: number;
}

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

export function fmtSec(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
