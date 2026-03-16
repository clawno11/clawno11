import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot, ChevronDown, Wifi, WifiOff, RefreshCw, Loader2, Wrench, CheckCircle2,
} from "lucide-react";
import { useInstanceStore } from "../store/instances";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  mountChatWebview, unmountChatWebview, hideChatWebview, resizeChatWebview, repairModelConfig,
} from "../ipc";

export function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances } = useInstanceStore();

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const stored = localStorage.getItem("clawno-last-instance");
    if (stored && instances.some((i) => i.id === stored)) return stored;
    return instances.find((i) => i.health === "online")?.id ?? instances[0]?.id ?? null;
  });
  const [showPicker, setShowPicker] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [mounting, setMounting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);

  const selectedInst = instances.find((i) => i.id === selectedId);
  const isOnline = selectedInst?.health === "online";

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const mountedInstanceRef = useRef<string | null>(null);

  const selectInstance = (id: string) => {
    setSelectedId(id);
    localStorage.setItem("clawno-last-instance", id);
    setShowPicker(false);
  };

  const [debugBounds, setDebugBounds] = useState<string>("");

  const getBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const b = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    setDebugBounds(`x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} w=${b.width.toFixed(0)} h=${b.height.toFixed(0)} dpr=${window.devicePixelRatio}`);
    return b;
  }, []);

  const handleRepair = useCallback(async () => {
    if (!selectedInst) return;
    setRepairing(true);
    setRepairResult(null);
    try {
      const result = await repairModelConfig(selectedInst.port);
      const msg = result.ok
        ? result.detail.includes("no-repair-needed")
          ? "模型配置正常，无需修复"
          : `已修复: ${result.detail}`
        : `修复失败: ${result.detail}`;
      setRepairResult(msg);
      if (result.ok && !result.detail.includes("no-repair-needed")) {
        if (mountedRef.current) {
          await unmountChatWebview().catch(() => {});
          mountedRef.current = false;
          mountedInstanceRef.current = null;
          await new Promise((r) => setTimeout(r, 500));
          const bounds = getBounds();
          if (bounds && bounds.width > 1 && bounds.height > 1) {
            await mountChatWebview(bounds.x, bounds.y, bounds.width, bounds.height);
            mountedRef.current = true;
            mountedInstanceRef.current = selectedId;
          }
        }
      }
      setTimeout(() => setRepairResult(null), 5000);
    } catch (e) {
      setRepairResult(`修复失败: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setRepairResult(null), 5000);
    } finally {
      setRepairing(false);
    }
  }, [selectedInst, selectedId, getBounds]);

  // Mount / show the child webview when the instance goes online
  useEffect(() => {
    if (!isOnline) {
      if (mountedRef.current) {
        unmountChatWebview().catch(() => {});
        mountedRef.current = false;
        mountedInstanceRef.current = null;
      }
      return;
    }

    const instanceChanged = mountedInstanceRef.current !== null
      && mountedInstanceRef.current !== selectedId;

    if (instanceChanged && mountedRef.current) {
      unmountChatWebview().catch(() => {});
      mountedRef.current = false;
      mountedInstanceRef.current = null;
    }

    let cancelled = false;

    const doMount = async () => {
      await new Promise((r) => requestAnimationFrame(r));
      if (cancelled) return;

      const bounds = getBounds();
      if (!bounds || bounds.width < 1 || bounds.height < 1) return;

      setMounting(true);
      setMountError(null);
      try {
        await mountChatWebview(bounds.x, bounds.y, bounds.width, bounds.height);
        if (!cancelled) {
          mountedRef.current = true;
          mountedInstanceRef.current = selectedId;
        }
      } catch (e) {
        if (!cancelled) setMountError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setMounting(false);
      }
    };

    doMount();

    return () => { cancelled = true; };
  }, [isOnline, selectedId, getBounds]);

  // Sync child webview size on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (!mountedRef.current) return;
      const bounds = getBounds();
      if (!bounds) return;
      resizeChatWebview(bounds.x, bounds.y, bounds.width, bounds.height);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [getBounds]);

  // Hide (not destroy) when leaving the page
  useEffect(() => {
    return () => {
      if (mountedRef.current) {
        hideChatWebview().catch(() => {});
      }
    };
  }, []);

  // ── Empty state: no instances deployed ─────────────────────────────────

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

  // ── Normal state ───────────────────────────────────────────────────────

  return (
    <div className="page-enter flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.02)" }}>
        <Bot size={16} style={{ color: "hsl(var(--primary))" }} />
        <span className="font-semibold text-sm flex-1 truncate">{t("chat.title")}</span>

        {/* Repair model button */}
        {isOnline && (
          <button
            onClick={handleRepair}
            disabled={repairing}
            title="修复模型配置（模型报错时点击）"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-amber-50 disabled:opacity-50"
            style={{ border: "1px solid rgba(245,158,11,0.3)", color: "#d97706" }}>
            {repairing
              ? <Loader2 size={12} className="animate-spin" />
              : <Wrench size={12} />}
            <span className="hidden sm:inline">{repairing ? "修复中..." : "修复模型"}</span>
          </button>
        )}

        {/* Instance picker */}
        <div className="relative">
          <button onClick={() => setShowPicker((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.05)" }}>
            {isOnline
              ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              : <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
            <span className="font-mono max-w-[180px] truncate">{selectedInst?.httpUrl ?? "—"}</span>
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
                <button key={inst.id} onClick={() => selectInstance(inst.id)}
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

      {/* Repair result toast */}
      {repairResult && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs flex-shrink-0 animate-in fade-in"
          style={{
            background: repairResult.includes("失败") ? "rgba(239,68,68,0.06)" : "rgba(16,185,129,0.06)",
            border: `1px solid ${repairResult.includes("失败") ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
            color: repairResult.includes("失败") ? "#dc2626" : "#059669",
          }}>
          {repairResult.includes("失败")
            ? <Wrench size={12} className="flex-shrink-0" />
            : <CheckCircle2 size={12} className="flex-shrink-0" />}
          <span className="flex-1">{repairResult}</span>
        </div>
      )}

      {/* OpenClaw embedded area — child webview is overlaid on top of this div */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {mounting && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2 z-0">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">正在加载 OpenClaw...</span>
          </div>
        )}
        {mountError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-0 px-8">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}>
              {mountError}
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              请确认 OpenClaw 网关已启动并运行
            </p>
          </div>
        )}
      </div>

      {showPicker && <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />}
      {debugBounds && (
        <div className="fixed bottom-2 right-2 bg-black/80 text-green-400 text-[10px] font-mono px-2 py-1 rounded z-[9999] pointer-events-none">
          {debugBounds}
        </div>
      )}
    </div>
  );
}
