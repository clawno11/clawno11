import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Send, Bot, User, ChevronDown, Wifi, WifiOff, RefreshCw,
  ShieldCheck, ShieldOff, BookOpen, History, Plus, Search,
  Trash2, X, MessageSquare, Sparkles, ChevronUp, GitBranch, Square, AlertCircle, Cpu,
} from "lucide-react";
import type { ChatMessage } from "@clawno/openclaw-client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { recordTokenUsage } from "../store/tokenLog";
import { getMainAgentModel, listConfiguredProviders, ollamaListLocalModels, type OllamaModel } from "../ipc";
import { useAiConfigStore } from "../store/aiConfig";
import { redactPii, type PiiMatch } from "../store/piiFilter";
import { buildRagContext, documentCount } from "../store/ragStore";
import {
  createSession, addMessage, loadMessages, listSessions, searchSessions,
  deleteSession, type ChatSession, type StoredMessage,
} from "../store/chatHistory";
import { getAllPrompts, saveCustomPrompt, deleteCustomPrompt, type PromptTemplate } from "../store/promptLibrary";
import { listRules, matchRule } from "../store/modelRouter";
import { logSecurityEvent } from "../store/securityEventStore";

// ── Constants ─────────────────────────────────────────────────────────────

/** Max characters sent in a single model request (≈ 8k tokens at ~4 chars/token). */
const MAX_CONTEXT_CHARS = 32_000;

/** Provider ID → cheapest available model, mirroring deploy.rs provider_cheapest_model. */
const PROVIDER_CLOUD_MODELS: Record<string, { model: string; label: string; badge: string }> = {
  siliconflow: { model: "openrouter/meta-llama/llama-3.1-8b-instruct", label: "SiliconFlow Llama 3.1 8B", badge: "免费" },
  hunyuan:     { model: "openrouter/tencent/hunyuan-lite",             label: "混元 Lite",                 badge: "免费" },
  spark:       { model: "openrouter/iflytek/spark-lite",               label: "讯飞星火 Lite",             badge: "免费" },
  zai:         { model: "zai/glm-4-flash",                             label: "智谱 GLM-4-Flash",          badge: "¥0.1/1M" },
  openrouter:  { model: "openrouter/meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B",             badge: "免费" },
  doubao:      { model: "openrouter/bytedance/doubao-lite-32k",        label: "豆包 Lite",                 badge: "¥0.3/1M" },
  minimax:     { model: "minimax/MiniMax-M2",                          label: "MiniMax M2",                badge: "¥0.15/1M" },
  deepseek:    { model: "openrouter/deepseek/deepseek-chat",           label: "DeepSeek V3",               badge: "¥1/1M" },
  qwen:        { model: "openrouter/qwen/qwen-plus",                   label: "通义千问 Plus",             badge: "¥0.5/1M" },
  moonshot:    { model: "openrouter/moonshot-ai/moonshot-v1-8k",       label: "月之暗面 v1-8k",            badge: "¥12/1M" },
  openai:      { model: "openai/gpt-4o-mini",                         label: "GPT-4o Mini",               badge: "$0.15/1M" },
  anthropic:   { model: "anthropic/claude-haiku-3",                   label: "Claude Haiku 3",            badge: "$0.25/1M" },
};

// ── Shell command audit ────────────────────────────────────────────────────

/**
 * Extract shell command blocks from an AI response.
 * Matches fenced code blocks with bash/sh/shell/cmd/powershell/python/zsh/fish tags.
 * Returns at most the first line of each command (up to 200 chars) to avoid bloating the log.
 */
