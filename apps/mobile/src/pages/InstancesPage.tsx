/**
 * InstancesPage — mobile version.
 * Shows all configured remote instances with health status.
 * No local deploy/pm2 controls; management is done on the desktop.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Server, Wifi, WifiOff, RefreshCw, Trash2, MessageSquare,
  AlertCircle, Plus, Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstanceStore } from "../store/instances";
import { probeInstanceHealth } from "../ipc";
import { TopBar } from "../components/TopBar";
import { useNavigate } from "react-router-dom";

export function InstancesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances, remove, setHealth } = useInstanceStore();
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  // Auto-probe on mount
  useEffect(() => {
    if (instances.length > 0) probeAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

            return (
              <div
                key={inst.id}
                className="rounded-2xl border bg-white overflow-hidden"
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

                  {/* Health badge */}
                  <div className="flex-shrink-0">
                    {isProbng ? (
                      <span className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                        <RefreshCw size={12} className="animate-spin" />
                        {t("instances.health.unknown")}
                      </span>
                    ) : isOnline ? (
                      <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
                        <Wifi size={12} />
                        {t("instances.health.online")}
                        {inst.latencyMs !== undefined && (
                          <span className="text-[10px] font-mono opacity-70">{inst.latencyMs}ms</span>
                        )}
                      </span>
                    ) : isOffline ? (
                      <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                        <WifiOff size={12} />
                        {t("instances.health.offline")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                        <AlertCircle size={12} />
                        {t("instances.health.unknown")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex border-t border-[hsl(var(--border))]/60">
                  <button
                    onClick={() => probeOne(inst.id, inst.httpUrl)}
                    className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-[hsl(var(--muted-foreground))] border-r border-[hsl(var(--border))]/60"
                  >
                    <Zap size={12} /> {t("instances.probe")}
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
