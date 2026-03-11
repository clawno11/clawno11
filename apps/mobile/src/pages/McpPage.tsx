import { useState, useEffect, useCallback } from "react";
import { TopBar } from "../components/TopBar";
import {
  Puzzle, Plus, Trash2, ShieldCheck, ShieldAlert, ShieldX,
  Shield, RefreshCw, Loader, AlertTriangle, CheckCircle2,
  ChevronDown, ClipboardList, Server, Terminal, Radio, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listServers, addServer, toggleServer, deleteServer, scanServer,
  listAuditEntries, clearAuditLog,
  type McpServer, type McpAuditEntry, type Transport, type RiskLevel,
} from "../store/mcpStore";

// ── Risk badge ─────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<RiskLevel, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  safe:    { icon: ShieldCheck,  color: "text-green-600",  bg: "bg-green-500/8",  border: "border-green-500/30" },
  caution: { icon: ShieldAlert,  color: "text-amber-600",  bg: "bg-amber-500/8",  border: "border-amber-500/30" },
  danger:  { icon: ShieldX,      color: "text-red-600",    bg: "bg-red-500/8",    border: "border-red-500/30"   },
  unknown: { icon: Shield,       color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border"     },
};

function RiskBadge({ level }: { level: RiskLevel }) {
  const { t } = useTranslation();
  const cfg = RISK_CONFIG[level];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon size={11} />
      {t(`mcp.risk.${level}`)}
    </span>
  );
}

const TRANSPORT_ICONS: Record<Transport, React.ElementType> = {
  http:  Server,
  sse:   Radio,
  stdio: Terminal,
};

/** Format a timestamp for the audit table: show only time when same-day, otherwise full date+time. */
function formatAuditTime(ts: number): string {
  const d = new Date(ts);
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? d.toLocaleTimeString() : d.toLocaleString();
}

// ── Add server form ────────────────────────────────────────────────────────

