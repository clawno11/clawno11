/**
 * Smart Model Router — keyword-based instance selection.
 *
 * Architecture:
 *   Each OpenClaw "instance" can be configured with a different AI provider
 *   (e.g., Instance A → Claude, Instance B → GPT-4o, Instance C → DeepSeek).
 *
 *   Routing rules map keyword patterns to a specific instance.
 *   Before each chat turn, the input is checked against active rules (priority order).
 *   If a match is found, ClawNo.11 automatically routes to the designated instance.
 *
 * Storage: localStorage (no DB needed — rules are a small config set).
 */

const STORAGE_KEY = "clawno-routing-rules";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RoutingRule {
  id: string;
  name: string;
  /** Comma-separated keywords; match is OR-based, case-insensitive */
  keywords: string[];
  /** Target ClawInstance.id */
  instanceId: string;
  /** Lower = evaluated first */
  priority: number;
  enabled: boolean;
}

// ── Persistence ────────────────────────────────────────────────────────────

export function listRules(): RoutingRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Runtime shape validation — silently drops malformed entries from corrupted storage
    const valid = parsed.filter(
      (r): r is RoutingRule =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as Record<string, unknown>).id === "string" &&
        typeof (r as Record<string, unknown>).name === "string" &&
        Array.isArray((r as Record<string, unknown>).keywords) &&
        typeof (r as Record<string, unknown>).instanceId === "string" &&
        typeof (r as Record<string, unknown>).priority === "number" &&
        typeof (r as Record<string, unknown>).enabled === "boolean",
    );
    return valid.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

export function saveRules(rules: RoutingRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch (e) {
    // QuotaExceededError or SecurityError — log but don't crash the caller
    console.error("[ModelRouter] Failed to persist rules:", e);
  }
}

export function addRule(rule: Omit<RoutingRule, "id">): RoutingRule {
  const rules = listRules();
  const newRule: RoutingRule = { ...rule, id: crypto.randomUUID() };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

export function updateRule(id: string, patch: Partial<RoutingRule>): void {
  const rules = listRules().map((r) => (r.id === id ? { ...r, ...patch } : r));
  saveRules(rules);
}

export function deleteRule(id: string): void {
  saveRules(listRules().filter((r) => r.id !== id));
}

// ── Matching ───────────────────────────────────────────────────────────────

/**
 * Return the first matching rule for the given input string.
 * Rules are evaluated in ascending priority order.
 */
export function matchRule(input: string, rules: RoutingRule[]): RoutingRule | null {
  const lower   = input.toLowerCase();
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

  for (const rule of enabled) {
    const hit = rule.keywords.some((kw) => kw.trim() && lower.includes(kw.trim().toLowerCase()));
    if (hit) return rule;
  }
  return null;
}

// ── Built-in templates ─────────────────────────────────────────────────────
// Users can import these as starting points.

export const RULE_TEMPLATES: Omit<RoutingRule, "id" | "instanceId">[] = [
  {
    name: "代码 / 编程",
    keywords: ["代码", "code", "bug", "debug", "函数", "class", "error", "exception", "compile", "编译", "python", "typescript", "javascript", "rust", "sql"],
    priority: 10,
    enabled: true,
  },
  {
    name: "创意写作",
    keywords: ["写作", "文案", "小红书", "故事", "诗", "创意", "广告", "标题", "writing", "creative", "blog"],
    priority: 20,
    enabled: true,
  },
  {
    name: "数据分析",
    keywords: ["数据", "分析", "图表", "统计", "excel", "csv", "报表", "data", "analysis", "chart", "dashboard"],
    priority: 30,
    enabled: true,
  },
  {
    name: "翻译",
    keywords: ["翻译", "translate", "英文", "中文", "日文", "德文", "法文", "spanish", "english"],
    priority: 40,
    enabled: true,
  },
  {
    // Routes to the local Ollama instance (id: "ollama-local").
    // Disabled by default — user opts in after setting a default local model.
    name: "本地模型（私密 / 离线）",
    keywords: ["本地模型", "本地ai", "ollama", "离线", "offline", "私密", "不联网", "local ai", "local model"],
    priority: 5,
    enabled: false,
  },
];
