import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  deployCheckNode, deployInstallPm2,
  deployOnboard, deployStart, configureApiKey,
  getBrowserUrl, openInBrowser, checkDeployStatus, updateOpenclaw,
  deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
  deployRemoteOnboard, deployRemoteStartGateway,
  deployRemoteInstallClawnoServer, deployRemoteStartClawnoServer,
  ollamaEnsureInstalled,
  scanEnvironment, installSingleDep,
  type StepResult,
} from "../../ipc";
import { useInstanceStore, type ClawInstance } from "../../store/instances";
import { useAiConfigStore } from "../../store/aiConfig";
import { verifyProviderKey, DIRECT_PROVIDER_IDS } from "../../store/aiVerify";
import { translateDetail } from "./translations";
import type {
  DeployMode, DeployAction, StepDef, StepState,
  VerifyStatus, DeployStatus, FinalResult,
  TrustLevel, DependencyInfo,
} from "./types";
import {
  STEP_DEFS_BY_ACTION, REMOTE_STEP_DEFS, CLAWNO_SERVER_STEP_DEFS,
  DEP_INSTALL_ORDER, DEP_LABELS, DEP_ESTIMATED_SEC, DEP_HINTS,
} from "./types";
import { useStepProgress, computeOverallPct } from "./useStepProgress";
import { useSshForm } from "./useSshForm";
import { useAiSetup } from "./useAiSetup";
import i18n from "../../i18n";

const L = (zh: string, en: string) => (i18n.language === "en" ? en : zh);

// ── Persistent step result cache ──────────────────────────────────────────────

const STEP_CACHE_KEY = "deploy-step-results";

interface CachedStepResult {
  ok: boolean;
  detail: string;
  completedAt: number;
}

function loadStepCache(): Record<string, CachedStepResult> {
  try {
    return JSON.parse(localStorage.getItem(STEP_CACHE_KEY) || "{}");
  } catch { return {}; }
}

function saveStepToCache(depId: string, result: StepResult) {
  const cache = loadStepCache();
  cache[depId] = { ok: result.ok, detail: result.detail, completedAt: Date.now() };
  localStorage.setItem(STEP_CACHE_KEY, JSON.stringify(cache));
}

