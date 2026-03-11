/**
 * ChatPage — mobile version.
 *
 * Full feature parity with desktop:
 *  - PII filter, RAG context injection, smart model routing
 *  - SSE streaming via Tauri events (Rust HTTP SSE)
 *  - Token recording, chat history persistence
 *  - Prompt injection detection, shell command audit
 *  - Prompt library, session management
 *
 * Mobile adaptations:
 *  - Bottom-sheet style history drawer (not sidebar)
 *  - Touch-optimized input with send button
 *  - Compact header with instance picker
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Send, Bot, User, ChevronDown, Wifi, WifiOff, RefreshCw,
  ShieldCheck, ShieldOff, BookOpen, History, Plus, Search,
  Trash2, X, MessageSquare, Sparkles, ChevronUp, GitBranch,
  Square, AlertCircle,
} from "lucide-react";
import type { ChatMessage } from "@clawno/openclaw-client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { fetchChatProxyToken } from "../ipc";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { recordTokenUsage } from "../store/tokenLog";
import { getMainAgentModel } from "../ipc";
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
import { TopBar } from "../components/TopBar";

const MAX_CONTEXT_CHARS = 32_000;
const CHAT_PROXY_PORT = 18800;

/**
 * Provider ID → cheapest available model.
 * Keys MUST match the provider IDs used in SettingsPage AI_PROVIDERS
 * and stored by aiConfigStore (secureAiConfig prefix "ai_key_configured:").
 */
const PROVIDER_CLOUD_MODELS: Record<string, { model: string; label: string; badge: string }> = {
  zhipu:      { model: "zai/glm-4-flash",                             label: "智谱 GLM-4-Flash",          badge: "低价" },
  openrouter: { model: "openrouter/meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B",             badge: "免费" },
  minimax:    { model: "minimax/MiniMax-M2",                          label: "MiniMax M2",                badge: "低价" },
  openai:     { model: "openai/gpt-4o-mini",                         label: "GPT-4o Mini",               badge: "轻量" },
  anthropic:  { model: "anthropic/claude-haiku-3",                   label: "Claude Haiku 3",            badge: "轻量" },
};