function AddServerForm({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [transport, setTransport] = useState<Transport>("http");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!name.trim() || !endpoint.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addServer(name.trim(), endpoint.trim(), transport);
      setName(""); setEndpoint(""); setTransport("http");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        <Plus size={15} /> {t("mcp.addServer")}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("mcp.addServer")}</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("mcp.form.name")}</label>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("mcp.form.namePlaceholder")}
            className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("mcp.form.transport")}</label>
          <div className="relative">
            <select
              value={transport} onChange={(e) => setTransport(e.target.value as Transport)}
              className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
            >
              <option value="http">HTTP / REST</option>
              <option value="sse">SSE (Server-Sent Events)</option>
              <option value="stdio">Stdio (Local Process)</option>
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("mcp.form.endpoint")}</label>
        <input
          value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          placeholder={transport === "stdio" ? "npx -y @modelcontextprotocol/server-xxx" : "http://localhost:3000"}
          className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">
          {t("common.cancel")}
        </button>
        <button onClick={handleAdd} disabled={saving || !name.trim() || !endpoint.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving && <Loader size={13} className="animate-spin" />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

// ── Server card ────────────────────────────────────────────────────────────

function ServerCard({
  server,
  onToggle, onDelete, onScan,
}: {
  server: McpServer;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  /** Called after a scan completes; parent should reload server list from DB. */
  onScan: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const TransportIcon = TRANSPORT_ICONS[server.transport];

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      await scanServer(server);
      // Reload from DB so factors and riskLevel reflect the persisted result.
      await onScan();
    } catch (err) {
      setScanError(String(err));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-3 transition-colors ${
      !server.enabled ? "opacity-60" : ""
    } ${RISK_CONFIG[server.riskLevel].border}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <TransportIcon size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{server.name}</p>
            <RiskBadge level={server.riskLevel} />
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">
              {server.transport.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{server.endpoint}</p>
        </div>
        {/* Enable toggle */}
        <button
          onClick={() => onToggle(server.id, !server.enabled)}
          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
            server.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[hsl(var(--card))] shadow transition-all ${
            server.enabled ? "left-[18px]" : "left-0.5"
          }`} />
        </button>
      </div>

      {/* Risk factors — sourced from DB-persisted server.factors, survive page reloads */}
      {server.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {server.factors.map((f) => (
            <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${RISK_CONFIG[server.riskLevel].color} ${RISK_CONFIG[server.riskLevel].bg} ${RISK_CONFIG[server.riskLevel].border}`}>
              {t(`mcp.factors.${f}`, { defaultValue: f })}
            </span>
          ))}
        </div>
      )}

      {/* Last scanned */}
      {server.lastScanned && (
        <p className="text-[10px] text-muted-foreground">
          {t("mcp.lastScanned")}: {new Date(server.lastScanned).toLocaleString()}
        </p>
      )}

      {/* Scan error inline */}
      {scanError && (
        <p className="text-[10px] text-red-500 flex items-center gap-1">
          <AlertTriangle size={10} /> {scanError}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/50">
        <button
          onClick={handleScan} disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted/50 disabled:opacity-50 transition-colors"
        >
          {scanning
            ? <Loader size={12} className="animate-spin" />
            : <RefreshCw size={12} />}
          {t("mcp.scan")}
        </button>

        <div className="flex-1" />

        {confirming ? (
          <>
            <span className="text-xs text-red-500">{t("rag.confirmDelete")}</span>
            <button onClick={() => { onDelete(server.id); setConfirming(false); }}
              className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 transition-colors">
              {t("common.confirm")}
            </button>
            <button onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded text-xs border border-border hover:bg-muted/50 transition-colors">
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Audit log tab ──────────────────────────────────────────────────────────

const OUTCOME_CONFIG = {
  allowed: { color: "text-green-600",  icon: CheckCircle2  },
  blocked: { color: "text-red-600",    icon: ShieldX       },
  error:   { color: "text-amber-600",  icon: AlertTriangle },
};

function AuditTab() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<McpAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setEntries(await listAuditEntries()); }
    catch (err) { setLoadError(String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearing(true);
    setConfirmClear(false);
    try { await clearAuditLog(); setEntries([]); }
    finally { setClearing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("mcp.auditDesc")}</p>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted/50 disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t("common.refresh")}
          </button>
          {entries.length > 0 && (
            confirmClear ? (
              <>
                <span className="self-center text-xs text-red-500">{t("mcp.clearLogConfirm")}</span>
                <button onClick={handleClear} disabled={clearing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs hover:bg-red-600 disabled:opacity-50 transition-colors">
                  {clearing ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {t("common.confirm")}
                </button>
                <button onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted/50 transition-colors">
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-xs hover:bg-red-50 transition-colors">
                <Trash2 size={12} />
                {t("mcp.clearLog")}
              </button>
            )
          )}
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
          <AlertTriangle size={14} />
          <span>{loadError}</span>
          <button onClick={load} className="ml-auto text-xs underline hover:no-underline">
            {t("common.retry")}
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 rounded-xl border border-dashed border-border text-muted-foreground text-sm">
          <ClipboardList size={24} className="mb-2 opacity-30" />
          {t("mcp.auditEmpty")}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                {["mcp.col.time", "mcp.col.server", "mcp.col.tool", "mcp.col.args", "mcp.col.outcome"].map((k) => (
                  <th key={k} className="px-3 py-2 text-left font-medium text-muted-foreground">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => {
                const cfg = OUTCOME_CONFIG[e.outcome] ?? OUTCOME_CONFIG.allowed;
                const Icon = cfg.icon;
                return (
                  <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {formatAuditTime(e.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium">{e.serverName || "—"}</td>
                    <td className="px-3 py-2 font-mono">{e.toolName}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                      {e.argsPreview || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 font-medium ${cfg.color}`}>
                        <Icon size={11} />
                        {t(`mcp.outcome.${e.outcome}`)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

type Tab = "servers" | "audit";

export function McpPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("servers");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setServers(await listServers()); }
    catch (err) { setLoadError(String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Toggle enabled state with optimistic update and rollback on failure. */
  const handleToggle = async (id: string, enabled: boolean) => {
    setServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
    try {
      await toggleServer(id, enabled);
    } catch {
      setServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled: !enabled } : s));
    }
  };

  /** Delete with optimistic removal and rollback on failure. */
  const handleDelete = async (id: string) => {
    const snapshot = servers;
    setServers((prev) => prev.filter((s) => s.id !== id));
    try {
      await deleteServer(id);
    } catch {
      setServers(snapshot);
    }
  };

  /** Reload server list from DB after a scan (picks up persisted risk + factors). */
  const handleScanDone = useCallback(async () => {
    try {
      setServers(await listServers());
    } catch (err) {
      // Non-fatal: scan result is already persisted; surface the reload failure
      // through the main load error banner by re-running the full load.
      console.error("[MCP] post-scan reload failed:", err);
      load();
    }
  }, [load]);

  const riskSummary = {
    safe:    servers.filter((s) => s.riskLevel === "safe").length,
    caution: servers.filter((s) => s.riskLevel === "caution").length,
    danger:  servers.filter((s) => s.riskLevel === "danger").length,
    unknown: servers.filter((s) => s.riskLevel === "unknown").length,
  };

  return (
    <div className="flex flex-col h-full">
    <TopBar title={t("mcp.title")} subtitle={t("mcp.desc")} back />
    <div className="flex-1 scrollable p-4 space-y-4 pb-6">
      {/* Refresh row */}
      <div className="flex justify-end">
        <button onClick={load} disabled={loading}
          className="touch-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[hsl(var(--border))] text-sm">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {t("common.refresh")}
        </button>
      </div>

      {/* Load error banner */}
      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
          <AlertTriangle size={14} />
          <span>{loadError}</span>
          <button onClick={load} className="ml-auto text-xs underline hover:no-underline">
            {t("common.retry")}
          </button>
        </div>
      )}

      {/* Risk summary strip — shows all 4 levels including unscanned servers */}
      {servers.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {(["safe", "caution", "danger", "unknown"] as const).map((level) => {
            const cfg = RISK_CONFIG[level];
            const Icon = cfg.icon;
            return (
              <div key={level} className={`flex items-center gap-2 p-3 rounded-xl border ${cfg.border} ${cfg.bg}`}>
                <Icon size={16} className={cfg.color} />
                <div>
                  <p className={`text-lg font-bold leading-none ${cfg.color}`}>{riskSummary[level]}</p>
                  <p className="text-xs text-muted-foreground">{t(`mcp.risk.${level}`)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/40 w-fit">
        {([["servers", t("mcp.tabServers")], ["audit", t("mcp.tabAudit")]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "servers" ? (
        <div className="space-y-4">
          <AddServerForm onAdded={load} />

          {servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 rounded-xl border border-dashed border-border text-muted-foreground text-sm">
              <Puzzle size={24} className="mb-2 opacity-30" />
              {t("mcp.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <ServerCard
                  key={s.id} server={s}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onScan={handleScanDone}
                />
              ))}
            </div>
          )}

          {/* Info box */}
          <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground leading-relaxed">
            <Puzzle size={14} className="flex-shrink-0 mt-0.5 text-primary" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">{t("mcp.whatIsMcp")}</p>
              {(t("mcp.mcpDesc", { returnObjects: true }) as string[]).map((line, i) => (
                <p key={i}>• {line}</p>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <AuditTab />
      )}
    </div>
    </div>
  );
}
