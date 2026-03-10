import { useState, useEffect, useCallback } from "react";
import {
  Puzzle, Plus, Trash2, ShieldCheck, ShieldAlert, ShieldX,
  Shield, RefreshCw, Loader, AlertTriangle, CheckCircle2,
  ChevronDown, ClipboardList, Server, Terminal, Radio, X,
  Wrench, Clock, Ban, FileText, Box, Zap, PlugZap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listServers, addServer, toggleServer, deleteServer, scanServer,
  listAuditEntries, clearAuditLog, getServerCallSummary,
  type McpServer, type McpAuditEntry, type McpCallSummary,
  type Transport, type RiskLevel,
} from "../store/mcpStore";
import { listOpenClawPlugins, toggleOpenClawPlugin, type OpenClawPlugin } from "../ipc";

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
  const [description, setDescription] = useState("");
  // "idle" | "saving" | "scanning" — drives button label and disabled state
  const [phase, setPhase] = useState<"idle" | "saving" | "scanning">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!name.trim() || !endpoint.trim()) return;
    setError(null);
    try {
      setPhase("saving");
      const id = await addServer(name.trim(), endpoint.trim(), transport, description);

      // Fix A: immediately scan after add so the server never sits in an
      // unknown+enabled limbo state. Fix B/C are applied inside scanServer.
      setPhase("scanning");
      const newServer: McpServer = {
        id,
        name: name.trim(),
        endpoint: endpoint.trim(),
        transport,
        description,
        enabled: true,
        riskLevel: "unknown",
        factors: [],
        lastScanned: null,
        createdAt: Date.now(),
      };
      await scanServer(newServer);

      setName(""); setEndpoint(""); setTransport("http"); setDescription("");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
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

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t("mcp.form.description")}
          <span className="ml-1 text-muted-foreground/50">{t("mcp.form.descriptionOptional")}</span>
        </label>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t("mcp.form.descriptionPlaceholder")}
          rows={2}
          className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} disabled={phase !== "idle"}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/50 disabled:opacity-40 transition-colors">
          {t("common.cancel")}
        </button>
        <button
          onClick={handleAdd}
          disabled={phase !== "idle" || !name.trim() || !endpoint.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors min-w-[90px] justify-center"
        >
          <Loader size={13} className={phase !== "idle" ? "animate-spin" : "hidden"} />
          {phase === "scanning" ? t("mcp.scanning") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

// ── Server card ────────────────────────────────────────────────────────────

// ── Call summary strip ─────────────────────────────────────────────────────

function CallSummaryStrip({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<McpCallSummary | null>(null);

  useEffect(() => {
    getServerCallSummary(serverId)
      .then(setSummary)
      .catch(() => {});
  }, [serverId]);

  if (!summary || summary.totalCalls === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        {t("mcp.noCallsYet")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Stats row */}
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock size={10} />
          {t("mcp.totalCalls", { count: summary.totalCalls })}
        </span>
        {summary.blockedCalls > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
            <Ban size={10} />
            {t("mcp.blockedCalls", { count: summary.blockedCalls })}
          </span>
        )}
        {summary.lastCallAt && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto">
            <Clock size={10} />
            {new Date(summary.lastCallAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Tool chips */}
      {summary.recentTools.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Wrench size={10} className="text-muted-foreground flex-shrink-0" />
          {summary.recentTools.map((tool) => (
            <span
              key={tool}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 border border-border font-mono text-muted-foreground"
            >
              {tool}
            </span>
          ))}
        </div>
      )}
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

      {/* ── Header ── */}
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
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            server.enabled ? "left-[18px]" : "left-0.5"
          }`} />
        </button>
      </div>

      {/* ── Description ── */}
      {server.description ? (
        <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
          <FileText size={11} className="text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">{server.description}</p>
        </div>
      ) : null}

      {/* ── Risk factors ── */}
      {server.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {server.factors.map((f) => (
            <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${RISK_CONFIG[server.riskLevel].color} ${RISK_CONFIG[server.riskLevel].bg} ${RISK_CONFIG[server.riskLevel].border}`}>
              {t(`mcp.factors.${f}`, { defaultValue: f })}
            </span>
          ))}
        </div>
      )}

      {/* ── Call summary ── */}
      <div className="px-3 py-2 rounded-lg bg-muted/20 border border-border/40 space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          {t("mcp.callActivity")}
        </p>
        <CallSummaryStrip serverId={server.id} />
      </div>

      {/* ── Last scanned ── */}
      {server.lastScanned && (
        <p className="text-[10px] text-muted-foreground">
          {t("mcp.lastScanned")}: {new Date(server.lastScanned).toLocaleString()}
        </p>
      )}

      {/* ── Scan error inline ── */}
      {scanError && (
        <p className="text-[10px] text-red-500 flex items-center gap-1">
          <AlertTriangle size={10} /> {scanError}
        </p>
      )}

      {/* ── Actions ── */}
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

