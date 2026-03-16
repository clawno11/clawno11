/**
 * DeployPage — 5-step SSH remote deployment, aligned with Desktop.
 *
 * Steps: connect → check_node → install_openclaw → onboard → start_gateway
 *
 * After successful deploy, SSH credentials are saved to the secure store
 * so management operations (kill switch, restart) can reuse them.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal, Server, CheckCircle2, XCircle, Loader,
  Circle, Clock, Eye, EyeOff, Wifi, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  deployRemoteConnect,
  deployRemoteCheckNode,
  deployRemoteInstallOpenclaw,
  deployRemoteOnboard,
  deployRemoteStartGateway,
  deployRemoteInstallClawnoServer,
  deployRemoteStartClawnoServer,
  type SshArgs,
  type StepResult,
} from "../ipc";
import { setSecureValue } from "../ipc";
import { useInstanceStore } from "../store/instances";
import { TopBar } from "../components/TopBar";
import { REMOTE_STEP_DEFS, CLAWNO_SERVER_STEP_DEFS } from "@clawno/shared/deploy/stepDefs";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "running" | "done" | "error";

interface StepState {
  label: string;
  estimatedSec: number;
  status: StepStatus;
  detail?: string;
  fixesApplied: string[];
  elapsedSec: number;
}

function fmtSec(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DeployPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addOrUpdate } = useInstanceStore();

  // Form
  const [host, setHost]                   = useState("");
  const [sshPort, setSshPort]             = useState("22");
  const [username, setUsername]            = useState("root");
  const [password, setPassword]           = useState("");
  const [showPass, setShowPass]           = useState(false);
  const [openclawPort, setOpenclawPort]   = useState("18789");
  const [instanceName, setInstanceName]   = useState("");
  const [includeClawnoServer, setIncludeClawnoServer] = useState(true);
  const [clawnoServerPort, setClawnoServerPort] = useState("18800");

  // State
  const [steps, setSteps]                 = useState<StepState[]>([]);
  const [isDeploying, setIsDeploying]     = useState(false);
  const [activeIdx, setActiveIdx]         = useState(-1);
  const [finalResult, setFinalResult]     = useState<{
    success: boolean; message: string; gatewayUrl?: string;
  } | null>(null);

  // Test connection
  const [isTesting, setIsTesting]         = useState(false);
  const [testResult, setTestResult]       = useState<string | null>(null);
  const [testError, setTestError]         = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hostTrimmed = host.trim();
  const userTrimmed = username.trim();
  const portNum     = parseInt(sshPort, 10) || 22;
  const ocPortNum   = parseInt(openclawPort, 10) || 18789;
  const derivedName = instanceName.trim() || hostTrimmed || t("deploy.ssh.title");

  const canTest   = !!(hostTrimmed && userTrimmed && password) && !isDeploying;
  const canDeploy = canTest && testResult !== null;

  // Elapsed timer
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

  // ── Build SshArgs ───────────────────────────────────────────────────────────

  const buildSshArgs = useCallback((): SshArgs => ({
    host: hostTrimmed,
    port: portNum,
    username: userTrimmed || "root",
    password: password || undefined,
    gatewayPort: ocPortNum,
  }), [hostTrimmed, portNum, userTrimmed, password, ocPortNum]);

  // ── Test connection ─────────────────────────────────────────────────────────

  const handleTest = async () => {
    if (!canTest) return;
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await deployRemoteConnect(buildSshArgs());
      if (res.ok) {
        setTestResult(res.detail);
      } else {
        setTestError(res.detail);
      }
    } catch (e) {
      setTestError(String(e));
    } finally {
      setIsTesting(false);
    }
  };

  // ── Deploy pipeline ─────────────────────────────────────────────────────────

  const handleDeploy = async () => {
    if (!canDeploy) return;
    const sshArgs = buildSshArgs();
    const csPort = parseInt(clawnoServerPort, 10) || 18800;

    const baseStepDefs: StepState[] = REMOTE_STEP_DEFS.map((d) => ({
      label: t(d.labelKey),
      estimatedSec: d.estimatedSec,
      status: "pending" as const,
      fixesApplied: [],
      elapsedSec: 0,
    }));

    const csStepDefs: StepState[] = includeClawnoServer
      ? CLAWNO_SERVER_STEP_DEFS.map((d) => ({
          label: t(d.labelKey),
          estimatedSec: d.estimatedSec,
          status: "pending" as const,
          fixesApplied: [],
          elapsedSec: 0,
        }))
      : [];

    const stepDefs = [...baseStepDefs, ...csStepDefs];

    const baseStepFns: Array<() => Promise<StepResult>> = [
      () => deployRemoteConnect(sshArgs),
      () => deployRemoteCheckNode(sshArgs),
      () => deployRemoteInstallOpenclaw(sshArgs),
      () => deployRemoteOnboard(sshArgs),
      () => deployRemoteStartGateway(sshArgs),
    ];

    const csStepFns: Array<() => Promise<StepResult>> = includeClawnoServer
      ? [
          () => deployRemoteInstallClawnoServer(sshArgs),
          () => deployRemoteStartClawnoServer(sshArgs, csPort),
        ]
      : [];

    const stepFns = [...baseStepFns, ...csStepFns];

    setSteps(stepDefs);
    setFinalResult(null);
    setIsDeploying(true);

    for (let i = 0; i < stepFns.length; i++) {
      setActiveIdx(i);
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: "running", elapsedSec: 0 } : s,
        ),
      );

      try {
        const res = await stepFns[i]!();
        if (res.ok) {
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "done", detail: res.detail, fixesApplied: res.fixes_applied ?? [] }
                : s,
            ),
          );

          if (i === stepFns.length - 1) {
            const port = sshArgs.gatewayPort;
            const gwUrl = `http://${sshArgs.host}:${port}`;
            const instId = `remote-${sshArgs.host}-${port}`;

            addOrUpdate({
              id: instId,
              name: derivedName,
              kind: "remote",
              gatewayUrl: gwUrl.replace(/^http/, "ws"),
              uiUrl: gwUrl,
              httpUrl: gwUrl,
              port,
              deployedAt: Date.now(),
              health: "online",
              ...(includeClawnoServer ? { chatProxyUrl: `http://${sshArgs.host}:${csPort}` } : {}),
            });

            // Persist SSH metadata for management commands
            try {
              await setSecureValue(
                `ssh_creds_${instId}`,
                JSON.stringify({
                  host: sshArgs.host,
                  port: sshArgs.port,
                  username: sshArgs.username,
                  gatewayPort: sshArgs.gatewayPort,
                }),
              );
              if (sshArgs.password) {
                await setSecureValue(`ssh_pass_${instId}`, sshArgs.password);
              }
            } catch {
              // Non-critical — creds won't be available for future management
            }

            setFinalResult({ success: true, message: t("deploy.ssh.success"), gatewayUrl: gwUrl });
          }
        } else {
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "error", detail: res.detail } : s,
            ),
          );
          setFinalResult({ success: false, message: res.detail });
          setIsDeploying(false);
          setActiveIdx(-1);
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "error", detail: msg } : s,
          ),
        );
        setFinalResult({ success: false, message: msg });
        setIsDeploying(false);
        setActiveIdx(-1);
        return;
      }
    }

    setActiveIdx(-1);
    setIsDeploying(false);
  };

  const reset = () => {
    setSteps([]);
    setFinalResult(null);
    setActiveIdx(-1);
    setTestResult(null);
    setTestError(null);
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const totalEstSec = steps.reduce((s, d) => s + d.estimatedSec, 0);
  const doneSec     = steps.filter((s) => s.status === "done" || s.status === "error").reduce((s, d) => s + d.elapsedSec, 0);
  const activeSec   = steps[activeIdx]?.elapsedSec ?? 0;
  const overallPct  = steps.length === 0 ? 0 : Math.min(99, ((doneSec + activeSec) / totalEstSec) * 100);

  const showForm = steps.length === 0 && !finalResult;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("deploy.ssh.title")} subtitle={t("deploy.ssh.subtitle")} back />

      <div className="flex-1 scrollable p-4 space-y-4 pb-8">

        {/* ── SSH Credentials ── */}
        {showForm && (
          <>
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
              <div className="px-4 py-3 border-b border-[hsl(var(--border))]"
                style={{ background: "rgba(6,182,212,0.04)" }}>
                <p className="font-semibold text-sm text-[hsl(var(--primary))]">{t("deploy.ssh.credentials")}</p>
              </div>
              <div className="p-4 space-y-3">
                {/* Host */}
                <div>
                  <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                    {t("deploy.ssh.host")}
                  </label>
                  <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.100"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>

                {/* SSH port + Username */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                      {t("deploy.ssh.port")}
                    </label>
                    <input type="number" value={sshPort} onChange={(e) => setSshPort(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                      {t("deploy.ssh.username")}
                    </label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                    {t("deploy.ssh.password")}
                  </label>
                  <div className="mt-1 relative">
                    <input type={showPass ? "text" : "password"} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("deploy.ssh.passwordPlaceholder")}
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    <button type="button" onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 touch-btn text-[hsl(var(--muted-foreground))]">
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* OpenClaw port + Instance name */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                      {t("deploy.ssh.servicePort")}
                    </label>
                    <input type="number" value={openclawPort} onChange={(e) => setOpenclawPort(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                      {t("deploy.ssh.instanceName")}
                    </label>
                    <input type="text" value={instanceName} onChange={(e) => setInstanceName(e.target.value)}
                      placeholder={hostTrimmed || t("deploy.ssh.title")}
                      className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
              </div>
            </div>
          </section>

            {/* ClawNO11 Server option */}
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
              <div className="p-4 space-y-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeClawnoServer}
                    onChange={(e) => setIncludeClawnoServer(e.target.checked)}
                    disabled={isDeploying}
                    className="mt-1 h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-primary disabled:opacity-50"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{t("deploy.ssh.includeClawnoServer")}</p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">{t("deploy.ssh.includeClawnoServerDesc")}</p>
                  </div>
                </label>

                {includeClawnoServer && (
                  <div className="ml-7">
                    <label className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                      {t("deploy.ssh.clawnoServerPort")}
                    </label>
                    <input type="number" value={clawnoServerPort} onChange={(e) => setClawnoServerPort(e.target.value)}
                      className="mt-1 w-32 px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm bg-[hsl(var(--card))] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                )}
              </div>
            </section>

            {/* Test result */}
            {testResult && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl text-xs text-green-700"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-0.5">{t("deploy.ssh.testSuccess")}</p>
                  <p className="font-mono opacity-80 leading-relaxed break-all">{testResult}</p>
                </div>
              </div>
            )}
            {testError && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl text-xs text-red-700"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <XCircle size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-0.5">{t("deploy.ssh.testFailed")}</p>
                  <p className="opacity-80 break-all">{testError}</p>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-col gap-2.5">
              <button onClick={handleTest} disabled={!canTest || isTesting}
                className="touch-btn w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border transition-colors disabled:opacity-40"
                style={{ borderColor: "rgba(6,182,212,0.4)", color: "hsl(var(--primary))" }}>
                {isTesting ? <Loader size={16} className="animate-spin" /> : <Wifi size={16} />}
                {t("deploy.ssh.testBtn")}
              </button>
              <button onClick={handleDeploy} disabled={!canDeploy}
                className="touch-btn w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-colors disabled:opacity-40"
                style={{ background: canDeploy ? "hsl(var(--primary))" : "hsl(var(--muted))", boxShadow: canDeploy ? "0 0 20px rgba(6,182,212,0.4)" : "none" }}>
                <Server size={16} /> {t("deploy.ssh.deployBtn")} <ChevronRight size={14} />
              </button>
              <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))] px-4">
                {t("deploy.ssh.deployHint")}
              </p>
            </div>
          </>
        )}

        {/* ── Step progress (deploying / failed) ── */}
        {steps.length > 0 && !finalResult?.success && (
          <>
            {/* Overall progress bar */}
            <div>
              <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))] mb-1">
                <span>{t("deploy.ssh.deploying")}</span>
                <span>
                  {isDeploying
                    ? `~${fmtSec(Math.max(0, totalEstSec - doneSec - activeSec))}`
                    : finalResult ? "" : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                    finalResult?.success ? "bg-green-500" :
                    finalResult          ? "bg-red-400"   : "bg-[hsl(var(--primary))]"
                  }`}
                  style={{ width: `${finalResult?.success ? 100 : overallPct}%` }}
                />
              </div>
            </div>

            {/* Step list */}
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]/50 overflow-hidden">
              {steps.map((step, i) => {
                const isActive = i === activeIdx;
                const pct = isActive
                  ? Math.min(99, (step.elapsedSec / step.estimatedSec) * 100)
                  : step.status === "done" || step.status === "error" ? 100 : 0;

                return (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-5 flex-shrink-0 mt-0.5">
                        {step.status === "done"    && <CheckCircle2 size={16} className="text-green-500" />}
                        {step.status === "error"   && <XCircle      size={16} className="text-red-500" />}
                        {step.status === "running" && <Loader       size={16} className="text-[hsl(var(--primary))] animate-spin" />}
                        {step.status === "pending" && <Circle       size={16} className="text-[hsl(var(--muted-foreground))]/30" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`text-sm leading-tight ${
                            step.status === "pending" ? "text-[hsl(var(--muted-foreground))]/50" :
                            step.status === "error"   ? "text-red-600 font-medium" :
                            step.status === "running" ? "font-semibold" : ""
                          }`}>
                            {step.label}
                          </p>
                          <span className="flex-shrink-0 flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                            <Clock size={10} />
                            {step.status === "running" ? (
                              <span className="tabular-nums">{fmtSec(step.elapsedSec)} / ~{fmtSec(step.estimatedSec)}</span>
                            ) : step.status === "done" ? (
                              <span className="text-green-600">{fmtSec(step.elapsedSec)}</span>
                            ) : step.status === "error" ? (
                              <span className="text-red-500">{fmtSec(step.elapsedSec)}</span>
                            ) : (
                              <span>~{fmtSec(step.estimatedSec)}</span>
                            )}
                          </span>
                        </div>
                        {step.detail && step.status !== "pending" && (
                          <p className={`text-[11px] mt-0.5 ${step.status === "error" ? "text-red-500" : "text-[hsl(var(--muted-foreground))]"}`}>
                            {step.detail}
                          </p>
                        )}
                        {(step.status === "running" || step.status === "done" || step.status === "error") && (
                          <div className="mt-1.5 h-1 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                                step.status === "done"  ? "bg-green-500" :
                                step.status === "error" ? "bg-red-500"   : "bg-[hsl(var(--primary))]"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Back button on failure */}
            {finalResult && !finalResult.success && (
              <button onClick={reset}
                className="touch-btn w-full py-2.5 rounded-xl text-sm font-semibold text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]">
                {t("deploy.ssh.backBtn")}
              </button>
            )}
          </>
        )}

        {/* ── Success ── */}
        {finalResult?.success && (
          <section className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.04)" }}>
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.12)" }}>
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <div>
                <p className="font-bold text-base text-green-700 mb-1">{t("deploy.ssh.successTitle")}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("deploy.ssh.successDesc")}</p>
                {finalResult.gatewayUrl && (
                  <p className="mt-1 font-mono text-xs text-green-700 break-all">{finalResult.gatewayUrl}</p>
                )}
              </div>

              {/* Step summary */}
              <div className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]/50 overflow-hidden text-left">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2">
                    <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                    <span className="text-xs flex-1 truncate">{step.label}</span>
                    <span className="text-[10px] text-green-600 font-mono">{fmtSec(step.elapsedSec)}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2.5 w-full mt-1">
                <button onClick={() => navigate("/chat")}
                  className="touch-btn w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white"
                  style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}>
                  <Terminal size={15} /> {t("deploy.ssh.startChat")}
                </button>
                <button onClick={() => navigate("/")}
                  className="touch-btn w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-semibold text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]">
                  <Server size={14} /> {t("deploy.ssh.viewInstances")}
                </button>
              </div>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
