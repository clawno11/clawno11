/**
 * ChatPage — mobile version.
 *
 * Mobile adaptations:
 *  - Bottom-sheet style history drawer (not sidebar)
 *  - Touch-optimized input with send button
 *  - Compact header with instance picker
 *  - iOS keyboard handling (visualViewport)
 *  - Chat proxy token auth for remote gateway
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Bot, ChevronDown, Wifi, WifiOff, RefreshCw,
  History, Plus, Search, Trash2, X, MessageSquare, Sparkles, Wrench,
} from "lucide-react";
import { PROVIDER_CLOUD_MODELS, MOBILE_PROVIDER_KEYS } from "@clawno/shared/chat/types";
import { relativeDate } from "@clawno/shared/chat/helpers";
import type { SendOptions } from "@clawno/shared/chat/useChatEngine";
import { useChatPageState } from "@clawno/shared/chat/useChatPageState";
import { ChatBanners } from "@clawno/shared/components/chat/ChatBanners";
import { MessageList } from "@clawno/shared/components/chat/MessageList";
import { ChatInput } from "@clawno/shared/components/chat/ChatInput";
import { useInstanceStore } from "../store/instances";
import { fetchChatProxyToken, getMainAgentModel, proxyRepairModel, discoverChatProxy, proxyFetchProviders, probeInstanceHealth } from "../ipc";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAiConfigStore } from "../store/aiConfig";
import {
  listSessions, searchSessions, deleteSession, type ChatSession,
} from "@clawno/shared/chatHistory";
import { listRules, matchRule } from "@clawno/shared/modelRouter";
import { TopBar } from "../components/TopBar";
import { MicButton } from "../components/MicButton";
import type { AudioPayload } from "@clawno/shared/chat/useChatEngine";

const MOBILE_CLOUD_MODELS = Object.fromEntries(
  MOBILE_PROVIDER_KEYS.filter((k) => k in PROVIDER_CLOUD_MODELS).map((k) => [k, PROVIDER_CLOUD_MODELS[k]]),
);

// ── History Drawer ────────────────────────────────────────────────────────

function HistoryDrawer({
  currentSessionId, onSelect, onNew, onClose,
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
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-[hsl(var(--card))] flex flex-col"
        style={{ maxHeight: "75vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[hsl(var(--muted-foreground))]/30" />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
          <History size={15} className="text-[hsl(var(--primary))]" />
          <span className="text-sm font-semibold flex-1">{t("history.title")}</span>
          <button onClick={onNew} className="touch-btn p-1.5 rounded-full"><Plus size={16} className="text-[hsl(var(--primary))]" /></button>
          <button onClick={onClose} className="touch-btn p-1.5 rounded-full"><X size={16} className="text-[hsl(var(--muted-foreground))]" /></button>
        </div>
        <div className="px-4 py-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("history.search")}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-[hsl(var(--muted-foreground))]">
              <MessageSquare size={24} className="opacity-30" /><p className="text-xs">{t("history.empty")}</p>
            </div>
          )}
          {sessions.map((s) => (
            <div key={s.id} onClick={() => onSelect(s)}
              className={`relative px-4 py-3 border-b border-[hsl(var(--border))]/50 active:bg-[hsl(var(--muted))]/30 ${
                s.id === currentSessionId ? "bg-[hsl(var(--primary))]/5 border-l-2 border-l-[hsl(var(--primary))]" : ""
              }`}>
              <p className="text-sm font-medium truncate pr-8">{s.title}</p>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                {relativeDate(s.updatedAt, t)}
                {s.messageCount !== undefined && ` · ${t("history.msgCount", { count: s.messageCount })}`}
              </p>
              {deleting === s.id ? (
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id).then(load); setDeleting(null); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-lg text-[11px] bg-red-500 text-white font-medium">
                  {t("common.confirm")}
                </button>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); setDeleting(s.id); setTimeout(() => setDeleting(null), 3000); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[hsl(var(--muted-foreground))]">
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
  const { configured: configuredProviders, markConfigured } = useAiConfigStore();

  const {
    engine, messages, isStreaming, currentSessionId,
    selectedId, setSelectedId, showPicker, setShowPicker, input, setInput,
    showHistory, setShowHistory,
    routingEnabled, toggleRouting, routedTo,
    selectedModel, setSelectedModel, showModelPicker, setShowModelPicker,
    activeModelInfo, setActiveModelInfo,
    selectedInst, gatewayUrl, isOnline,
    bottomRef,
    handleNewChat, handleSelectSession, setRoutedWithTimer,
  } = useChatPageState(instances, { defaultGatewayUrl: "" });

  // ── Mobile-specific effects ────────────────────────────────────────────

  useEffect(() => {
    const inst = instances.find((i) => i.id === selectedId);
    if (!inst) { setActiveModelInfo(null); return; }
    let cancelled = false;
    getMainAgentModel(inst.httpUrl)
      .then((modelStr) => {
        if (cancelled || !modelStr) return;
        const slashIdx = modelStr.indexOf("/");
        if (slashIdx > 0) setActiveModelInfo({ provider: modelStr.slice(0, slashIdx), model: modelStr.slice(slashIdx + 1) });
        else setActiveModelInfo({ provider: "openclaw", model: modelStr });
      })
      .catch(() => { if (!cancelled) setActiveModelInfo({ provider: configuredProviders[0] ?? "openclaw", model: "main" }); });
    return () => { cancelled = true; };
  }, [selectedId, instances, configuredProviders]);

  // WeChat-style keyboard handling:
  // Translate the entire chat container up by the keyboard height so
  // the input bar sits directly above the keyboard.
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let appliedKb = 0;

    function getKeyboardHeight(): number {
      const vv = window.visualViewport;
      if (!vv) return 0;
      return Math.max(0, Math.round(window.innerHeight - vv.height));
    }

    function apply(kbHeight: number) {
      const el = chatContainerRef.current;
      if (!el || kbHeight === appliedKb) return;
      appliedKb = kbHeight;
      el.style.transform = kbHeight > 0 ? `translateY(-${kbHeight}px)` : "";
      if (kbHeight > 0) {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        });
      }
    }

    function handleFocusIn(e: FocusEvent) {
      if (!(e.target instanceof HTMLTextAreaElement)) return;
      if (pollTimer) clearInterval(pollTimer);
      let attempts = 0;
      pollTimer = setInterval(() => {
        const kbh = getKeyboardHeight();
        if (kbh > 150) {
          apply(kbh);
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
        if (++attempts > 30) {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (appliedKb === 0) apply(Math.round(window.innerHeight * 0.4));
        }
      }, 50);
    }

    function handleFocusOut(e: FocusEvent) {
      if (!(e.target instanceof HTMLTextAreaElement)) return;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      setTimeout(() => apply(0), 100);
    }

    const el = chatContainerRef.current;
    el?.addEventListener("focusin", handleFocusIn);
    el?.addEventListener("focusout", handleFocusOut);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      el?.removeEventListener("focusin", handleFocusIn);
      el?.removeEventListener("focusout", handleFocusOut);
    };
  }, [bottomRef]);

  // ── Chat proxy port discovery ──────────────────────────────────────────

  const [proxyOrigin, setProxyOrigin] = useState<string | null>(null);
  const [proxyToken, setProxyToken] = useState<string | null>(null);

  useEffect(() => {
    if (!gatewayUrl || proxyOrigin !== null) return;
    let cancelled = false;
    discoverChatProxy(gatewayUrl)
      .then((d) => {
        if (cancelled || !d.found) return;
        setProxyOrigin(d.proxy_url);
        if (d.token) {
          setProxyToken(d.token);
          setGlobalChatProxyToken(d.token);
          try {
            const host = new URL(gatewayUrl).host;
            if (host) updateTokenByHost(host, d.token);
          } catch { /* ignore */ }
        }
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [gatewayUrl, proxyOrigin, setGlobalChatProxyToken, updateTokenByHost]);

  // ── Sync providers from desktop instance ────────────────────────────────

  useEffect(() => {
    if (!proxyOrigin) return;
    let cancelled = false;
    const token = proxyToken ?? selectedInst?.chatProxyToken ?? lastChatProxyToken ?? "";
    proxyFetchProviders(proxyOrigin, token)
      .then((providers) => {
        if (cancelled) return;
        for (const id of providers) markConfigured(id);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [proxyOrigin, proxyToken, selectedInst, lastChatProxyToken, markConfigured]);

  // ── Audio / voice state ────────────────────────────────────────────────

  const pendingAudioRef = useRef<AudioPayload | null>(null);

  const currentProvider = useMemo(
    () => activeModelInfo?.provider ?? null,
    [activeModelInfo],
  );

  const sendWithAudioRef = useRef<(b64: string, fmt: string) => void>(() => {});

  const handleAudioReady = useCallback((base64: string, format: string) => {
    sendWithAudioRef.current(base64, format);
  }, []);

  const handleTextReady = useCallback((text: string) => {
    if (text.trim()) setInput(text);
  }, [setInput]);

  // ── Shared send-options builder ─────────────────────────────────────────

  const buildSendOpts = useCallback(async (rawContent: string, audioData?: AudioPayload | null): Promise<SendOptions | null> => {
    let effectiveGatewayUrl = gatewayUrl;
    let effectiveModel: string | null = null;
    let effectiveInstanceId = selectedId;

    if (selectedModel?.startsWith("cloud:")) {
      const cloudModel = selectedModel.slice(6);
      effectiveModel = cloudModel;
      if (rawContent) setRoutedWithTimer(`云端 · ${cloudModel.split("/").slice(1).join("/") || cloudModel}`);
    } else if (routingEnabled && rawContent) {
      const matched = matchRule(rawContent, listRules());
      if (matched?.instanceId && matched.instanceId !== selectedId) {
        const target = instances.find((i) => i.id === matched.instanceId);
        if (target) {
          effectiveInstanceId = target.id;
          effectiveGatewayUrl = target.httpUrl;
          setRoutedWithTimer(target.name);
        }
      }
    }

    let authToken = selectedInst?.chatProxyToken ?? lastChatProxyToken ?? null;
    if (!authToken && effectiveGatewayUrl) {
      try {
        const fetched = await fetchChatProxyToken(effectiveGatewayUrl);
        if (fetched) {
          authToken = fetched;
          setGlobalChatProxyToken(fetched);
          try { const host = new URL(effectiveGatewayUrl).host; if (host) updateTokenByHost(host, fetched); } catch { /* ignore */ }
        }
      } catch { /* non-fatal */ }
    }

    return {
      rawContent,
      gatewayUrl: effectiveGatewayUrl,
      proxyUrl: proxyOrigin,
      model: effectiveModel,
      instanceId: effectiveInstanceId,
      authToken,
      audioData: audioData ?? null,
      t,
    } satisfies SendOptions;
  }, [
    gatewayUrl, selectedId, selectedModel, routingEnabled, instances,
    t,
    proxyOrigin, setRoutedWithTimer, selectedInst, lastChatProxyToken,
    setGlobalChatProxyToken, updateTokenByHost,
  ]);

  // ── Route resolution + send ────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const audio = pendingAudioRef.current;
    pendingAudioRef.current = null;
    const opts = await buildSendOpts(input.trim(), audio);
    if (!opts) return;
    const accepted = await engine.send(opts);
    if (accepted) setInput("");
  }, [input, isStreaming, engine, buildSendOpts, setInput]);

  const handleSendWithAudio = useCallback(async (base64: string, format: string) => {
    if (isStreaming) return;
    const rawContent = input.trim() || "";
    const opts = await buildSendOpts(rawContent, { base64, format });
    if (!opts) return;
    const accepted = await engine.send(opts);
    if (accepted) { setInput(""); pendingAudioRef.current = null; }
  }, [isStreaming, input, engine, buildSendOpts, setInput]);

  useEffect(() => { sendWithAudioRef.current = handleSendWithAudio; }, [handleSendWithAudio]);

  // ── Reconnect / health polling ─────────────────────────────────────────

  const { setHealth } = useInstanceStore();
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnect = useCallback(async () => {
    if (!selectedInst || reconnecting) return;
    setReconnecting(true);
    try {
      const result = await probeInstanceHealth(selectedInst.httpUrl);
      setHealth(selectedInst.id, result.online ? "online" : "offline", result.online ? result.latency_ms : undefined);
      if (result.online) setProxyOrigin(null); // reset so proxy re-discovery triggers
    } catch {
      setHealth(selectedInst.id, "offline");
    } finally {
      setReconnecting(false);
    }
  }, [selectedInst, reconnecting, setHealth]);

  useEffect(() => {
    if (!selectedInst || isOnline) return;
    const timer = setInterval(async () => {
      try {
        const result = await probeInstanceHealth(selectedInst.httpUrl);
        if (result.online) {
          setHealth(selectedInst.id, "online", result.latency_ms);
          setProxyOrigin(null);
        }
      } catch { /* stay offline */ }
    }, 15_000);
    return () => clearInterval(timer);
  }, [selectedInst, isOnline, setHealth]);

  // ── Model repair ──────────────────────────────────────────────────────

  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);

  const handleRepair = useCallback(async () => {
    if (!proxyOrigin) return;
    setRepairing(true);
    setRepairResult(null);
    try {
      const token = proxyToken ?? selectedInst?.chatProxyToken ?? lastChatProxyToken ?? "";
      const result = await proxyRepairModel(proxyOrigin, token);
      const msg = result.ok
        ? result.detail.includes("no-repair-needed")
          ? "模型配置正常"
          : `已修复: ${result.detail}`
        : `修复失败: ${result.detail}`;
      setRepairResult(msg);
      setTimeout(() => setRepairResult(null), 5000);
    } catch (e) {
      setRepairResult(`修复失败: ${e}`);
      setTimeout(() => setRepairResult(null), 5000);
    } finally {
      setRepairing(false);
    }
  }, [proxyOrigin, proxyToken, selectedInst, lastChatProxyToken]);

  // ── Empty state ────────────────────────────────────────────────────────

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
          <button onClick={() => navigate("/connect")}
            className="touch-btn px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
            style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}>
            {t("chat.goToConnect")}
          </button>
        </div>
      </div>
    );
  }

  // ── Mobile model picker ────────────────────────────────────────────────

  const modelPickerNode = (
    <div className="relative">
      <button onClick={() => setShowModelPicker((v) => !v)}
        className={`touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors ${
          selectedModel ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
        }`}>
        {selectedModel ? <Sparkles size={10} /> : <Bot size={10} />}
        <span className="max-w-[60px] truncate">
          {selectedModel ? (selectedModel.slice(6).split("/").slice(1).join("/") || selectedModel.slice(6)) : t("model.auto")}
        </span>
        <ChevronDown size={8} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
      </button>
      {showModelPicker && (
        <div className="absolute bottom-full mb-1.5 left-0 w-60 rounded-2xl overflow-hidden z-50 max-h-72 overflow-y-auto"
          style={{ border: "1px solid rgba(6,182,212,0.2)", background: "hsl(var(--card))", boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}>
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 sticky top-0 bg-[hsl(var(--card))]">{t("model.pickerTitle")}</div>
          <button onClick={() => { setSelectedModel(null); setShowModelPicker(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors active:bg-slate-100"
            style={{ background: !selectedModel ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: !selectedModel ? "2px solid hsl(var(--primary))" : "2px solid transparent" }}>
            <Bot size={13} className="text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0"><p className="font-medium">{t("model.auto")}</p><p className="text-[10px] text-muted-foreground">{t("model.autoDesc")}</p></div>
            {!selectedModel && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
          </button>
          {configuredProviders.filter((p) => MOBILE_CLOUD_MODELS[p]).length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">{t("model.cloudGroup")}</div>
              {configuredProviders.filter((p) => MOBILE_CLOUD_MODELS[p]).map((p) => {
                const info = MOBILE_CLOUD_MODELS[p]!;
                const key = `cloud:${info.model}`;
                const isActive = selectedModel === key;
                return (
                  <button key={p} onClick={() => { setSelectedModel(key); setShowModelPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors active:bg-slate-100"
                    style={{ background: isActive ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent" }}>
                    <Sparkles size={13} className="text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0"><p className="font-medium truncate">{info.label}</p></div>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
          {configuredProviders.filter((p) => MOBILE_CLOUD_MODELS[p]).length === 0 && (
            <div className="px-3 py-2.5 text-[11px] text-muted-foreground">{t("model.noModels")}</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div ref={chatContainerRef} className="flex flex-col h-full relative overflow-hidden"
      style={{ transition: "transform 0.25s ease-out", willChange: "transform" }}>
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
        {isOnline && proxyOrigin && (
          <button onClick={handleRepair} disabled={repairing}
            className="touch-btn p-1.5 rounded-full"
            title="修复模型">
            <Wrench size={14} className={repairing ? "animate-spin text-amber-500" : "text-[hsl(var(--muted-foreground))]"} />
          </button>
        )}
        <button onClick={() => setShowPicker((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs touch-btn"
          style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.05)" }}>
          {selectedInst ? (isOnline ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> : <span className="w-1.5 h-1.5 rounded-full bg-red-400" />) : <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
          <span className="font-mono max-w-[120px] truncate">{selectedInst?.name ?? t("chat.selectInstance")}</span>
          <ChevronDown size={10} className={showPicker ? "rotate-180" : ""} />
        </button>
      </div>

      {/* Instance picker */}
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
                  engine.clear();
                  setSelectedModel(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-left border-b border-[hsl(var(--border))]/50 last:border-0 active:bg-[hsl(var(--muted))]/30"
                style={{ background: inst.id === selectedId ? "rgba(6,182,212,0.06)" : "transparent" }}>
                {inst.health === "online" ? <Wifi size={13} className="text-emerald-500 flex-shrink-0" />
                  : inst.health === "offline" ? <WifiOff size={13} className="text-red-400 flex-shrink-0" />
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

      {/* Offline warning with reconnect */}
      {selectedInst && !isOnline && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs flex-shrink-0"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}>
          <WifiOff size={11} className="flex-shrink-0" />
          <span className="flex-1">{t("chat.instanceOffline", { status: selectedInst.health === "offline" ? t("chat.offline") : t("chat.unknown") })}</span>
          <button onClick={handleReconnect} disabled={reconnecting}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium flex-shrink-0"
            style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)", color: "hsl(var(--primary))" }}>
            <RefreshCw size={10} className={reconnecting ? "animate-spin" : ""} />
            {reconnecting ? t("chat.reconnecting") : t("chat.reconnect")}
          </button>
        </div>
      )}

      {/* Repair result toast */}
      {repairResult && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs flex-shrink-0"
          style={{
            background: repairResult.startsWith("已修复") || repairResult === "模型配置正常"
              ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
            border: repairResult.startsWith("已修复") || repairResult === "模型配置正常"
              ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(239,68,68,0.2)",
            color: repairResult.startsWith("已修复") || repairResult === "模型配置正常"
              ? "#059669" : "#dc2626",
          }}>
          <Wrench size={11} className="flex-shrink-0" />
          <span className="truncate">{repairResult}</span>
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        compact
        bottomRef={bottomRef}
      />

      {/* Banners */}
      <ChatBanners routedTo={routedTo} compact />

      {/* Input area */}
      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onStop={engine.stop}
        isStreaming={isStreaming}
        compact
        routingEnabled={routingEnabled}
        onToggleRouting={toggleRouting}
        onPromptSelect={setInput}
        modelPicker={modelPickerNode}
        voiceButton={
          <MicButton
            provider={currentProvider}
            onAudioReady={handleAudioReady}
            onTextReady={handleTextReady}
            disabled={isStreaming}
          />
        }
      />

      {/* History drawer */}
      {showHistory && (
        <HistoryDrawer currentSessionId={currentSessionId}
          onSelect={handleSelectSession} onNew={handleNewChat}
          onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
