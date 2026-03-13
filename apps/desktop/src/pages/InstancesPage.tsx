import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Server, RefreshCw } from "lucide-react";
import {
  getBrowserUrl, openInBrowser, startLocalService, uninstallLocalInstance,
} from "../ipc";
import { useTranslation } from "react-i18next";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { probeHealth, translateDetail } from "./instances/types";
import { InstanceCard } from "./instances/InstanceCard";

export function InstancesPage() {
  const navigate = useNavigate();
  const { instances, setHealth, remove } = useInstanceStore();

  const checkAll = useCallback(async () => {
    instances.forEach((i) => setHealth(i.id, "unknown"));
    await Promise.all(
      instances.map(async (inst) => {
        const { health, latencyMs } = await probeHealth(inst);
        setHealth(inst.id, health, latencyMs);
      }),
    );
  }, [instances, setHealth]);

  useEffect(() => {
    const autoHealth = localStorage.getItem("clawno-auto-health");
    const enabled = autoHealth === null ? true : autoHealth === "1";
    if (enabled && instances.length > 0) checkAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — initial probe only

  useEffect(() => {
    const timer = setInterval(() => {
      if (instances.length > 0) checkAll();
    }, 30_000);
    return () => clearInterval(timer);
  }, [checkAll]);

  const handleOpen = async (_inst: ClawInstance) => {
    try {
      const url = await getBrowserUrl();
      await openInBrowser(url);
    } catch (e) {
      console.error("open_in_browser failed:", e);
    }
  };

  const { t } = useTranslation();

  const handleStart = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    const res = await startLocalService(inst.port);
    if (res.ok) {
      setHealth(inst.id, "online");
      return { ok: true, msg: t("instances.status.starting").replace("…", "") };
    } else {
      setHealth(inst.id, "offline");
      return { ok: false, msg: translateDetail(res.detail) };
    }
  };

  const handleRestart = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    setHealth(inst.id, "unknown");
    const { restartLocalService } = await import("../ipc");
    await restartLocalService();
    await new Promise((r) => setTimeout(r, 2500));
    const { health, latencyMs } = await probeHealth(inst);
    setHealth(inst.id, health, latencyMs);
    return health === "online"
      ? { ok: true, msg: t("instances.actions.restart") }
      : { ok: false, msg: t("common.error") };
  };

  const handleStop = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    const { stopLocalService } = await import("../ipc");
    await stopLocalService();
    await new Promise((r) => setTimeout(r, 800));
    setHealth(inst.id, "offline");
    return { ok: true, msg: t("instances.actions.stop") };
  };

  const handleRemove = async (inst: ClawInstance) => {
    if (inst.kind === "local") {
      const confirmed = window.confirm(
        "确认删除本机 OpenClaw 实例？\n\n" +
        "• 服务进程将被停止并卸载\n" +
        "• 历史对话和配置数据（~/.openclaw/）将保留，重新部署后可恢复\n\n" +
        "确认要继续吗？"
      );
      if (!confirmed) return;
      await uninstallLocalInstance();
    }
    remove(inst.id);
  };

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-2xl font-bold tracking-tight">{t("instances.title")}</h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(6,182,212,0.1)", color: "hsl(var(--primary))", border: "1px solid rgba(6,182,212,0.2)" }}>
              OpenClaw
            </span>
          </div>
          <p className="text-muted-foreground text-sm">{t("instances.desc")}</p>
        </div>
        {instances.length > 0 && (
          <button
            onClick={checkAll}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ border: "1px solid rgba(6,182,212,0.3)", color: "hsl(var(--primary))" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(6,182,212,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <RefreshCw size={13} />
            {t("instances.actions.checkHealth")}
          </button>
        )}
      </div>

      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}>
            <Server size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
          </div>
          <p className="text-base font-semibold text-foreground/70">{t("instances.empty")}</p>
          <p className="text-sm mt-1 mb-6">{t("instances.desc")}</p>
          <button
            onClick={() => navigate("/deploy")}
            className="px-5 py-2 rounded-xl text-white text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
          >
            {t("instances.emptyBtn")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              onRefresh={async () => {
                setHealth(inst.id, "unknown");
                const { health, latencyMs } = await probeHealth(inst);
                setHealth(inst.id, health, latencyMs);
              }}
              onOpen={() => handleOpen(inst)}
              onStart={() => handleStart(inst)}
              onStop={() => handleStop(inst)}
              onRestart={() => handleRestart(inst)}
              onRemove={() => handleRemove(inst)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