function extractShellCommands(text: string): string[] {
  const commands: string[] = [];
  const re = /```(?:bash|sh|shell|cmd|powershell|ps1|zsh|fish|python)\r?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const firstLine = m[1].trim().split(/\r?\n/)[0] ?? "";
    if (firstLine) commands.push(firstLine.slice(0, 200));
  }
  return commands;
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(your\s+)?(previous\s+)?instructions/i,
  /disregard\s+(your\s+)?(previous\s+)?instructions/i,
  /you\s+are\s+now\s+(a|an|the)\s/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(a|an|the)\s/i,
  /new\s+system\s+prompt/i,
  /\[SYSTEM\]/,
  /jailbreak/i,
  /DAN\s+mode/i,
  /你(现在|从现在起)(是|变成|成为)(?!用户)/,
  /忘记.{0,20}指令/,
  /忽略.{0,20}之前.{0,20}指令/,
  /绕过.{0,10}(限制|安全|规则)/,
];

function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.5));
}

interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
  createdAt?: number;
}

/** Format a message timestamp as a short, human-friendly string. */
function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  if (now.toDateString() === d.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function trimToContextWindow(msgs: { role: string; content: string }[]) {
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

function relativeDate(ts: number, t: (k: string) => string): string {
  const now  = new Date();
  const date = new Date(ts);
  if (now.toDateString() === date.toDateString()) return t("history.today");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.toDateString() === date.toDateString()) return t("history.yesterday");
  if (Date.now() - ts < 7 * 86_400_000) return t("history.thisWeek");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── History Drawer ────────────────────────────────────────────────────────

function HistoryDrawer({
  currentSessionId,
  onSelect,
  onNew,
  onClose,
}: {
  currentSessionId: string | null;
  onSelect: (s: ChatSession) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = query.trim() ? await searchSessions(query) : await listSessions();
    setSessions(list);
  }, [query]);

  useEffect(() => { load(); }, [load, currentSessionId]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-[hsl(var(--card))] flex flex-col"
        style={{ maxHeight: "75vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[hsl(var(--muted-foreground))]/30" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
          <History size={15} className="text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold flex-1">{t("history.title")}</span>
          <button onClick={onNew} className="touch-btn p-1.5 rounded-full">
            <Plus size={16} className="text-[hsl(var(--primary))]" />
          </button>
          <button onClick={onClose} className="touch-btn p-1.5 rounded-full">
            <X size={16} className="text-[hsl(var(--muted-foreground))]" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("history.search")}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-sm"
            />
          </div>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-[hsl(var(--muted-foreground))]">
              <MessageSquare size={24} className="opacity-30" />
              <p className="text-xs">{t("history.empty")}</p>
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s)}
              className={`relative px-4 py-3 border-b border-[hsl(var(--border))]/50 active:bg-[hsl(var(--muted))]/30 ${
                s.id === currentSessionId ? "bg-[hsl(var(--primary))]/5 border-l-2 border-l-[hsl(var(--primary))]" : ""
              }`}
            >
              <p className="text-sm font-medium truncate pr-8">{s.title}</p>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                {relativeDate(s.updatedAt, t)}
                {s.messageCount !== undefined && ` · ${t("history.msgCount", { count: s.messageCount })}`}
              </p>
              {deleting === s.id ? (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id).then(load); setDeleting(null); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-lg text-[11px] bg-red-500 text-white font-medium"
                >
                  {t("common.confirm")}
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleting(s.id); setTimeout(() => setDeleting(null), 3000); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[hsl(var(--muted-foreground))]"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main ChatPage ─────────────────────────────────────────────────────────

export function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances, lastChatProxyToken, setGlobalChatProxyToken, updateTokenByHost } = useInstanceStore();
  const { configured: configuredProviders } = useAiConfigStore();

  const [selectedId, setSelectedId]    = useState<string | null>(null);
  const [showPicker, setShowPicker]    = useState(false);
  const [messages, setMessages]        = useState<UIMessage[]>([]);
  const [input, setInput]              = useState("");
  const [isStreaming, setIsStreaming]  = useState(false);
  const [showHistory, setShowHistory]  = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem("clawno-last-session"),
  );
  const [piiEnabled, setPiiEnabled]    = useState(() => localStorage.getItem("clawno-pii") !== "false");
  const [lastPiiMatches, setLastPiiMatches] = useState<PiiMatch[]>([]);
  const [ragEnabled, setRagEnabled]    = useState(() => localStorage.getItem("clawno-rag") !== "false");
  const [ragDocCount, setRagDocCount]  = useState(0);
  const [injectionWarning, setInjectionWarning] = useState(false);
  const [routingEnabled, setRoutingEnabled] = useState(() => localStorage.getItem("clawno-routing") !== "false");
  const [routedTo, setRoutedTo]        = useState<string | null>(null);
  const [showPrompts, setShowPrompts]  = useState(false);
  const [prompts, setPrompts]          = useState<PromptTemplate[]>(() => getAllPrompts());
  const [activeModelInfo, setActiveModelInfo] = useState<{ provider: string; model: string } | null>(null);
  /**
   * selectedModel encoding (mobile — cloud only, no local Ollama):
   *   null              — auto (gateway default)
   *   "cloud:<model>"   — explicit cloud model override for this session
   */
  const [selectedModel, setSelectedModel]   = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const scrollBehaviorRef = useRef<ScrollBehavior>("instant");
  const mountedRef  = useRef(true);
  const isSendingRef = useRef(false);
  const cancelRef   = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const routedToTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSession = (id: string | null) => {
    if (id) localStorage.setItem("clawno-last-session", id);
    else localStorage.removeItem("clawno-last-session");
    setCurrentSessionId(id);
  };

  useEffect(() => {
    mountedRef.current = true;
    const lastId = localStorage.getItem("clawno-last-session");
    if (lastId) {
      loadMessages(lastId)
        .then((stored) => {
          if (!mountedRef.current) return;
          setMessages(stored.map((m): UIMessage => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })));
          setCurrentSessionId(lastId);
        })
        .catch(() => persistSession(null));
    }
    return () => {
      mountedRef.current = false;
      if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => documentCount().then(setRagDocCount).catch(() => {});
    refresh();
  }, []);

  const defaultInstance = useMemo(() => pickDefault(instances), [instances]);

  useEffect(() => {
    if (selectedId && instances.find((i) => i.id === selectedId)) return;
    setSelectedId(defaultInstance?.id ?? null);
  }, [instances, defaultInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const inst = instances.find((i) => i.id === selectedId);
    if (!inst) { setActiveModelInfo(null); return; }
    let cancelled = false;

    getMainAgentModel(inst.httpUrl)
      .then((modelStr) => {
        if (cancelled || !modelStr) return;
        const slashIdx = modelStr.indexOf("/");
        if (slashIdx > 0) {
          setActiveModelInfo({ provider: modelStr.slice(0, slashIdx), model: modelStr.slice(slashIdx + 1) });
        } else {
          setActiveModelInfo({ provider: "openclaw", model: modelStr });
        }
      })
      .catch(() => {
        if (!cancelled) {
          const provider = configuredProviders[0] ?? "openclaw";
          setActiveModelInfo({ provider, model: "main" });
        }
      });

    return () => { cancelled = true; };
  }, [selectedId, instances, configuredProviders]);

  useEffect(() => {
    scrollBehaviorRef.current = "instant";
  }, [currentSessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: scrollBehaviorRef.current });
    scrollBehaviorRef.current = "smooth";
  }, [messages]);

  // iOS WKWebView: visualViewport resize when keyboard appears
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = window.innerHeight - vv.height;
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
      if (offset > 50) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      document.documentElement.style.setProperty("--keyboard-offset", "0px");
    };
  }, []);

  const selectedInst = instances.find((i) => i.id === selectedId) ?? null;
  const gatewayUrl   = selectedInst?.httpUrl ?? "";
  const isOnline     = selectedInst?.health === "online";

  /**
   * Derive the chat proxy URL from the gateway URL.
   * The openclaw gateway (port 18789) is WebSocket-only and has no REST chat
   * endpoint.  The desktop's chat_proxy (port 18800) bridges REST ↔ CLI for us.
   */
  const getChatProxyUrl = useCallback((gUrl: string): string => {
    try {
      const u = new URL(gUrl);
      u.port = String(CHAT_PROXY_PORT);
      return u.origin;
    } catch {
      return gUrl;
    }
  }, []);

  const handleSelectSession = useCallback(async (session: ChatSession) => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (mountedRef.current) setIsStreaming(false);
    const stored: StoredMessage[] = await loadMessages(session.id);
    if (!mountedRef.current) return;
    setMessages(stored.map((m): UIMessage => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })));
    persistSession(session.id);
    setShowHistory(false);
  }, []);

  const cancelStream = useCallback(() => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (mountedRef.current) setIsStreaming(false);
  }, []);

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

  const send = useCallback(async () => {
    if (!input.trim() || isStreaming || isSendingRef.current) return;
    isSendingRef.current = true;
    cancelRef.current = false;
    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const rawContent = input.trim();

      if (detectInjection(rawContent)) {
        isSendingRef.current = false;
        if (!window.confirm(`${t("security.injectionWarn")}\n\n${t("security.injectionWarnDetail")}`)) return;
        isSendingRef.current = true;
        setInjectionWarning(true);
        await logSecurityEvent("injection_detected", `注入检测: "${rawContent.slice(0, 80)}"`, "warn");
        setTimeout(() => setInjectionWarning(false), 5000);
      }

      let sendContent = rawContent;
      let piiMatches: PiiMatch[] = [];
      if (piiEnabled) {
        const result = redactPii(rawContent);
        sendContent = result.redacted;
        piiMatches  = result.matches;
      }
      if (mountedRef.current) setLastPiiMatches(piiMatches);

      let effectiveInstanceId = selectedId;
      let effectiveGatewayUrl = gatewayUrl;
      // Cloud model override: "cloud:<model>" → pass model field to gateway.
      let effectiveModel: string | null = null;
      if (selectedModel?.startsWith("cloud:")) {
        effectiveModel = selectedModel.slice(6);
        if (mountedRef.current) {
          const label = effectiveModel.split("/").slice(1).join("/") || effectiveModel;
          setRoutedTo(`云端 · ${label}`);
          if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
          routedToTimerRef.current = setTimeout(() => {
            routedToTimerRef.current = null;
            if (mountedRef.current) setRoutedTo(null);
          }, 4000);
        }
      } else if (routingEnabled) {
        const matched = matchRule(rawContent, listRules());
        if (matched?.instanceId && matched.instanceId !== selectedId) {
          const target = instances.find((i) => i.id === matched.instanceId);
          if (target) {
            effectiveInstanceId = target.id;
            effectiveGatewayUrl = target.httpUrl;
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

      let ragPrefix = "";
      if (ragEnabled && ragDocCount > 0) {
        try {
          ragPrefix = await buildRagContext(rawContent, 3);
          if (piiEnabled && ragPrefix) ragPrefix = redactPii(ragPrefix).redacted;
        } catch { /* ignore */ }
      }
      const finalContent = ragPrefix + sendContent;

      let sessionId = currentSessionId;
      try {
        if (!sessionId) {
          const title = rawContent.slice(0, 40) + (rawContent.length > 40 ? "…" : "");
          sessionId = await createSession(title, effectiveInstanceId ?? "");
          if (mountedRef.current) persistSession(sessionId);
        }
      } catch { /* proceed without persistence */ }

      if (!mountedRef.current) return;

      const now = Date.now();
      const userMsg: UIMessage      = { id: crypto.randomUUID(), role: "user",      content: rawContent, createdAt: now };
      const sendMsg: UIMessage      = { ...userMsg, content: finalContent };
      const assistantId             = crypto.randomUUID();
      const assistantMsg: UIMessage = { id: assistantId, role: "assistant", content: "", streaming: true, createdAt: now };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsStreaming(true);

      if (sessionId) addMessage(sessionId, "user", rawContent).catch(console.error);

      const reqId = assistantId;

      try {
        const contextMsgs = trimToContextWindow(
          [...messages, sendMsg].map(({ role, content }) => ({ role, content })),
        );

        let accumulatedText = "";

        const unlistenChunk = await listen<{ req_id: string; delta: string }>(
          "chat-chunk",
          (event) => {
            if (event.payload.req_id !== reqId) return;
            if (cancelRef.current || !mountedRef.current) return;
            accumulatedText += event.payload.delta;
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: accumulatedText } : m),
            );
          },
        );

        const unlistenDone = await listen<{ req_id: string; error: string | null }>(
          "chat-done",
          async (event) => {
            if (event.payload.req_id !== reqId) return;
            unlistenChunk();
            unlistenDone();
            if (!mountedRef.current) return;

            if (event.payload.error && !cancelRef.current && !accumulatedText) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: `${t("chat.error")}${event.payload.error}`, streaming: false } : m,
                ),
              );
              // If the error looks like real AI content, persist it
              const errText = event.payload.error;
              const looksLikeContent = errText.length > 100 || errText.includes("payloads") || errText.includes("text");
              if (looksLikeContent && sessionId) {
                try { await addMessage(sessionId, "assistant", `${t("chat.error")}${errText}`); } catch { /* non-fatal */ }
              }
            } else {
              if (event.payload.error && !cancelRef.current && accumulatedText) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
                );
              } else {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
                );
              }
            }

            // Persist assistant response regardless of error flag
            if (!cancelRef.current && sessionId && accumulatedText) {
              try { await addMessage(sessionId, "assistant", accumulatedText); } catch (e) { console.error("Failed to save assistant message:", e); }
            }

            if (accumulatedText) {
              const promptText = [...messages, userMsg].map((m) => m.content).join(" ");
              recordTokenUsage({
                instanceId: effectiveInstanceId ?? "unknown",
                provider: activeModelInfo?.provider ?? "openclaw",
                model:    activeModelInfo?.model    ?? "main",
                promptTokens: estimateTokens(promptText),
                completionTokens: estimateTokens(accumulatedText),
              }).catch(console.error);
              const shellCmds = extractShellCommands(accumulatedText);
              if (shellCmds.length > 0) {
                logSecurityEvent("shell_audit", `AI 响应包含命令：\`${shellCmds[0]}\``, "warn").catch(console.error);
              }
            }
            setIsStreaming(false);
          },
        );

        ac.signal.addEventListener("abort", () => {
          unlistenChunk();
          unlistenDone();
          if (sessionId && accumulatedText) {
            addMessage(sessionId, "assistant", accumulatedText).catch(console.error);
          }
          if (mountedRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
            setIsStreaming(false);
          }
          isSendingRef.current = false;
        }, { once: true });

        let authToken = selectedInst?.chatProxyToken ?? lastChatProxyToken ?? null;

        if (!authToken && effectiveGatewayUrl) {
          try {
            const fetched = await fetchChatProxyToken(effectiveGatewayUrl);
            if (fetched) {
              authToken = fetched;
              setGlobalChatProxyToken(fetched);
              try {
                const host = new URL(effectiveGatewayUrl).host;
                if (host) updateTokenByHost(host, fetched);
              } catch { /* ignore */ }
            }
          } catch { /* non-fatal */ }
        }

        invoke("stream_chat", {
          gatewayUrl: getChatProxyUrl(effectiveGatewayUrl),
          messages: contextMsgs,
          reqId,
          model: effectiveModel,
          authToken,
        }).catch((e: unknown) => {
          if (cancelRef.current || !mountedRef.current) return;
          unlistenChunk();
          unlistenDone();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: t("chat.error") + String(e), streaming: false } : m,
            ),
          );
          setIsStreaming(false);
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
      isSendingRef.current = false;
    }
  }, [
    input, isStreaming, piiEnabled, selectedId, gatewayUrl, routingEnabled,
    ragEnabled, ragDocCount, currentSessionId, messages, instances, t,
    activeModelInfo, selectedModel, getChatProxyUrl,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Empty state ─────────────────────────────────────────────────────────
  if (instances.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title={t("chat.title")} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}>
            <Bot size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
          </div>
          <div>
            <p className="font-semibold text-[hsl(var(--foreground))]/70 mb-1">{t("chat.noInstance")}</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("chat.noInstanceSub")}</p>
          </div>
          <button
            onClick={() => navigate("/connect")}
            className="touch-btn px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
            style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
          >
            {t("chat.goToConnect")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0 top-bar"
        style={{ borderBottom: "1px solid rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.02)" }}>
        <button onClick={() => setShowHistory(true)} className="touch-btn p-1.5 rounded-full">
          <History size={18} className={showHistory ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"} />
        </button>
        <button onClick={handleNewChat} className="touch-btn p-1.5 rounded-full">
          <Plus size={18} className="text-[hsl(var(--muted-foreground))]" />
        </button>
        <Bot size={16} style={{ color: "hsl(var(--primary))" }} />
        <span className="font-semibold text-sm flex-1 truncate">{t("chat.title")}</span>

        {/* Instance picker */}
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs touch-btn"
          style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.05)" }}
        >
          {selectedInst ? (
            isOnline
              ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              : <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
          )}
          <span className="font-mono max-w-[120px] truncate">
            {selectedInst?.name ?? t("chat.selectInstance")}
          </span>
          <ChevronDown size={10} className={showPicker ? "rotate-180" : ""} />
        </button>
      </div>

      {/* Instance picker dropdown */}
      {showPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
          <div className="absolute right-3 top-14 w-64 rounded-2xl overflow-hidden z-50 shadow-xl"
            style={{ border: "1px solid rgba(6,182,212,0.2)", background: "hsl(var(--card))" }}>
            {instances.map((inst) => (
              <button key={inst.id}
                onClick={() => {
                  if (inst.id !== selectedId && messages.length > 0 && !window.confirm(t("chat.switchInstanceConfirm"))) return;
                  setSelectedId(inst.id);
                  setShowPicker(false);
                  setMessages([]);
                  persistSession(null);
                  setSelectedModel(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-left border-b border-[hsl(var(--border))]/50 last:border-0 active:bg-[hsl(var(--muted))]/30"
                style={{ background: inst.id === selectedId ? "rgba(6,182,212,0.06)" : "transparent" }}
              >
                {inst.health === "online"
                  ? <Wifi size={13} className="text-emerald-500 flex-shrink-0" />
                  : inst.health === "offline"
                    ? <WifiOff size={13} className="text-red-400 flex-shrink-0" />
                    : <RefreshCw size={13} className="text-slate-400 animate-spin flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inst.name}</p>
                  <p className="font-mono text-[10px] text-[hsl(var(--muted-foreground))] truncate">{inst.httpUrl}</p>
                </div>
                {inst.health === "online" && inst.latencyMs !== undefined && (
                  <span className="text-[10px] text-emerald-600">{inst.latencyMs}ms</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Offline warning */}
      {selectedInst && !isOnline && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs flex-shrink-0"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}>
          <WifiOff size={11} className="flex-shrink-0" />
          <span>{t("chat.instanceOffline", { status: selectedInst.health === "offline" ? t("chat.offline") : t("chat.unknown") })}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))]">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.2)" }}>
              <Bot size={22} style={{ color: "rgba(6,182,212,0.45)" }} />
            </div>
            <p className="text-sm">{t("chat.emptyHint")}</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const prevMsg = messages[idx - 1];
          const showDateSep =
            msg.createdAt &&
            (!prevMsg?.createdAt ||
              new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString());
          return (
            <React.Fragment key={msg.id}>
              {showDateSep && msg.createdAt && (
                <div className="flex justify-center">
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/40 px-3 py-0.5 rounded-full">
                    {new Date(msg.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", weekday: "short" })}
                  </span>
                </div>
              )}
              <div className={`flex gap-2 bubble-enter ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: msg.role === "user" ? "hsl(var(--primary))" : "rgba(6,182,212,0.1)",
                  }}>
                  {msg.role === "user"
                    ? <User size={14} className="text-white" />
                    : <Bot  size={14} style={{ color: "hsl(var(--primary))" }} />}
                </div>
                <div className={`flex flex-col max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                    style={msg.role === "user" ? {
                      background: "hsl(var(--primary))", color: "white",
                      borderTopRightRadius: 4,
                    } : {
                      background: "hsl(var(--card))", color: "hsl(var(--foreground))",
                      borderTopLeftRadius: 4,
                      border: "1px solid rgba(6,182,212,0.12)",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    }}
                  >
                    {msg.streaming && !msg.content ? (
                      <span className="flex items-center gap-1 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "hsl(var(--primary))", opacity: 0.6, animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "hsl(var(--primary))", opacity: 0.6, animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "hsl(var(--primary))", opacity: 0.6, animationDelay: "300ms" }} />
                      </span>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.streaming && (
                          <span className="inline-block w-0.5 h-4 ml-0.5 rounded-sm animate-pulse"
                            style={{ background: "hsl(var(--primary))", opacity: 0.7 }} />
                        )}
                      </>
                    )}
                  </div>
                  {msg.createdAt && !msg.streaming && (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]/60 mt-0.5 px-1">
                      {formatMsgTime(msg.createdAt)}
                    </span>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Notification banners */}
      {routedTo && (
        <div className="mx-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs flex-shrink-0"
          style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "hsl(var(--primary))" }}>
          <GitBranch size={12} /> <span>{t("router.routedTo", { name: routedTo })}</span>
        </div>
      )}
      {injectionWarning && (
        <div className="mx-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-amber-700 flex-shrink-0"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <AlertCircle size={12} /> <span>{t("security.injectionWarn")}</span>
        </div>
      )}
      {lastPiiMatches.length > 0 && (
        <div className="mx-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-green-700 flex-shrink-0"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <ShieldCheck size={12} /> <span>{t("pii.bannerTitle")} — {t("pii.bannerDesc", { count: lastPiiMatches.length })}</span>
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-bar px-3 pt-2 flex-shrink-0"
        style={{ borderTop: "1px solid rgba(6,182,212,0.1)", background: "hsl(var(--card))" }}>
        {/* Tool toggles */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <button
            onClick={() => { const n = !piiEnabled; setPiiEnabled(n); setLastPiiMatches([]); localStorage.setItem("clawno-pii", String(n)); }}
            className={`touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
              piiEnabled ? "border-green-400 text-green-700 bg-green-50" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            }`}
          >
            {piiEnabled ? <ShieldCheck size={10} /> : <ShieldOff size={10} />}
            {t("pii.settingTitle")}
          </button>

          <button
            onClick={() => { const n = !ragEnabled; setRagEnabled(n); localStorage.setItem("clawno-rag", String(n)); }}
            className={`touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
              ragEnabled && ragDocCount > 0
                ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            }`}
          >
            <BookOpen size={10} />
            {t("rag.ragSwitch")}
            {ragDocCount > 0 && <span className="opacity-70">{ragDocCount}</span>}
          </button>

          <button
            onClick={() => { const n = !routingEnabled; setRoutingEnabled(n); localStorage.setItem("clawno-routing", String(n)); }}
            className={`touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
              routingEnabled ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            }`}
          >
            <GitBranch size={10} />
            {t("router.switch")}
          </button>

          {/* Cloud model picker button */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              className={`touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
                selectedModel
                  ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
              }`}
            >
              {selectedModel ? <Sparkles size={10} /> : <Bot size={10} />}
              <span className="max-w-[60px] truncate">
                {selectedModel
                  ? (selectedModel.slice(6).split("/").slice(1).join("/") || selectedModel.slice(6))
                  : t("model.auto")}
              </span>
              <ChevronDown size={8} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
            </button>

            {showModelPicker && (
              <div className="absolute bottom-full mb-1.5 left-0 w-60 rounded-2xl overflow-hidden z-50 max-h-72 overflow-y-auto"
                style={{ border: "1px solid rgba(6,182,212,0.2)", background: "hsl(var(--card))", boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}>
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 sticky top-0 bg-[hsl(var(--card))]">
                  {t("model.pickerTitle")}
                </div>

                {/* Auto option */}
                <button
                  onClick={() => { setSelectedModel(null); setShowModelPicker(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors active:bg-slate-100"
                  style={{
                    background: !selectedModel ? "rgba(6,182,212,0.06)" : "transparent",
                    borderLeft: !selectedModel ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  }}
                >
                  <Bot size={13} className="text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{t("model.auto")}</p>
                    <p className="text-[10px] text-muted-foreground">{t("model.autoDesc")}</p>
                  </div>
                  {!selectedModel && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                </button>

                {/* Configured cloud models */}
                {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">
                      {t("model.cloudGroup")}
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
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors active:bg-slate-100"
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

                {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length === 0 && (
                  <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                    {t("model.noModels")}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowPrompts((v) => !v)}
            className={`touch-btn ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
              showPrompts ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            }`}
          >
            <Sparkles size={10} />
            {t("prompts.toggle")}
            {showPrompts ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </button>
        </div>

        {/* Prompt library */}
        {showPrompts && (
          <div className="mb-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2">
            <div className="flex flex-wrap gap-1.5">
              {prompts.map((p) => (
                <div key={p.id} className="relative group">
                  <button
                    onClick={() => { setInput(p.content); setShowPrompts(false); }}
                    className="touch-btn flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs"
                  >
                    <span>{p.emoji}</span>
                    <span>{p.label}</span>
                  </button>
                  {p.type === "custom" && (
                    <button
                      onClick={() => { deleteCustomPrompt(p.id); setPrompts(getAllPrompts()); }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center"
                    >
                      <X size={8} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => {
                  const label = prompt(t("prompts.labelPlaceholder"));
                  const content = prompt(t("prompts.contentPlaceholder"));
                  if (label && content) {
                    try {
                      saveCustomPrompt({ emoji: "✨", label, content });
                      setPrompts(getAllPrompts());
                    } catch { /* ignore */ }
                  }
                }}
                className="touch-btn flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]"
              >
                <Plus size={10} /> {t("prompts.add")}
              </button>
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("chat.placeholder")}
            disabled={isStreaming}
            rows={1}
            className="flex-1 px-3.5 py-2.5 rounded-2xl text-sm disabled:opacity-50 resize-none"
            style={{
              border: "1px solid rgba(6,182,212,0.25)",
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
              lineHeight: "1.5",
              maxHeight: "120px",
              overflowY: "auto",
            }}
          />
          {isStreaming ? (
            <button
              onClick={cancelStream}
              className="touch-btn w-11 h-11 flex items-center justify-center rounded-2xl text-white flex-shrink-0"
              style={{ background: "#ef4444" }}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="touch-btn w-11 h-11 flex items-center justify-center rounded-2xl text-white flex-shrink-0 disabled:opacity-40"
              style={{ background: "hsl(var(--primary))" }}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      {/* History drawer (bottom sheet) */}
      {showHistory && (
        <HistoryDrawer
          currentSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onNew={handleNewChat}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
