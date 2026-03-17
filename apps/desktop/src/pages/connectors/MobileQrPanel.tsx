import { useState, useEffect } from "react";
import {
  Smartphone, Copy, Check, RefreshCw, Loader, Wifi,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAllLanIps } from "../../ipc";

const CHAT_PROXY_PORT = 18800;

export function MobileQrPanel() {
  const { t } = useTranslation();
  const [ips, setIps]         = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    getAllLanIps()
      .then(setIps)
      .catch(() => setIps([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
        <Smartphone size={16} className="text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{t("connectors.mobileIp.title")}</p>
          <p className="text-xs text-muted-foreground">{t("connectors.mobileIp.desc")}</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-40"
          title={t("common.refresh")}
        >
          <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-muted-foreground"} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* IP list */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader size={16} className="animate-spin" />
            <span className="text-sm">{t("connectors.mobileIp.detecting")}</span>
          </div>
        ) : ips.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">{t("connectors.mobileIp.noIp")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("connectors.mobileIp.noIpHint")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("connectors.mobileIp.availableAddresses")}</p>
            {ips.map((ip) => {
              const url = `http://${ip}:${CHAT_PROXY_PORT}`;
              const isCopied = copied === url;
              return (
                <div
                  key={ip}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <Wifi size={14} className="text-green-500 flex-shrink-0" />
                  <code className="flex-1 text-sm font-mono text-primary truncate select-all">
                    {url}
                  </code>
                  <button
                    onClick={() => copyUrl(url)}
                    className="flex-shrink-0 p-1.5 rounded-md hover:bg-muted/60 transition-colors"
                    title={t("connectors.mobileIp.copy")}
                  >
                    {isCopied
                      ? <Check size={14} className="text-green-500" />
                      : <Copy size={14} className="text-muted-foreground" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Steps */}
        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium mb-2.5">{t("connectors.mobileIp.howTo")}</p>
          <ol className="space-y-2">
            {[
              t("connectors.mobileIp.step1"),
              t("connectors.mobileIp.step2"),
              t("connectors.mobileIp.step3"),
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Port explanation */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t("connectors.mobileIp.portNote")}
        </p>
      </div>
    </div>
  );
}