// ── Permission inference helpers ────────────────────────────────────────────

/** Infer capability flags from a plugin's exposed tool names. */
function inferPermissions(toolNames: string[]) {
  const joined = toolNames.join(" ").toLowerCase();
  const hasAny  = (...kws: string[]) => kws.some((k) => joined.includes(k));
  return {
    network: hasAny("fetch", "http", "search", "web", "url", "browser", "scrape", "crawl", "request", "api"),
    fileIO:  hasAny("read", "write", "file", "fs", "path", "dir", "folder", "memory", "document", "storage", "list"),
    shell:   hasAny("exec", "shell", "cmd", "command", "run", "process", "bash", "spawn", "terminal"),
  };
}

/** One cell in the permission matrix. */
function PermCell({ label, granted, icon }: { label: string; granted: boolean; icon: string }) {
  return (
    <div className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border text-center ${
      granted
        ? "bg-amber-500/8 border-amber-400/30 text-amber-600"
        : "bg-muted/30 border-border text-muted-foreground/50"
    }`}>
      <span className="text-base leading-none">{icon}</span>
      <span className="text-[10px] font-medium whitespace-nowrap">{label}</span>
      <span className={`text-[9px] font-bold ${granted ? "text-amber-500" : "text-muted-foreground/40"}`}>
        {granted ? "✓" : "—"}
      </span>
    </div>
  );
}

function PermissionMatrix({ toolNames }: { toolNames: string[] }) {
  const { t } = useTranslation();
  const perms = inferPermissions(toolNames);
  if (toolNames.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 pl-12">
      <PermCell label={t("mcp.perm.network")} granted={perms.network} icon="🌐" />
      <PermCell label={t("mcp.perm.fileIO")}  granted={perms.fileIO}  icon="📁" />
      <PermCell label={t("mcp.perm.shell")}   granted={perms.shell}   icon="⚡" />
    </div>
  );
}

// ── OpenClaw native plugins tab ────────────────────────────────────────────

const ORIGIN_LABEL: Record<string, string> = {
  bundled: "stock",
  npm:     "npm",
  local:   "local",
};

function PluginCard({
  plugin,
  onToggled,
}: {
  plugin: OpenClawPlugin;
  onToggled: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const isLoaded        = plugin.status === "loaded";

  const handleToggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      await toggleOpenClawPlugin(plugin.id, !plugin.enabled);
      onToggled();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-2.5 transition-colors ${
      !plugin.enabled ? "opacity-60" : ""
    } ${isLoaded ? "border-green-500/30" : "border-border"}`}>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isLoaded ? "bg-green-500/10" : "bg-muted/40"
        }`}>
          <Box size={16} className={isLoaded ? "text-green-600" : "text-muted-foreground"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{plugin.name || plugin.id}</p>
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
              isLoaded
                ? "text-green-600 bg-green-500/8 border-green-500/30"
                : "text-muted-foreground bg-muted/30 border-border"
            }`}>
              {isLoaded
                ? <><Zap size={9} />{t("mcp.plugins.statusLoaded")}</>
                : t("mcp.plugins.statusDisabled")}
            </span>
            {/* Origin badge */}
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">
              {ORIGIN_LABEL[plugin.origin] ?? plugin.origin}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {plugin.id}{plugin.version ? ` · v${plugin.version}` : ""}
          </p>
        </div>

        {/* Toggle */}
        <button
          onClick={handleToggle}
          disabled={busy}
          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${
            plugin.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            plugin.enabled ? "left-[18px]" : "left-0.5"
          }`} />
        </button>
      </div>

      {/* Description */}
      {plugin.description && (
        <p className="text-xs text-muted-foreground leading-relaxed pl-12">
          {plugin.description}
        </p>
      )}

      {/* Tool names */}
      {plugin.tool_names.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pl-12">
          <Wrench size={10} className="text-primary flex-shrink-0" />
          {plugin.tool_names.map((tool) => (
            <span key={tool}
              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/8 border border-primary/20 font-mono text-primary">
              {tool}
            </span>
          ))}
        </div>
      )}

      {/* Permission matrix — only shown when plugin has tools */}
      <PermissionMatrix toolNames={plugin.tool_names} />

      {err && (
        <p className="text-[10px] text-red-500 flex items-center gap-1 pl-12">
          <AlertTriangle size={10} /> {err}
        </p>
      )}
    </div>
  );
}

/** Pure display section — state is owned by McpPage and passed in as props. */
function PluginsSection({
  plugins, loading, loadErr, onRetry, onToggled,
}: {
  plugins: OpenClawPlugin[];
  loading: boolean;
  loadErr: string | null;
  onRetry: () => void;
  onToggled: () => void;
}) {
  const { t } = useTranslation();
  const loaded   = plugins.filter((p) => p.status === "loaded");
  const disabled = plugins.filter((p) => p.status !== "loaded");

  return (
    <div className="space-y-3">
      {loadErr && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
          <AlertTriangle size={14} />
          <span>{loadErr}</span>
          <button onClick={onRetry} className="ml-auto text-xs underline">{t("common.retry")}</button>
        </div>
      )}

      {/* Summary strip */}
      {plugins.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-3 rounded-xl border border-green-500/30 bg-green-500/8">
            <Zap size={15} className="text-green-600" />
            <div>
              <p className="text-lg font-bold leading-none text-green-600">{loaded.length}</p>
              <p className="text-xs text-muted-foreground">{t("mcp.plugins.loaded")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-muted/20">
            <Box size={15} className="text-muted-foreground" />
            <div>
              <p className="text-lg font-bold leading-none text-muted-foreground">{disabled.length}</p>
              <p className="text-xs text-muted-foreground">{t("mcp.plugins.available")}</p>
            </div>
          </div>
        </div>
      )}

      {plugins.length === 0 && !loading && !loadErr ? (
        <div className="flex flex-col items-center justify-center h-32 rounded-xl border border-dashed border-border text-muted-foreground text-sm">
          <PlugZap size={22} className="mb-2 opacity-30" />
          {t("mcp.plugins.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {loaded.length > 0 && (
            <>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {t("mcp.plugins.sectionLoaded")}
              </p>
              {loaded.map((p) => <PluginCard key={p.id} plugin={p} onToggled={onToggled} />)}
            </>
          )}
          {disabled.length > 0 && (
            <>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-2">
                {t("mcp.plugins.sectionAvailable")}
              </p>
              {disabled.map((p) => <PluginCard key={p.id} plugin={p} onToggled={onToggled} />)}
            </>
          )}
        </div>
      )}
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

// ── Module-level cache — survives component unmount/remount on navigation ──
//
// McpPage is mounted/unmounted each time the user navigates away and back
// (React Router v6 <Routes> behaviour). We cache the last-fetched data here
// so that revisiting the page is instant. The user must explicitly click
// the Refresh button to re-fetch from the backend.

let _cachedServers: McpServer[]      | null = null;
let _cachedPlugins: OpenClawPlugin[] | null = null;

// ── Main Page ──────────────────────────────────────────────────────────────

type Tab = "overview" | "audit";

export function McpPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");

  // ── Servers state — initialised from cache to avoid flicker on remount ───
  const [servers,     setServers]     = useState<McpServer[]>(_cachedServers ?? []);
  const [serversLoad, setServersLoad] = useState(false);
  const [serversErr,  setServersErr]  = useState<string | null>(null);

  // ── Plugins state — same cache strategy as servers ───────────────────────
  const [plugins,     setPlugins]     = useState<OpenClawPlugin[]>(_cachedPlugins ?? []);
  const [pluginsLoad, setPluginsLoad] = useState(false);
  const [pluginsErr,  setPluginsErr]  = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setServersLoad(true); setServersErr(null);
    try {
      const data = await listServers();
      _cachedServers = data;
      setServers(data);
    }
    catch (err) { setServersErr(String(err)); }
    finally { setServersLoad(false); }
  }, []);

  const loadPlugins = useCallback(async () => {
    setPluginsLoad(true); setPluginsErr(null);
    try {
      const data = await listOpenClawPlugins();
      _cachedPlugins = data;
      setPlugins(data);
    }
    catch (err) { setPluginsErr(String(err)); }
    finally { setPluginsLoad(false); }
  }, []);

  // On mount: fetch only if no cached data exists.
  // On subsequent mounts (navigate-back), cached state is already set above.
  useEffect(() => {
    if (_cachedServers === null) loadServers();
    if (_cachedPlugins === null) loadPlugins();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual refresh triggered by the header button — refreshes everything.
  const handleRefreshAll = useCallback(() => {
    loadServers();
    loadPlugins();
  }, [loadServers, loadPlugins]);

  const isRefreshing = serversLoad || pluginsLoad;

  // ── Server CRUD handlers ─────────────────────────────────────────────────
  const handleToggle = async (id: string, enabled: boolean) => {
    setServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
    try { await toggleServer(id, enabled); }
    catch { setServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled: !enabled } : s)); }
  };

  const handleDelete = async (id: string) => {
    const snap = servers;
    setServers((prev) => prev.filter((s) => s.id !== id));
    try { await deleteServer(id); }
    catch { setServers(snap); }
  };

  const handleScanDone = useCallback(async () => {
    try { setServers(await listServers()); }
    catch { loadServers(); }
  }, [loadServers]);

  const riskSummary = {
    safe:    servers.filter((s) => s.riskLevel === "safe").length,
    caution: servers.filter((s) => s.riskLevel === "caution").length,
    danger:  servers.filter((s) => s.riskLevel === "danger").length,
    unknown: servers.filter((s) => s.riskLevel === "unknown").length,
  };

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Puzzle size={22} className="text-primary" />
            {t("mcp.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("mcp.desc")}</p>
        </div>
        {/* Single refresh button refreshes both plugins and servers */}
        <button onClick={handleRefreshAll} disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50">
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          {t("common.refresh")}
        </button>
      </div>

      {/* ── Tabs (2 only) ── */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/40 w-fit">
        {([
          ["overview", t("mcp.tabOverview")],
          ["audit",    t("mcp.tabAudit")],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === "overview" ? (
        <div className="space-y-8">

          {/* ── Section A: OpenClaw native plugins ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <PlugZap size={15} className="text-primary" />
              <h2 className="text-sm font-semibold">{t("mcp.sectionPlugins")}</h2>
              <span className="text-xs text-muted-foreground">{t("mcp.sectionPluginsHint")}</span>
            </div>
            <PluginsSection
              plugins={plugins}
              loading={pluginsLoad}
              loadErr={pluginsErr}
              onRetry={loadPlugins}
              onToggled={loadPlugins}
            />
          </section>

          {/* ── Divider ── */}
          <div className="border-t border-border/60" />

          {/* ── Section B: External AI tools (formerly "MCP Servers") ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Server size={15} className="text-primary" />
              <h2 className="text-sm font-semibold">{t("mcp.sectionExternal")}</h2>
              <span className="text-xs text-muted-foreground">{t("mcp.sectionExternalHint")}</span>
            </div>

            {/* Error */}
            {serversErr && (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
                <AlertTriangle size={14} /><span>{serversErr}</span>
                <button onClick={loadServers} className="ml-auto text-xs underline">{t("common.retry")}</button>
              </div>
            )}

            {/* Risk strip — only when servers exist */}
            {servers.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {(["safe", "caution", "danger", "unknown"] as const).map((level) => {
                  const cfg = RISK_CONFIG[level];
                  const Icon = cfg.icon;
                  return (
                    <div key={level} className={`flex items-center gap-2 p-2.5 rounded-xl border ${cfg.border} ${cfg.bg}`}>
                      <Icon size={14} className={cfg.color} />
                      <div>
                        <p className={`text-base font-bold leading-none ${cfg.color}`}>{riskSummary[level]}</p>
                        <p className="text-[10px] text-muted-foreground">{t(`mcp.risk.${level}`)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <AddServerForm onAdded={loadServers} />

            {servers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 rounded-xl border border-dashed border-border text-muted-foreground text-sm gap-1">
                <Server size={22} className="mb-1 opacity-30" />
                <span className="font-medium">{t("mcp.empty")}</span>
                <span className="text-xs text-muted-foreground/70">{t("mcp.emptyHint")}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {servers.map((s) => (
                  <ServerCard key={s.id} server={s}
                    onToggle={handleToggle} onDelete={handleDelete} onScan={handleScanDone} />
                ))}
              </div>
            )}

            {/* Plain-language explainer */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground leading-relaxed">
              <Server size={13} className="flex-shrink-0 mt-0.5 text-primary" />
              <div className="space-y-1">
                <p className="font-semibold text-foreground">{t("mcp.whatIsExternal")}</p>
                {(t("mcp.externalDesc", { returnObjects: true }) as string[]).map((line, i) => (
                  <p key={i}>• {line}</p>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <AuditTab />
      )}
    </div>
  );
}

