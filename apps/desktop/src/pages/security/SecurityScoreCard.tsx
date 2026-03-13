import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import {
  type SecurityReport,
  CHECK_WEIGHTS,
  checkContrib,
  scoreGrade,
  StatusIcon,
} from "./types";

export function ScoreRing({ score, onClick }: { score: number; onClick?: () => void }) {
  const { t } = useTranslation();
  const color =
    score >= 85 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${onClick ? "cursor-pointer group" : ""}`}
      onClick={onClick}
      title={onClick ? t("security.scoreBreakdownHint") : undefined}
    >
      <svg width={112} height={112} viewBox="0 0 112 112"
        className={onClick ? "transition-transform group-hover:scale-105" : ""}
      >
        <circle cx={56} cy={56} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={10} />
        <circle
          cx={56} cy={56} r={r} fill="none"
          stroke={color} strokeWidth={10}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 56 56)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x={56} y={60} textAnchor="middle" fontSize={24} fontWeight={700} fill={color}>
          {score}
        </text>
      </svg>
      <div className="text-center">
        <p className="text-xs text-muted-foreground">
          {t("security.score")}
          {onClick && <span className="ml-1 opacity-60">↗</span>}
        </p>
        <p className="text-[11px] font-semibold mt-0.5" style={{ color }}>
          {scoreGrade(score, t)}
        </p>
      </div>
    </div>
  );
}

export function ScoreBreakdownPanel({
  report,
  onClose,
}: {
  report: SecurityReport;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  const contribColor = (status: string) =>
    status === "ok"     ? "text-green-600"  :
    status === "notice" ? "text-blue-500"   :
    status === "warn"   ? "text-amber-600"  :
    status === "danger" ? "text-red-600"    : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-primary" />
          {t("security.scoreBreakdownTitle")}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {t("security.scoreBreakdownClose")} ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{t("security.gradeLegendOk")}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{t("security.gradeLegendWarn")}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{t("security.gradeLegendDanger")}</span>
        <span className="ml-auto font-semibold text-foreground">{t("security.gradeTotal")}：{report.score} / 100</span>
      </div>

      <div className="space-y-1.5">
        {report.checks.map((c) => {
          const pts    = checkContrib(c);
          const maxPts = CHECK_WEIGHTS[c.id] ?? 0;
          const labelKey = `security.checkLabels.${c.id}`;
          const label = i18n.exists(labelKey) ? t(labelKey) : c.label;
          const pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
          return (
            <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
              c.status === "ok"     ? "border-green-500/20 bg-green-500/5"  :
              c.status === "notice" ? "border-blue-400/25 bg-blue-400/5"   :
              c.status === "warn"   ? "border-amber-500/20 bg-amber-500/5"  :
              c.status === "danger" ? "border-red-500/20 bg-red-500/5"      :
              "border-border bg-muted/20"
            }`}>
              <StatusIcon status={c.status} />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{label}</span>
                <div className="mt-1 h-1 w-full rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background:
                        c.status === "ok"     ? "#22c55e" :
                        c.status === "notice" ? "#60a5fa" :
                        c.status === "warn"   ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
              </div>
              <span className={`font-bold tabular-nums flex-shrink-0 ${contribColor(c.status)}`}>
                +{pts}<span className="text-muted-foreground font-normal">/{maxPts}</span>
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                c.status === "ok"     ? "text-green-700 bg-green-100"  :
                c.status === "notice" ? "text-blue-700  bg-blue-100"   :
                c.status === "warn"   ? "text-amber-700 bg-amber-100"  :
                c.status === "danger" ? "text-red-700   bg-red-100"    :
                "text-muted-foreground bg-muted"
              }`}>
                {t(`security.checkStatus.${c.status}`)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between px-1 pt-1 border-t border-border">
        <p className="text-[11px] text-muted-foreground">{t("security.scoreBreakdownHint")}</p>
        <span className="text-xs font-bold" style={{
          color: report.score >= 85 ? "#22c55e" : report.score >= 65 ? "#f59e0b" : "#ef4444"
        }}>
          {scoreGrade(report.score, t)}
        </span>
      </div>
    </div>
  );
}
