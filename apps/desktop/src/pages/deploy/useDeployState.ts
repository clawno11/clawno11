import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  deployCheckNode, deployInstallPm2,
  deployOnboard, deployStart, configureApiKey,
  getBrowserUrl, openInBrowser, checkDeployStatus, updateOpenclaw,
  deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
  deployRemoteOnboard, deployRemoteStartGateway,
  ollamaEnsureInstalled,
  type StepResult, type SshArgs,
} from "../../ipc";
import i18n from "../../i18n";
import { useInstanceStore, type ClawInstance } from "../../store/instances";
import { useAiConfigStore } from "../../store/aiConfig";
import { verifyProviderKey, DIRECT_PROVIDER_IDS } from "../../store/aiVerify";
import { translateDetail } from "./translations";
import type { DeployMode, DeployAction, SshAuthMethod, StepDef, StepState, VerifyStatus, DeployStatus } from "./types";
import { STEP_DEFS_BY_ACTION, REMOTE_STEP_DEFS } from "./types";

const STEP_FNS_BY_ACTION: Record<DeployAction, Array<(port?: number) => Promise<StepResult>>> = {
  full: [
    () => deployCheckNode(),
    // Use updateOpenclaw (not deployInstallOpenclaw) so the full reinstall
    // always upgrades to the latest version instead of skipping when openclaw
    // is already installed at an older version.
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
  const [mode, setMode]               = useState<DeployMode>("local");
  const [steps, setSteps]             = useState<StepState[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [finalResult, setFinalResult] = useState<{
    success: boolean;
    serviceStarted: boolean;
    message: string;
    inst?: ClawInstance;
  } | null>(null);
  const [ollamaPhase, setOllamaPhase] = useState<"idle" | "installing" | "ok" | "fail">("idle");
  const [activeIdx, setActiveIdx]     = useState<number>(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addOrUpdate = useInstanceStore((s) => s.addOrUpdate);

  // ── SSH form state ──────────────────────────────────────────────────────────
  const [sshHost, setSshHost]             = useState("");
  const [sshPort, setSshPort]             = useState(22);
  const [sshUser, setSshUser]             = useState("root");
  const [sshAuthMethod, setSshAuthMethod] = useState<SshAuthMethod>("password");
  const [sshPassword, setSshPassword]     = useState("");
  const [sshPrivateKey, setSshPrivateKey] = useState("");
  const [sshGatewayPort, setSshGatewayPort] = useState(18789);
  const [showPassword, setShowPassword]   = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  // ── Pre-deploy status check ─────────────────────────────────────────────────
  const [checkPhase, setCheckPhase]   = useState<"checking" | "fresh" | "installed">("checking");
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

  // ── AI config state ─────────────────────────────────────────────────────────
  const [aiProvider, setAiProvider]         = useState<string>("anthropic");
  const [aiApiKey, setAiApiKey]             = useState("");
  const [isConfiguringAI, setIsConfiguringAI] = useState(false);
  const [aiConfigResult, setAiConfigResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiVerifyStatus, setAiVerifyStatus] = useState<VerifyStatus>("idle");
  const [aiVerifyMsg, setAiVerifyMsg]       = useState<string | undefined>();

  // elapsed ticker
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

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeIdx, isDeploying]);

  const updateStep = (index: number, patch: Partial<StepState>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  // ── Shared pipeline engine ─────────────────────────────────────────────────

  const runDeployPipeline = async (
    stepDefs: StepDef[],
    stepFns: Array<() => Promise<StepResult>>,
    onStepSuccess: (i: number, result: StepResult) => void,
    onAbort: (i: number, result: StepResult | string) => void,
  ): Promise<void> => {
    const fresh: StepState[] = stepDefs.map((d) => ({
      ...d, status: "pending" as const, elapsedSec: 0, fixes_applied: [],
    }));
    setSteps(fresh);
    setFinalResult(null);
    setIsDeploying(true);

    for (let i = 0; i < stepFns.length; i++) {
      setActiveIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running", elapsedSec: 0, fixes_applied: [] } : s)),
      );

      try {
        const res = await stepFns[i]!();

        if (res.ok) {
          updateStep(i, { status: "done", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          onStepSuccess(i, res);
        } else {
          updateStep(i, { status: "error", detail: res.detail, fixes_applied: res.fixes_applied ?? [] });
          onAbort(i, res);
          setIsDeploying(false);
          setActiveIdx(-1);
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateStep(i, { status: "error", detail: msg, fixes_applied: [] });
        onAbort(i, msg);
        setIsDeploying(false);
        setActiveIdx(-1);
        return;
      }
    }

    setActiveIdx(-1);
    setIsDeploying(false);
  };

  // ── Local deploy ────────────────────────────────────────────────────────────

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

  // ── Test SSH connection ─────────────────────────────────────────────────────

  const buildSshArgs = (): SshArgs => ({
    host: sshHost.trim(),
    port: sshPort,
    username: sshUser.trim() || "root",
    ...(sshAuthMethod === "password" && sshPassword ? { password: sshPassword } : {}),
    ...(sshAuthMethod === "key" && sshPrivateKey ? { privateKey: sshPrivateKey } : {}),
    gatewayPort: sshGatewayPort,
  });

  const handleTestConnection = async () => {
    if (!sshHost.trim()) return;
    const sshArgs = buildSshArgs();
    setIsTestingConn(true);
    setConnTestResult(null);
    try {
      const res = await deployRemoteConnect(sshArgs);
      setConnTestResult({
        ok:  res.ok,
        msg: res.ok
          ? (i18n.language === "en" ? "Connection successful" : "连接成功")
          : translateDetail(res.detail),
      });
    } catch (e) {
      setConnTestResult({ ok: false, msg: String(e) });
    } finally {
      setIsTestingConn(false);
    }
  };

  // ── Remote (SSH) deploy ─────────────────────────────────────────────────────

  const handleRemoteDeploy = async () => {
    if (!sshHost.trim()) return;
    const sshArgs = buildSshArgs();

    const port = sshGatewayPort;
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
    if (mode === "local") {
      handleLocalDeploy(action);
    } else {
      handleRemoteDeploy();
    }
  };

  const reset = () => {
    setSteps([]); setFinalResult(null); setActiveIdx(-1);
    setAiApiKey(""); setAiConfigResult(null);
    setOllamaPhase("idle");
  };

  const resetAndRecheck = () => {
    reset();
    runStatusCheck();
  };

  const { markConfigured: markAiConfigured } = useAiConfigStore();

  const handleConfigureAI = async () => {
    if (!aiApiKey.trim()) return;
    setIsConfiguringAI(true);
    setAiConfigResult(null);
    setAiVerifyStatus("idle");
    const key = aiApiKey.trim();
    try {
      const res = await configureApiKey(aiProvider, key);
      setAiConfigResult({ ok: res.ok, msg: translateDetail(res.detail) });
      if (res.ok) {
        setAiApiKey("");
        await markAiConfigured(aiProvider);
        setAiVerifyStatus("verifying");
        const v = await verifyProviderKey(aiProvider, key, DIRECT_PROVIDER_IDS.has(aiProvider));
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

  const totalEstSec   = steps.reduce((s, d) => s + d.estimatedSec, 0);
  const doneSec       = steps.filter((s) => s.status === "done" || s.status === "error").reduce((s, d) => s + d.elapsedSec, 0);
  const activeSec     = steps[activeIdx]?.elapsedSec ?? 0;
  const overallPct    = steps.length === 0 ? 0 : Math.min(99, ((doneSec + activeSec) / totalEstSec) * 100);
  const freshEstSec   = STEP_DEFS_BY_ACTION.full.reduce((s, d) => s + d.estimatedSec, 0);

  return {
    mode, setMode,
    steps, isDeploying, finalResult, activeIdx,
    ollamaPhase,
    sshHost, setSshHost, sshPort, setSshPort, sshUser, setSshUser,
    sshAuthMethod, setSshAuthMethod, sshPassword, setSshPassword,
    sshPrivateKey, setSshPrivateKey, sshGatewayPort, setSshGatewayPort,
    showPassword, setShowPassword, isTestingConn, connTestResult, setConnTestResult, keyFileRef,
    checkPhase, deployStatus, isRechecking, runStatusCheck,
    aiProvider, setAiProvider, aiApiKey, setAiApiKey,
    isConfiguringAI, aiConfigResult, aiVerifyStatus, setAiVerifyStatus, aiVerifyMsg,
    handleDeploy, handleTestConnection, handleRemoteDeploy, handleConfigureAI, handleOpenDashboard,
    reset, resetAndRecheck,
    totalEstSec, doneSec, activeSec, overallPct, freshEstSec,
  };
}
