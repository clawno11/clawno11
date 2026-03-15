import { useTranslation } from "react-i18next";
import {
  CheckCircle, XCircle, Loader, Circle, Clock, Wrench,
  Download, Package, Wifi, WifiOff, RefreshCw, ArrowRightLeft,
  ExternalLink, ShieldCheck,
} from "lucide-react";
import type { StepState } from "./types";
import { fmtSec, fmtBytes, fmtSpeed, fmtEta, fmtEtaFromProgress, phaseAwarePct, PHASE_LABELS } from "./types";
import { translateDetail, translateFix } from "./translations";
import { TrustBadge } from "./TrustBadge";
import i18n from "../../i18n";

const L = (zh: string, en: string) => i18n.language === "en" ? en : zh;

function phaseLabel(phase: string): string {
  const p = PHASE_LABELS[phase];
  if (!p) return "";
  return i18n.language === "en" ? p.en : p.zh;
}

const PHASE_COLORS: Record<string, string> = {
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

const PHASE_BAR_COLORS: Record<string, string> = {
  probing: "bg-sky-400",
  downloading: "bg-primary",
  downloaded: "bg-green-500",
  installing: "bg-amber-500",
  verifying: "bg-emerald-500",
  retrying: "bg-amber-500 animate-pulse",
  "strategy-switch": "bg-blue-500",
  "waiting-for-user": "bg-amber-400 animate-pulse",
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  downloading: <Download size={11} />,
  downloaded:  <CheckCircle size={11} />,
  installing:  <Package size={11} />,
  verifying:   <ShieldCheck size={11} />,
  "waiting-for-user": <Clock size={11} />,
};

export function StepRow({ step, isActive }: { step: StepState; isActive: boolean }) {
  useTranslation();

  const dl = step.downloadProgress;
  const sp = step.progress;

  const currentPhase = sp?.phase ?? (dl?.phase === "downloading" ? "downloading" : undefined);

  const pct = isActive
    ? Math.min(99, phaseAwarePct(sp, step.elapsedSec, step.estimatedSec))
    : step.status === "done" || step.status === "error"
      ? 100
      : 0;

  const isRetrying = sp?.isRetrying ?? false;
  const isStrategySwitching = sp?.phase === "strategy-switch";
  const isDownloading = currentPhase === "downloading";
  const isInstalling = currentPhase === "installing";

  const effectiveSourceUrl = sp?.sourceUrl ?? step.sourceUrl;
  const effectiveTrust = sp?.sourceTrust ?? step.trustLevel;
  const effectiveSourceLabel = step.sourceLabel;

  const barColor = step.status === "done"
    ? "bg-green-500"
    : step.status === "error"
      ? "bg-red-500"
      : currentPhase
        ? (PHASE_BAR_COLORS[currentPhase] ?? "bg-primary")
        : "bg-primary";

  const barAnimated = isInstalling || currentPhase === "probing";

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        {/* icon */}
        <div className="w-5 flex-shrink-0 mt-0.5">
          {step.status === "done"    && <CheckCircle size={18} className="text-green-500" />}
          {step.status === "error"   && <XCircle     size={18} className="text-red-500" />}
          {step.status === "running" && isRetrying && <RefreshCw size={18} className="text-amber-500 animate-spin" />}
          {step.status === "running" && isStrategySwitching && <ArrowRightLeft size={18} className="text-blue-500 animate-pulse" />}
          {step.status === "running" && !isRetrying && !isStrategySwitching && <Loader size={18} className="text-primary animate-spin" />}
          {step.status === "pending" && <Circle      size={18} className="text-muted-foreground/30" />}
        </div>

        {/* label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-sm leading-tight ${
              step.status === "pending" ? "text-muted-foreground/50" :
              step.status === "error"   ? "text-red-600 font-medium" :
              step.status === "running" ? "text-foreground font-semibold" :
                                          "text-foreground"
            }`}>
              {step.label}
              {step.status === "done" && step.currentVersion && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">v{step.currentVersion}</span>
              )}
            </p>

            {/* time / progress badge */}
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
              {step.status === "running" && isDownloading && sp && sp.bytesTotal > 0 ? (
                <>
                  <Download size={11} />
                  <span className="tabular-nums">
                    {fmtBytes(sp.bytesDone)} / {fmtBytes(sp.bytesTotal)}
                  </span>
                </>
              ) : step.status === "running" && isDownloading && dl && dl.bytesTotal > 0 ? (
                <>
                  <Download size={11} />
                  <span className="tabular-nums">
                    {fmtBytes(dl.bytesDownloaded)} / {fmtBytes(dl.bytesTotal)}
                  </span>
                </>
              ) : (
                <Clock size={11} />
              )}
              {step.status === "running" && !isDownloading && (
                <span className="tabular-nums">{fmtSec(step.elapsedSec)}</span>
              )}
              {step.status === "done" && (
                <span className="text-green-600">
                  {step.preInstalled ? L("已安装", "installed") : fmtSec(step.elapsedSec)}
                </span>
              )}
              {step.status === "error" && (
                <span className="text-red-500">{fmtSec(step.elapsedSec)}</span>
              )}
              {step.status === "pending" && step.estimatedSec > 0 && (
                <span>~{fmtSec(step.estimatedSec)}</span>
              )}
            </span>
          </div>

          {/* Source info — always shown when available */}
          {effectiveSourceUrl && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              {effectiveTrust && <TrustBadge level={effectiveTrust} />}
              {effectiveSourceLabel && (
                <span className="font-medium text-muted-foreground/70">{effectiveSourceLabel}</span>
              )}
              <a
                href={effectiveSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline truncate flex items-center gap-0.5 text-muted-foreground/60 hover:text-primary"
                title={effectiveSourceUrl}
              >
                <span className="truncate max-w-[240px]">{effectiveSourceUrl}</span>
                <ExternalLink size={9} className="flex-shrink-0" />
              </a>
            </div>
          )}

          {/* New progress details from self-healing engine */}
          {step.status === "running" && sp && (
            <div className="mt-1 space-y-0.5">
              {sp.strategyTotal > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                    {sp.strategyIdx + 1}/{sp.strategyTotal}
                  </span>
                  <span className="font-medium">{sp.strategyName}</span>
                </div>
              )}

              {isDownloading && sp.bytesTotal > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {sp.speedBps > 0
                      ? <Wifi size={11} className="text-green-500" />
                      : <WifiOff size={11} className="text-amber-500" />}
                    <span className="tabular-nums font-medium">{fmtSpeed(sp.speedBps)}</span>
                  </span>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="tabular-nums">
                    {L("剩余", "remaining")} ~{fmtEtaFromProgress(sp)}
                  </span>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="tabular-nums">
                    {L("剩余", "remaining")} {fmtBytes(sp.bytesTotal - sp.bytesDone)}
                  </span>
                </div>
              )}

              {isStrategySwitching && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600">
                  <ArrowRightLeft size={11} />
                  <span>{sp.message}</span>
                </div>
              )}

              {isRetrying && sp.remedy && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600">
                  <Wrench size={11} />
                  <span>{sp.remedy}</span>
                </div>
              )}

              {!isDownloading && !isStrategySwitching && !(isRetrying && sp.remedy) && sp.message && (
                <p className="text-xs text-muted-foreground truncate">{sp.message}</p>
              )}
            </div>
          )}

          {/* Legacy download details */}
          {step.status === "running" && dl && !sp && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {dl.phase === "resolving" && (
                <span>{L("正在获取包信息…", "Resolving package info…")}</span>
              )}
              {dl.phase === "downloading" && dl.bytesTotal > 0 && (
                <>
                  <span className="flex items-center gap-1">
                    {dl.speedBps > 0
                      ? <Wifi size={11} className="text-green-500" />
                      : <WifiOff size={11} className="text-amber-500" />}
                    <span className="tabular-nums font-medium">{fmtSpeed(dl.speedBps)}</span>
                  </span>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="tabular-nums">{L("剩余", "remaining")} ~{fmtEta(dl)}</span>
                </>
              )}
              {dl.phase === "installing-deps" && (
                <span className="flex items-center gap-1">
                  <Loader size={11} className="animate-spin" />
                  {L("正在安装依赖（需要下载）…", "Installing dependencies…")}
                </span>
              )}
            </div>
          )}

          {step.status === "pending" && step.hint && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{step.hint}</p>
          )}

          {step.detail && step.status !== "pending" && (
            <p className={`text-xs mt-0.5 ${step.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
              {translateDetail(step.detail)}
            </p>
          )}

          {step.status === "done" && step.fixes_applied.length > 0 && (
            <div className="mt-1.5 flex items-start gap-1">
              <Wrench size={11} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-600">
                {L("自动修复：", "Auto-fixed: ")}{step.fixes_applied.map(translateFix).join(", ")}
              </p>
            </div>
          )}

          {/* progress bar — skip for pre-installed (instant done) */}
          {(step.status === "running" || step.status === "error" || (step.status === "done" && !step.preInstalled)) && (
            <div className="mt-2">
              {/* Phase label during running */}
              {step.status === "running" && currentPhase && currentPhase !== "done" && (
                <div className="flex items-center gap-1 mb-1">
                  <span className={`flex items-center gap-1 text-[11px] font-medium ${PHASE_COLORS[currentPhase] ?? "text-muted-foreground"}`}>
                    {PHASE_ICONS[currentPhase]}
                    {phaseLabel(currentPhase)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {Math.round(pct)}%
                  </span>
                </div>
              )}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-linear ${barColor}`}
                  style={{
                    width: `${pct}%`,
                    ...(barAnimated && step.status === "running" ? {
                      backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.15) 50%, rgba(255,255,255,.15) 75%, transparent 75%, transparent)",
                      backgroundSize: "1rem 1rem",
                      animation: "progress-stripes 1s linear infinite",
                    } : {}),
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
