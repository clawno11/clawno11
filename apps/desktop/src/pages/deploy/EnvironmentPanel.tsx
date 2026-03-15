import { useTranslation } from "react-i18next";
import {
  Monitor, Cpu, HardDrive, MemoryStick, Shield, Wifi, Loader,
  RefreshCw, ChevronDown, ChevronUp, AlertTriangle, ExternalLink,
} from "lucide-react";
import { useState } from "react";
import type { EnvironmentReport, DependencyInfo } from "./types";
import { fmtBytes } from "./types";
import { DependencyCard } from "./DependencyCard";
import { TrustBadge } from "./TrustBadge";
import i18n from "../../i18n";

const L = (zh: string, en: string) => (i18n.language === "en" ? en : zh);

interface EnvironmentPanelProps {
  phase: "idle" | "scanning" | "done" | "error";
  report: EnvironmentReport | null;
  error: string | null;
  onRescan: () => void;
  onInstallDep: (depId: string) => void;
  installingDep: string | null;
  advancedMode: boolean;
  collapsed?: boolean;
  depInstallState?: import("./useEnvironmentScan").DepInstallState | null;
  onClearInstallResult?: () => void;
}

function canInstallDep(dep: DependencyInfo, allDeps: DependencyInfo[]): { ok: boolean; reason?: string } {
  if (dep.id === "npm") {
    return { ok: false, reason: L("npm 随 Node.js 一起安装", "npm is bundled with Node.js") };
  }
  if (dep.id === "openclaw" || dep.id === "pm2") {
    const node = allDeps.find((d) => d.id === "nodejs");
    if (!node || node.status !== "satisfied") {
      return { ok: false, reason: L("请先安装 Node.js", "Install Node.js first") };
    }
    const npm = allDeps.find((d) => d.id === "npm");
    if (!npm || npm.status !== "satisfied") {
      return { ok: false, reason: L("请先安装 npm", "Install npm first") };
    }
  }
  return { ok: true };
}

