import { useState, useCallback } from "react";
import {
  Server, ExternalLink, Trash2, RotateCcw, PowerOff,
  HardDrive, Globe, Clock, Play, Loader, AlertCircle,
  CheckCircle, KeyRound, ChevronDown, CircleAlert, RefreshCw,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { HealthBadge } from "@clawno/shared/components/common/HealthBadge";
import { ConfigureAIPanel } from "@clawno/shared/components/ai/ConfigureAIPanel";
import { useTranslation } from "react-i18next";
import { useAiConfigStore } from "../../store/aiConfig";
import { configureApiKey } from "../../ipc";
import type { ClawInstance } from "../../store/instances";
import type { CardAction } from "./types";

export function InstanceCard({
  inst,
  onRefresh,
  onOpen,
  onStop,
  onStart,
  onRestart,
  onRemove,
}: {
  inst: ClawInstance;
  onRefresh: () => void;
  onOpen: () => void;
  onStop: () => Promise<{ ok: boolean; msg: string }>;
  onStart: () => Promise<{ ok: boolean; msg: string }>;
  onRestart: () => Promise<{ ok: boolean; msg: string }>;
  onRemove: () => void;
}) {
  const [action, setAction] = useState<CardAction>("idle");
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showConfigAI, setShowConfigAI] = useState(false);
  const { configured, isConfigured, markConfigured } = useAiConfigStore();
  const hasAI = configured.length > 0;

  const deployedDate = new Date(inst.deployedAt).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const withFeedback = async (
    kind: "starting" | "restarting" | "stopping",
    fn: () => Promise<{ ok: boolean; msg: string } | void>,
  ) => {
    setAction(kind);
    setActionResult(null);
    try {
      const result = await fn();
      if (result && typeof result === "object") {
        setActionResult(result);
      }
    } catch (e) {
      setActionResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setAction("idle");
    }
  };

  const { t } = useTranslation();
  const actionLabel: Record<CardAction, string> = {
    idle: "",
    starting: t("instances.status.starting"),
    restarting: t("instances.status.restarting"),
    stopping: t("instances.status.stopping"),
  };

  const isOffline = inst.health === "offline";

  const handleConfigure = useCallback(async (provider: string, key: string) => {
    const res = await configureApiKey(provider, key);
    return { ok: res.ok, detail: res.detail };
  }, []);

  const handleOpenUrl = useCallback((url: string) => {
    open(url);
  }, []);

  return (
    <div className="card-enter rounded-2xl overflow-hidden"
      style={{
        background: "white",
        border: `1px solid ${isOffline ? "rgba(239,68,68,0.2)" : "rgba(6,182,212,0.15)"}`,
        boxShadow: isOffline
          ? "0 1px 8px rgba(239,68,68,0.06)"
          : "0 1px 12px rgba(6,182,212,0.08), 0 0 0 0 transparent",
      }}
    >
      {/* header */}
      <div className="flex items-center gap-3.5 px-4 py-3.5 border-b"
        style={{ borderColor: isOffline ? "rgba(239,68,68,0.12)" : "rgba(6,182,212,0.1)" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: isOffline ? "rgba(239,68,68,0.06)" : "rgba(6,182,212,0.1)" }}>
          {inst.kind === "local"
            ? <HardDrive size={20} style={{ color: isOffline ? "#f87171" : "hsl(var(--primary))" }} />
            : <Globe     size={20} style={{ color: isOffline ? "#f87171" : "hsl(var(--primary))" }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{inst.name}</p>
          <p className="font-mono truncate" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{inst.uiUrl}</p>
        </div>
        <HealthBadge health={inst.health} {...(inst.latencyMs !== undefined ? { latencyMs: inst.latencyMs } : {})} />
      </div>

      {/* meta */}
      <div className="px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1"
        style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
        <span className="flex items-center gap-1.5">
          <Server size={10} />
          <span>Gateway </span>
          <span className="font-mono">:{inst.port}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Globe size={10} />
          <span className="font-mono">127.0.0.1:{inst.port}</span>
        </span>
        <span className="flex items-center gap-1.5 col-span-2">
          <Clock size={10} /> {deployedDate}
        </span>
      </div>

      {/* action feedback */}
      {action !== "idle" && (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-xs text-primary">
          <Loader size={12} className="animate-spin" />
          {actionLabel[action]}
        </div>
      )}
      {actionResult && action === "idle" && (
        <div className={`mx-4 mb-2 flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
          actionResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {actionResult.ok
            ? <CheckCircle size={12} className="mt-0.5 flex-shrink-0" />
            : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
          <span>{actionResult.msg}</span>
        </div>
      )}

      {/* 未配置 AI 引导横幅 — 服务在线时才显示 */}
      {!isOffline && !hasAI && !showConfigAI && (
        <div className="mx-4 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <CircleAlert size={13} className="flex-shrink-0 text-amber-500" />
          <span className="flex-1">{t("instances.ai.title")}</span>
          <button
            onClick={() => setShowConfigAI(true)}
            className="flex-shrink-0 flex items-center gap-1 font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            {t("instances.actions.configureAI")} <ChevronDown size={11} className="-rotate-90" />
          </button>
        </div>
      )}


      {/* Configure AI panel */}
      {showConfigAI && (
        <ConfigureAIPanel
          onClose={() => setShowConfigAI(false)}
          onConfigure={handleConfigure}
          onOpenUrl={handleOpenUrl}
          configured={configured}
          isConfigured={isConfigured}
          markConfigured={markConfigured}
        />
      )}

      {/* actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t"
        style={{ borderColor: "rgba(6,182,212,0.1)", background: "rgba(6,182,212,0.02)" }}>
        <button
          onClick={onOpen}
          disabled={isOffline}
          title={t("instances.actions.openBrowser")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: isOffline ? "#94a3b8" : "hsl(var(--primary))",
            boxShadow: isOffline ? "none" : "0 0 10px rgba(6,182,212,0.35)",
          }}
        >
          <ExternalLink size={13} /> {t("instances.actions.openBrowser")}
        </button>

        <button
          onClick={() => setShowConfigAI((v) => !v)}
          title={t("instances.actions.configureAI")}
          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
            showConfigAI
              ? "border-primary/50 bg-primary/10 text-primary"
              : hasAI
                ? "border-border hover:bg-accent"
                : "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
        >
          <KeyRound size={13} />
          {t("instances.actions.configureAI")}
          {!hasAI && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange-500" />
          )}
          {hasAI && (
            <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1 font-medium">
              {configured.length}
            </span>
          )}
        </button>

        <button
          onClick={onRefresh}
          title={t("instances.actions.checkHealth")}
          disabled={action !== "idle"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} />
        </button>


        {inst.kind === "local" && (
          <>
            {isOffline ? (
              <button
                onClick={() => withFeedback("starting", onStart)}
                disabled={action !== "idle"}
                title={t("instances.actions.start")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-green-400 text-green-600 text-xs hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                {action === "starting" ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
                <span>{action === "starting" ? t("instances.status.starting") : t("instances.actions.start")}</span>
              </button>
            ) : (
              <button
                onClick={() => withFeedback("restarting", onRestart)}
                disabled={action !== "idle"}
                title={t("instances.actions.restart")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors disabled:opacity-40"
              >
                {action === "restarting" ? <Loader size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                <span>{action === "restarting" ? t("instances.status.restarting") : t("instances.actions.restart")}</span>
              </button>
            )}

            <button
              onClick={() => withFeedback("stopping", onStop)}
              disabled={action !== "idle" || isOffline}
              title={t("instances.actions.stop")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-40"
            >
              {action === "stopping" ? <Loader size={13} className="animate-spin" /> : <PowerOff size={13} />}
              <span>{action === "stopping" ? t("instances.status.stopping") : t("instances.actions.stop")}</span>
            </button>
          </>
        )}

        <button
          onClick={onRemove}
          title={t("instances.actions.delete")}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
