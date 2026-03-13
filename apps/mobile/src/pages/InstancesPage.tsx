/**
 * InstancesPage — mobile version.
 * Shows all configured remote instances with health status.
 * Supports remote AI provider configuration via the desktop chat proxy.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Server, RefreshCw, Trash2, MessageSquare,
  Plus, Zap, KeyRound, CircleAlert,
} from "lucide-react";
// Mobile uses window.open for external URLs (no plugin-shell dependency)
import { useTranslation } from "react-i18next";
import { HealthBadge } from "@clawno/shared/components/common/HealthBadge";
import { ConfigureAIPanel } from "@clawno/shared/components/ai/ConfigureAIPanel";
import { useInstanceStore } from "../store/instances";
import { useAiConfigStore } from "../store/aiConfig";
import {
  probeInstanceHealth,
  discoverChatProxy,
  proxyFetchProviders,
  proxyConfigureApiKey,
} from "../ipc";
import type { ProxyDiscovery } from "../ipc";
import { TopBar } from "../components/TopBar";
import { useNavigate } from "react-router-dom";

export function InstancesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances, remove, setHealth } = useInstanceStore();
  const { configured, isConfigured, markConfigured } = useAiConfigStore();
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showConfigAI, setShowConfigAI] = useState<string | null>(null);
  const [proxyInfo, setProxyInfo] = useState<Record<string, ProxyDiscovery>>({});

  const probeOne = useCallback(async (id: string, httpUrl: string) => {
    setProbing((p) => new Set([...p, id]));
    try {
      const result = await probeInstanceHealth(httpUrl);
      setHealth(id, result.online ? "online" : "offline", result.online ? result.latency_ms : undefined);
    } catch {
      setHealth(id, "offline");
    } finally {
      setProbing((p) => { const s = new Set(p); s.delete(id); return s; });
    }
  }, [setHealth]);

  const probeAll = useCallback(() => {
    instances.forEach((inst) => probeOne(inst.id, inst.httpUrl));
  }, [instances, probeOne]);

  useEffect(() => {
    if (instances.length > 0) probeAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Discover chat proxy via Rust-side HTTP (bypasses WebView CORS)
  useEffect(() => {
    let cancelled = false;
    instances.forEach(async (inst) => {
      if (proxyInfo[inst.id]) return;
      try {
        const discovery = await discoverChatProxy(inst.gatewayUrl || inst.httpUrl);
        if (!cancelled && discovery.found) {
          setProxyInfo((prev) => ({ ...prev, [inst.id]: discovery }));
          // Sync configured providers from desktop
          try {
            const providers = await proxyFetchProviders(discovery.proxy_url, discovery.token);
            providers.forEach((p) => markConfigured(p));
          } catch { /* non-critical */ }
        }
      } catch { /* discovery failed */ }
    });
    return () => { cancelled = true; };
  }, [instances, proxyInfo, markConfigured]);

  const makeConfigure = useCallback((instId: string) => {
    return async (provider: string, key: string): Promise<{ ok: boolean; detail: string }> => {
      const info = proxyInfo[instId];
      if (!info?.found) return { ok: false, detail: "无法连接桌面实例（chat proxy 未发现）" };
      try {
        return await proxyConfigureApiKey(info.proxy_url, info.token, provider, key);
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    };
  }, [proxyInfo]);

  const handleOpenUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener");
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={t("instances.title")}
        subtitle={t("instances.desc")}
        right={
          <button
            onClick={probeAll}
            className="touch-btn p-2 rounded-full text-[hsl(var(--muted-foreground))]"
          >
            <RefreshCw size={18} />
          </button>
        }
      />

      <div className="flex-1 scrollable p-4 space-y-3 pb-6">
        {instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}>
              <Server size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
            </div>
            <div>
              <p className="font-semibold text-[hsl(var(--foreground))]/70 mb-1">{t("instances.empty")}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("instances.goToConnect")}
              </p>
            </div>
            <button
              onClick={() => navigate("/connect")}
              className="touch-btn flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
              style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
            >
              <Plus size={16} /> {t("instances.addServer")}
            </button>
          </div>
        ) : (
          instances.map((inst) => {
            const isProbng = probing.has(inst.id);
            const isOnline = inst.health === "online";
            const isOffline = inst.health === "offline";
            const isConfigOpen = showConfigAI === inst.id;
            const hasAI = configured.length > 0;

            return (
              <div
                key={inst.id}
                className="rounded-2xl border bg-[hsl(var(--card))] overflow-hidden"
                style={{
                  borderColor: isOnline ? "rgba(16,185,129,0.25)" : isOffline ? "rgba(239,68,68,0.2)" : "rgba(6,182,212,0.15)",
                }}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isOnline ? "rgba(16,185,129,0.1)" : "rgba(6,182,212,0.08)",
                      border: `1px solid ${isOnline ? "rgba(16,185,129,0.25)" : "rgba(6,182,212,0.15)"}`,
                    }}>
                    <Server size={16} style={{ color: isOnline ? "#10b981" : "hsl(var(--primary))" }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{inst.name}</p>
                    <p className="text-[11px] font-mono text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                      {inst.httpUrl}
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    <HealthBadge
                      health={isProbng ? "probing" : inst.health}
                      latencyMs={inst.latencyMs}
                    />
                  </div>
                </div>

                {/* 未配置 AI 引导横幅 */}
                {isOnline && !hasAI && !isConfigOpen && (
                  <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <CircleAlert size={13} className="flex-shrink-0 text-amber-500" />
                    <span className="flex-1">{t("instances.ai.title")}</span>
                    <button
                      onClick={() => setShowConfigAI(inst.id)}
                      className="flex-shrink-0 font-medium text-amber-700 underline underline-offset-2"
                    >
                      {t("instances.actions.configureAI")}
                    </button>
                  </div>
                )}

                {/* Configure AI panel */}
                {isConfigOpen && (
                  <ConfigureAIPanel
                    onClose={() => setShowConfigAI(null)}
                    onConfigure={makeConfigure(inst.id)}
                    onOpenUrl={handleOpenUrl}
                    configured={configured}
                    isConfigured={isConfigured}
                    markConfigured={markConfigured}
                    compact
                  />
                )}

                {/* Actions */}
                <div className="flex border-t border-[hsl(var(--border))]/60">
                  <button
                    onClick={() => probeOne(inst.id, inst.httpUrl)}
                    className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-[hsl(var(--muted-foreground))] border-r border-[hsl(var(--border))]/60"
                  >
                    <Zap size={12} /> {t("instances.probe")}
                  </button>

                  <button
                    onClick={() => setShowConfigAI(isConfigOpen ? null : inst.id)}
                    className={`touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs border-r border-[hsl(var(--border))]/60 ${
                      isConfigOpen ? "text-[hsl(var(--primary))] font-semibold"
                        : hasAI ? "text-[hsl(var(--muted-foreground))]"
                        : "text-amber-600 font-semibold"
                    }`}
                  >
                    <KeyRound size={12} />
                    {t("instances.actions.configureAI")}
                    {!hasAI && (
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                    )}
                    {hasAI && (
                      <span className="text-[9px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1 font-medium">
                        {configured.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => { navigate("/chat"); }}
                    className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-[hsl(var(--primary))] border-r border-[hsl(var(--border))]/60"
                  >
                    <MessageSquare size={12} /> {t("instances.chat")}
                  </button>
                  {deleteConfirm === inst.id ? (
                    <button
                      onClick={() => { remove(inst.id); setDeleteConfirm(null); }}
                      className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-red-600 font-semibold"
                    >
                      {t("instances.confirmDelete")}
                    </button>
                  ) : (
                    <button
                      onClick={() => { setDeleteConfirm(inst.id); setTimeout(() => setDeleteConfirm(null), 3000); }}
                      className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-[hsl(var(--muted-foreground))]"
                    >
                      <Trash2 size={12} /> {t("instances.actions.delete")}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
