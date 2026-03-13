import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  Activity, AlertTriangle, RefreshCw, TrendingUp, Zap, Clock,
  PowerOff, Trash2, ArrowDownToLine, ArrowUpFromLine, Wallet, Layers,
  DollarSign, Settings2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getUsageSummary, purgeOldRecords,
  type UsageSummary, type HourlyUsage, type ModelBreakdown, type InstanceUsage,
} from "../../stores/tokenLogStore";
import {
  getBudget, getInstanceBudget, budgetLevel,
  type TokenBudget,
} from "../../stores/tokenLogStore";
import {
  calculateCost, getDisplayCurrency, setDisplayCurrency,
  getExchangeRate, findModelPrice,
  type DisplayCurrency,
} from "../../stores/tokenPricingStore";
import { useTokenAnomalyStore } from "../../tokenAnomalyStore";

const AUTO_REFRESH_MS = 60_000;

const MODEL_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-amber-500", "bg-pink-500",
  "bg-cyan-500", "bg-lime-500", "bg-orange-500", "bg-teal-500",
];

const LEVEL_COLORS = {
  none:     { bar: "bg-emerald-500", text: "text-emerald-600", badge: "" },
  warn:     { bar: "bg-amber-400",   text: "text-amber-600",   badge: "text-amber-600" },
  critical: { bar: "bg-orange-500",  text: "text-orange-600",  badge: "text-orange-600" },
  over:     { bar: "bg-red-500",     text: "text-red-600",     badge: "text-red-600 font-semibold" },
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface InstanceOption {
  id: string;
  name: string;
  health?: "online" | "offline" | "unknown";
  kind?: "local" | "remote";
}

export interface TokenPageContentProps {
  instances?: InstanceOption[];
  selectedInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  showInstanceSelector?: boolean;
  showCostAnalysis?: boolean;
  onKillSwitch?: (ratio?: string) => void | Promise<void>;
  onGoSettings: () => void;
  killLoading?: boolean;
  killDone?: boolean;
  killError?: string | null;
  instanceName?: string | undefined;
  onLoadingChange?: (loading: boolean) => void;
}

export interface TokenPageContentRef {
  refresh: () => void;
}

// ── BarChart ────────────────────────────────────────────────────────────────

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
  const now = Date.now();
  const slots = Array.from({ length: 24 }, (_, i) => {
    const slotHour = Math.floor((now - (23 - i) * msPerHour) / msPerHour) * msPerHour;
    return { ts: slotHour, val: data.find((d) => d.hour === slotHour)?.totalTokens ?? 0 };
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

// ── StatCard ────────────────────────────────────────────────────────────────

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

// ── InstanceBreakdownSection ──────────────────────────────────────────────────

function InstanceBreakdownSection({
  breakdown,
  instances,
  onSelect,
}: {
  breakdown: InstanceUsage[];
  instances: InstanceOption[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (breakdown.length === 0) return null;

  const maxTokens = Math.max(...breakdown.map((b) => b.total24h), 1);

  const getName = (id: string) =>
    instances.find((i) => i.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Layers size={14} className="text-muted-foreground" />
          {t("tokens.instanceBreakdownTitle")}
        </h2>
        <span className="text-[11px] text-muted-foreground">{t("tokens.instanceBreakdownHint")}</span>
      </div>

      <div className="space-y-3">
        {breakdown.map((b) => {
          const name     = getName(b.instanceId);
          const pct      = maxTokens > 0 ? (b.total24h / maxTokens) * 100 : 0;
          const instBudget = getInstanceBudget(b.instanceId);
          const level    = instBudget.enabled && instBudget.dailyLimit > 0
            ? budgetLevel(b.total24h, instBudget.dailyLimit)
            : "none";
          const barColor = level === "over"     ? "bg-red-500"
                         : level === "critical" ? "bg-orange-500"
                         : level === "warn"     ? "bg-amber-400"
                         : "bg-primary/60";

          return (
            <button
              key={b.instanceId}
              onClick={() => onSelect(b.instanceId)}
              className="w-full text-left space-y-1.5 group hover:bg-muted/30 rounded-lg p-2 -mx-2 transition-colors"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[40%]">
                  {name}
                </span>
                <div className="flex items-center gap-2 text-muted-foreground text-[11px] font-mono tabular-nums">
                  {instBudget.enabled && instBudget.dailyLimit > 0 && (
                    <span className={`${level !== "none" ? "text-amber-600 font-medium" : ""}`}>
                      {b.total24h.toLocaleString()} / {instBudget.dailyLimit.toLocaleString()}
                    </span>
                  )}
                  {(!instBudget.enabled || instBudget.dailyLimit === 0) && (
                    <span>{b.total24h.toLocaleString()} tokens</span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60">
                    月: {b.totalMonth.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${Math.max(pct, b.total24h > 0 ? 2 : 0)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">点击实例行可切换到该实例的详细视图</p>
    </div>
  );
}

// ── BreakdownSection ────────────────────────────────────────────────────────

function BreakdownSection({ summary }: { summary: UsageSummary }) {
  const { t } = useTranslation();
  const { promptTotal24h, completionTotal24h, total24h, modelBreakdown } = summary;
  if (total24h === 0) return null;

  const inputPct  = total24h > 0 ? (promptTotal24h / total24h) * 100 : 50;
  const outputPct = 100 - inputPct;

  const visibleModels = modelBreakdown.slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">{t("tokens.breakdownTitle")}</h2>

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
          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${inputPct}%` }} />
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

// ── CostSection ─────────────────────────────────────────────────────────────

interface ModelCostRow {
  model: string;
  provider: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  tokenPct: number;
  cost: number | null;
  costCurrency: "USD" | "CNY" | null;
  costPct: number;
  label: string;
  free: boolean;
  priceFound: boolean;
}

function CostSection({
  summary,
  displayCurrency,
  exchangeRate,
  onGoSettings,
}: {
  summary: UsageSummary;
  displayCurrency: DisplayCurrency;
  exchangeRate: number;
  onGoSettings: () => void;
}) {
  const { t } = useTranslation();
  const { modelBreakdown, total24h } = summary;
  if (total24h === 0) return null;

  const rows: ModelCostRow[] = modelBreakdown.map((m, i) => {
    const isGeneric = !m.model || m.model === "main" || m.model === "default";
    const label     = isGeneric ? (m.provider || "unknown") : m.model;
    const tokenPct  = total24h > 0 ? (m.tokens / total24h) * 100 : 0;
    const found     = isGeneric ? null : findModelPrice(m.model, m.provider);
    const costBreak = found
      ? calculateCost(m.promptTokens, m.completionTokens, m.model, m.provider)
      : null;

    return {
      model: m.model, provider: m.provider,
      tokens: m.tokens, promptTokens: m.promptTokens, completionTokens: m.completionTokens,
      tokenPct,
      cost: costBreak?.totalCost ?? null,
      costCurrency: costBreak?.currency ?? null,
      costPct: 0,
      label,
      free: found?.price.free ?? false,
      priceFound: !!found,
      _idx: i,
    } as ModelCostRow & { _idx: number };
  });

  const toDisplay = (cost: number, currency: "USD" | "CNY"): number => {
    if (displayCurrency === "ORIGINAL") return cost;
    const target = displayCurrency;
    if (currency === target) return cost;
    return currency === "USD" ? cost * exchangeRate : cost / exchangeRate;
  };

  const resolvedCurrency: "USD" | "CNY" =
    displayCurrency === "ORIGINAL" ? "CNY" : displayCurrency;

  let totalCostDisplay = 0;
  const displayCosts = rows.map((r) => {
    if (r.cost === null || r.costCurrency === null) return null;
    return toDisplay(r.cost, r.costCurrency);
  });
  displayCosts.forEach((c) => { if (c !== null) totalCostDisplay += c; });

  const rowsWithPct = rows.map((r, i) => {
    const dc = displayCosts[i] ?? null;
    const costPct = dc !== null && totalCostDisplay > 0 ? (dc / totalCostDisplay) * 100 : 0;
    return { ...r, costPct };
  });

  const unknownModels = rows.filter((r) => !r.priceFound && !r.free).map((r) => r.label);

  const today      = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysPassed  = today.getDate();
  const projected   = daysPassed > 0 ? (totalCostDisplay / daysPassed) * daysInMonth : 0;

  const symbol = resolvedCurrency === "USD" ? "$" : "¥";
  const fmtCost = (c: number) =>
    c === 0 ? `${symbol}0.00` : c < 0.001 ? `< ${symbol}0.001`
      : c < 10 ? `${symbol}${c.toFixed(3)}`
      : c < 100 ? `${symbol}${c.toFixed(2)}`
      : `${symbol}${c.toFixed(1)}`;

  const fmtModelCost = (row: ModelCostRow) => {
    if (row.free) return <span className="text-emerald-600 text-[11px] font-medium">{t("tokens.costFree")}</span>;
    if (!row.priceFound) return <span className="text-muted-foreground/60 text-[11px]">—</span>;
    if (row.cost === null) return <span className="text-muted-foreground/60 text-[11px]">—</span>;
    const dc = displayCosts[rows.indexOf(row)] ?? null;
    const val: number = dc !== null ? dc : (row.cost ?? 0);
    const sym = (displayCurrency === "ORIGINAL" ? row.costCurrency : displayCurrency) === "USD" ? "$" : "¥";
    return (
      <span className="font-mono tabular-nums text-[11px] text-foreground">
        {val === 0 ? `${sym}0.00`
          : val < 0.001 ? `< ${sym}0.001`
          : val < 10 ? `${sym}${val.toFixed(3)}`
          : val < 100 ? `${sym}${val.toFixed(2)}`
          : `${sym}${val.toFixed(1)}`}
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign size={14} className="text-amber-500" />
          {t("tokens.costSection")}
        </h2>
        <span className="text-[10px] text-muted-foreground">{t("tokens.costSectionHint")}</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
          <p className="text-[10px] text-muted-foreground mb-1">{t("tokens.cost24h")}</p>
          <p className="text-base font-bold text-amber-600">{fmtCost(totalCostDisplay)}</p>
          {unknownModels.length > 0 && (
            <p className="text-[9px] text-muted-foreground mt-0.5">+ 未知</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
          <p className="text-[10px] text-muted-foreground mb-1">{t("tokens.costMonth")}</p>
          <p className="text-base font-bold text-amber-600">
            {fmtCost(totalCostDisplay * (daysInMonth / Math.max(daysPassed, 1)) * 0 + totalCostDisplay)}
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">{daysPassed} 天累计</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
          <p className="text-[10px] text-muted-foreground mb-1">{t("tokens.costProjected")}</p>
          <p className="text-base font-bold text-amber-600">{fmtCost(projected)}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">{t("tokens.costProjectedSub")}</p>
        </div>
      </div>

      <div className="space-y-1 pt-1 border-t border-border">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3 px-1">
          <span className="font-medium">{t("tokens.costPerModel")}</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-1.5 rounded-sm bg-primary/50 inline-block" />
              {t("tokens.costTokenPct")}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-1.5 rounded-sm bg-amber-400 inline-block" />
              {t("tokens.costPct")}
            </span>
          </div>
        </div>

        {rowsWithPct.map((row, i) => (
          <div key={`${row.provider}-${row.model}-${i}`} className="space-y-1.5 py-2 border-b border-border/40 last:border-0">
            <div className="flex items-center justify-between text-xs gap-2">
              <span
                className="text-foreground font-medium truncate max-w-[40%]"
                title={`${row.provider} / ${row.model}`}
              >
                {row.label}
              </span>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-muted-foreground tabular-nums text-[11px]">
                  {row.tokens.toLocaleString()}
                </span>
                {fmtModelCost(row)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground w-10 text-right tabular-nums flex-shrink-0">
                {row.tokenPct.toFixed(1)}%
              </span>
              <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${MODEL_COLORS[i % MODEL_COLORS.length]} opacity-60 transition-all duration-500`}
                  style={{ width: `${row.tokenPct}%` }}
                />
              </div>
            </div>

            {row.priceFound && !row.free && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-amber-600 w-10 text-right tabular-nums flex-shrink-0">
                  {row.costPct.toFixed(1)}%
                </span>
                <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${row.costPct}%` }}
                  />
                </div>
              </div>
            )}
            {row.free && (
              <p className="text-[10px] text-emerald-600 pl-12">{t("tokens.costFree")} · 成本 $0</p>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between text-xs pt-2 font-semibold">
          <span>{t("tokens.costTotal")}</span>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground tabular-nums text-[11px]">{total24h.toLocaleString()}</span>
            <span className="text-amber-600 font-mono tabular-nums text-[11px]">{fmtCost(totalCostDisplay)}</span>
          </div>
        </div>
      </div>

      {unknownModels.length > 0 && (
        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {t("tokens.costUnknownModels")}
            <span className="font-mono ml-1">{unknownModels.join(", ")}</span>
          </p>
          <button
            onClick={onGoSettings}
            className="text-[11px] text-primary hover:underline flex-shrink-0"
          >
            {t("tokens.costConfigureLink")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── CurrencySelector ───────────────────────────────────────────────────────

function CurrencySelector({
  value,
  onChange,
}: {
  value: DisplayCurrency;
  onChange: (v: DisplayCurrency) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const OPTIONS: { value: DisplayCurrency; label: string }[] = [
    { value: "ORIGINAL", label: t("tokens.currencyOriginal") },
    { value: "CNY",      label: t("tokens.currencyCNY") },
    { value: "USD",      label: t("tokens.currencyUSD") },
  ];

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0]!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-lg px-2 py-1 transition-colors"
      >
        <Settings2 size={11} />
        {current.label}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-10 min-w-[160px] overflow-hidden">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-muted/60 ${
                opt.value === value ? "text-primary font-medium bg-primary/5" : "text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BudgetBar / BudgetProgress ──────────────────────────────────────────────

function BudgetBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t } = useTranslation();
  const level  = budgetLevel(used, limit);
  const pct    = Math.min((used / Math.max(limit, 1)) * 100, 100);
  const colors = LEVEL_COLORS[level];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className={`flex items-center gap-1.5 ${colors.text}`}>
          {level === "over"     && <span className={colors.badge}>{t("tokens.budgetOver")}</span>}
          {level === "critical" && <span className={colors.badge}>{t("tokens.budgetCritical")}</span>}
          <span className="font-mono tabular-nums">
            {used.toLocaleString()}
            <span className="text-muted-foreground font-normal">{" / "}{limit.toLocaleString()}</span>
          </span>
        </span>
      </div>
      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${colors.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BudgetProgress({
  summary, budget, onGoSettings,
}: {
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
        <button onClick={onGoSettings} className="text-[11px] text-primary hover:underline">
          {t("tokens.budgetGoSettings")}
        </button>
      </div>
      <div className="space-y-3">
        {hasDaily   && <BudgetBar label={t("tokens.budgetDailyProgress")}   used={summary.total24h}   limit={budget.dailyLimit} />}
        {hasMonthly && <BudgetBar label={t("tokens.budgetMonthlyProgress")} used={summary.totalMonth} limit={budget.monthlyLimit} />}
      </div>
    </div>
  );
}

// ── AnomalyAlert ────────────────────────────────────────────────────────────

function AnomalyAlert({
  summary,
  instanceName,
  onKill,
  killLoading,
  killDone,
  killError,
}: {
  summary: UsageSummary;
  instanceName?: string;
  onKill: (ratio: string) => void;
  killLoading: boolean;
  killDone: boolean;
  killError: string | null;
}) {
  const { t } = useTranslation();
  if (!summary.anomaly) return null;

  const ratio = summary.anomalyRatio?.toFixed(1) ?? "3.0";

  const handleKill = () => onKill(ratio);

  return (
    <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/8 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-700">
            {instanceName
              ? t("tokens.anomalyPerInstance", { name: instanceName })
              : t("tokens.anomalyTitle")}
          </p>
          <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed">
            {t("tokens.anomalyMsg", {
              total: summary.total24h.toLocaleString(),
              avg:   Math.round(summary.avg7d).toLocaleString(),
              ratio,
            })}
          </p>
          {killError && <p className="text-xs text-red-600 mt-1">{killError}</p>}
        </div>
      </div>
      {!killDone ? (
        <button
          onClick={handleKill}
          disabled={killLoading}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {killLoading ? <RefreshCw size={14} className="animate-spin" /> : <PowerOff size={14} />}
          {killLoading ? t("security.killSwitchWorking") : t("tokens.anomalyKillBtn")}
        </button>
      ) : (
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-100 text-red-700 text-sm font-semibold">
          <PowerOff size={14} />
          {t("tokens.anomalyKillDone")}
        </div>
      )}
    </div>
  );
}

// ── InstanceTabs ────────────────────────────────────────────────────────────

function InstanceTabs({
  instances,
  selected,
  onSelect,
}: {
  instances: InstanceOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  if (instances.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          selected === null
            ? "bg-primary text-primary-foreground"
            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {t("tokens.allInstances")}
      </button>
      {instances.map((inst) => (
        <button
          key={inst.id}
          onClick={() => onSelect(inst.id)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selected === inst.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            inst.health === "online" ? "bg-emerald-400" :
            inst.health === "offline" ? "bg-red-400" : "bg-gray-400"
          }`} />
          {inst.name}
        </button>
      ))}
    </div>
  );
}

// ── Main TokenPageContent ───────────────────────────────────────────────────

export const TokenPageContent = forwardRef<TokenPageContentRef, TokenPageContentProps>(function TokenPageContent({
  instances = [],
  selectedInstanceId = null,
  onSelectInstance,
  showInstanceSelector = false,
  showCostAnalysis = false,
  onKillSwitch,
  onGoSettings,
  killLoading = false,
  killDone = false,
  killError = null,
  instanceName,
  onLoadingChange,
}, ref) {
  const { t } = useTranslation();
  const setAnomaly = useTokenAnomalyStore((s) => s.setAnomaly);

  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>(getDisplayCurrency);
  const [exchangeRate] = useState<number>(getExchangeRate);

  const handleCurrencyChange = (c: DisplayCurrency) => {
    setDisplayCurrency(c);
    setDisplayCurrencyState(c);
  };

  const [globalBudget, setGlobalBudget] = useState<TokenBudget>(getBudget);
  const [instanceBudget, setInstanceBudget] = useState<TokenBudget | null>(null);

  useEffect(() => {
    if (selectedInstanceId) {
      const ib = getInstanceBudget(selectedInstanceId);
      setInstanceBudget(ib.enabled ? ib : null);
    } else {
      setInstanceBudget(null);
    }
  }, [selectedInstanceId]);

  const effectiveBudget = instanceBudget ?? globalBudget;

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeDone, setPurgeDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getUsageSummary(selectedInstanceId ?? undefined);
      setSummary(s);
      if (!selectedInstanceId) setAnomaly(s.anomaly);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Token summary error:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedInstanceId, setAnomaly]);

  useImperativeHandle(ref, () => ({ refresh: load }), [load]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    load();
    const timer = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setGlobalBudget(getBudget());
      if (selectedInstanceId) {
        const ib = getInstanceBudget(selectedInstanceId);
        setInstanceBudget(ib.enabled ? ib : null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [selectedInstanceId]);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    try {
      await purgeOldRecords(30);
      setPurgeDone(true);
      setTimeout(() => setPurgeDone(false), 3000);
    } catch (e) {
      console.error("purge failed:", e);
    } finally {
      setPurging(false);
    }
  }, []);

  const peak     = summary ? Math.max(...summary.hourly.map((h) => h.totalTokens), 0) : 0;
  const avgHourly = summary ? Math.round(summary.total24h / 24) : 0;

  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity size={22} className="text-primary" />
            {t("tokens.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {selectedInstance
              ? `${selectedInstance.name} · ${selectedInstance.kind === "remote" ? "远程" : "本地"}`
              : t("tokens.desc")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {showCostAnalysis && (
            <CurrencySelector value={displayCurrency} onChange={handleCurrencyChange} />
          )}
          {lastRefresh && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock size={11} />
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? t("tokens.loading") : t("tokens.refresh")}
          </button>
        </div>
      </div>

      {showInstanceSelector && instances.length > 0 && (
        <InstanceTabs
          instances={instances}
          selected={selectedInstanceId}
          onSelect={(id) => {
            onSelectInstance?.(id);
            setSummary(null);
          }}
        />
      )}

      {summary && onKillSwitch && (
        <AnomalyAlert
          summary={summary}
          {...(instanceName ? { instanceName } : {})}
          onKill={(ratio) => onKillSwitch(ratio)}
          killLoading={killLoading}
          killDone={killDone}
          killError={killError}
        />
      )}

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

      {summary && effectiveBudget.enabled && (
        <BudgetProgress
          summary={summary}
          budget={effectiveBudget}
          onGoSettings={onGoSettings}
        />
      )}

      {showInstanceSelector && !selectedInstanceId && summary && summary.instanceBreakdown.length >= 1 && (
        <InstanceBreakdownSection
          breakdown={summary.instanceBreakdown}
          instances={instances}
          onSelect={(id) => {
            onSelectInstance?.(id);
            setSummary(null);
          }}
        />
      )}

      {summary && <BreakdownSection summary={summary} />}

      {showCostAnalysis && summary && summary.modelBreakdown.length > 0 && (
        <CostSection
          summary={summary}
          displayCurrency={displayCurrency}
          exchangeRate={exchangeRate}
          onGoSettings={onGoSettings}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">{t("tokens.tipsTitle")}</h2>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {(t("tokens.tips", { returnObjects: true }) as string[]).map((tip, i) => (
            <li key={i}>• {tip}</li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end pb-2">
        <button
          onClick={handlePurge}
          disabled={purging}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40"
        >
          <Trash2 size={12} />
          {purging ? t("tokens.purging") : purgeDone ? t("tokens.purgeShortcutDone") : t("tokens.purgeShortcut")}
        </button>
      </div>
    </>
  );
});
