import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  deployCheckNode, deployInstallPm2,
  deployOnboard, deployStart, configureApiKey,
  getBrowserUrl, openInBrowser, checkDeployStatus, updateOpenclaw,
  deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
  deployRemoteOnboard, deployRemoteStartGateway,
  ollamaEnsureInstalled,
  type StepResult,
} from "../../ipc";
import { useInstanceStore, type ClawInstance } from "../../store/instances";
import { useAiConfigStore } from "../../store/aiConfig";
import { verifyProviderKey, DIRECT_PROVIDER_IDS } from "../../store/aiVerify";
import { translateDetail } from "./translations";
import type {
  DeployMode, DeployAction, StepDef, StepState,
  VerifyStatus, DeployStatus, FinalResult,
} from "./types";
import { STEP_DEFS_BY_ACTION, REMOTE_STEP_DEFS } from "./types";
import { useStepProgress, computeOverallPct } from "./useStepProgress";
import { useSshForm } from "./useSshForm";
import { useAiSetup } from "./useAiSetup";

const STEP_FNS_BY_ACTION: Record<DeployAction, Array<(port?: number) => Promise<StepResult>>> = {
  full: [
    () => deployCheckNode(),
    () => updateOpenclaw(),
    () => deployInstallPm2(),
    () => deployOnboard(),
    (port) => deployStart(port),
  ],
  update: [
    () => updateOpenclaw(),
    () => deployOnboard(),
    (port) => deployStart(port),
  ],
  restart: [
    (port) => deployStart(port),
  ],
};

