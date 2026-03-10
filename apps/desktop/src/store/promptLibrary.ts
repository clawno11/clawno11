/**
 * Prompt library — built-in templates + user custom prompts.
 * Custom prompts are persisted in localStorage (no DB needed).
 */

export interface PromptTemplate {
  id: string;
  emoji: string;
  label: string;
  /** The full system/user prompt text injected into the input box */
  content: string;
  /** "builtin" templates ship with the app; "custom" are user-created */
  type: "builtin" | "custom";
}

// ── Built-in templates ─────────────────────────────────────────────────────

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: "translator",
    emoji: "🌐",
    label: "专业翻译",
    content:
      "你是一位专业翻译官。我将给你一段文字，请将其翻译成自然流畅的{{目标语言}}，保持原意并符合当地表达习惯。待翻译内容：\n\n",
    type: "builtin",
  },
  {
    id: "code-review",
    emoji: "🔍",
    label: "代码审查",
    content:
      "请对以下代码进行专业的代码审查，重点关注：1) 潜在 Bug 2) 性能问题 3) 安全漏洞 4) 可读性与最佳实践。给出具体的改进建议。\n\n```\n",
    type: "builtin",
  },
  {
    id: "architect",
    emoji: "🏗️",
    label: "架构设计",
    content:
      "你是一位资深软件架构师。请根据以下需求，给出清晰的系统架构设计方案，包括：模块划分、技术选型、数据流向、关键接口设计，以及潜在风险提示。\n\n需求：",
    type: "builtin",
  },
  {
    id: "xhs-copywriter",
    emoji: "📱",
    label: "小红书文案",
    content:
      "你是一位爆款小红书文案创作者。请为以下主题写一篇吸引眼球的小红书笔记：标题要有吸引力（带emoji），正文分段清晰，结尾加3-5个精准标签。\n\n主题：",
    type: "builtin",
  },
  {
    id: "debugger",
    emoji: "🐛",
    label: "Debug 助手",
    content:
      "我遇到了一个 Bug，请帮我分析根本原因并给出修复方案。\n\n错误信息：\n```\n[粘贴错误信息]\n```\n\n相关代码：\n```\n[粘贴代码]\n```\n\n已尝试过：",
    type: "builtin",
  },
  {
    id: "weekly-report",
    emoji: "📋",
    label: "周报生成",
    content:
      "请根据以下工作内容，生成一份专业的工作周报。格式：本周完成事项 / 遇到的问题 / 下周计划。语言简洁有力，突出成果。\n\n本周工作内容：",
    type: "builtin",
  },
  {
    id: "explain",
    emoji: "💡",
    label: "通俗解释",
    content:
      "请用最通俗易懂的语言，向一个没有专业背景的人解释以下概念或问题。可以用生活中的类比。\n\n需要解释的内容：",
    type: "builtin",
  },
  {
    id: "sql-helper",
    emoji: "🗄️",
    label: "SQL 助手",
    content:
      "你是一位 SQL 专家。请根据以下需求编写高效、规范的 SQL 查询语句，并说明思路。\n\n数据库类型：\n表结构：\n查询需求：",
    type: "builtin",
  },
];

// ── Custom prompts (localStorage) ─────────────────────────────────────────

const STORAGE_KEY = "clawno-custom-prompts";
/** Maximum allowed character count for a single prompt's content field. */
const MAX_CONTENT_LENGTH = 4000;

/** Type-guard: verify an unknown value matches the PromptTemplate shape. */
function isPromptTemplate(v: unknown): v is PromptTemplate {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id      === "string" && t.id.length      > 0 &&
    typeof t.emoji   === "string" &&
    typeof t.label   === "string" && t.label.length   > 0 &&
    typeof t.content === "string" && t.content.length > 0 &&
    (t.type === "builtin" || t.type === "custom")
  );
}

export function loadCustomPrompts(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Validate every item; silently drop any corrupted entries rather than
    // crashing the whole app or blindly trusting the stored shape.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromptTemplate);
  } catch {
    return [];
  }
}

export function saveCustomPrompt(p: Omit<PromptTemplate, "id" | "type">): PromptTemplate {
  if (!p.label.trim()) throw new Error("prompt label cannot be empty");
  if (!p.content.trim()) throw new Error("prompt content cannot be empty");
  if (p.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`prompt content exceeds ${MAX_CONTENT_LENGTH} characters`);
  }
  const prompts = loadCustomPrompts();
  const newP: PromptTemplate = { ...p, id: crypto.randomUUID(), type: "custom" };
  prompts.push(newP);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  return newP;
}

export function deleteCustomPrompt(id: string): void {
  const prompts = loadCustomPrompts().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

export function getAllPrompts(): PromptTemplate[] {
  return [...BUILTIN_PROMPTS, ...loadCustomPrompts()];
}
