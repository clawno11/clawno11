import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Wifi,
  Lock,
  RefreshCw,
  Globe,
  Home,
  Network,
} from "lucide-react";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";

interface LanInfo {
  ip: string;
  subnet: string;
  prefix: number;
}

type NetworkMode = "off" | "local" | "subnet" | "tailscale";

interface NetworkModeCardProps {
  mode: NetworkMode;
  current: NetworkMode;
  icon: React.ReactNode;
  label: string;
  desc: string;
  warning?: string;
  badge?: string;
  onClick: () => void;
  applying: boolean;
}

function NetworkModeCard({
  mode, current, icon, label, desc, warning, badge, onClick, applying,
}: NetworkModeCardProps) {
  const active = current === mode;
  return (
    <button
      onClick={onClick}
      disabled={applying || active}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
        active
          ? mode === "off"
            ? "border-primary/50 bg-primary/5"
            : "border-green-500/60 bg-green-500/5"
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/30 disabled:opacity-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          active
            ? mode === "off" ? "bg-primary/15 text-primary" : "bg-green-500/15 text-green-600"
            : "bg-muted/60 text-muted-foreground"
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${active ? (mode === "off" ? "text-primary" : "text-green-700") : ""}`}>
              {label}
            </span>
            {active && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                mode === "off"
                  ? "text-primary bg-primary/10"
                  : "text-green-700 bg-green-100"
              }`}>
                ✓ {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
          {warning && active && (
            <p className="text-[11px] text-amber-600 mt-1 font-medium">{warning}</p>
          )}
        </div>
      </div>
    </button>
  );
}

interface NetworkAccessPanelProps {
  port: number;
  onEvent: () => void;
}

export function NetworkAccessPanel({ port, onEvent }: NetworkAccessPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode]       = useState<NetworkMode>("off");
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    Promise.all([
      invoke<string>("get_network_access_mode", { port }),
      invoke<LanInfo | null>("get_local_lan_info"),
    ]).then(([m, info]) => {
      setMode((m as NetworkMode) || "off");
      setLanInfo(info);
    }).catch(console.error)
      .finally(() => setLoaded(true));
  }, [port]);

  const applyMode = async (newMode: NetworkMode) => {
    if (newMode === mode) return;
    setApplying(true);
    setError(null);
    try {
      await invoke("set_network_access_mode", { port, mode: newMode });
      setMode(newMode);
      await logSecurityEvent(
        "firewall_on",
        `设备访问模式已切换为「${t(`security.netAccessMode.${newMode}`)}」· 端口 ${port}`,
        newMode === "off" ? "warn" : "info",
      );
      onEvent();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground animate-pulse">
        {t("security.netAccessLoading")}
      </div>
    );
  }

  const subnetDesc = lanInfo
    ? t("security.netAccessModeDesc.subnet", { subnet: lanInfo.subnet })
    : t("security.netAccessNoLan");

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Network size={14} className="text-primary" />
        <h2 className="text-sm font-semibold">{t("security.netAccess")}</h2>
        <span className="text-xs text-muted-foreground font-normal ml-1">
          · {t("security.netAccessDesc")}
        </span>
      </div>

      {lanInfo && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border">
          <Wifi size={12} className="text-muted-foreground flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t("security.netAccessCurrentIp")}</span>
          <span className="font-mono text-[11px] font-semibold text-foreground">{lanInfo.ip}</span>
          <span className="text-[10px] text-muted-foreground ml-1">({lanInfo.subnet})</span>
        </div>
      )}

      {mode === "local" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-[11px] text-green-700">
          <Lock size={12} className="flex-shrink-0" />
          {t("security.netAccessLocalActive")}
        </div>
      )}

      <div className="space-y-2">
        <NetworkModeCard
          mode="off"
          current={mode}
          icon={<Globe size={16} />}
          label={t("security.netAccessMode.off")}
          desc={t("security.netAccessModeDesc.off")}
          badge={t("security.netAccessActive")}
          onClick={() => applyMode("off")}
          applying={applying}
        />
        <NetworkModeCard
          mode="subnet"
          current={mode}
          icon={<Home size={16} />}
          label={t("security.netAccessMode.subnet")}
          desc={subnetDesc}
          badge={t("security.netAccessActive")}
          {...(!lanInfo ? { warning: t("security.netAccessNoLan") } : {})}
          onClick={() => applyMode("subnet")}
          applying={applying || !lanInfo}
        />
        <NetworkModeCard
          mode="tailscale"
          current={mode}
          icon={<Lock size={16} />}
          label={t("security.netAccessMode.tailscale")}
          desc={t("security.netAccessModeDesc.tailscale")}
          badge={t("security.netAccessActive")}
          onClick={() => applyMode("tailscale")}
          applying={applying}
        />
      </div>

      {mode !== "tailscale" && (
        <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
          💡 {t("security.netAccessTailscaleTip")}{" "}
          <button
            onClick={() => navigate("/connectors")}
            className="text-primary hover:underline font-medium"
          >
            {t("security.netAccessTailscalePage")}
          </button>
          {" "}{t("security.netAccessTailscaleTipSuffix")}
        </p>
      )}

      {applying && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw size={12} className="animate-spin" />
          {t("security.netAccessApplying")}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-600 px-1">
          ⚠ {t("security.netAccessApplyFailed")}: {error}
        </p>
      )}
    </div>
  );
}