export function EnvironmentPanel({
  phase, report, error, onRescan, onInstallDep, installingDep, advancedMode,
  collapsed = false, depInstallState, onClearInstallResult,
}: EnvironmentPanelProps) {
  useTranslation();
  const [showSystemInfo, setShowSystemInfo] = useState(false);

  if (phase === "scanning" || phase === "idle") {
    return (
      <div className="mb-5 rounded-xl border border-border bg-card p-5 flex items-center gap-3">
        <Loader size={18} className="text-primary animate-spin flex-shrink-0" />
        <p className="text-sm text-muted-foreground">{L("正在检测系统环境…", "Scanning system environment…")}</p>
      </div>
    );
  }

  if (phase === "error" || !report) {
    return (
      <div className="mb-5 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="text-sm font-semibold text-red-600">{L("环境检测失败", "Environment scan failed")}</span>
        </div>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <button
          onClick={onRescan}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <RefreshCw size={12} />
          {L("重新检测", "Rescan")}
        </button>
      </div>
    );
  }

  const requiredDeps = report.dependencies.filter((d) => !d.isOptional);
  const optionalDeps = report.dependencies.filter((d) => d.isOptional);
  const missingRequired = requiredDeps.filter((d) => d.status !== "satisfied");
  const availablePMs = report.packageManagers.filter((pm) => pm.available);
  const satisfiedCount = requiredDeps.length - missingRequired.length;

  if (collapsed) {
    return (
      <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <Monitor size={14} className="text-primary" />
            <span className="font-medium">{L("环境依赖", "Dependencies")}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {requiredDeps.map((dep) => (
              <span key={dep.id} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  dep.status === "satisfied" ? "bg-green-500" :
                  dep.status === "needs-upgrade" ? "bg-amber-500" : "bg-red-400"
                }`} />
                <span className="text-muted-foreground">{dep.displayName}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-4">
      {/* System info (collapsible) */}
      <div className="rounded-xl border border-border bg-card">
        <div
          role="button"
          tabIndex={0}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors rounded-xl cursor-pointer select-none"
          onClick={() => setShowSystemInfo(!showSystemInfo)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowSystemInfo(!showSystemInfo); }}
        >
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-primary" />
            <span className="text-sm font-semibold">{L("系统环境", "System Environment")}</span>
            <span className="text-xs text-muted-foreground">
              {report.os} {report.osVersion} • {report.arch}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onRescan(); }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <RefreshCw size={12} />
            </button>
            {showSystemInfo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>

        {showSystemInfo && (
          <div className="px-4 pb-4 space-y-3">
            {/* System specs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Cpu size={13} className="text-muted-foreground" />
                <span className="text-muted-foreground">{L("架构", "Arch")}:</span>
                <span className="font-mono font-medium">{report.arch}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <MemoryStick size={13} className="text-muted-foreground" />
                <span className="text-muted-foreground">{L("内存", "Memory")}:</span>
                <span className="font-mono font-medium">{fmtBytes(report.totalMemoryMb * 1048576)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <HardDrive size={13} className="text-muted-foreground" />
                <span className="text-muted-foreground">{L("可用磁盘", "Free Disk")}:</span>
                <span className={`font-mono font-medium ${report.freeDiskMb < 500 ? "text-red-500" : ""}`}>
                  {fmtBytes(report.freeDiskMb * 1048576)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Shield size={13} className="text-muted-foreground" />
                <span className="text-muted-foreground">{L("管理员", "Admin")}:</span>
                <span className={`font-medium ${report.isAdmin ? "text-green-600" : "text-muted-foreground"}`}>
                  {report.isAdmin ? L("是", "Yes") : L("否", "No")}
                </span>
              </div>
            </div>

            {report.httpProxy && (
              <div className="flex items-center gap-2 text-xs">
                <Wifi size={13} className="text-muted-foreground" />
                <span className="text-muted-foreground">{L("代理", "Proxy")}:</span>
                <span className="font-mono text-amber-600">{report.httpProxy}</span>
              </div>
            )}

            {/* Package managers */}
            {availablePMs.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-1.5">
                  {L("可用包管理器", "Available Package Managers")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availablePMs.map((pm) => (
                    <span
                      key={pm.name}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono"
                      title={pm.version || undefined}
                    >
                      {pm.name}{pm.version ? ` ${pm.version.split("\n")[0]?.substring(0, 12)}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Disk warning */}
            {report.freeDiskMb > 0 && report.freeDiskMb < 500 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <span className="text-xs text-red-600">
                  {L(
                    `磁盘空间不足（仅剩 ${fmtBytes(report.freeDiskMb * 1048576)}），至少需要 500MB`,
                    `Low disk space (${fmtBytes(report.freeDiskMb * 1048576)} remaining), at least 500MB needed`,
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dependencies — always visible */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {L("依赖清单", "Dependencies")}
            {missingRequired.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                {missingRequired.length} {L("待安装", "to install")}
              </span>
            )}
            {missingRequired.length === 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400">
                {L("全部就绪", "All ready")}
              </span>
            )}
          </h3>
        </div>

        <div className="space-y-3">
          {requiredDeps.map((dep) => {
            const { ok, reason } = canInstallDep(dep, report.dependencies);
            const isThisDep = depInstallState?.depId === dep.id;
            return advancedMode ? (
              <DependencyCard
                key={dep.id}
                dep={dep}
                isInstalling={installingDep === dep.id}
                canInstall={ok}
                {...(reason != null ? { disabledReason: reason } : {})}
                onInstall={onInstallDep}
                {...(isThisDep ? {
                  installProgress: depInstallState.progress,
                  installResult: depInstallState.result,
                  installPhase: depInstallState.phase,
                  onClearResult: onClearInstallResult,
                } : {})}
              />
            ) : (
              <DependencyCompactRow key={dep.id} dep={dep} />
            );
          })}
        </div>

        {/* Optional deps */}
        {optionalDeps.length > 0 && (
          <>
            <div className="my-3 border-t border-border" />
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">
              {L("可选依赖", "Optional")}
            </p>
            <div className="space-y-3">
              {optionalDeps.map((dep) => {
                const { ok, reason } = canInstallDep(dep, report.dependencies);
                const isThisDep = depInstallState?.depId === dep.id;
                return advancedMode ? (
                  <DependencyCard
                    key={dep.id}
                    dep={dep}
                    isInstalling={installingDep === dep.id}
                    canInstall={ok}
                    {...(reason != null ? { disabledReason: reason } : {})}
                    onInstall={onInstallDep}
                    {...(isThisDep ? {
                      installProgress: depInstallState.progress,
                      installResult: depInstallState.result,
                      installPhase: depInstallState.phase,
                      onClearResult: onClearInstallResult,
                    } : {})}
                  />
                ) : (
                  <DependencyCompactRow key={dep.id} dep={dep} />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DependencyCompactRow({ dep }: { dep: DependencyInfo }) {
  const isSatisfied = dep.status === "satisfied";
  const isUpgrade = dep.status === "needs-upgrade";
  const isMissing = !isSatisfied && !isUpgrade;
  const primarySource = dep.sources.find((s) => s.isPrimary) ?? dep.sources[0];

  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${
      isSatisfied ? "border-green-200/60 bg-green-50/30 dark:border-green-900/20 dark:bg-green-950/10" :
      isUpgrade   ? "border-amber-200/60 bg-amber-50/30 dark:border-amber-900/20 dark:bg-amber-950/10" :
                    "border-red-200/60 bg-red-50/30 dark:border-red-900/20 dark:bg-red-950/10"
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSatisfied && <span className="w-2 h-2 rounded-full bg-green-500" />}
          {isUpgrade && <span className="w-2 h-2 rounded-full bg-amber-500" />}
          {isMissing && <span className="w-2 h-2 rounded-full bg-red-400" />}
          <span className="text-sm font-medium">{dep.displayName}</span>
          {dep.isOptional && (
            <span className="text-[10px] text-muted-foreground">{L("（可选）", "(optional)")}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {dep.currentVersion && (
            <span className="font-mono text-muted-foreground">{dep.currentVersion}</span>
          )}
          {isSatisfied && <span className="text-green-600 font-medium">{L("已就绪", "Ready")}</span>}
          {isUpgrade && <span className="text-amber-600 font-medium">{L("需升级", "Upgrade")}</span>}
          {isMissing && <span className="text-red-500 font-medium">{L("未安装", "Missing")}</span>}
        </div>
      </div>

      {/* Source info row */}
      {primarySource && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <TrustBadge level={primarySource.trustLevel} compact />
          <span className="text-muted-foreground/70">
            {primarySource.label}
          </span>
          {!isSatisfied && primarySource.url && (
            <a
              href={primarySource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline hover:text-primary flex items-center gap-0.5 truncate max-w-[220px]"
              title={primarySource.url}
            >
              <span className="truncate">{primarySource.url.replace(/^https?:\/\//, "")}</span>
              <ExternalLink size={9} className="flex-shrink-0" />
            </a>
          )}
          {dep.strategies.length > 0 && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {dep.strategies[0]}
            </span>
          )}
        </div>
      )}

      {/* Required version hint */}
      {isMissing && dep.requiredVersion && (
        <div className="mt-1 text-[10px] text-muted-foreground/70">
          {L("需要版本", "Required")}: {dep.requiredVersion}
          {dep.sizeEstimateMb > 0 && ` · ~${dep.sizeEstimateMb}MB`}
        </div>
      )}
    </div>
  );
}
