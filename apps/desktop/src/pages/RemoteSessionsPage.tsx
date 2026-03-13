import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Radio, Trash2, ChevronRight, User, Bot,
  MessageSquare, AlertTriangle,
} from "lucide-react";
import { useRemoteSessionsStore, type RemoteExchange } from "../store/remoteSessions";

interface SessionGroup {
  session_key: string;
  exchanges: RemoteExchange[];
  lastActivity: number;
}

export function RemoteSessionsPage() {
  const { t } = useTranslation();
  const exchanges = useRemoteSessionsStore((s) => s.exchanges);
  const clearStore = useRemoteSessionsStore((s) => s.clear);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const sessionGroups: SessionGroup[] = (() => {
    const map = new Map<string, RemoteExchange[]>();
    for (const ex of exchanges) {
      const key = ex.session_key || "unknown";
      const group = map.get(key);
      if (group) group.push(ex);
      else map.set(key, [ex]);
    }
    return Array.from(map.entries())
      .map(([session_key, exs]) => ({
        session_key,
        exchanges: exs,
        lastActivity: Math.max(...exs.map((e) => e.timestamp)),
      }))
      .sort((a, b) => b.lastActivity - a.lastActivity);
  })();

  const handleClear = useCallback(() => {
    clearStore();
  }, [clearStore]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  return (
    <div className="page-enter flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.02)" }}
      >
        <Radio size={16} style={{ color: "hsl(var(--primary))" }} />
        <span className="font-semibold text-sm flex-1">{t("remoteSessions.title")}</span>

        {exchanges.length > 0 && (
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{ background: "rgba(16,185,129,0.08)", color: "#059669", border: "1px solid rgba(16,185,129,0.2)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("remoteSessions.totalExchanges", { count: exchanges.length })}
          </span>
        )}

        <button
          onClick={handleClear}
          disabled={exchanges.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-red-50 disabled:opacity-30"
          style={{ border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}
        >
          <Trash2 size={12} />
          {t("remoteSessions.clear")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {exchanges.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}
            >
              <Radio size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
            </div>
            <p className="font-semibold text-foreground/70">{t("remoteSessions.empty")}</p>
            <p className="text-sm text-center max-w-xs">{t("remoteSessions.emptyHint")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {sessionGroups.map((group) => {
              const isExpanded = expandedSession === group.session_key;
              const pendingCount = group.exchanges.filter((e) => !e.done).length;
              const errorCount = group.exchanges.filter((e) => e.error).length;

              return (
                <div key={group.session_key}>
                  {/* Session header */}
                  <button
                    onClick={() => setExpandedSession(isExpanded ? null : group.session_key)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                  >
                    <ChevronRight
                      size={14}
                      className={`flex-shrink-0 transition-transform text-muted-foreground ${isExpanded ? "rotate-90" : ""}`}
                    />
                    <MessageSquare size={14} className="flex-shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {group.session_key || t("remoteSessions.unknownSession")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("remoteSessions.exchangeCount", { count: group.exchanges.length })}
                        {" · "}
                        {formatTime(group.lastActivity)}
                      </p>
                    </div>
                    {pendingCount > 0 && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                    )}
                    {errorCount > 0 && (
                      <span
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}
                      >
                        <AlertTriangle size={10} />
                        {errorCount}
                      </span>
                    )}
                  </button>

                  {/* Expanded exchanges */}
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-3">
                      {group.exchanges.map((ex) => (
                        <div
                          key={ex.id}
                          className="rounded-xl overflow-hidden"
                          style={{ border: "1px solid rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.01)" }}
                        >
                          {/* User message */}
                          <div className="flex items-start gap-2.5 px-3.5 py-2.5">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ background: "hsl(var(--primary))" }}
                            >
                              <User size={12} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  {t("remoteSessions.mobileUser")}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">
                                  {formatTime(ex.timestamp)}
                                </span>
                                {ex.model && ex.model !== "main" && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                                    style={{ background: "rgba(6,182,212,0.08)", color: "hsl(var(--primary))" }}
                                  >
                                    {ex.model}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm whitespace-pre-wrap break-words">{ex.user_text}</p>
                            </div>
                          </div>

                          {/* Divider */}
                          <div className="border-t" style={{ borderColor: "rgba(6,182,212,0.08)" }} />

                          {/* Assistant response */}
                          <div className="flex items-start gap-2.5 px-3.5 py-2.5">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ background: "rgba(6,182,212,0.1)" }}
                            >
                              <Bot size={12} style={{ color: "hsl(var(--primary))" }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[11px] font-medium text-muted-foreground mb-1 block">
                                {t("remoteSessions.assistant")}
                              </span>
                              {!ex.done ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                  {t("remoteSessions.streaming")}
                                </div>
                              ) : ex.error ? (
                                <p className="text-sm" style={{ color: "#dc2626" }}>
                                  {t("remoteSessions.error")}: {truncate(ex.error, 200)}
                                </p>
                              ) : (
                                <p className="text-sm whitespace-pre-wrap break-words text-foreground/80">
                                  {truncate(ex.assistant_text, 2000) || (
                                    <span className="text-muted-foreground italic">{t("remoteSessions.noContent")}</span>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
