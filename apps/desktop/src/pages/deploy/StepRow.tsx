import { useTranslation } from "react-i18next";
import {
  CheckCircle, XCircle, Loader, Circle, Clock, Wrench,
  Download, Wifi, WifiOff, RefreshCw, ArrowRightLeft,
} from "lucide-react";
import type { StepState } from "./types";
import { fmtSec, fmtBytes, fmtSpeed, fmtEta, fmtEtaFromProgress } from "./types";
import { translateDetail, translateFix } from "./translations";
import i18n from "../../i18n";

const L = (zh: string, en: string) => i18n.language === "en" ? en : zh;

export function StepRow({ step, isActive }: { step: StepState; isActive: boolean }) {
  useTranslation();

  const dl = step.downloadProgress;
  const sp = step.progress;

  // Use real progress from the self-healing engine when available
  const hasNewProgress = sp && sp.pct > 0;
  const hasLegacyProgress = dl && dl.bytesTotal > 0 && dl.phase === "downloading";

  const pct = isActive
    ? hasNewProgress
      ? Math.min(99, sp.pct)
      : hasLegacyProgress
        ? Math.min(99, (dl.bytesDownloaded / dl.bytesTotal) * 100)
        : Math.min(99, (step.elapsedSec / step.estimatedSec) * 100)
    : step.status === "done" || step.status === "error"
      ? 100
      : 0;

  const isRetrying = sp?.isRetrying ?? false;
  const isStrategySwitching = sp?.phase === "strategy-switch";
  const isDownloading = sp?.phase === "downloading" || (dl?.phase === "downloading");

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
            </p>

            {/* time / progress badge */}
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
              {step.status === "running" && (hasNewProgress || hasLegacyProgress) ? (
                <>
                  <Download size={11} />
                  {hasNewProgress && sp.bytesTotal > 0 ? (
                    <span className="tabular-nums">
                      {fmtBytes(sp.bytesDone)} / {fmtBytes(sp.bytesTotal)}
                    </span>
                  ) : hasLegacyProgress ? (
                    <span className="tabular-nums">
                      {fmtBytes(dl.bytesDownloaded)} / {fmtBytes(dl.bytesTotal)}
                    </span>
                  ) : null}
                </>
              ) : (
                <Clock size={11} />
              )}
              {step.status === "running" && !hasNewProgress && !hasLegacyProgress && (
                <span className="tabular-nums">{fmtSec(step.elapsedSec)}</span>
              )}
              {step.status === "done" && (
                <span className="text-green-600">{fmtSec(step.elapsedSec)}</span>
              )}
              {step.status === "error" && (
                <span className="text-red-500">{fmtSec(step.elapsedSec)}</span>
              )}
              {step.status === "pending" && (
                <span>~{fmtSec(step.estimatedSec)}</span>
              )}
            </span>
          </div>

          {/* New progress details from self-healing engine */}
          {step.status === "running" && sp && (
            <div className="mt-1 space-y-0.5">
              {/* Strategy indicator */}
              {sp.strategyTotal > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                    {sp.strategyIdx + 1}/{sp.strategyTotal}
                  </span>
                  <span className="font-medium">{sp.strategyName}</span>
                </div>
              )}

              {/* Download speed + ETA */}
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

              {/* Strategy switch message */}
              {isStrategySwitching && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600">
                  <ArrowRightLeft size={11} />
                  <span>{sp.message}</span>
                </div>
              )}

              {/* Retry + remedy info */}
              {isRetrying && sp.remedy && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600">
                  <Wrench size={11} />
                  <span>{sp.remedy}</span>
                </div>
              )}

              {/* Status message for non-download phases */}
              {!isDownloading && !isStrategySwitching && !(isRetrying && sp.remedy) && sp.message && (
                <p className="text-xs text-muted-foreground truncate">{sp.message}</p>
              )}
            </div>
          )}

          {/* Legacy download details (no new progress) */}
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

          {/* hint when pending */}
          {step.status === "pending" && step.hint && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{step.hint}</p>
          )}

          {/* detail when done/error */}
          {step.detail && step.status !== "pending" && (
            <p className={`text-xs mt-0.5 ${step.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
              {translateDetail(step.detail)}
            </p>
          )}

          {/* auto-fixes badge */}
          {step.status === "done" && step.fixes_applied.length > 0 && (
            <div className="mt-1.5 flex items-start gap-1">
              <Wrench size={11} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-600">
                {L("自动修复：", "Auto-fixed: ")}{step.fixes_applied.map(translateFix).join(", ")}
              </p>
            </div>
          )}

          {/* progress bar */}
          {(step.status === "running" || step.status === "done" || step.status === "error") && (
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-linear ${
                  step.status === "done"  ? "bg-green-500" :
                  step.status === "error" ? "bg-red-500"   :
                  isRetrying ? "bg-amber-500 animate-pulse" :
                  isStrategySwitching ? "bg-blue-500" : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
