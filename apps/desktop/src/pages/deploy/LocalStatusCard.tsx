import { useTranslation } from "react-i18next";
import { Loader, CheckCircle, RefreshCw, Package, Zap, RotateCcw } from "lucide-react";
import type { DeployAction, DeployStatus } from "./types";
import { fmtSec } from "./types";

interface LocalStatusCardProps {
  checkPhase: "checking" | "fresh" | "installed";
  deployStatus: DeployStatus | null;
  isRechecking: boolean;
  isDeploying: boolean;
  runStatusCheck: () => void;
  handleDeploy: (action: DeployAction) => void;
  freshEstSec: number;
}

export function LocalStatusCard(props: LocalStatusCardProps) {
  const { t } = useTranslation();
  const {
    checkPhase, deployStatus, isRechecking, isDeploying,
    runStatusCheck, handleDeploy, freshEstSec,
  } = props;

  return (
    <>
      {/* Checking spinner */}
      {checkPhase === "checking" && (
        <div className="mb-5 rounded-xl border border-border bg-card p-5 flex items-center gap-3">
          <Loader size={18} className="text-primary animate-spin flex-shrink-0" />
          <p className="text-sm text-muted-foreground">{t("deploy.statusChecking")}</p>
        </div>
      )}

      {/* Already installed — show 3-action card */}
      {checkPhase === "installed" && deployStatus && (
        <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-5">
          {/* Status header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-primary" />
              <span className="text-sm font-semibold">{t("deploy.statusInstalled")}</span>
            </div>
            <button
              onClick={() => runStatusCheck()}
              disabled={isRechecking}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isRechecking ? "animate-spin" : ""} />
              {t("deploy.recheckStatus")}
            </button>
          </div>

          {/* Version + service status */}
          <div className="flex items-center gap-4 mb-5 px-1">
            <div className="flex items-center gap-1.5">
              <Package size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t("deploy.statusVersion")}:</span>
              <span className="text-xs font-mono font-semibold">v{deployStatus.openclaw_version}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${deployStatus.service_running ? "bg-green-500" : "bg-red-400"}`} />
              <span className="text-xs text-muted-foreground">
                {deployStatus.service_running ? t("deploy.statusRunning") : t("deploy.statusStopped")}
              </span>
            </div>
          </div>

          {/* 3 action buttons */}
          <div className="grid grid-cols-3 gap-2">
            {/* Update */}
            <button
              onClick={() => handleDeploy("update")}
              disabled={isDeploying}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Zap size={18} />
              <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionUpdate")}</span>
              <span className="text-[10px] opacity-70 text-center leading-tight">{t("deploy.actionUpdateDesc")}</span>
            </button>

            {/* Restart only */}
            <button
              onClick={() => handleDeploy("restart")}
              disabled={isDeploying}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-border hover:border-primary/50 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={18} />
              <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionRestart")}</span>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{t("deploy.actionRestartDesc")}</span>
            </button>

            {/* Full reinstall */}
            <button
              onClick={() => handleDeploy("full")}
              disabled={isDeploying}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 border-border hover:border-primary/50 transition-colors disabled:opacity-50"
            >
              <Package size={18} />
              <span className="text-xs font-semibold text-center leading-tight">{t("deploy.actionReinstall")}</span>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{t("deploy.actionReinstallDesc")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Fresh install — show single deploy button + tip */}
      {checkPhase === "fresh" && (
        <>
          <button
            onClick={() => handleDeploy("full")}
            disabled={isDeploying}
            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                       hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors flex items-center justify-center gap-2 mb-3"
          >
            {t("deploy.startDeploy")}
          </button>
          <p className="text-xs text-muted-foreground text-center">
            {t("deploy.tipFirst", { time: fmtSec(freshEstSec) })}
          </p>
        </>
      )}
    </>
  );
}
