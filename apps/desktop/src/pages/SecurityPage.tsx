import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  Activity,
  Wifi,
} from "lucide-react";
import { useInstanceStore } from "../store/instances";
import {
  logSecurityEvent,
  getRecentSecurityEvents,
  clearSecurityEvents,
  type SecurityEvent,
} from "@clawno/shared/securityEventStore";
import { type SecurityReport, type PortConnection } from "./security/types";
import { ScoreRing, ScoreBreakdownPanel } from "./security/SecurityScoreCard";
import { CheckRow, ConnectionRow } from "./security/SecurityChecks";
import { KillSwitchBanner } from "./security/KillSwitchBanner";
import { ToolPermissionPanel } from "./security/ToolPermissions";
import { NetworkAccessPanel } from "./security/NetworkAccessPanel";
import { HardeningPanel } from "./security/HardeningPanel";
import { SecurityEventsPanel } from "./security/SecurityEvents";

export function SecurityPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();

  const activeInstance = instances.find((i) => i.health === "online");
  const activePort = activeInstance?.port ?? 18789;
  const hasActiveInstance = !!activeInstance;

  const [report, setReport] = useState<SecurityReport | null>(null);
  const [connections, setConnections] = useState<PortConnection[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [firewallActive, setFirewallActive] = useState(false);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const evts = await getRecentSecurityEvents(30);
      setEvents(evts);
    } catch { /* non-blocking */ }
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const [rep, conns, fwActive] = await Promise.all([
        invoke<SecurityReport>("scan_security_status", { port: activePort }),
        invoke<PortConnection[]>("get_port_connections", { port: activePort }),
        invoke<boolean>("check_firewall_active", { port: activePort }).catch(() => false),
      ]);
      setReport(rep);
      setConnections(conns);
      setFirewallActive(fwActive as boolean);
      await logSecurityEvent(
        "scan",
        `安全扫描完成，评分：${rep.score} 分，活跃连接：${conns.length}`,
        rep.score < 60 ? "danger" : rep.score < 80 ? "warn" : "info",
      );
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
      await loadEvents();
    }
  }, [activePort, loadEvents]);

  useEffect(() => {
    invoke<boolean>("check_firewall_active", { port: activePort })
      .then(setFirewallActive)
      .catch(() => { /* non-blocking */ });
  }, [activePort]);

  useEffect(() => { runScan(); }, [runScan]);

  const externalConns = connections.filter((c) => !c.is_local && !c.is_listening);

  return (
    <div className="page-enter p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck size={22} className="text-primary" />
            {t("security.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("security.desc", { port: activePort })}
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
          {scanning ? t("security.scanning") : t("security.rescan")}
        </button>
      </div>

      {!hasActiveInstance && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700 flex items-center gap-2">
          <AlertTriangle size={13} className="flex-shrink-0" />
          {t("security.noInstanceWarning", { port: activePort })}
        </div>
      )}

      {scanError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs text-red-700 flex items-center gap-2">
          <ShieldX size={13} className="flex-shrink-0" />
          {t("security.scanError")}: {scanError}
        </div>
      )}

      <KillSwitchBanner
        port={activePort}
        firewallActive={firewallActive}
        onFirewallChange={setFirewallActive}
        onEvent={runScan}
      />

      {/* Score + external connection alert */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className={`rounded-xl border bg-card p-5 flex items-center justify-center transition-colors ${
            report ? "border-border hover:border-primary/40 cursor-pointer" : "border-border"
          }`}
          onClick={report ? () => setShowBreakdown((v) => !v) : undefined}
        >
          {report
            ? <ScoreRing score={report.score} onClick={() => setShowBreakdown((v) => !v)} />
            : <div className="text-sm text-muted-foreground animate-pulse">{t("security.scanning")}</div>
          }
        </div>

        <div className={`md:col-span-2 rounded-xl border p-5 flex flex-col justify-between ${
          externalConns.length > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-green-500/30 bg-green-500/5"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {externalConns.length > 0
              ? <ShieldAlert size={18} className="text-amber-500" />
              : <ShieldCheck size={18} className="text-green-500" />}
            <span className="font-semibold text-sm">
              {externalConns.length > 0
                ? t("security.externalAlert", { count: externalConns.length })
                : t("security.noExternal")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {externalConns.length > 0 ? t("security.externalDesc") : t("security.noExternalDesc")}
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {t("security.activeConns")}<span className="font-semibold text-foreground">{connections.length}</span>
          </div>
        </div>
      </div>

      {showBreakdown && report && (
        <ScoreBreakdownPanel report={report} onClose={() => setShowBreakdown(false)} />
      )}

      <ToolPermissionPanel onEvent={loadEvents} />
      <NetworkAccessPanel port={activePort} onEvent={runScan} />

      {report && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} />
            {t("security.checks")}
            <span className="ml-auto text-xs text-muted-foreground font-normal">{t("security.checksHint")}</span>
          </h2>
          {report.checks.map((c) => (
            <CheckRow key={c.id} check={c} port={activePort} onFixed={runScan} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Wifi size={14} />
          {t("security.wall")}
          <span className="text-xs font-normal text-muted-foreground ml-1">· {t("security.wallSub", { port: activePort })}</span>
        </h2>
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{t("security.noConnections")}</p>
        ) : (
          <div className="space-y-1.5">
            {connections.map((c, i) => (
              <ConnectionRow key={`${c.local_addr}-${c.remote_addr}-${c.pid}-${i}`} conn={c} />
            ))}
          </div>
        )}
      </div>

      <HardeningPanel
        port={activePort}
        firewallActive={firewallActive}
        onFirewallChange={setFirewallActive}
        onRescan={runScan}
        onEvent={loadEvents}
      />

      <SecurityEventsPanel
        events={events}
        onClear={async () => { await clearSecurityEvents(); setEvents([]); }}
      />

    </div>
  );
}