const STEP_FNS_BY_ACTION: Record<Exclude<DeployAction, "full">, Array<(port?: number) => Promise<StepResult>>> = {
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

  // ClawNO11 Server option for remote deploy
  const [includeClawnoServer, setIncludeClawnoServer] = useState(false);
  const [clawnoServerPort, setClawnoServerPort] = useState(18800);

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

    setSteps(stepDefs.map((d, i) => {
      if (i < startFrom && (d as StepState).status === "done") return d as StepState;
      return { ...d, status: "pending" as const, elapsedSec: 0, fixes_applied: [] };
    }));
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
          const depId = stepsRef.current[i]?.depId;
          if (depId) saveStepToCache(depId, res);
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
              const depId = stepsRef.current[i]?.depId;
              if (depId) saveStepToCache(depId, res2);
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

  // Build dynamic steps from environment scan
  const buildDynamicSteps = (depMap: Map<string, DependencyInfo>): StepState[] => {
    const depSteps: StepState[] = DEP_INSTALL_ORDER.map((depId) => {
      const info = depMap.get(depId);
      const labels = DEP_LABELS[depId] ?? { zh: depId, en: depId };
      const label = i18n.language === "en" ? labels.en : labels.zh;
      const primary = info?.sources.find((s) => s.isPrimary) ?? info?.sources[0];
      const installed = info?.status === "satisfied";
      const hintEntry = DEP_HINTS[depId];
      const hint = hintEntry && !installed ? (i18n.language === "en" ? hintEntry.en : hintEntry.zh) : undefined;
      return {
        label,
        estimatedSec: installed ? 0 : (DEP_ESTIMATED_SEC[depId] ?? 30),
        status: "pending" as const,
        elapsedSec: 0,
        fixes_applied: [],
        depId,
        ...(hint != null ? { hint } : {}),
        ...(primary?.label != null ? { sourceLabel: primary.label } : {}),
        ...(primary?.url != null ? { sourceUrl: primary.url } : {}),
        ...(primary?.trustLevel != null ? { trustLevel: primary.trustLevel } : {}),
        ...(info?.currentVersion != null ? { currentVersion: info.currentVersion } : {}),
        preInstalled: installed,
      };
    });

    const fixedSteps: StepState[] = [
      {
        label: t("deploy.steps.onboard"),
        estimatedSec: 5,
        status: "pending" as const,
        elapsedSec: 0,
        fixes_applied: [],
        depId: "__onboard",
      },
      {
        label: t("deploy.steps.start"),
        estimatedSec: 5,
        status: "pending" as const,
        elapsedSec: 0,
        fixes_applied: [],
        depId: "__start",
      },
    ];

    return [...depSteps, ...fixedSteps];
  };

  // Scanning state exposed to DeployPage
  const [isScanning, setIsScanning] = useState(false);

  // Local deploy — full: scan-driven dynamic pipeline
  const handleLocalDeploy = async (action: DeployAction = "full") => {
    const port = 18789;

    if (action !== "full") {
      const stepDefs: StepDef[] = STEP_DEFS_BY_ACTION[action].map((k) => ({
        label: t(k.labelKey), estimatedSec: k.estimatedSec,
      }));
      const boundStepFns = STEP_FNS_BY_ACTION[action].map((fn) => () => fn(port));
      const LAST = boundStepFns.length - 1;

      await runDeployPipeline(
        stepDefs,
        boundStepFns,
        (i) => {
          if (i === LAST) {
            const inst: ClawInstance = {
              id: "local-default", name: "本机 OpenClaw", kind: "local",
              gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
              httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "online",
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
      return;
    }

    // ── Full deploy: environment scan → dynamic pipeline ──
    setIsScanning(true);
    setIsDeploying(true);
    setFinalResult(null);

    let depMap: Map<string, DependencyInfo>;
    try {
      const raw = await scanEnvironment();
      const deps = raw.dependencies.map((d): DependencyInfo => ({
        id: d.id,
        displayName: d.display_name,
        requiredVersion: d.required_version,
        ...(d.current_version != null ? { currentVersion: d.current_version } : {}),
        status: d.status,
        sources: d.sources.map((s) => ({
          url: s.url,
          label: s.label,
          trustLevel: s.trust_level as TrustLevel,
          ...(s.expected_sha256 != null ? { expectedSha256: s.expected_sha256 } : {}),
          isPrimary: s.is_primary,
        })),
        strategies: d.strategies,
        sizeEstimateMb: d.size_estimate_mb,
        isOptional: d.is_optional,
      }));
      depMap = new Map(deps.map((d) => [d.id, d]));
    } catch (e) {
      setIsScanning(false);
      setIsDeploying(false);
      setFinalResult({
        success: false, serviceStarted: false,
        message: L("环境扫描失败: ", "Environment scan failed: ") + String(e),
      });
      return;
    }
    setIsScanning(false);

    const dynamicSteps = buildDynamicSteps(depMap);
    const cache = loadStepCache();

    // Mark steps that are already satisfied (from scan) as immediately done
    // and find the first step that needs work
    let startFrom = 0;
    for (let i = 0; i < dynamicSteps.length; i++) {
      const step = dynamicSteps[i]!;
      const depId = step.depId;
      if (!depId) continue;

      if (step.preInstalled) {
        // Environment scan confirmed: already installed
        dynamicSteps[i] = {
          ...step,
          status: "done" as const,
          detail: step.currentVersion
            ? `v${step.currentVersion} ${L("已安装", "installed")}`
            : L("已安装", "installed"),
        };
        startFrom = i + 1;
      } else if (cache[depId]?.ok) {
        // Previous deploy cached a successful result, and scan now says satisfied
        const info = depMap.get(depId);
        if (info?.status === "satisfied") {
          dynamicSteps[i] = {
            ...step,
            status: "done" as const,
            preInstalled: true,
            detail: info.currentVersion
              ? `v${info.currentVersion} ${L("已安装", "installed")}`
              : cache[depId].detail,
            ...(info.currentVersion != null ? { currentVersion: info.currentVersion } : {}),
          };
          startFrom = i + 1;
        }
      }
    }

    const stepFns: Array<() => Promise<StepResult>> = dynamicSteps.map((step) => {
      if (step.status === "done") {
        return async () => ({
          ok: true,
          detail: step.detail ?? L("已安装", "installed"),
          fixes_applied: [],
        });
      }
      switch (step.depId) {
        case "nodejs": return () => deployCheckNode();
        case "npm":    return async () => ({ ok: true, detail: L("npm 随 Node.js 安装", "npm bundled with Node.js"), fixes_applied: [] as string[] });
        case "git":    return async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return installSingleDep("git");
        };
        case "openclaw": return () => updateOpenclaw();
        case "pm2":    return () => deployInstallPm2();
        case "__onboard": return () => deployOnboard();
        case "__start": return () => deployStart(port);
        default: return async () => ({ ok: true, detail: "", fixes_applied: [] as string[] });
      }
    });

    const LAST = stepFns.length - 1;

    await runDeployPipeline(
      dynamicSteps,
      stepFns,
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
        const inst: ClawInstance = {
          id: "local-default", name: "本机 OpenClaw", kind: "local",
          gatewayUrl: `ws://localhost:${port}`, uiUrl: `http://localhost:${port + 2}`,
          httpUrl: `http://localhost:${port}`, port, deployedAt: Date.now(), health: "offline",
        };
        addOrUpdate(inst);
        setFinalResult({ success: false, serviceStarted: false, message: detail, inst });
      },
      startFrom,
    );
  };

  // Remote deploy
  const handleRemoteDeploy = async () => {
    if (!ssh.sshHost.trim()) return;
    const sshArgs = ssh.buildSshArgs();
    const port = ssh.sshGatewayPort;

    const baseStepDefs: StepDef[] = REMOTE_STEP_DEFS.map((k) => ({
      label: t(k.labelKey), estimatedSec: k.estimatedSec,
    }));
    const baseStepFns: Array<() => Promise<StepResult>> = [
      () => deployRemoteConnect(sshArgs),
      () => deployRemoteCheckNode(sshArgs),
      () => deployRemoteInstallOpenclaw(sshArgs),
      () => deployRemoteOnboard(sshArgs),
      () => deployRemoteStartGateway(sshArgs),
    ];

    const csPort = clawnoServerPort;
    const csStepDefs: StepDef[] = includeClawnoServer
      ? CLAWNO_SERVER_STEP_DEFS.map((k) => ({
          label: t(k.labelKey), estimatedSec: k.estimatedSec,
        }))
      : [];
    const csStepFns: Array<() => Promise<StepResult>> = includeClawnoServer
      ? [
          () => deployRemoteInstallClawnoServer(sshArgs),
          () => deployRemoteStartClawnoServer(sshArgs, csPort),
        ]
      : [];

    const stepDefs = [...baseStepDefs, ...csStepDefs];
    const stepFns = [...baseStepFns, ...csStepFns];
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
            ...(includeClawnoServer ? { chatProxyUrl: `http://${sshArgs.host}:${csPort}` } : {}),
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

  // Ref to store step functions for manual execution
  const manualStepFnsRef = useRef<Array<() => Promise<StepResult>>>([]);

  // Prepare steps for advanced mode — scan environment, build step list, don't auto-execute
  const prepareSteps = async () => {
    const port = 18789;
    setIsScanning(true);
    setFinalResult(null);

    let depMap: Map<string, DependencyInfo>;
    try {
      const raw = await scanEnvironment();
      const deps = raw.dependencies.map((d): DependencyInfo => ({
        id: d.id,
        displayName: d.display_name,
        requiredVersion: d.required_version,
        ...(d.current_version != null ? { currentVersion: d.current_version } : {}),
        status: d.status,
        sources: d.sources.map((s) => ({
          url: s.url,
          label: s.label,
          trustLevel: s.trust_level as TrustLevel,
          ...(s.expected_sha256 != null ? { expectedSha256: s.expected_sha256 } : {}),
          isPrimary: s.is_primary,
        })),
        strategies: d.strategies,
        sizeEstimateMb: d.size_estimate_mb,
        isOptional: d.is_optional,
      }));
      depMap = new Map(deps.map((d) => [d.id, d]));
    } catch (e) {
      setIsScanning(false);
      setFinalResult({
        success: false, serviceStarted: false,
        message: L("环境扫描失败: ", "Environment scan failed: ") + String(e),
      });
      return;
    }
    setIsScanning(false);

    const dynamicSteps = buildDynamicSteps(depMap);
    const cache = loadStepCache();

    for (let i = 0; i < dynamicSteps.length; i++) {
      const step = dynamicSteps[i]!;
      const depId = step.depId;
      if (!depId) continue;

      if (step.preInstalled) {
        dynamicSteps[i] = {
          ...step,
          status: "done" as const,
          detail: step.currentVersion
            ? `v${step.currentVersion} ${L("已安装", "installed")}`
            : L("已安装", "installed"),
        };
      } else if (cache[depId]?.ok) {
        const info = depMap.get(depId);
        if (info?.status === "satisfied") {
          dynamicSteps[i] = {
            ...step,
            status: "done" as const,
            preInstalled: true,
            detail: info.currentVersion
              ? `v${info.currentVersion} ${L("已安装", "installed")}`
              : cache[depId].detail,
            ...(info.currentVersion != null ? { currentVersion: info.currentVersion } : {}),
          };
        }
      }
    }

    const fns: Array<() => Promise<StepResult>> = dynamicSteps.map((step) => {
      if (step.status === "done") {
        return async () => ({
          ok: true,
          detail: step.detail ?? L("已安装", "installed"),
          fixes_applied: [],
        });
      }
      switch (step.depId) {
        case "nodejs": return () => deployCheckNode();
        case "npm":    return async () => ({ ok: true, detail: L("npm 随 Node.js 安装", "npm bundled with Node.js"), fixes_applied: [] as string[] });
        case "git":    return async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return installSingleDep("git");
        };
        case "openclaw": return () => updateOpenclaw();
        case "pm2":    return () => deployInstallPm2();
        case "__onboard": return () => deployOnboard();
        case "__start": return () => deployStart(port);
        default: return async () => ({ ok: true, detail: "", fixes_applied: [] as string[] });
      }
    });

    manualStepFnsRef.current = fns;
    setSteps(dynamicSteps);
  };

  // Execute a single step in advanced mode
  const executeStep = async (index: number) => {
    const fn = manualStepFnsRef.current[index];
    if (!fn) return;
    const step = stepsRef.current[index];
    if (!step || step.status === "done") return;

    const port = 18789;
    const totalSteps = manualStepFnsRef.current.length;

    setActiveIdx(index);
    setIsDeploying(true);
    updateStep(index, { status: "running", elapsedSec: 0, fixes_applied: [] });

    try {
      const res = await fn();
      if (res.ok) {
        updateStep(index, { status: "done", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
        const depId = step.depId;
        if (depId) saveStepToCache(depId, res);

        if (index === totalSteps - 2) {
          addOrUpdate({
            id: "local-default", name: "本机 OpenClaw", kind: "local",
            gatewayUrl: `ws://127.0.0.1:${port}`, uiUrl: `http://127.0.0.1:${port}`,
            httpUrl: `http://127.0.0.1:${port}`, port, deployedAt: Date.now(), health: "offline",
          });
        }
        if (index === totalSteps - 1) {
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
      } else {
        updateStep(index, { status: "error", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateStep(index, { status: "error", detail: msg, fixes_applied: [] });
    } finally {
      setActiveIdx(-1);
      setIsDeploying(false);
    }
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
    // 重新扫描环境后再部署，避免依赖已安装但上次误报失败时仍重复安装
    if (mode === "local") {
      handleLocalDeploy("full");
    } else {
      handleRemoteDeploy();
    }
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
        // Rust 侧已验证 OpenClaw 识别了该 Key，可以标记为已配置
        ai.setApiKey("");
        await markAiConfigured(ai.selectedProvider);
        // 进一步前端侧探测 Key 是否直连可用
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
    isScanning,
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
    // ClawNO11 Server option
    includeClawnoServer, setIncludeClawnoServer,
    clawnoServerPort, setClawnoServerPort,
    // Actions
    handleDeploy, prepareSteps, executeStep,
    handleTestConnection: ssh.handleTestConnection,
    handleRemoteDeploy, handleConfigureAI, handleOpenDashboard,
    reset, resetAndRecheck, retryFromFailed, failedStepIdx,
    // Progress metrics
    totalEstSec, doneSec, activeSec, overallPct, freshEstSec,
  };
}
