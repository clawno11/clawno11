/**
 * Pure helper functions shared between desktop and mobile ChatPage.
 * No side effects, no Tauri imports, no React — fully testable with vitest.
 */

// ── Constants ─────────────────────────────────────────────────────────────

export const MAX_CONTEXT_CHARS = 32_000;

// ── Shell command audit ───────────────────────────────────────────────────

const SHELL_CODE_RE =
  /```(?:bash|sh|shell|cmd|powershell|ps1|zsh|fish|python)\r?\n([\s\S]*?)```/gi;

export function extractShellCommands(text: string): string[] {
  const commands: string[] = [];
  let m: RegExpExecArray | null;
  SHELL_CODE_RE.lastIndex = 0;
  while ((m = SHELL_CODE_RE.exec(text)) !== null) {
    const firstLine = (m[1] ?? "").trim().split(/\r?\n/)[0] ?? "";
    if (firstLine) commands.push(firstLine.slice(0, 200));
  }
  return commands;
}

// ── Prompt injection detection ────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(your\s+)?(previous\s+)?instructions/i,
  /disregard\s+(your\s+)?(previous\s+)?instructions/i,
  /you\s+are\s+now\s+(a|an|the)\s/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(a|an|the)\s/i,
  /new\s+system\s+prompt/i,
  /\[SYSTEM\]/,
  /\[INST\]/,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /你(现在|从现在起)(是|变成|成为)(?!用户|.*?(吗|么|？|\?|什么|哪))/,
  /忘记.{0,20}指令/,
  /忽略.{0,20}之前.{0,20}指令/,
  /不再遵守/,
  /绕过.{0,10}(限制|安全|规则)/,
  /从现在起.{0,10}扮演/,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ── Error humanisation ────────────────────────────────────────────────────

const ERROR_MAP: Array<[test: (s: string) => boolean, msg: string]> = [
  [(s) => s.includes("does not support tools"), "当前模型不支持工具调用，系统正在自动直连 Ollama 重试…"],
  [(s) => s.includes("Ollama 未运行") || s.includes("ollama-direct-error") || s.includes("ollama-fallback"), "本地 Ollama 连接失败，请检查 Ollama 是否正在运行"],
  [(s) => s.includes("Ollama 返回错误"), ""],
  [(s) => s.includes("Ollama 流式响应异常"), "Ollama 响应异常，请重试"],
  [(s) => s.includes("openclaw-spawn-error"), "未找到 openclaw 命令，请确认已完成部署"],
  [(s) => s.includes("http-connect-error") || s.includes("http-request-error") || s.includes("连接网关失败"), "网关连接失败，请检查实例是否在线"],
  [(s) => s.includes("stream-read-error") || s.includes("数据流"), "数据流中断，请重试"],
  [(s) => s.includes("gateway-http-5") || s.includes("网关返回错误 5"), "网关内部错误，请稍后重试"],
  [(s) => s.includes("429") || s.includes("过于频繁"), "请求过于频繁，请稍后再试"],
  [(s) => s.includes("Unauthorized") || s.includes("401"), "认证失败，请重新配对连接"],
  [(s) => s.includes("Forbidden") || s.includes("403") || s.includes("invalid token"), "配对令牌已失效，请重新配对连接"],
  [(s) => s.includes("Ollama API error"), "Ollama 接口异常，系统正在尝试自动恢复…"],
];

export function humaniseError(raw: string): string {
  for (const [test, msg] of ERROR_MAP) {
    if (test(raw)) return msg || raw;
  }
  return raw;
}

// ── Token estimation ──────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.5));
}

// ── Context window trimming ───────────────────────────────────────────────

export function trimToContextWindow(
  msgs: { role: string; content: string }[],
  maxChars = MAX_CONTEXT_CHARS,
): { role: string; content: string }[] {
  let total = msgs.reduce((sum, m) => sum + m.content.length, 0);
  if (total <= maxChars) return msgs;
  const result = [...msgs];
  while (result.length > 1 && total > maxChars) {
    total -= result[0]!.content.length;
    result.shift();
  }
  return result;
}

// ── Timestamp formatting ──────────────────────────────────────────────────

export function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  if (now.toDateString() === d.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function relativeDate(ts: number, t: (key: string) => string): string {
  const now  = new Date();
  const date = new Date(ts);
  if (now.toDateString() === date.toDateString()) return t("history.today");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.toDateString() === date.toDateString()) return t("history.yesterday");
  if (Date.now() - ts < 7 * 86_400_000) return t("history.thisWeek");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Instance selection ────────────────────────────────────────────────────

export function pickDefault<T extends { health: string }>(
  instances: T[],
): T | null {
  if (instances.length === 0) return null;
  return instances.find((i) => i.health === "online") ?? instances[0] ?? null;
}
