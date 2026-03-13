import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { StepProgress, StepState, DownloadProgress } from "./types";

/**
 * Listens to both the legacy `deploy-download-progress` and new
 * `deploy-step-progress` Tauri events and merges them into the
 * steps state array.
 */
export function useStepProgress(
  activeIdx: number,
  isDeploying: boolean,
  setSteps: React.Dispatch<React.SetStateAction<StepState[]>>,
) {
  // Elapsed-second ticker
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeIdx < 0 || !isDeploying) return;

    timerRef.current = setInterval(() => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === activeIdx ? { ...s, elapsedSec: s.elapsedSec + 1 } : s,
        ),
      );
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeIdx, isDeploying, setSteps]);

  // Legacy download progress event
  useEffect(() => {
    const unlisten = listen<{
      step: string;
      phase: string;
      bytes_downloaded: number;
      bytes_total: number;
      speed_bps: number;
    }>("deploy-download-progress", (evt) => {
      const p = evt.payload;
      const dp: DownloadProgress = {
        phase: p.phase,
        bytesDownloaded: p.bytes_downloaded,
        bytesTotal: p.bytes_total,
        speedBps: p.speed_bps,
      };
      setSteps((prev) =>
        prev.map((s, i) =>
          i === activeIdx && s.status === "running"
            ? { ...s, downloadProgress: dp }
            : s,
        ),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeIdx, setSteps]);

  // New unified step progress event
  useEffect(() => {
    const unlisten = listen<{
      step_id: string;
      phase: string;
      strategy_name: string;
      strategy_idx: number;
      strategy_total: number;
      bytes_done: number;
      bytes_total: number;
      speed_bps: number;
      pct: number;
      eta_secs: number;
      message: string;
      is_retrying: boolean;
      error_sig?: string;
      remedy?: string;
    }>("deploy-step-progress", (evt) => {
      const p = evt.payload;
      const sp: StepProgress = {
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
      };
      setSteps((prev) =>
        prev.map((s, i) =>
          i === activeIdx && s.status === "running"
            ? { ...s, progress: sp }
            : s,
        ),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeIdx, setSteps]);
}

/** Compute overall progress percentage from steps array. */
export function computeOverallPct(
  steps: StepState[],
  activeIdx: number,
): number {
  if (steps.length === 0) return 0;
  const totalEst = steps.reduce((s, d) => s + d.estimatedSec, 0);
  if (totalEst === 0) return 0;

  const doneSec = steps
    .filter((s) => s.status === "done" || s.status === "error")
    .reduce((s, d) => s + d.elapsedSec, 0);

  const activeStep = steps[activeIdx];
  let activeContrib = activeStep?.elapsedSec ?? 0;

  // Use real progress if available
  if (activeStep?.progress && activeStep.progress.pct > 0) {
    activeContrib = (activeStep.progress.pct / 100) * activeStep.estimatedSec;
  } else if (activeStep?.downloadProgress?.bytesTotal) {
    activeContrib =
      (activeStep.downloadProgress.bytesDownloaded /
        activeStep.downloadProgress.bytesTotal) *
      activeStep.estimatedSec;
  }

  return Math.min(99, ((doneSec + activeContrib) / totalEst) * 100);
}
