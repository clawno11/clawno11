import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef } from "react";
import {
  CheckCircle, XCircle, AlertTriangle, Download, ExternalLink,
  Loader, Package, X, ShieldCheck,
} from "lucide-react";
import type { DependencyInfo, StepProgress } from "./types";
import { fmtBytes, phaseAwarePct, PHASE_LABELS, DEP_ESTIMATED_SEC } from "./types";
import { TrustBadge } from "./TrustBadge";
import { translateDetail, translateFix } from "./translations";
import type { StepResult } from "../../ipc";
import i18n from "../../i18n";

const L = (zh: string, en: string) => (i18n.language === "en" ? en : zh);

function cardPhaseLabel(phase: string): string {
  const p = PHASE_LABELS[phase];
  if (!p) return "";
  return i18n.language === "en" ? p.en : p.zh;
}

const CARD_PHASE_COLORS: Record<string, string> = {
  probing: "text-sky-500",
  downloading: "text-blue-500",
  downloaded: "text-green-500",
  installing: "text-amber-600",
  verifying: "text-emerald-500",
  retrying: "text-amber-500",
  "strategy-switch": "text-blue-500",
  "waiting-for-user": "text-amber-500",
  done: "text-green-500",
};

const CARD_PHASE_BAR: Record<string, string> = {
  probing: "bg-sky-400",
  downloading: "bg-primary",
  downloaded: "bg-green-500",
  installing: "bg-amber-500",
  verifying: "bg-emerald-500",
  retrying: "bg-amber-500 animate-pulse",
  "strategy-switch": "bg-blue-500",
  "waiting-for-user": "bg-amber-400 animate-pulse",
};

const CARD_PHASE_ICONS: Record<string, React.ReactNode> = {
  downloading: <Download size={10} />,
  installing:  <Package size={10} />,
  verifying:   <ShieldCheck size={10} />,
};

interface DependencyCardProps {
  dep: DependencyInfo;
  isInstalling: boolean;
  canInstall: boolean;
  disabledReason?: string;
  onInstall: (depId: string) => void;
  installProgress?: StepProgress | null;
  installResult?: StepResult | null;
  installPhase?: "installing" | "done" | "error";
  onClearResult?: () => void;
}

