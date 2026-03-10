import { useState, useEffect, useCallback } from "react";
import { Activity, AlertTriangle, RefreshCw, TrendingUp, Zap, Clock, Trash2, ArrowDownToLine, ArrowUpFromLine, Wallet, PowerOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getUsageSummary, purgeOldRecords, type UsageSummary, type HourlyUsage, type ModelBreakdown } from "../store/tokenLog";
import { getBudget, budgetLevel, type TokenBudget } from "../store/tokenBudget";
import { useTokenAnomalyStore } from "../store/tokenAnomalyStore";
import { logSecurityEvent } from "../store/securityEventStore";
import { TopBar } from "../components/TopBar";

const AUTO_REFRESH_MS = 60_000;

// ── Colour palette for model bars ─────────────────────────────────────────

const MODEL_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-lime-500",
  "bg-orange-500",
  "bg-teal-500",
];

// ── Mini bar chart ─────────────────────────────────────────────────────────

function BarChart({ data }: { data: HourlyUsage[] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">
        {t("tokens.noData")}
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.totalTokens), 1);

  const msPerHour = 3_600_000;
  const now = Date.now(); // milliseconds, matching tokenLog.ts
  const slots: Array<{ ts: number; val: number }> = Array.from({ length: 24 }, (_, i) => {
    const slotHour = Math.floor((now - (23 - i) * msPerHour) / msPerHour) * msPerHour;
    return {
      ts: slotHour,
      val: data.find((d) => d.hour === slotHour)?.totalTokens ?? 0,
    };
  });

  const unitLabel = t("tokens.unit");

  return (
    <div className="flex items-end gap-0.5 h-28 w-full">
      {slots.map(({ ts, val }, i) => {
        const pct = (val / max) * 100;
        const isLast = i === slots.length - 1;
        return (
          <div key={ts} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative">
            <div
              className={`w-full rounded-sm transition-all ${
                isLast ? "bg-primary" : val > 0 ? "bg-primary/50" : "bg-muted/30"
              }`}
              style={{ height: `${Math.max(pct, val > 0 ? 4 : 1)}%` }}
            />
            {val > 0 && (
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                <div className="bg-popover border border-border rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow">
                  {val.toLocaleString()} {unitLabel}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = "default",
}: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  color?: "default" | "green" | "amber" | "red" | "blue";
}) {
  const colors = {
    default: "text-primary bg-primary/10 border-primary/20",
    green:   "text-green-600 bg-green-500/10 border-green-500/20",
    amber:   "text-amber-600 bg-amber-500/10 border-amber-500/20",
    red:     "text-red-600 bg-red-500/10 border-red-500/20",
    blue:    "text-blue-600 bg-blue-500/10 border-blue-500/20",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Breakdown section ──────────────────────────────────────────────────────

function BreakdownSection({
  summary,
}: {
  summary: UsageSummary;
}) {
  const { t } = useTranslation();
  const { promptTotal24h, completionTotal24h, total24h, modelBreakdown } = summary;

  if (total24h === 0) return null;

  const inputPct  = total24h > 0 ? (promptTotal24h / total24h) * 100 : 50;
  const outputPct = 100 - inputPct;

  const visibleModels = modelBreakdown.slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">{t("tokens.breakdownTitle")}</h2>

      {/* Input vs Output split */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="flex items-center gap-1.5 text-blue-600 font-medium">
            <ArrowUpFromLine size={11} />
            {t("tokens.inputLabel")}
            <span className="text-muted-foreground font-normal">
              {promptTotal24h.toLocaleString()} · {inputPct.toFixed(1)}%
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
            <span className="text-muted-foreground font-normal">
              {completionTotal24h.toLocaleString()} · {outputPct.toFixed(1)}%
            </span>
            <ArrowDownToLine size={11} />
            {t("tokens.outputLabel")}
          </span>
        </div>
        <div className="h-2 bg-muted/40 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${inputPct}%` }}
          />
          <div className="h-full bg-emerald-500 flex-1 transition-all duration-500" />
        </div>
        <div className="flex gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            {t("tokens.inputTokens")}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {t("tokens.outputTokens")}
          </span>
        </div>
      </div>

      {/* Per-model breakdown */}
      {visibleModels.length > 0 && (
        <div className="space-y-2.5 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">{t("tokens.byModel")}</p>
          {visibleModels.map(({ provider, model, tokens }: ModelBreakdown, i: number) => {
            const pct = (tokens / total24h) * 100;
            const label = model || provider || "unknown";
            return (
              <div key={`${provider}-${model}-${i}`} className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span
                    className="text-muted-foreground truncate max-w-[55%]"
                    title={`${provider} / ${model}`}
                  >
                    {label}
                  </span>
                  <span className="font-mono text-muted-foreground tabular-nums text-[11px]">
                    {tokens.toLocaleString()} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${MODEL_COLORS[i % MODEL_COLORS.length]} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Budget progress ────────────────────────────────────────────────────────

const LEVEL_COLORS = {
  none:     { bar: "bg-emerald-500", text: "text-emerald-600", badge: "" },
  warn:     { bar: "bg-amber-400",   text: "text-amber-600",   badge: "text-amber-600" },
  critical: { bar: "bg-orange-500",  text: "text-orange-600",  badge: "text-orange-600" },
  over:     { bar: "bg-red-500",     text: "text-red-600",     badge: "text-red-600 font-semibold" },
};

function BudgetBar({
  label, used, limit,
}: { label: string; used: number; limit: number }) {
  const { t } = useTranslation();
  const level  = budgetLevel(used, limit);
  const pct    = Math.min((used / Math.max(limit, 1)) * 100, 100);
  const colors = LEVEL_COLORS[level];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className={`flex items-center gap-1.5 ${colors.text}`}>
          {level === "over" && <span className={colors.badge}>{t("tokens.budgetOver")}</span>}
          {level === "critical" && <span className={colors.badge}>{t("tokens.budgetCritical")}</span>}
          <span className="font-mono tabular-nums">
            {used.toLocaleString()}
            <span className="text-muted-foreground font-normal">
              {" / "}{limit.toLocaleString()}
            </span>
          </span>
        </span>
      </div>
      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BudgetProgress({ summary, budget, onGoSettings }: {
  summary: UsageSummary;
  budget: TokenBudget;
  onGoSettings: () => void;
}) {
  const { t } = useTranslation();
  const hasDaily   = budget.dailyLimit > 0;
  const hasMonthly = budget.monthlyLimit > 0;
  if (!hasDaily && !hasMonthly) return null;

  const dailyLevel   = budgetLevel(summary.total24h,   budget.dailyLimit);
  const monthlyLevel = budgetLevel(summary.totalMonth, budget.monthlyLimit);
  const isAnyAlert   = dailyLevel !== "none" || monthlyLevel !== "none";

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${
      isAnyAlert ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-card"
    }`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Wallet size={14} className={isAnyAlert ? "text-amber-500" : "text-muted-foreground"} />
          {t("tokens.budgetProgressTitle")}
        </h2>
        <button
          onClick={onGoSettings}
          className="text-[11px] text-primary hover:underline"
        >
          {t("tokens.budgetGoSettings")}
        </button>
      </div>

      <div className="space-y-3">
        {hasDaily && (
          <BudgetBar
            label={t("tokens.budgetDailyProgress")}
            used={summary.total24h}
            limit={budget.dailyLimit}
          />
        )}
        {hasMonthly && (
          <BudgetBar
            label={t("tokens.budgetMonthlyProgress")}
            used={summary.totalMonth}
            limit={budget.monthlyLimit}
          />
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function TokenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAnomaly = useTokenAnomalyStore((s) => s.setAnomaly);
  const [budget, setBudgetState] = useState<TokenBudget>(getBudget);

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [killLoading, setKillLoading] = useState(false);
  const [killDone, setKillDone] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeDone, setPurgeDone] = useState(false);

  // Mobile: kill switch not available (desktop-only feature — requires local pm2/firewall)
  const handleAnomalyKill = useCallback(async () => {
    const ratio = summary?.anomalyRatio?.toFixed(1) ?? "3.0";
    setKillLoading(true);
    await logSecurityEvent(
      "token_anomaly_detected_mobile",
      `token anomaly ${ratio}x avg (mobile: no kill switch)`,
      "danger",
    );
    setKillLoading(false);
    setKillDone(true);
    setTimeout(() => setKillDone(false), 5000);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePurge = useCallback(async () => {
    setPurging(true);
    try {
      await purgeOldRecords(30);
      setPurgeDone(true);
      // Reset done badge after 3 s
      setTimeout(() => setPurgeDone(false), 3000);
    } catch (e) {
      console.error("purge failed:", e);
    } finally {
      setPurging(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getUsageSummary();
      setSummary(s);
      setAnomaly(s.anomaly);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Token summary error:", e);
    } finally {
      setLoading(false);
    }
  }, [setAnomaly]);

  useEffect(() => {
    load();
    const timer = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Re-read budget from localStorage whenever the page becomes visible
  // (user may have changed it in Settings and navigated back).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setBudgetState(getBudget()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const peak = summary
    ? Math.max(...summary.hourly.map((h) => h.totalTokens), 0)
    : 0;

  const avgHourly = summary ? Math.round(summary.total24h / 24) : 0;

  return (
    <div className="flex flex-col h-full">
    <TopBar
      title={t("tokens.title")}
      subtitle={t("tokens.desc")}
      back
      right={
        <button onClick={load} disabled={loading} className="touch-btn p-2 rounded-full">
          <RefreshCw size={18} className={`text-[hsl(var(--muted-foreground))] ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    />
    <div className="flex-1 scrollable p-4 space-y-4 pb-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity size={22} className="text-primary" />
            {t("tokens.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("tokens.desc")}
          </p>
        </div>
        {lastRefresh && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock size={11} />
            {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* ── Anomaly alert ── */}
      {summary?.anomaly && (
        <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/8 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-700">{t("tokens.anomalyTitle")}</p>
              <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed">
                {t("tokens.anomalyMsg", {
                  total: summary.total24h.toLocaleString(),
                  avg:   Math.round(summary.avg7d).toLocaleString(),
                  ratio: summary.anomalyRatio?.toFixed(1) ?? "3.0",
                })}
              </p>
            </div>
          </div>
          {!killDone ? (
            <button
              onClick={handleAnomalyKill}
              disabled={killLoading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {killLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <PowerOff size={14} />
              )}
              {killLoading ? t("security.killSwitchWorking") : t("tokens.anomalyKillBtn")}
            </button>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-100 text-red-700 text-sm font-semibold">
              <PowerOff size={14} />
              {t("tokens.anomalyKillDone")}
            </div>
          )}
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Zap}
          label={t("tokens.total24h")}
          value={summary ? summary.total24h.toLocaleString() : "—"}
          sub={t("tokens.unit")}
          color={summary?.anomaly ? "amber" : "default"}
        />
        <StatCard
          icon={TrendingUp}
          label={t("tokens.peakHour")}
          value={peak > 0 ? peak.toLocaleString() : "—"}
          sub={t("tokens.unitPerHour")}
          color="green"
        />
        <StatCard
          icon={Activity}
          label={t("tokens.avgHour")}
          value={avgHourly > 0 ? avgHourly.toLocaleString() : "—"}
          sub={t("tokens.unitPerHour")}
        />
      </div>

      {/* ── Input / Output mini-cards ── */}
      {summary && summary.total24h > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            icon={ArrowUpFromLine}
            label={t("tokens.inputTokens")}
            value={summary.promptTotal24h.toLocaleString()}
            sub={`${summary.total24h > 0 ? ((summary.promptTotal24h / summary.total24h) * 100).toFixed(1) : 0}% · ${t("tokens.unit")}`}
            color="blue"
          />
          <StatCard
            icon={ArrowDownToLine}
            label={t("tokens.outputTokens")}
            value={summary.completionTotal24h.toLocaleString()}
            sub={`${summary.total24h > 0 ? ((summary.completionTotal24h / summary.total24h) * 100).toFixed(1) : 0}% · ${t("tokens.unit")}`}
            color="green"
          />
        </div>
      )}

      {/* ── Bar chart ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("tokens.chartTitle")}</h2>
          <span className="text-xs text-muted-foreground">{t("tokens.chartHint")}</span>
        </div>
        {loading && !summary ? (
          <div className="h-28 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
            {t("tokens.loading")}
          </div>
        ) : (
          <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <BarChart data={summary?.hourly ?? []} />
          </div>
        )}
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{t("tokens.chartFrom")}</span>
          <span>{t("tokens.chartTo")}</span>
        </div>
      </div>

      {/* ── Budget progress ── */}
      {summary && budget.enabled && (
        <BudgetProgress
          summary={summary}
          budget={budget}
          onGoSettings={() => navigate("/settings")}
        />
      )}

      {/* ── Model / I-O breakdown ── */}
      {summary && <BreakdownSection summary={summary} />}

      {/* ── Tips ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">{t("tokens.tipsTitle")}</h2>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {(t("tokens.tips", { returnObjects: true }) as string[]).map((tip, i) => (
            <li key={i}>• {tip}</li>
          ))}
        </ul>
      </div>

      {/* ── Quick purge ── */}
      <div className="flex justify-end pb-2">
        <button
          onClick={handlePurge}
          disabled={purging}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40"
        >
          <Trash2 size={12} />
          {purging
            ? t("tokens.purging")
            : purgeDone
              ? t("tokens.purgeShortcutDone")
              : t("tokens.purgeShortcut")}
        </button>
      </div>

    </div>
    </div>
  );
}
