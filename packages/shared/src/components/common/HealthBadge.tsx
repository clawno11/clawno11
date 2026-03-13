import { WifiOff, RefreshCw, Wifi, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export type HealthStatus = "online" | "offline" | "unknown" | "probing";

export interface HealthBadgeProps {
  health: HealthStatus;
  latencyMs?: number;
}

export function HealthBadge({ health, latencyMs }: HealthBadgeProps) {
  const { t } = useTranslation();

  if (health === "probing") {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-muted-foreground">
        <RefreshCw size={11} className="animate-spin" />
        {t("instances.health.unknown")}
      </span>
    );
  }

  if (health === "online") {
    return (
      <span
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
        style={{ background: "rgba(16,185,129,0.1)", color: "#059669", border: "1px solid rgba(16,185,129,0.25)" }}
      >
        <Wifi size={11} />
        {t("instances.health.online")}
        {latencyMs !== undefined && (
          <span className="font-mono" style={{ fontSize: 10, opacity: 0.75 }}>{latencyMs}ms</span>
        )}
      </span>
    );
  }

  if (health === "offline") {
    return (
      <span
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
        style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}
      >
        <WifiOff size={11} />
        {t("instances.health.offline")}
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
      style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)" }}
    >
      <AlertCircle size={11} />
      {t("instances.health.unknown")}
    </span>
  );
}
