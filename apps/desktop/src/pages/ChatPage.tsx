import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, ChevronDown, Wifi, WifiOff, RefreshCw,
  History, Plus, Search, Trash2, X, MessageSquare,
  Sparkles, AlertCircle, Cpu,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { PROVIDER_CLOUD_MODELS } from "@clawno/shared/chat/types";
import { relativeDate } from "@clawno/shared/chat/helpers";
import type { SendOptions } from "@clawno/shared/chat/useChatEngine";
import { useChatPageState } from "@clawno/shared/chat/useChatPageState";
import { ChatBanners } from "@clawno/shared/components/chat/ChatBanners";
import { MessageList } from "@clawno/shared/components/chat/MessageList";
import { ChatInput } from "@clawno/shared/components/chat/ChatInput";
import { useInstanceStore } from "../store/instances";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getMainAgentModel, listConfiguredProviders, ollamaListLocalModels, type OllamaModel } from "../ipc";
import { useAiConfigStore } from "../store/aiConfig";
import {
  listSessions, searchSessions, deleteSession, type ChatSession,
} from "@clawno/shared/chatHistory";
import { listRules, matchRule } from "@clawno/shared/modelRouter";

// ── History Sidebar ────────────────────────────────────────────────────────

function HistorySidebar({
  currentSessionId, onSelect, onNew, onClose,
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

  useEffect(() => { load(); }, [load, currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="px-2 py-2 border-b border-border/50">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("history.search")}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      {sidebarError && (
        <div className="mx-2 mt-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[10px]">
          <AlertCircle size={10} className="flex-shrink-0" />{sidebarError}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && !sidebarError && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-1.5">
            <MessageSquare size={18} className="opacity-30" />{t("history.empty")}
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} onClick={() => onSelect(s)}
            className={`group relative px-3 py-2.5 cursor-pointer border-b border-border/40 transition-colors ${
              s.id === currentSessionId ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/40 border-l-2 border-l-transparent"
            }`}>
            <p className="text-xs font-medium truncate leading-snug pr-5">{s.title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {relativeDate(s.updatedAt, t)}
              {s.messageCount !== undefined && ` · ${t("history.msgCount", { count: s.messageCount })}`}
            </p>
            {deleting === s.id ? (
              <button onClick={(e) => handleDelete(e, s.id)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] bg-red-500 text-white">
                {t("common.confirm")}
              </button>
            ) : (
              <button onClick={(e) => {
                e.stopPropagation();
                if (deletingTimerRef.current !== null) clearTimeout(deletingTimerRef.current);
                setDeleting(s.id);
                deletingTimerRef.current = setTimeout(() => { deletingTimerRef.current = null; setDeleting(null); }, 3000);
              }} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all">
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
  } = useChatPageState(instances, {
    defaultGatewayUrl: "http://127.0.0.1:18789",
  });

  // ── Desktop-specific state ─────────────────────────────────────────────

  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Desktop-specific effects ───────────────────────────────────────────

  useEffect(() => {
    const inst = instances.find((i) => i.id === selectedId);
    if (!inst) { setActiveModelInfo(null); return; }
    let cancelled = false;
    const applyFromStr = (modelStr: string) => {
      const slashIdx = modelStr.indexOf("/");
      if (slashIdx > 0) setActiveModelInfo({ provider: modelStr.slice(0, slashIdx), model: modelStr.slice(slashIdx + 1) });
      else setActiveModelInfo({ provider: "openclaw", model: modelStr });
    };
    const fallbackToCliProviders = () =>
      listConfiguredProviders()
        .then((providers) => { if (!cancelled) setActiveModelInfo({ provider: providers[0] ?? configuredProviders[0] ?? "openclaw", model: "main" }); })
        .catch(() => { if (!cancelled) setActiveModelInfo({ provider: configuredProviders[0] ?? "openclaw", model: "main" }); });
    getMainAgentModel(inst.port)
      .then((modelStr) => {
        if (cancelled) return;
        if (modelStr && modelStr !== "default" && modelStr !== "main" && modelStr !== "") applyFromStr(modelStr);
        else return fallbackToCliProviders();
      })
      .catch(() => { if (!cancelled) fallbackToCliProviders(); });
    return () => { cancelled = true; };
  }, [selectedId, instances, configuredProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const load = () => ollamaListLocalModels().then(setLocalModels).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<void>("gateway-restarted", () => setSelectedModel(null)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [input]);

  // ── Route resolution + send ────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const rawContent = input.trim();

    let effectiveGatewayUrl = gatewayUrl;
    let effectiveModel: string | null = null;
    let effectiveInstanceId = selectedId;

    if (selectedModel?.startsWith("cloud:")) {
      const cloudModel = selectedModel.slice(6);
      effectiveModel = cloudModel;
      setRoutedWithTimer(`云端 · ${cloudModel.split("/").slice(1).join("/") || cloudModel}`);
    } else if (selectedModel) {
      effectiveModel = selectedModel;
      effectiveGatewayUrl = "http://localhost:11434";
      effectiveInstanceId = "ollama-local";
      setRoutedWithTimer(`本地 · ${effectiveModel}`);
    } else if (routingEnabled) {
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

    const accepted = await engine.send({
      rawContent,
      gatewayUrl: effectiveGatewayUrl,
      model: effectiveModel,
      instanceId: effectiveInstanceId,
      t,
    } satisfies SendOptions);

    if (accepted) setInput("");
  }, [
    input, isStreaming, gatewayUrl, selectedId, selectedModel,
    routingEnabled, instances, t, engine, setRoutedWithTimer, setInput,
  ]);

  // ── Empty state ────────────────────────────────────────────────────────

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
        <button onClick={() => navigate("/deploy")}
          className="px-5 py-2 rounded-xl text-white text-sm font-semibold"
          style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}>
          {t("chat.goToDeploy")}
        </button>
      </div>
    );
  }

  // ── Desktop model picker ───────────────────────────────────────────────

  const modelPickerNode = (
    <div className="relative flex-shrink-0">
      <button onClick={() => setShowModelPicker((v) => !v)}
        title={selectedModel?.startsWith("cloud:") ? `云端模型：${selectedModel.slice(6)}` : selectedModel ? `本地模型：${selectedModel}` : "模型：自动（OpenClaw）"}
        className={`h-10 flex items-center gap-1.5 px-2.5 rounded-xl text-xs font-medium transition-colors border ${
          selectedModel ? "border-primary/50 bg-primary/8 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border/80"
        }`}>
        {selectedModel?.startsWith("cloud:") ? <Sparkles size={13} /> : selectedModel ? <Cpu size={13} /> : <Bot size={13} />}
        <span className="max-w-[100px] truncate hidden sm:block">
          {selectedModel?.startsWith("cloud:") ? (selectedModel.slice(6).split("/").slice(1).join("/") || selectedModel.slice(6)) : selectedModel ? selectedModel.split(":")[0] : "自动"}
        </span>
        <ChevronDown size={10} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
      </button>
      {showModelPicker && (
        <div className="absolute bottom-full mb-1.5 left-0 w-64 rounded-xl overflow-hidden z-50 max-h-80 overflow-y-auto"
          style={{ border: "1px solid rgba(6,182,212,0.2)", background: "white", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 sticky top-0 bg-white">选择模型</div>
          <button onClick={() => { setSelectedModel(null); setShowModelPicker(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
            style={{ background: !selectedModel ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: !selectedModel ? "2px solid hsl(var(--primary))" : "2px solid transparent" }}>
            <Bot size={13} className="text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0"><p className="font-medium">自动</p><p className="text-[10px] text-muted-foreground">由 OpenClaw 网关决策（默认最省）</p></div>
            {!selectedModel && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
          </button>
          {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">云端模型（本次对话生效）</div>
              {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).map((p) => {
                const info = PROVIDER_CLOUD_MODELS[p]!;
                const key = `cloud:${info.model}`;
                const isActive = selectedModel === key;
                return (
                  <button key={p} onClick={() => { setSelectedModel(key); setShowModelPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
                    style={{ background: isActive ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent" }}>
                    <Sparkles size={13} className="text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0"><p className="font-medium truncate">{info.label}</p></div>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
          {localModels.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 border-y border-border/40">本地模型（Ollama · 无需联网）</div>
              {localModels.map((m) => {
                const isActive = selectedModel === m.name;
                return (
                  <button key={m.name} onClick={() => { setSelectedModel(m.name); setShowModelPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
                    style={{ background: isActive ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent" }}>
                    <Cpu size={13} className="text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0"><p className="font-medium truncate">{m.name}</p><p className="text-[10px] text-muted-foreground">本地运行</p></div>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
          {configuredProviders.filter((p) => PROVIDER_CLOUD_MODELS[p]).length === 0 && localModels.length === 0 && (
            <div className="px-3 py-2.5 text-[11px] text-muted-foreground">暂无可选模型，前往「设置」配置 API Key 或「本地」下载模型</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="page-enter flex h-full overflow-hidden">
      {showHistory && (
        <HistorySidebar
          currentSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onNew={handleNewChat}
          onClose={() => setShowHistory(false)}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.02)" }}>
          <button onClick={() => setShowHistory((v) => !v)} title={t("history.title")}
            className={`p-1.5 rounded-lg transition-colors ${showHistory ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
            <History size={15} />
          </button>
          <button onClick={handleNewChat} title={t("history.newChat")}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors">
            <Plus size={15} />
          </button>
          <Bot size={16} style={{ color: "hsl(var(--primary))" }} />
          <span className="font-semibold text-sm flex-1 truncate">{t("chat.title")}</span>

          {/* Instance picker */}
          <div className="relative">
            <button onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.05)" }}>
              {selectedInst
                ? isOnline
                  ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                : <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />}
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
                      if (inst.id !== selectedId && messages.length > 0 && !window.confirm(t("chat.switchInstanceConfirm"))) return;
                      setSelectedId(inst.id);
                      setShowPicker(false);
                      engine.clear();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                    style={{
                      background: inst.id === selectedId ? "rgba(6,182,212,0.06)" : "transparent",
                      borderLeft: inst.id === selectedId ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                    }}>
                    {inst.health === "online"
                      ? <Wifi size={12} className="text-emerald-500 flex-shrink-0" />
                      : inst.health === "offline"
                        ? <WifiOff size={12} className="text-red-400 flex-shrink-0" />
                        : <RefreshCw size={12} className="text-slate-400 animate-spin flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{inst.name}</p>
                      <p className="font-mono truncate" style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{inst.httpUrl}</p>
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
            <span>{t("chat.instanceOffline", { status: selectedInst.health === "offline" ? t("chat.offline") : t("chat.unknown") })}</span>
          </div>
        )}

        {/* Messages */}
        <MessageList
          messages={messages}
          isOnline={isOnline}
          gatewayUrl={gatewayUrl}
          bottomRef={bottomRef}
        />

        {/* Banners */}
        <ChatBanners routedTo={routedTo} />

        {/* Input area */}
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={engine.stop}
          isStreaming={isStreaming}
          routingEnabled={routingEnabled}
          onToggleRouting={toggleRouting}
          onPromptSelect={setInput}
          textareaRef={textareaRef}
          modelPicker={modelPickerNode}
        />

        {showPicker && <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />}
        {showModelPicker && <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />}
      </div>
    </div>
  );
}