function extractShellCommands(text: string): string[] {
  const commands: string[] = [];
  const re = /```(?:bash|sh|shell|cmd|powershell|ps1|zsh|fish|python)\r?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const firstLine = (m[1] ?? "").trim().split(/\r?\n/)[0] ?? "";
    if (firstLine) commands.push(firstLine.slice(0, 200));
  }
  return commands;
}

// ── Prompt injection detection ────────────────────────────────────────────

/** Patterns that indicate a potential prompt-injection attempt. */
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
  /你(现在|从现在起)(是|变成|成为)(?!用户)/,
  /忘记.{0,20}指令/,
  /忽略.{0,20}之前.{0,20}指令/,
  /不再遵守/,
  /绕过.{0,10}(限制|安全|规则)/,
  /从现在起.{0,10}扮演/,
];

function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Rough token estimate: 1 token ≈ 3.5 chars (Chinese-heavy assumption). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.5));
}

interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
}

/** Trim the oldest messages until the total character count fits in MAX_CONTEXT_CHARS.
 *  Always retains at least the most recent message. */
function trimToContextWindow(
  msgs: { role: string; content: string }[],
): { role: string; content: string }[] {
  let total = msgs.reduce((sum, m) => sum + m.content.length, 0);
  if (total <= MAX_CONTEXT_CHARS) return msgs;
  const result = [...msgs];
  while (result.length > 1 && total > MAX_CONTEXT_CHARS) {
    total -= result[0]!.content.length;
    result.shift();
  }
  return result;
}

function pickDefault(instances: ClawInstance[]): ClawInstance | null {
  if (instances.length === 0) return null;
  return instances.find((i) => i.health === "online") ?? instances[0] ?? null;
}

/** Relative time using calendar days (not rolling 24-hour windows). */
function relativeDate(ts: number, t: (key: string) => string): string {
  const now  = new Date();
  const date = new Date(ts);
  if (now.toDateString() === date.toDateString()) return t("history.today");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.toDateString() === date.toDateString()) return t("history.yesterday");
  if (Date.now() - ts < 7 * 86_400_000) return t("history.thisWeek");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── History Sidebar ────────────────────────────────────────────────────────

function HistorySidebar({
  currentSessionId,
  onSelect,
  onNew,
  onClose,
}: {
  currentSessionId: string | null;
  onSelect: (session: ChatSession) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sessions, setSessions]   = useState<ChatSession[]>([]);
  const [query, setQuery]         = useState("");
  const [deleting, setDeleting]   = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const deletingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending auto-dismiss timer on unmount to prevent state updates
  // on an unmounted component.
  useEffect(() => () => {
    if (deletingTimerRef.current !== null) clearTimeout(deletingTimerRef.current);
  }, []);

  const load = useCallback(async () => {
    try {
      setSidebarError(null);
      const list = query.trim() ? await searchSessions(query) : await listSessions();
      setSessions(list);
    } catch (e) {
      setSidebarError(e instanceof Error ? e.message : String(e));
    }
  }, [query]);

  // Single effect: re-runs when query changes (load dep changes) OR when a new
  // session is created externally (currentSessionId dep changes).
  useEffect(() => {
    load();
  }, [load, currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setSidebarError(e instanceof Error ? e.message : String(e));
    }
    setDeleting(null);
  };

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <History size={14} className="text-primary flex-shrink-0" />
        <span className="text-xs font-semibold flex-1">{t("history.title")}</span>
        <button onClick={onNew} title={t("history.newChat")}
          className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
          <Plus size={14} />
        </button>
        <button onClick={onClose} title={t("history.close")}
          className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2 border-b border-border/50">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("history.search")}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Error banner */}
      {sidebarError && (
        <div className="mx-2 mt-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[10px]">
          <AlertCircle size={10} className="flex-shrink-0" />
          {sidebarError}
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && !sidebarError && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-1.5">
            <MessageSquare size={18} className="opacity-30" />
            {t("history.empty")}
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s)}
            className={`group relative px-3 py-2.5 cursor-pointer border-b border-border/40 transition-colors ${
              s.id === currentSessionId
                ? "bg-primary/8 border-l-2 border-l-primary"
                : "hover:bg-muted/40 border-l-2 border-l-transparent"
            }`}
          >
            <p className="text-xs font-medium truncate leading-snug pr-5">{s.title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {relativeDate(s.updatedAt, t)}
              {s.messageCount !== undefined && ` · ${t("history.msgCount", { count: s.messageCount })}`}
            </p>
            {deleting === s.id ? (
              <button
                onClick={(e) => handleDelete(e, s.id)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] bg-red-500 text-white"
              >
                {t("common.confirm")}
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (deletingTimerRef.current !== null) clearTimeout(deletingTimerRef.current);
                  setDeleting(s.id);
                  deletingTimerRef.current = setTimeout(() => { deletingTimerRef.current = null; setDeleting(null); }, 3000);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

// ── Main ChatPage ──────────────────────────────────────────────────────────

export function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances } = useInstanceStore();
  const { configured: configuredProviders } = useAiConfigStore();

  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [showPicker, setShowPicker]   = useState(false);

  const [messages, setMessages]       = useState<UIMessage[]>([]);
  const [input, setInput]             = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem("clawno-last-session"),
  );

  const [piiEnabled, setPiiEnabled]   = useState(() => localStorage.getItem("clawno-pii") !== "false");
  const [lastPiiMatches, setLastPiiMatches] = useState<PiiMatch[]>([]);
  const [ragEnabled, setRagEnabled]   = useState(() => localStorage.getItem("clawno-rag") !== "false");
  const [ragDocCount, setRagDocCount] = useState(0);
  const [injectionWarning, setInjectionWarning] = useState(false);

  const [routingEnabled, setRoutingEnabled] = useState(() => localStorage.getItem("clawno-routing") !== "false");
  const [routedTo, setRoutedTo]             = useState<string | null>(null);

  /** Local Ollama models available for selection. */
  const [localModels, setLocalModels]       = useState<OllamaModel[]>([]);
  /**
   * selectedModel encoding:
   *   null              — auto (OpenClaw gateway decides, cheapest cloud by default)
   *   "cloud:<model>"   — cloud model override, e.g. "cloud:zai/glm-4-flash"
   *                       → keeps gateway URL, passes model field to stream_chat
   *   "<name>"          — local Ollama model name (no prefix)
   *                       → bypasses gateway, routes directly to localhost:11434
   *
   * Cleared when the gateway restarts (gateway-restarted event).
   */
  const [selectedModel, setSelectedModel]   = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const [showPrompts, setShowPrompts] = useState(false);
  const [prompts, setPrompts]         = useState<PromptTemplate[]>(() => getAllPrompts());
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [newPromptLabel, setNewPromptLabel]     = useState("");
  const [newPromptEmoji, setNewPromptEmoji]     = useState("✨");
  const [newPromptContent, setNewPromptContent] = useState("");

  /** Cached provider + model from the gateway's /agents endpoint.
   *  Updated whenever the selected instance changes. */
  const [activeModelInfo, setActiveModelInfo] = useState<{ provider: string; model: string } | null>(null);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  // ── Lifecycle refs ───────────────────────────────────────────────────────
  /** Set to false on unmount; guards all deferred state updates. */
  const mountedRef = useRef(true);
  /** Prevents a second concurrent send while awaiting RAG/session setup. */
  const isSendingRef = useRef(false);
  /** True while user wants to suppress further streaming UI updates. */
  const cancelRef = useRef(false);
  /** Abort controller for the active HTTP streaming request. */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Timer ID for auto-clearing the routedTo notification banner. */
  const routedToTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Persist session ID to localStorage so it survives navigation. */
  const persistSession = (id: string | null) => {
    if (id) localStorage.setItem("clawno-last-session", id);
    else localStorage.removeItem("clawno-last-session");
    setCurrentSessionId(id);
  };

  useEffect(() => {
    mountedRef.current = true;

    // Restore the last active session from SQLite when the page mounts
    // (e.g. after navigating away and back).
    const lastId = localStorage.getItem("clawno-last-session");
    if (lastId) {
      loadMessages(lastId)
        .then((stored) => {
          if (!mountedRef.current) return;
          const uiMsgs: UIMessage[] = stored.map((m) => ({
            id: m.id, role: m.role, content: m.content,
          }));
          setMessages(uiMsgs);
          setCurrentSessionId(lastId);
        })
        .catch(() => {
          // Session may have been deleted — start fresh.
          persistSession(null);
        });
    }

    return () => {
      mountedRef.current = false;
      if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
    };
  }, []);

  // Refresh ragDocCount on mount and whenever the tab regains visibility.
  useEffect(() => {
    const refresh = () => documentCount().then(setRagDocCount).catch(() => {});
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  // Preferred instance (memoized — avoids recomputing on every render).
  const defaultInstance = useMemo(() => pickDefault(instances), [instances]);

  useEffect(() => {
    if (selectedId && instances.find((i) => i.id === selectedId)) return;
    setSelectedId(defaultInstance?.id ?? null);
  }, [instances, defaultInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the active model from the gateway whenever the selected instance changes.
  // Tries three sources in order:
  //   1. Gateway HTTP /agents endpoint  → "provider/model-name" string
  //   2. openclaw models status CLI     → first configured provider + "main"
  //   3. In-memory aiConfig store       → first known provider + "main"
  useEffect(() => {
    const inst = instances.find((i) => i.id === selectedId);
    if (!inst) { setActiveModelInfo(null); return; }

    let cancelled = false;

    const applyFromStr = (modelStr: string) => {
      const slashIdx = modelStr.indexOf("/");
      if (slashIdx > 0) {
        setActiveModelInfo({ provider: modelStr.slice(0, slashIdx), model: modelStr.slice(slashIdx + 1) });
      } else {
        setActiveModelInfo({ provider: "openclaw", model: modelStr });
      }
    };

    const fallbackToCliProviders = () =>
      listConfiguredProviders()
        .then((providers) => {
          if (cancelled) return;
          const provider = providers[0] ?? configuredProviders[0] ?? "openclaw";
          setActiveModelInfo({ provider, model: "main" });
        })
        .catch(() => {
          if (cancelled) return;
          const provider = configuredProviders[0] ?? "openclaw";
          setActiveModelInfo({ provider, model: "main" });
        });

    getMainAgentModel(inst.port)
      .then((modelStr) => {
        if (cancelled) return;
        // Only use the HTTP result if it looks like a real model name (not a generic placeholder)
        if (modelStr && modelStr !== "default" && modelStr !== "main" && modelStr !== "") {
          applyFromStr(modelStr);
        } else {
          return fallbackToCliProviders();
        }
      })
      .catch(() => {
        if (!cancelled) fallbackToCliProviders();
      });

    return () => { cancelled = true; };
  }, [selectedId, instances, configuredProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh local Ollama model list on mount and periodically.
  useEffect(() => {
    const load = () => ollamaListLocalModels().then(setLocalModels).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  // When the OpenClaw gateway restarts, clear any manual model override so the
  // next message goes through the gateway's freshly-applied default (cheapest cloud).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<void>("gateway-restarted", () => {
      if (mountedRef.current) {
        setSelectedModel(null);
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea as content grows (max 8 rem ≈ 6 lines).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [input]);

  const selectedInst = instances.find((i) => i.id === selectedId) ?? null;
  const gatewayUrl   = selectedInst?.httpUrl ?? "http://127.0.0.1:18789";
  const isOnline     = selectedInst?.health === "online";

  // ── Load a past session ──────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (session: ChatSession) => {
    // Cancel any in-flight stream first so isStreaming resets and the input
    // isn't left permanently locked after switching to a history session.
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (mountedRef.current) setIsStreaming(false);

    try {
      const stored: StoredMessage[] = await loadMessages(session.id);
      if (!mountedRef.current) return;
      const uiMsgs: UIMessage[] = stored.map((m) => ({
        id: m.id, role: m.role, content: m.content,
      }));
      setMessages(uiMsgs);
      persistSession(session.id);
      setShowHistory(false);
    } catch (e) {
      console.error("Failed to load session messages:", e);
    }
  }, []);

  // ── Cancel streaming ─────────────────────────────────────────────────────
  const cancelStream = useCallback(() => {
    cancelRef.current = true;
    // Abort the underlying HTTP request so the connection is released.
    abortControllerRef.current?.abort();
    if (mountedRef.current) setIsStreaming(false);
  }, []);

  // ── New chat ─────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (routedToTimerRef.current) { clearTimeout(routedToTimerRef.current); routedToTimerRef.current = null; }
    setMessages([]);
    persistSession(null);
    setInput("");
    setIsStreaming(false);
    setLastPiiMatches([]);
    setRoutedTo(null);
    setShowHistory(false);
  }, []);

  // ── Send ─────────────────────────────────────────────────────────────────
  // Keep a ref to the current messages array so the send callback can read
  // the latest history without re-creating itself on every incoming chunk.
  // This eliminates the expensive re-creation that previously happened on
  // every streaming update (messages was in the deps array).
  const messagesRef = useRef<UIMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Same pattern for activeModelInfo — used only inside the chat-done handler.
  const activeModelInfoRef = useRef(activeModelInfo);
  useEffect(() => { activeModelInfoRef.current = activeModelInfo; }, [activeModelInfo]);

  const send = useCallback(async () => {
    if (!input.trim() || isStreaming || isSendingRef.current) return;
    // Lock BEFORE any async operation to prevent a second concurrent send
    // during the await-heavy setup phase (RAG build, session creation).
    isSendingRef.current = true;
    cancelRef.current = false;
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // Track whether we successfully reached the streaming phase.
    // The finally block only releases the lock when setup itself failed;
    // once invoke() fires, the event handlers own the lock.
    let invokeStarted = false;

    try {
      const rawContent = input.trim();

      // Prompt injection detection — warn before sending
      if (detectInjection(rawContent)) {
        isSendingRef.current = false;
        if (!window.confirm(
          `${t("security.injectionWarn")}\n\n${t("security.injectionWarnDetail")}`
        )) {
          return;
        }
        // User chose to send anyway — re-acquire the lock and log the event.
        isSendingRef.current = true;
        setInjectionWarning(true);
        await logSecurityEvent(
          "injection_detected",
          `用户发送了含注入特征的消息（已放行）: "${rawContent.slice(0, 80)}${rawContent.length > 80 ? "…" : ""}"`,
          "warn",
        );
        setTimeout(() => setInjectionWarning(false), 5000);
      }

      // PII filter — current message only.
      let sendContent = rawContent;
      let piiMatches: PiiMatch[] = [];
      if (piiEnabled) {
        const result = redactPii(rawContent);
        sendContent  = result.redacted;
        piiMatches   = result.matches;
      }
      if (mountedRef.current) setLastPiiMatches(piiMatches);

      // Smart routing — resolve effective instance before any state updates.
      let effectiveInstanceId = selectedId;
      let effectiveGatewayUrl = gatewayUrl;
      // Model override: null = auto; "cloud:<m>" = cloud override; plain string = local Ollama.
      let effectiveModel: string | null = null;

      if (selectedModel?.startsWith("cloud:")) {
        // User explicitly chose a cloud model — keep the gateway URL, pass model as override.
        effectiveModel = selectedModel.slice(6); // strip "cloud:" prefix
        if (mountedRef.current) {
          const label = effectiveModel.split("/").slice(1).join("/") || effectiveModel;
          setRoutedTo(`云端 · ${label}`);
          if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
          routedToTimerRef.current = setTimeout(() => {
            routedToTimerRef.current = null;
            if (mountedRef.current) setRoutedTo(null);
          }, 4000);
        }
      } else if (selectedModel) {
        // User explicitly selected a local Ollama model — bypass the OpenClaw gateway.
        effectiveModel = selectedModel;
        effectiveGatewayUrl = "http://localhost:11434";
        effectiveInstanceId = "ollama-local";
        if (mountedRef.current) {
          setRoutedTo(`本地 · ${effectiveModel}`);
          if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
          routedToTimerRef.current = setTimeout(() => {
            routedToTimerRef.current = null;
            if (mountedRef.current) setRoutedTo(null);
          }, 4000);
        }
      } else if (routingEnabled) {
        const rules   = listRules();
        const matched = matchRule(rawContent, rules);
        if (matched?.instanceId && matched.instanceId !== selectedId) {
          const target = instances.find((i) => i.id === matched.instanceId);
          if (target) {
            effectiveInstanceId = target.id;
            effectiveGatewayUrl = target.httpUrl;
            effectiveModel = null;
            if (mountedRef.current) {
              setRoutedTo(target.name);
              if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
              routedToTimerRef.current = setTimeout(() => {
                routedToTimerRef.current = null;
                if (mountedRef.current) setRoutedTo(null);
              }, 4000);
            }
          }
        }
      }

      // RAG context injection.
      let ragPrefix = "";
      if (ragEnabled && ragDocCount > 0) {
        try {
          ragPrefix = await buildRagContext(rawContent, 3);
          if (piiEnabled && ragPrefix) ragPrefix = redactPii(ragPrefix).redacted;
        } catch (e) {
          console.error("RAG context build failed:", e);
        }
      }
      const finalContent = ragPrefix + sendContent;

      // Ensure a session exists (create on first message).
      let sessionId = currentSessionId;
      try {
        if (!sessionId) {
          const title = rawContent.slice(0, 40) + (rawContent.length > 40 ? "…" : "");
          sessionId = await createSession(title, effectiveInstanceId ?? "");
          if (mountedRef.current) persistSession(sessionId);
        }
      } catch (e) {
        console.error("Failed to create chat session:", e);
        // Proceed without persistence rather than blocking the user.
      }

      // Guard: component may have unmounted during the async setup above.
      if (!mountedRef.current) return;

      const userMsg: UIMessage      = { id: crypto.randomUUID(), role: "user",      content: rawContent };
      const sendMsg: UIMessage      = { ...userMsg, content: finalContent };
      const assistantId             = crypto.randomUUID();
      const assistantMsg: UIMessage = { id: assistantId, role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsStreaming(true);

      if (sessionId) {
        addMessage(sessionId, "user", rawContent).catch(console.error);
      }

      // Unique request ID ties "chat-chunk" / "chat-done" events to this send.
      const reqId = assistantId;

      try {
        // Build context from the ref (latest messages without re-rendering send).
        // Apply PII filter to historical context as well, so old messages don't
        // leak sensitive data that has since been added to the filter.
        const historyMsgs = messagesRef.current.map(({ role, content }) => ({
          role,
          content: piiEnabled ? redactPii(content).redacted : content,
        }));
        const contextMsgs = trimToContextWindow([
          ...historyMsgs,
          { role: sendMsg.role, content: sendMsg.content },
        ]);

        let accumulatedText = "";

        const unlistenChunk = await listen<{ req_id: string; delta: string }>(
          "chat-chunk",
          (event) => {
            if (event.payload.req_id !== reqId) return;
            if (cancelRef.current) return;
            // Always accumulate text even when unmounted so chat-done can persist the full reply.
            accumulatedText += event.payload.delta;
            if (!mountedRef.current) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: accumulatedText } : m,
              ),
            );
          },
        );

        const unlistenDone = await listen<{ req_id: string; error: string | null; model?: string | null }>(
          "chat-done",
          async (event) => {
            if (event.payload.req_id !== reqId) return;
            unlistenChunk();
            unlistenDone();

            // Persist to SQLite BEFORE the mount check — the user may have navigated
            // away while the reply was streaming; we still want to save it so it appears
            // when they return to the chat page.
            if (!event.payload.error && !cancelRef.current && sessionId && accumulatedText) {
              addMessage(sessionId, "assistant", accumulatedText).catch(console.error);
            }

            if (!mountedRef.current) return;

            if (event.payload.error && !cancelRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `${t("chat.error")}${event.payload.error}`, streaming: false }
                    : m,
                ),
              );
            } else {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
              );

              // Read model info from the ref to always get the latest value.
              const currentModelInfo = activeModelInfoRef.current;
              const resolvedModel = (() => {
                const gatewayModel = event.payload.model;
                if (gatewayModel && gatewayModel !== "main" && gatewayModel !== "default") return gatewayModel;
                const agentModel = currentModelInfo?.model;
                if (agentModel && agentModel !== "main" && agentModel !== "default") return agentModel;
                return currentModelInfo?.provider ?? "openclaw";
              })();

              const promptText = [...messagesRef.current, userMsg].map((m) => m.content).join(" ");
              recordTokenUsage({
                instanceId: effectiveInstanceId ?? "unknown",
                provider: currentModelInfo?.provider ?? "openclaw",
                model:    resolvedModel,
                promptTokens: estimateTokens(promptText),
                completionTokens: estimateTokens(accumulatedText),
              }).catch(console.error);

              const shellCmds = extractShellCommands(accumulatedText);
              if (shellCmds.length > 0) {
                const preview = shellCmds[0]!;
                const suffix = shellCmds.length > 1 ? ` （共 ${shellCmds.length} 个命令块）` : "";
                logSecurityEvent(
                  "shell_audit",
                  `AI 响应包含 Shell 命令：\`${preview}\`${suffix}`,
                  "warn",
                ).catch(console.error);
              }
            }
            setIsStreaming(false);
            isSendingRef.current = false;
          },
        );

        // Register abort handler to clean up listeners when user clicks Stop.
        ac.signal.addEventListener("abort", () => {
          unlistenChunk();
          unlistenDone();
          if (mountedRef.current) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
            );
            setIsStreaming(false);
          }
          isSendingRef.current = false;
        }, { once: true });

        // Fire-and-forget; completion is signalled via "chat-done" event.
        // Mark invokeStarted so the finally block does NOT reset the lock —
        // the event handlers are now responsible for clearing isSendingRef.
        invokeStarted = true;
        invoke("stream_chat", {
          gatewayUrl: effectiveGatewayUrl,
          messages: contextMsgs,
          reqId,
          model: effectiveModel,
        }).catch((e: unknown) => {
          if (cancelRef.current || !mountedRef.current) return;
          unlistenChunk();
          unlistenDone();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: t("chat.error") + String(e), streaming: false }
                : m,
            ),
          );
          setIsStreaming(false);
          isSendingRef.current = false;
        });

        return;
      } catch (e) {
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: t("chat.error") + (e instanceof Error ? e.message : ""), streaming: false }
              : m,
          ),
        );
        setIsStreaming(false);
      }
    } finally {
      // Only release the lock here when invoke() was never reached (setup failure).
      // Once invoke starts, the event handlers (chat-done / abort / .catch) own it.
      if (!invokeStarted) {
        isSendingRef.current = false;
      }
    }
  }, [
    input, isStreaming, piiEnabled, selectedId, gatewayUrl, routingEnabled,
    ragEnabled, ragDocCount, currentSessionId, instances, t, selectedModel,
  ]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (instances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}>
          <Bot size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
        </div>
        <div className="text-center">
          <p className="font-semibold text-foreground/70 mb-1">{t("chat.noInstance")}</p>
          <p className="text-sm">{t("chat.noInstanceSub")}</p>
        </div>
        <button
          onClick={() => navigate("/deploy")}
          className="px-5 py-2 rounded-xl text-white text-sm font-semibold"
          style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
        >
          {t("chat.goToDeploy")}
        </button>
      </div>
    );
  }

  return (
    <div className="page-enter flex h-full overflow-hidden">
      {/* ── History Sidebar ── */}
      {showHistory && (
        <HistorySidebar
          currentSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onNew={handleNewChat}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ── Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.02)" }}>

          <button
            onClick={() => setShowHistory((v) => !v)}
            title={t("history.title")}
            className={`p-1.5 rounded-lg transition-colors ${showHistory ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
          >
            <History size={15} />
          </button>

          <button
            onClick={handleNewChat}
            title={t("history.newChat")}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <Plus size={15} />
          </button>

          <Bot size={16} style={{ color: "hsl(var(--primary))" }} />
          <span className="font-semibold text-sm flex-1 truncate">{t("chat.title")}</span>

          {/* Instance picker */}
          <div className="relative">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.05)" }}
            >
              {selectedInst ? (
                isOnline
                  ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
              )}
              <span className="font-mono max-w-[160px] truncate">{gatewayUrl}</span>
              <ChevronDown size={11} className={`flex-shrink-0 transition-transform ${showPicker ? "rotate-180" : ""}`} />
            </button>

            {showPicker && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl overflow-hidden z-50"
                style={{ border: "1px solid rgba(6,182,212,0.2)", background: "white", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "hsl(var(--muted-foreground))", borderBottom: "1px solid rgba(6,182,212,0.1)" }}>
                  {t("chat.selectInstance")}
                </div>
                {instances.map((inst) => (
                  <button key={inst.id}
                    onClick={() => {
                      if (
                        inst.id !== selectedId &&
                        messages.length > 0 &&
                        !window.confirm(t("chat.switchInstanceConfirm"))
                      ) return;
                      setSelectedId(inst.id);
                      setShowPicker(false);
                      setMessages([]);
                      persistSession(null);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                    style={{
                      background: inst.id === selectedId ? "rgba(6,182,212,0.06)" : "transparent",
                      borderLeft: inst.id === selectedId ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                    }}
                  >
                    {inst.health === "online"
                      ? <Wifi size={12} className="text-emerald-500 flex-shrink-0" />
                      : inst.health === "offline"
                        ? <WifiOff size={12} className="text-red-400 flex-shrink-0" />
                        : <RefreshCw size={12} className="text-slate-400 animate-spin flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{inst.name}</p>
                      <p className="font-mono truncate" style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                        {inst.httpUrl}
                      </p>
                    </div>
                    {inst.health === "online" && inst.latencyMs !== undefined && (
                      <span className="text-[10px] font-mono text-emerald-600 flex-shrink-0">{inst.latencyMs}ms</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Offline warning */}
        {selectedInst && !isOnline && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}>
            <WifiOff size={12} className="flex-shrink-0" />
            <span>
              {t("chat.instanceOffline", { status: selectedInst.health === "offline" ? t("chat.offline") : t("chat.unknown") })}
            </span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.2)" }}>
                <Bot size={24} style={{ color: "rgba(6,182,212,0.45)" }} />
              </div>
              <p className="text-sm">{t("chat.emptyHint")}</p>
              {isOnline && (
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
                  {t("chat.connectedTo", { url: gatewayUrl })}
                </p>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: msg.role === "user" ? "hsl(var(--primary))" : "rgba(6,182,212,0.1)",
                  boxShadow: msg.role === "user" ? "0 0 8px rgba(6,182,212,0.35)" : "none",
                }}>
                {msg.role === "user"
                  ? <User size={14} className="text-white" />
                  : <Bot  size={14} style={{ color: "hsl(var(--primary))" }} />}
              </div>
              <div className="max-w-[72%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                style={msg.role === "user" ? {
                  background: "hsl(var(--primary))", color: "white",
                  borderTopRightRadius: 4, boxShadow: "0 2px 10px rgba(6,182,212,0.3)",
                } : {
                  background: "white", color: "hsl(var(--foreground))",
                  borderTopLeftRadius: 4, border: "1px solid rgba(6,182,212,0.12)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
                }}>
                {msg.streaming && !msg.content ? (
                  <span className="flex items-center gap-1 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce bg-primary/60" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce bg-primary/60" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce bg-primary/60" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.streaming && (
                      <span className="inline-block w-1 h-4 ml-0.5 rounded-sm animate-pulse"
                        style={{ background: "hsl(var(--primary))", opacity: 0.7 }} />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Routing notification banner */}
        {routedTo && (
          <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-xs text-primary flex-shrink-0">
            <GitBranch size={13} className="flex-shrink-0" />
            <span>{t("router.routedTo", { name: routedTo })}</span>
          </div>
        )}

        {/* PII banner */}
        {injectionWarning && (
          <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-700 flex-shrink-0">
            <AlertCircle size={13} className="flex-shrink-0" />
            <span>{t("security.injectionWarn")} — {t("security.injectionTitle")}</span>
          </div>
        )}
        {lastPiiMatches.length > 0 && (
          <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/20 text-xs text-green-700 flex-shrink-0">
            <ShieldCheck size={13} className="flex-shrink-0" />
            <span>{t("pii.bannerTitle")} — {t("pii.bannerDesc", { count: lastPiiMatches.length })}</span>
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t flex-shrink-0" style={{ borderColor: "rgba(6,182,212,0.12)" }}>
          {/* Tool toggles */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <button
              onClick={() => { const n = !piiEnabled; setPiiEnabled(n); setLastPiiMatches([]); localStorage.setItem("clawno-pii", String(n)); }}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                piiEnabled ? "border-green-400 text-green-700 bg-green-50" : "border-border text-muted-foreground"
              }`}
            >
              {piiEnabled ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
              {t("pii.settingTitle")}
            </button>

            <button
              onClick={() => { const n = !ragEnabled; setRagEnabled(n); localStorage.setItem("clawno-rag", String(n)); }}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                ragEnabled && ragDocCount > 0
                  ? "border-primary/50 text-primary bg-primary/8"
                  : ragEnabled
                    ? "border-amber-400 text-amber-600 bg-amber-50"
                    : "border-border text-muted-foreground"
              }`}
            >
              <BookOpen size={11} />
              {t("rag.ragSwitch")}
              {ragDocCount > 0 && <span className="ml-0.5 text-[9px] opacity-70">{ragDocCount}</span>}
            </button>

            <button
              onClick={() => { const n = !routingEnabled; setRoutingEnabled(n); localStorage.setItem("clawno-routing", String(n)); }}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                routingEnabled ? "border-primary/50 text-primary bg-primary/8" : "border-border text-muted-foreground"
              }`}
            >
              <GitBranch size={11} />
              {t("router.switch")}
            </button>

            <button
              onClick={() => setShowPrompts((v) => !v)}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors ml-auto ${
                showPrompts ? "border-primary/50 text-primary bg-primary/8" : "border-border text-muted-foreground"
              }`}
            >
              <Sparkles size={11} />
              {t("prompts.toggle")}
              {showPrompts ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          </div>

          {/* Prompt library panel */}
          {showPrompts && (
            <div className="mb-2 rounded-xl border border-border bg-muted/20 p-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {prompts.map((p) => (
                  <div key={p.id} className="group relative">
                    <button
                      onClick={() => { setInput(p.content); setShowPrompts(false); }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card text-xs hover:bg-primary/8 hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <span>{p.emoji}</span>
                      <span>{p.label}</span>
                    </button>
                    {p.type === "custom" && (
                      <button
                        onClick={() => { deleteCustomPrompt(p.id); setPrompts(getAllPrompts()); }}
                        className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white items-center justify-center hidden group-hover:flex"
                      >
                        <X size={8} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setAddingPrompt((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Plus size={11} /> {t("prompts.add")}
                </button>
              </div>

              {addingPrompt && (
                <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={newPromptEmoji}
                      onChange={(e) => setNewPromptEmoji(e.target.value)}
                      className="w-12 px-2 py-1 rounded border border-border text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={2}
                    />
                    <input
                      value={newPromptLabel}
                      onChange={(e) => setNewPromptLabel(e.target.value)}
                      placeholder={t("prompts.labelPlaceholder")}
                      className="flex-1 px-2 py-1 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <textarea
                    value={newPromptContent}
                    onChange={(e) => setNewPromptContent(e.target.value)}
                    placeholder={t("prompts.contentPlaceholder")}
                    rows={3}
                    className="w-full px-2 py-1.5 rounded border border-border text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setAddingPrompt(false); setNewPromptLabel(""); setNewPromptContent(""); }}
                      className="px-2.5 py-1 rounded border border-border text-xs hover:bg-muted/50 transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      disabled={!newPromptLabel.trim() || !newPromptContent.trim() || newPromptContent.length > 4000}
                      onClick={() => {
                        try {
                          saveCustomPrompt({ emoji: newPromptEmoji, label: newPromptLabel, content: newPromptContent });
                          setPrompts(getAllPrompts());
                          setAddingPrompt(false);
                          setNewPromptLabel(""); setNewPromptContent(""); setNewPromptEmoji("✨");
                        } catch {
                          // Validation errors from saveCustomPrompt (e.g. content too long) are silently
                          // prevented by the disabled guard above; unexpected errors are swallowed here.
                        }
                      }}
                      className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {t("common.save")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Model selector + input + send */}
          <div className="flex gap-2 items-end">
            {/* Local model picker */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowModelPicker((v) => !v)}
                title={
                  selectedModel?.startsWith("cloud:")
                    ? `云端模型：${selectedModel.slice(6)}`
                    : selectedModel
                    ? `本地模型：${selectedModel}`
                    : "模型：自动（OpenClaw）"
                }
                className={`h-10 flex items-center gap-1.5 px-2.5 rounded-xl text-xs font-medium transition-colors border ${
                  selectedModel
                    ? "border-primary/50 bg-primary/8 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                {selectedModel?.startsWith("cloud:") ? <Sparkles size={13} /> : selectedModel ? <Cpu size={13} /> : <Bot size={13} />}
                <span className="max-w-[100px] truncate hidden sm:block">
                  {selectedModel?.startsWith("cloud:")
                    ? (selectedModel.slice(6).split("/").slice(1).join("/") || selectedModel.slice(6))
                    : selectedModel
                    ? selectedModel.split(":")[0]
                    : "自动"}
                </span>
                <ChevronDown size={10} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
              </button>

              {showModelPicker && (
                <div className="absolute bottom-full mb-1.5 left-0 w-64 rounded-xl overflow-hidden z-50 max-h-80 overflow-y-auto"
                  style={{ border: "1px solid rgba(6,182,212,0.2)", background: "white", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 sticky top-0 bg-white">
                    选择模型
                  </div>

                  {/* Auto option */}
                  <button
                    onClick={() => { setSelectedModel(null); setShowModelPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
                    style={{
                      background: !selectedModel ? "rgba(6,182,212,0.06)" : "transparent",
                      borderLeft: !selectedModel ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                    }}
                  >
                    <Bot size={13} className="text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">自动</p>
                      <p className="text-[10px] text-muted-foreground">由 OpenClaw 网关决策（默认最省）</p>
                    </div>
                    {!selectedModel && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </button>

                  {/* Cloud models — only show configured providers */}
                  {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">
                        云端模型（本次对话生效）
                      </div>
                      {configuredProviders
                        .filter((p) => PROVIDER_CLOUD_MODELS[p])
                        .map((p) => {
                          const info = PROVIDER_CLOUD_MODELS[p]!;
                          const key = `cloud:${info.model}`;
                          const isActive = selectedModel === key;
                          return (
                            <button
                              key={p}
                              onClick={() => { setSelectedModel(key); setShowModelPicker(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
                              style={{
                                background: isActive ? "rgba(6,182,212,0.06)" : "transparent",
                                borderLeft: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                              }}
                            >
                              <Sparkles size={13} className="text-amber-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{info.label}</p>
                                <p className="text-[10px] text-muted-foreground">{info.badge}</p>
                              </div>
                              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                            </button>
                          );
                        })}
                    </>
                  )}

                  {/* Local Ollama models */}
                  {localModels.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">
                        本地模型（Ollama · 无需联网）
                      </div>
                      {localModels.map((m) => {
                        const isActive = selectedModel === m.name;
                        return (
                          <button
                            key={m.name}
                            onClick={() => { setSelectedModel(m.name); setShowModelPicker(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
                            style={{
                              background: isActive ? "rgba(6,182,212,0.06)" : "transparent",
                              borderLeft: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                            }}
                          >
                            <Cpu size={13} className="text-primary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{m.name}</p>
                              <p className="text-[10px] text-muted-foreground">本地运行</p>
                            </div>
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length === 0 && localModels.length === 0 && (
                    <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                      暂无可选模型，前往「设置」配置 API Key 或「本地」下载模型
                    </div>
                  )}
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("chat.placeholder")}
              disabled={isStreaming}
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none disabled:opacity-50 resize-none overflow-y-auto"
              style={{
                border: "1px solid rgba(6,182,212,0.25)",
                background: "white",
                lineHeight: "1.5",
                maxHeight: "8rem",
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = "0 0 0 2px rgba(6,182,212,0.2)")}
              onBlur={(e)  => (e.currentTarget.style.boxShadow = "none")}
            />
            {isStreaming ? (
              <button
                onClick={cancelStream}
                title={t("chat.stopStreaming")}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-white transition-all flex-shrink-0"
                style={{ background: "#ef4444", boxShadow: "0 0 10px rgba(239,68,68,0.35)" }}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                style={{
                  background: "hsl(var(--primary))",
                  boxShadow: input.trim() ? "0 0 12px rgba(6,182,212,0.4)" : "none",
                }}
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>

        {showPicker && <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />}
        {showModelPicker && <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />}
      </div>
    </div>
  );
}
