/**
 * SecurityPage — mobile read-only view.
 *
 * Mobile cannot manage firewall rules, pm2 processes, or system-level
 * security settings. This page provides:
 *  1. Security event log viewer (read-only)
 *  2. PII filter status reminder
 *  3. Links to configure security from the desktop
 */
import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck, RefreshCw, AlertTriangle, AlertCircle,
  Info, Trash2, ShieldAlert, ShieldOff, Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getRecentSecurityEvents, clearSecurityEvents, logSecurityEvent,
  type SecurityEvent, type SecurityEventSeverity,
} from "../store/securityEventStore";
import { TopBar } from "../components/TopBar";

const SEVERITY_STYLE: Record<SecurityEventSeverity, {
  color: string; bg: string; icon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;
}> = {
  info:   { color: "#6b7280", bg: "rgba(107,114,128,0.08)", icon: Info },
  warn:   { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  icon: AlertTriangle },
  danger: { color: "#ef4444", bg: "rgba(239,68,68,0.08)",   icon: AlertCircle },
};

function relativeTime(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("security.timeJustNow");
  if (diff < 3_600_000) return t("security.timeMinutesAgo", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("security.timeHoursAgo",   { count: Math.floor(diff / 3_600_000) });
  return new Date(ts).toLocaleDateString();
}

export function SecurityPage() {
  const { t } = useTranslation();
  const [events, setEvents]   = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await getRecentSecurityEvents(50);
      setEvents(ev);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!window.confirm(t("security.clearEventsConfirm"))) return;
    setClearing(true);
    try {
      await clearSecurityEvents();
      await logSecurityEvent("events_cleared", t("security.eventsClearedDetail"), "info");
      setEvents([]);
    } finally {
      setClearing(false);
    }
  };

  const dangerCount = events.filter((e) => e.severity === "danger").length;
  const warnCount   = events.filter((e) => e.severity === "warn").length;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={t("security.title")}
        subtitle={t("security.mobileSubtitle")}
        back
        right={
          <button onClick={load} disabled={loading} className="touch-btn p-2 rounded-full">
            <RefreshCw size={18} className={`text-[hsl(var(--muted-foreground))] ${loading ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="flex-1 scrollable p-4 space-y-4 pb-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-white p-3 text-center">
            <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{events.length}</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">{t("security.totalEvents")}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{warnCount}</p>
            <p className="text-[11px] text-amber-600 mt-0.5">{t("security.severityWarn")}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{dangerCount}</p>
            <p className="text-[11px] text-red-600 mt-0.5">{t("security.severityDanger")}</p>
          </div>
        </div>

        {/* Mobile notice */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-blue-200 bg-blue-50">
          <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-relaxed">
            {t("security.mobileNotice")}
          </p>
        </div>

        {/* Security features status */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
            <p className="font-semibold text-sm">{t("security.featuresTitle")}</p>
          </div>
          <div className="divide-y divide-[hsl(var(--border))]/50">
            {[
              { icon: ShieldCheck, labelKey: "security.featurePii",       descKey: "security.featurePiiDesc",       status: "active",  color: "#10b981" },
              { icon: ShieldCheck, labelKey: "security.featureInjection",  descKey: "security.featureInjectionDesc", status: "active",  color: "#10b981" },
              { icon: ShieldCheck, labelKey: "security.featureRag",        descKey: "security.featureRagDesc",       status: "active",  color: "#10b981" },
              { icon: ShieldAlert, labelKey: "security.featureFirewall",   descKey: "security.featureFirewallDesc",  status: "desktop", color: "#f59e0b" },
              { icon: ShieldOff,   labelKey: "security.featureKillSwitch", descKey: "security.featureKillSwitchDesc",status: "desktop", color: "#f59e0b" },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Icon size={18} style={{ color: item.color }} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t(item.labelKey)}</p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{t(item.descKey)}</p>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    item.status === "active"
                      ? "text-green-700 bg-green-50"
                      : "text-amber-700 bg-amber-50"
                  }`}>
                    {item.status === "active" ? t("security.featureStatusActive") : t("security.featureStatusDesktop")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Event log */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
            <p className="font-semibold text-sm">{t("security.eventsTitle")}</p>
            {events.length > 0 && (
              <button
                onClick={handleClear}
                disabled={clearing}
                className="touch-btn flex items-center gap-1 text-[11px] text-red-500 px-2 py-1 rounded-lg"
              >
                <Trash2 size={11} />
                {clearing ? t("security.clearingEvents") : t("security.clearEventsBtn")}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[hsl(var(--muted-foreground))]">
              <RefreshCw size={16} className="animate-spin mr-2" /> {t("common.loading")}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-[hsl(var(--muted-foreground))]">
              <ShieldCheck size={24} className="opacity-30" />
              <p className="text-xs">{t("security.eventsEmpty")}</p>
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]/50">
              {events.map((ev) => {
                const cfg = SEVERITY_STYLE[ev.severity];
                const Icon = cfg.icon;
                const severityLabel =
                  ev.severity === "info"   ? t("security.severityInfo")   :
                  ev.severity === "warn"   ? t("security.severityWarn")   :
                                             t("security.severityDanger");
                return (
                  <div key={ev.id} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Icon size={14} style={{ color: cfg.color }} className="flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ color: cfg.color, background: cfg.bg }}
                          >
                            {severityLabel}
                          </span>
                          <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                            {ev.eventType}
                          </span>
                        </div>
                        <p className="text-xs text-[hsl(var(--foreground))] mt-1 leading-relaxed">
                          {ev.detail}
                        </p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
                          <Clock size={9} /> {relativeTime(ev.createdAt, t as (k: string, o?: Record<string, unknown>) => string)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