export function DependencyCard({
  dep, isInstalling, canInstall, disabledReason, onInstall,
  installProgress, installResult, installPhase, onClearResult,
}: DependencyCardProps) {
  useTranslation();

  const isSatisfied = dep.status === "satisfied";
  const isUpgrade = dep.status === "needs-upgrade";
  const isMissing = dep.status === "not-installed";
  const showProgress = isInstalling && installProgress;
  const showResult = !isInstalling && installResult && (installPhase === "done" || installPhase === "error");

  // Elapsed time counter for phase-aware progress
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isInstalling) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isInstalling]);

  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      isSatisfied ? "border-green-200 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/20" :
      isUpgrade   ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20" :
                    "border-border bg-card"
    }`}>
      {/* Header: name + status badge */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">{dep.displayName}</span>
          {dep.isOptional && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {L("可选", "Optional")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isSatisfied && (
            <>
              <CheckCircle size={14} className="text-green-500" />
              <span className="text-xs text-green-600 font-medium">{L("已安装", "Installed")}</span>
            </>
          )}
          {isUpgrade && (
            <>
              <AlertTriangle size={14} className="text-amber-500" />
              <span className="text-xs text-amber-600 font-medium">{L("需要升级", "Needs Upgrade")}</span>
            </>
          )}
          {isMissing && !dep.isOptional && (
            <>
              <XCircle size={14} className="text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground">{L("未安装", "Not Installed")}</span>
            </>
          )}
          {isMissing && dep.isOptional && (
            <span className="text-xs text-muted-foreground">{L("未检测", "Not Detected")}</span>
          )}
        </div>
      </div>

      {/* Version info */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
        <span>{L("要求", "Required")}: <span className="font-mono">{dep.requiredVersion}</span></span>
        {dep.currentVersion && (
          <span>{L("当前", "Current")}: <span className="font-mono font-semibold text-foreground">{dep.currentVersion}</span></span>
        )}
        {isMissing && dep.sizeEstimateMb > 0 && (
          <span>{L("预计大小", "Est. size")}: ~{fmtBytes(dep.sizeEstimateMb * 1048576)}</span>
        )}
      </div>

      {/* Sources */}
      <div className="space-y-1 mb-3">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
          {L("下载源", "Sources")}
        </p>
        {dep.sources.map((src, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <TrustBadge level={src.trustLevel} />
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline truncate flex items-center gap-1"
              title={src.url}
            >
              <span className="truncate">{src.label}</span>
              <ExternalLink size={10} className="flex-shrink-0" />
            </a>
            {src.isPrimary && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                {L("首选", "Primary")}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Strategies */}
      {dep.strategies.length > 0 && !isSatisfied && (
        <div className="mb-3">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-1">
            {L("安装策略", "Install Strategies")}
          </p>
          <div className="flex flex-wrap gap-1">
            {dep.strategies.map((s, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">
                {i + 1}. {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Inline install progress (phase-aware) */}
      {showProgress && (() => {
        const phase = installProgress.phase;
        const estSec = DEP_ESTIMATED_SEC[dep.id] ?? 30;
        const pct = Math.min(99, phaseAwarePct(installProgress, elapsed, estSec));
        const barColor = CARD_PHASE_BAR[phase] ?? "bg-primary";
        const barAnimated = phase === "installing" || phase === "probing";
        const phaseLbl = cardPhaseLabel(phase);
        const phaseColor = CARD_PHASE_COLORS[phase] ?? "text-primary";
        const phaseIcon = CARD_PHASE_ICONS[phase];
        const isDownloading = phase === "downloading";

        return (
          <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Loader size={12} className="animate-spin text-primary" />
                <span className="font-medium text-primary">
                  {installProgress.message || installProgress.strategyName || L("安装中…", "Installing…")}
                </span>
              </div>
              <span className="font-mono text-muted-foreground text-[10px]">{Math.round(pct)}%</span>
            </div>

            {/* Phase label */}
            {phaseLbl && phase !== "done" && (
              <div className="flex items-center gap-1">
                <span className={`flex items-center gap-1 text-[11px] font-medium ${phaseColor}`}>
                  {phaseIcon}
                  {phaseLbl}
                </span>
              </div>
            )}

            {/* Phase-aware progress bar */}
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-linear ${barColor}`}
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  ...(barAnimated ? {
                    backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.15) 50%, rgba(255,255,255,.15) 75%, transparent 75%, transparent)",
                    backgroundSize: "1rem 1rem",
                    animation: "progress-stripes 1s linear infinite",
                  } : {}),
                }}
              />
            </div>

            {/* Details row */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {installProgress.strategyTotal > 1 && (
                  <>{L("策略", "Strategy")} {installProgress.strategyIdx + 1}/{installProgress.strategyTotal}: {installProgress.strategyName}</>
                )}
              </span>
              <span className="flex items-center gap-2">
                {isDownloading && installProgress.bytesDone > 0 && (
                  <span>{fmtBytes(installProgress.bytesDone)}{installProgress.bytesTotal > 0 && ` / ${fmtBytes(installProgress.bytesTotal)}`}</span>
                )}
                {isDownloading && installProgress.speedBps > 0 && (
                  <span>{fmtBytes(installProgress.speedBps)}/s</span>
                )}
                {!isDownloading && elapsed > 0 && (
                  <span>{elapsed}s</span>
                )}
              </span>
            </div>

            {installProgress.isRetrying && installProgress.remedy && (
              <div className="text-[10px] text-amber-600 flex items-center gap-1">
                <AlertTriangle size={10} />
                {L("自愈中", "Self-healing")}: {installProgress.remedy}
              </div>
            )}
          </div>
        );
      })()}

      {/* Install result (inline) */}
      {showResult && (
        <div className={`mb-3 rounded-lg border p-3 text-xs ${
          installResult.ok
            ? "border-green-200 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/20"
            : "border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20"
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              {installResult.ok
                ? <CheckCircle size={13} className="text-green-500" />
                : <XCircle size={13} className="text-red-500" />
              }
              <span className={`font-medium ${installResult.ok ? "text-green-700" : "text-red-700"}`}>
                {installResult.ok ? L("安装成功", "Installed") : L("安装失败", "Failed")}
              </span>
            </div>
            {onClearResult && (
              <button onClick={onClearResult} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          {installResult.detail && (
            <p className="text-muted-foreground">{translateDetail(installResult.detail)}</p>
          )}
          {installResult.fixes_applied.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {installResult.fixes_applied.map((f, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">
                  {translateFix(f)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Install button */}
      {!isSatisfied && dep.id !== "npm" && !showProgress && (
        <button
          onClick={() => onInstall(dep.id)}
          disabled={isInstalling || !canInstall}
          title={!canInstall ? disabledReason : undefined}
          className="w-full mt-1 py-2 px-3 text-xs font-semibold rounded-lg transition-colors
                     flex items-center justify-center gap-2
                     bg-primary text-primary-foreground hover:bg-primary/90
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isInstalling ? (
            <>
              <Loader size={14} className="animate-spin" />
              {L("安装中…", "Installing…")}
            </>
          ) : (
            <>
              <Download size={14} />
              {isUpgrade ? L("升级", "Upgrade") : L("安装", "Install")}
            </>
          )}
        </button>
      )}
    </div>
  );
}
