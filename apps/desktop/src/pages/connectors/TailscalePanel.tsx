import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, Network, ExternalLink,
  Copy, Check, Wifi, RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstanceStore } from "../../store/instances";
import {
  getTailscaleStatus,
  type TailscaleStatus,
} from "../../ipc";
import { DEFAULT_PORT } from "./helpers";

export function TailscalePanel() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const activePort = instances.find((i) => i.health === "online")?.port ?? DEFAULT_PORT;

  const refresh = useCallback(() => {
    setLoading(true);
    getTailscaleStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const accessUrl = status?.ip ? `http://${status.ip}:${activePort}` : null;

  const copyUrl = async () => {
    if (!accessUrl) return;
    try {
      await navigator.clipboard.writeText(accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Network size={18} className="text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">{t("connectors.tailscale.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("connectors.tailscale.subtitle")}</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-40"
          title={t("common.refresh")}
        >
          <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-muted-foreground"} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {status && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            status.running
              ? "border-green-500/20 bg-green-500/5"
              : status.installed
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-border bg-muted/20"
          }`}>
            <Wifi size={16} className={
              status.running ? "text-green-500" :
              status.installed ? "text-amber-500" : "text-muted-foreground"
            } />
            <div>
              <p className="text-sm font-medium">
                {status.running ? t("connectors.tailscale.connected") :
                 status.installed ? t("connectors.tailscale.notRunning") :
                 t("connectors.tailscale.notInstalled")}
              </p>
              {status.version && (
                <p className="text-xs text-muted-foreground">{t("connectors.tailscale.version")}{status.version}</p>
              )}
              {status.ip && (
                <p className="text-xs text-muted-foreground">{t("connectors.tailscale.ip")}{status.ip}</p>
              )}
            </div>
          </div>
        )}

        {accessUrl && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">{t("connectors.tailscale.accessUrl")}</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/30">
              <code className="flex-1 text-xs text-primary font-mono truncate">{accessUrl}</code>
              <button
                onClick={copyUrl}
                className="flex-shrink-0 p-1 rounded hover:bg-muted/60 transition-colors"
                title={t("connectors.tailscale.copy")}
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("connectors.tailscale.accessHint")}
            </p>
          </div>
        )}

        {status && !status.installed && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("connectors.tailscale.installHint")}
            </p>
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 transition-colors"
            >
              <ExternalLink size={13} /> {t("connectors.tailscale.download")}
            </a>
            <p className="text-xs text-muted-foreground">
              {t("connectors.tailscale.privacyNote")}
            </p>
          </div>
        )}

        {status && status.installed && !status.running && (
          <p className="text-sm text-muted-foreground">
            {t("connectors.tailscale.startHint")}
          </p>
        )}
      </div>
    </div>
  );
}
