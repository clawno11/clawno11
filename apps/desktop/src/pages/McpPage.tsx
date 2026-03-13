import { useState, useEffect, useCallback } from "react";
import {
  Puzzle, RefreshCw, Server, AlertTriangle, Box, Zap, Wrench, PlugZap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { McpPageContent } from "@clawno/shared/components/mcp/McpPageContent";
import { listOpenClawPlugins, toggleOpenClawPlugin, type OpenClawPlugin } from "../ipc";

// ── Permission inference helpers (desktop-only) ──────────────────────────────

function inferPermissions(toolNames: string[]) {
  const joined = toolNames.join(" ").toLowerCase();
  const hasAny = (...kws: string[]) => kws.some((k) => joined.includes(k));
  return {
    network: hasAny("fetch", "http", "search", "web", "url", "browser", "scrape", "crawl", "request", "api"),
    fileIO:  hasAny("read", "write", "file", "fs", "path", "dir", "folder", "memory", "document", "storage", "list"),
    shell:   hasAny("exec", "shell", "cmd", "command", "run", "process", "bash", "spawn", "terminal"),
  }
}

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

// ── OpenClaw native plugins (desktop-only) ─────────────────────────────────

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
  const [err, setErr] = useState<string | null>(null);
  const isLoaded = plugin.status === "loaded";

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

      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isLoaded ? "bg-green-500/10" : "bg-muted/40"
        }`}>
          <Box size={16} className={isLoaded ? "text-green-600" : "text-muted-foreground"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{plugin.name || plugin.id}</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
              isLoaded
                ? "text-green-600 bg-green-500/8 border-green-500/30"
                : "text-muted-foreground bg-muted/30 border-border"
            }`}>
              {isLoaded ? <><Zap size={9} />{t("mcp.plugins.statusLoaded")}</> : t("mcp.plugins.statusDisabled")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">
              {ORIGIN_LABEL[plugin.origin] ?? plugin.origin}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {plugin.id}{plugin.version ? ` · v${plugin.version}` : ""}
          </p>
        </div>

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

      {plugin.description && (
        <p className="text-xs text-muted-foreground leading-relaxed pl-12">
          {plugin.description}
        </p>
      )}

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

      <PermissionMatrix toolNames={plugin.tool_names} />

      {err && (
        <p className="text-[10px] text-red-500 flex items-center gap-1 pl-12">
          <AlertTriangle size={10} /> {err}
        </p>
      )}
    </div>
  );
}

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
  const loaded = plugins.filter((p) => p.status === "loaded");
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

// ── Module-level cache ──────────────────────────────────────────────────────

let _cachedPlugins: OpenClawPlugin[] | null = null;

// ── Main Page ──────────────────────────────────────────────────────────────

export function McpPage() {
  const { t } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [serversLoading, setServersLoading] = useState(false);
  const [plugins, setPlugins] = useState<OpenClawPlugin[]>(_cachedPlugins ?? []);
  const [pluginsLoad, setPluginsLoad] = useState(false);
  const [pluginsErr, setPluginsErr] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    setPluginsLoad(true);
    setPluginsErr(null);
    try {
      const data = await listOpenClawPlugins();
      _cachedPlugins = data;
      setPlugins(data);
    } catch (err) {
      setPluginsErr(String(err));
    } finally {
      setPluginsLoad(false);
    }
  }, []);

  useEffect(() => {
    if (_cachedPlugins === null) loadPlugins();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshAll = useCallback(() => {
    setRefreshTrigger((t) => t + 1);
    loadPlugins();
  }, [loadPlugins]);

  const isRefreshing = serversLoading || pluginsLoad;

  const pluginsSectionNode = (
    <>
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
    </>
  );

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Puzzle size={22} className="text-primary" />
            {t("mcp.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("mcp.desc")}</p>
        </div>
        <button onClick={handleRefreshAll} disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50">
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          {t("common.refresh")}
        </button>
      </div>

      <McpPageContent
        showPlugins
        pluginsSection={pluginsSectionNode}
        showDescription
        showCallSummary
        overviewTabId="overview"
        infoTitleKey="mcp.whatIsExternal"
        infoDescKey="mcp.externalDesc"
        emptyIcon="server"
        showEmptyHint
        refreshTrigger={refreshTrigger}
        onLoadingChange={setServersLoading}
        sectionHeader={
          <>
            <Server size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">{t("mcp.sectionExternal")}</h2>
            <span className="text-xs text-muted-foreground">{t("mcp.sectionExternalHint")}</span>
          </>
        }
      />
    </div>
  );
}