export function useDeployState() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DeployMode>("local");
  const [steps, setSteps] = useState<StepState[]>([]);
  const stepsRef = useRef<StepState[]>([]);
  stepsRef.current = steps;
  const [isDeploying, setIsDeploying] = useState(false);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [ollamaPhase, setOllamaPhase] = useState<"idle" | "installing" | "ok" | "fail">("idle");
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const addOrUpdate = useInstanceStore((s) => s.addOrUpdate);

  // Delegate to focused hooks
  const ssh = useSshForm();
  const ai = useAiSetup();

  // Unified progress listener
  useStepProgress(activeIdx, isDeploying, setSteps);

  // Pre-deploy status check
  const [checkPhase, setCheckPhase] = useState<"checking" | "fresh" | "installed">("checking");
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [isRechecking, setIsRechecking] = useState(false);

  const runStatusCheck = useCallback(async (silent = false) => {
    if (!silent) setCheckPhase("checking");
    setIsRechecking(true);
    try {
      const status = await checkDeployStatus();
      setDeployStatus(status);
      setCheckPhase(status.openclaw_installed ? "installed" : "fresh");
    } catch {
      setCheckPhase("fresh");
    } finally {
      setIsRechecking(false);
    }
  }, []);

  useEffect(() => { runStatusCheck(); }, [runStatusCheck]);

  // AI config state
  const [isConfiguringAI, setIsConfiguringAI] = useState(false);
  const [aiConfigResult, setAiConfigResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiVerifyStatus, setAiVerifyStatus] = useState<VerifyStatus>("idle");
  const [aiVerifyMsg, setAiVerifyMsg] = useState<string | undefined>();

  const updateStep = (index: number, patch: Partial<StepState>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  // Pipeline engine
  const lastPipelineRef = useRef<{
    stepDefs: StepDef[];
    stepFns: Array<() => Promise<StepResult>>;
    onStepSuccess: (i: number, result: StepResult) => void;
    onAbort: (i: number, result: StepResult | string) => void;
    failedIdx: number;
  } | null>(null);

  const [failedStepIdx, setFailedStepIdx] = useState<number>(-1);
  const autoRetryCountRef = useRef<Record<number, number>>({});

  const runDeployPipeline = async (
    stepDefs: StepDef[],
    stepFns: Array<() => Promise<StepResult>>,
    onStepSuccess: (i: number, result: StepResult) => void,
    onAbort: (i: number, result: StepResult | string) => void,
    startFrom = 0,
  ): Promise<void> => {
    lastPipelineRef.current = { stepDefs, stepFns, onStepSuccess, onAbort, failedIdx: -1 };
    setFailedStepIdx(-1);
    if (startFrom === 0) autoRetryCountRef.current = {};

    if (startFrom === 0) {
      setSteps(stepDefs.map((d) => ({
        ...d, status: "pending" as const, elapsedSec: 0, fixes_applied: [],
      })));
    } else {
      setSteps((prev) => prev.map((s, i) => {
        if (i < startFrom) return s;
        const { detail: _, ...rest } = s;
        return { ...rest, status: "pending" as const, elapsedSec: 0, fixes_applied: [] };
      }));
    }
    setFinalResult(null);
    setIsDeploying(true);

    for (let i = startFrom; i < stepFns.length; i++) {
      setActiveIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) => {
          if (idx !== i) return s;
          const { progress: _, downloadProgress: __, ...rest } = s;
          return { ...rest, status: "running" as const, elapsedSec: 0, fixes_applied: [] };
        }),
      );

      try {
        const res = await stepFns[i]!();

        if (res.ok) {
          updateStep(i, { status: "done", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          onStepSuccess(i, res);
        } else {
          // Backend now handles retries via strategy chain — only retry once
          // from frontend for commands that don't have backend self-healing.
          const retries = autoRetryCountRef.current[i] ?? 0;
          const currentStep = stepsRef.current[i];
          const hasBackendProgress = currentStep?.progress != null || currentStep?.downloadProgress != null;
          if (retries < 1 && !hasBackendProgress) {
            autoRetryCountRef.current[i] = retries + 1;
            updateStep(i, { status: "running", elapsedSec: 0, detail: "", fixes_applied: [...(res.fixes_applied ?? []), "auto-retry"] });
            await new Promise((r) => setTimeout(r, 2000));
            const res2 = await stepFns[i]!();
            if (res2.ok) {
              updateStep(i, { status: "done", detail: res2.detail, fixes_applied: [...(res.fixes_applied ?? []), "auto-retry-success", ...(res2.fixes_applied ?? [])] });
              onStepSuccess(i, res2);
              continue;
            }
            updateStep(i, { status: "error", detail: res2.detail, fixes_applied: [...(res.fixes_applied ?? []), "auto-retry-failed", ...(res2.fixes_applied ?? [])] });
          } else {
            updateStep(i, { status: "error", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          }
          setFailedStepIdx(i);
          if (lastPipelineRef.current) lastPipelineRef.current.failedIdx = i;
          onAbort(i, res);
          setIsDeploying(false);
          setActiveIdx(-1);
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateStep(i, { status: "error", detail: msg, fixes_applied: [] });
        setFailedStepIdx(i);
        if (lastPipelineRef.current) lastPipelineRef.current.failedIdx = i;
        onAbort(i, msg);
        setIsDeploying(false);
        setActiveIdx(-1);
        return;
      }
    }

    setActiveIdx(-1);
    setIsDeploying(false);
  };

  // Local deploy
  const handleLocalDeploy = async (action: DeployAction = "full") => {
    const port = 18789;
    const stepDefs: StepDef[] = STEP_DEFS_BY_ACTION[action].map((k) => ({
      label: t(k.labelKey), estimatedSec: k.estimatedSec,
    }));
    const boundStepFns = STEP_FNS_BY_ACTION[action].map((fn) => () => fn(port));
    const LAST = boundStepFns.length - 1;

    await runDeployPipeline(
      stepDefs,
      boundStepFns,
      (i) => {
        if (i === LAST - 1) {
          addOrUpdate({
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://127.0.0.1:${port}`, uiUrl: `http://127.0.0.1:${port}`,
            httpUrl: `http://127.0.0.1:${port}`, port, deployedAt: Date.now(), health: "offline",
          });
        }
        if (i === LAST) {
          const inst: ClawInstance = {
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
            httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "online",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: true, message: t("deploy.success"), inst });
          setOllamaPhase("installing");
          ollamaEnsureInstalled()
            .then((r) => setOllamaPhase(r.ok ? "ok" : "fail"))
            .catch(() => setOllamaPhase("fail"));
        }
      },
      (i, result) => {
        const detail = typeof result === "string" ? result : result.detail;
        if (i === LAST) {
          const inst: ClawInstance = {
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
            httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "offline",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: false, message: detail, inst });
        } else {
          setFinalResult({ success: false, serviceStarted: false, message: detail });
        }
      },
    );
  };

  // Remote deploy
  const handleRemoteDeploy = async () => {
    if (!ssh.sshHost.trim()) return;
    const sshArgs = ssh.buildSshArgs();
    const port = ssh.sshGatewayPort;
    const stepDefs: StepDef[] = REMOTE_STEP_DEFS.map((k) => ({
      label: t(k.labelKey), estimatedSec: k.estimatedSec,
    }));
    const stepFns: Array<() => Promise<StepResult>> = [
      () => deployRemoteConnect(sshArgs),
      () => deployRemoteCheckNode(sshArgs),
      () => deployRemoteInstallOpenclaw(sshArgs),
      () => deployRemoteOnboard(sshArgs),
      () => deployRemoteStartGateway(sshArgs),
    ];
    const LAST = stepFns.length - 1;

    await runDeployPipeline(
      stepDefs,
      stepFns,
      (i) => {
        if (i === LAST) {
          const inst: ClawInstance = {
            id: `remote-${sshArgs.host}-${port}`,
            name: `${sshArgs.host}:${port}`,
            kind: "remote" as const,
            gatewayUrl: `ws://${sshArgs.host}:${port}`,
            uiUrl: `http://${sshArgs.host}:${port}`,
            httpUrl: `http://${sshArgs.host}:${port}`,
            port,
            deployedAt: Date.now(),
            health: "online",
          };
          addOrUpdate(inst);
          setFinalResult({ success: true, serviceStarted: true, message: t("deploy.success"), inst });
        }
      },
      (_, result) => {
        const detail = typeof result === "string" ? result : result.detail;
        setFinalResult({ success: false, serviceStarted: false, message: detail });
      },
    );
  };

  const handleDeploy = (action: DeployAction = "full") => {
    if (mode === "local") handleLocalDeploy(action);
    else handleRemoteDeploy();
  };

  const reset = () => {
    setSteps([]);
    setFinalResult(null);
    setActiveIdx(-1);
    ai.setApiKey("");
    setAiConfigResult(null);
    setOllamaPhase("idle");
  };

  const resetAndRecheck = () => {
    reset();
    runStatusCheck();
  };

  const retryFromFailed = () => {
    const ctx = lastPipelineRef.current;
    if (!ctx || ctx.failedIdx < 0) return;
    runDeployPipeline(ctx.stepDefs, ctx.stepFns, ctx.onStepSuccess, ctx.onAbort, ctx.failedIdx);
  };

  const { markConfigured: markAiConfigured } = useAiConfigStore();

  const handleConfigureAI = async () => {
    if (!ai.apiKey.trim()) return;
    setIsConfiguringAI(true);
    setAiConfigResult(null);
    setAiVerifyStatus("idle");
    const key = ai.apiKey.trim();
    try {
      const res = await configureApiKey(ai.selectedProvider, key);
      setAiConfigResult({ ok: res.ok, msg: translateDetail(res.detail) });
      if (res.ok) {
        ai.setApiKey("");
        await markAiConfigured(ai.selectedProvider);
        setAiVerifyStatus("verifying");
        const v = await verifyProviderKey(ai.selectedProvider, key, DIRECT_PROVIDER_IDS.has(ai.selectedProvider));
        setAiVerifyStatus(v.status);
        setAiVerifyMsg(v.message);
      }
    } catch (e) {
      setAiConfigResult({ ok: false, msg: String(e) });
    } finally {
      setIsConfiguringAI(false);
    }
  };

  const handleOpenDashboard = async () => {
    try {
      if (mode === "remote" && finalResult?.inst?.uiUrl) {
        await openInBrowser(finalResult.inst.uiUrl);
      } else {
        const url = await getBrowserUrl();
        await openInBrowser(url);
      }
    } catch (e) {
      console.error("open_in_browser failed:", e);
    }
  };

  const overallPct = computeOverallPct(steps, activeIdx);
  const totalEstSec = steps.reduce((s, d) => s + d.estimatedSec, 0);
  const doneSec = steps.filter((s) => s.status === "done" || s.status === "error").reduce((s, d) => s + d.elapsedSec, 0);
  const activeSec = steps[activeIdx]?.elapsedSec ?? 0;
  const freshEstSec = STEP_DEFS_BY_ACTION.full.reduce((s, d) => s + d.estimatedSec, 0);

  return {
    mode, setMode,
    steps, isDeploying, finalResult, activeIdx,
    ollamaPhase,
    // SSH form — spread for backward compat
    sshHost: ssh.sshHost, setSshHost: ssh.setSshHost,
    sshPort: ssh.sshPort, setSshPort: ssh.setSshPort,
    sshUser: ssh.sshUser, setSshUser: ssh.setSshUser,
    sshAuthMethod: ssh.sshAuthMethod, setSshAuthMethod: ssh.setSshAuthMethod,
    sshPassword: ssh.sshPassword, setSshPassword: ssh.setSshPassword,
    sshPrivateKey: ssh.sshPrivateKey, setSshPrivateKey: ssh.setSshPrivateKey,
    sshGatewayPort: ssh.sshGatewayPort, setSshGatewayPort: ssh.setSshGatewayPort,
    showPassword: ssh.showPassword, setShowPassword: ssh.setShowPassword,
    isTestingConn: ssh.isTestingConn, connTestResult: ssh.connTestResult,
    setConnTestResult: ssh.setConnTestResult, keyFileRef: ssh.keyFileRef,
    // Pre-deploy check
    checkPhase, deployStatus, isRechecking, runStatusCheck,
    // AI config — spread for backward compat
    aiProvider: ai.selectedProvider, setAiProvider: ai.setSelectedProvider,
    aiApiKey: ai.apiKey, setAiApiKey: ai.setApiKey,
    isConfiguringAI, aiConfigResult, aiVerifyStatus, setAiVerifyStatus, aiVerifyMsg,
    // Actions
    handleDeploy, handleTestConnection: ssh.handleTestConnection,
    handleRemoteDeploy, handleConfigureAI, handleOpenDashboard,
    reset, resetAndRecheck, retryFromFailed, failedStepIdx,
    // Progress metrics
    totalEstSec, doneSec, activeSec, overallPct, freshEstSec,
  };
}
