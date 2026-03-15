import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { scanEnvironment, installSingleDep, type EnvironmentReport, type StepResult } from "../../ipc";
import type { EnvironmentReport as FrontendReport, DependencyInfo, DepSource, PackageManagerInfo, StepProgress, TrustLevel } from "./types";

type ScanPhase = "idle" | "scanning" | "done" | "error";

export interface DepInstallState {
  depId: string;
  progress: StepProgress | null;
  result: StepResult | null;
  phase: "installing" | "done" | "error";
}

function mapReport(raw: EnvironmentReport): FrontendReport {
  return {
    os: raw.os,
    osVersion: raw.os_version,
    arch: raw.arch,
    totalMemoryMb: raw.total_memory_mb,
    freeDiskMb: raw.free_disk_mb,
    isAdmin: raw.is_admin,
    isChineseLocale: raw.is_chinese_locale,
    ...(raw.http_proxy != null ? { httpProxy: raw.http_proxy } : {}),
    packageManagers: raw.package_managers.map((pm): PackageManagerInfo => ({
      name: pm.name,
      available: pm.available,
      ...(pm.version != null ? { version: pm.version } : {}),
    })),
    dependencies: raw.dependencies.map((d): DependencyInfo => ({
      id: d.id,
      displayName: d.display_name,
      requiredVersion: d.required_version,
      ...(d.current_version != null ? { currentVersion: d.current_version } : {}),
      status: d.status,
      sources: d.sources.map((s): DepSource => ({
        url: s.url,
        label: s.label,
        trustLevel: s.trust_level,
        ...(s.expected_sha256 != null ? { expectedSha256: s.expected_sha256 } : {}),
        isPrimary: s.is_primary,
      })),
      strategies: d.strategies,
      sizeEstimateMb: d.size_estimate_mb,
      isOptional: d.is_optional,
    })),
  };
}

export function useEnvironmentScan() {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [report, setReport] = useState<FrontendReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [installingDep, setInstallingDep] = useState<string | null>(null);
  const [depInstallState, setDepInstallState] = useState<DepInstallState | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Clean up event listener on unmount
  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const runScan = useCallback(async () => {
    setPhase("scanning");
    setError(null);
    try {
      const raw = await scanEnvironment();
      setReport(mapReport(raw));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const installDep = useCallback(async (depId: string) => {
    setInstallingDep(depId);
    setDepInstallState({ depId, progress: null, result: null, phase: "installing" });

    // Listen to step progress events for inline progress display
    unlistenRef.current?.();
    unlistenRef.current = await listen<{
      step_id: string; phase: string; strategy_name: string;
      strategy_idx: number; strategy_total: number;
      bytes_done: number; bytes_total: number; speed_bps: number;
      pct: number; eta_secs: number; message: string; is_retrying: boolean;
      error_sig?: string; remedy?: string;
      source_url?: string; source_trust?: string;
    }>("deploy-step-progress", (evt) => {
      const p = evt.payload;
      setDepInstallState((prev) => prev ? ({
        ...prev,
        progress: {
          stepId: p.step_id,
          phase: p.phase,
          strategyName: p.strategy_name,
          strategyIdx: p.strategy_idx,
          strategyTotal: p.strategy_total,
          bytesDone: p.bytes_done,
          bytesTotal: p.bytes_total,
          speedBps: p.speed_bps,
          pct: p.pct,
          etaSecs: p.eta_secs,
          message: p.message,
          isRetrying: p.is_retrying,
          ...(p.error_sig != null ? { errorSig: p.error_sig } : {}),
          ...(p.remedy != null ? { remedy: p.remedy } : {}),
          ...(p.source_url != null ? { sourceUrl: p.source_url } : {}),
          ...(p.source_trust != null ? { sourceTrust: p.source_trust as TrustLevel } : {}),
        },
      }) : prev);

    });

    try {
      const result = await installSingleDep(depId);
      setDepInstallState((prev) => prev ? ({
        ...prev,
        result,
        phase: result.ok ? "done" : "error",
      }) : prev);
      await runScan();
      return result;
    } catch (e) {
      const result = { ok: false, detail: String(e), fixes_applied: [] } as StepResult;
      setDepInstallState((prev) => prev ? ({ ...prev, result, phase: "error" }) : prev);
      return result;
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setInstallingDep(null);
    }
  }, [runScan]);

  const clearInstallState = useCallback(() => {
    setDepInstallState(null);
  }, []);

  return {
    phase,
    report,
    error,
    runScan,
    installDep,
    installingDep,
    depInstallState,
    clearInstallState,
  };
}
