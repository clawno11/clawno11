import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Server, Settings2, Rocket, Loader, Play } from "lucide-react";
import { fmtSec } from "./deploy/types";
import { useDeployState } from "./deploy/useDeployState";
import { StepRow } from "./deploy/StepRow";
import { SshForm } from "./deploy/SshForm";
import { DeployResult } from "./deploy/DeployResult";
import i18n from "../i18n";

const L = (zh: string, en: string) => (i18n.language === "en" ? en : zh);

export function DeployPage() {
  const { t } = useTranslation();
  const state = useDeployState();
  const [advancedMode, setAdvancedMode] = useState(false);

  const {
    mode, setMode, steps, isDeploying, finalResult, activeIdx,
    isScanning,
    ollamaPhase, reset, resetAndRecheck, retryFromFailed, failedStepIdx,
    totalEstSec, doneSec, activeSec, overallPct,
    prepareSteps, executeStep,
  } = state;

  const isPreDeploy = steps.length === 0 && !isScanning;
  const hasSteps = steps.length > 0;

  return (
    <div className="page-enter p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("deploy.title")}</h1>
          <span className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(6,182,212,0.1)", color: "hsl(187,85%,40%)", border: "1px solid rgba(6,182,212,0.2)" }}>
            OpenClaw
          </span>
        </div>

        {/* Advanced mode toggle */}
        {mode === "local" && !finalResult && (isPreDeploy || (hasSteps && advancedMode)) && (
          <button
            onClick={() => {
              const next = !advancedMode;
              setAdvancedMode(next);
              if (next && steps.length === 0) {
                prepareSteps();
              }
            }}
            disabled={isDeploying}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
              advancedMode
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
            }`}
          >
            <Settings2 size={13} />
            {advancedMode ? t("deploy.simpleMode") : t("deploy.advancedMode")}
          </button>
        )}
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        {mode === "remote" ? t("deploy.remoteDesc") : t("deploy.desc")}
      </p>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(["local", "remote"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); reset(); }}
            disabled={isDeploying}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors disabled:opacity-50 ${
              mode === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            {m === "local" ? <HardDrive size={28} /> : <Server size={28} />}
            <span className="font-semibold">{m === "local" ? t("deploy.local") : t("deploy.remote")}</span>
            <span className="text-xs text-muted-foreground text-center">
              {m === "local" ? t("deploy.localDesc") : t("deploy.remoteDesc")}
            </span>
          </button>
        ))}
      </div>

      {/* Pre-deploy: one-click deploy button (shown when no advanced mode) */}
      {mode === "local" && isPreDeploy && !finalResult && !advancedMode && (
        <button
          onClick={() => state.handleDeploy("full")}
          disabled={isDeploying}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-primary bg-primary/5 text-primary font-semibold hover:bg-primary/10 transition-colors disabled:opacity-50"
        >
          <Rocket size={20} />
          {L("一键部署", "One-Click Deploy")}
        </button>
      )}

      {/* Scanning indicator */}
      {isScanning && steps.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader size={20} className="animate-spin text-primary" />
          <span className="text-sm font-medium">{L("正在检测系统环境…", "Scanning system environment…")}</span>
        </div>
      )}

      {/* SSH form (remote mode, before deploy starts) */}
      {mode === "remote" && steps.length === 0 && !finalResult && (
        <SshForm
          sshHost={state.sshHost} setSshHost={state.setSshHost}
          sshPort={state.sshPort} setSshPort={state.setSshPort}
          sshUser={state.sshUser} setSshUser={state.setSshUser}
          sshAuthMethod={state.sshAuthMethod} setSshAuthMethod={state.setSshAuthMethod}
          sshPassword={state.sshPassword} setSshPassword={state.setSshPassword}
          sshPrivateKey={state.sshPrivateKey} setSshPrivateKey={state.setSshPrivateKey}
          sshGatewayPort={state.sshGatewayPort} setSshGatewayPort={state.setSshGatewayPort}
          showPassword={state.showPassword} setShowPassword={state.setShowPassword}
          isTestingConn={state.isTestingConn} connTestResult={state.connTestResult}
          setConnTestResult={state.setConnTestResult}
          isDeploying={isDeploying}
          handleTestConnection={state.handleTestConnection}
          handleRemoteDeploy={state.handleRemoteDeploy}
          keyFileRef={state.keyFileRef}
          includeClawnoServer={state.includeClawnoServer}
          setIncludeClawnoServer={state.setIncludeClawnoServer}
          clawnoServerPort={state.clawnoServerPort}
          setClawnoServerPort={state.setClawnoServerPort}
        />
      )}

      {/* Overall progress bar */}
      {steps.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{t("deploy.deploying")}</span>
            <span>
              {isDeploying
                ? `~${fmtSec(Math.max(0, totalEstSec - doneSec - activeSec))}`
                : finalResult?.success
                ? fmtSec(steps.reduce((s, d) => s + d.elapsedSec, 0))
                : ""}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                finalResult?.success ? "bg-green-500" :
                finalResult          ? "bg-red-400"   : "bg-primary"
              }`}
              style={{ width: `${finalResult?.success ? 100 : overallPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card px-4 divide-y divide-border">
          {steps.map((step, i) => (
            <div key={step.depId ?? `step-${i}`} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <StepRow step={step} isActive={i === activeIdx} />
              </div>
              {advancedMode && step.status === "pending" && !isDeploying && (() => {
                const canRun = !steps.some((s, j) => j < i && s.status !== "done");
                return (
                  <button
                    onClick={() => canRun && executeStep(i)}
                    disabled={!canRun}
                    title={!canRun ? L("请先完成前面的步骤", "Complete previous steps first") : undefined}
                    className="flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg
                               bg-primary text-primary-foreground hover:bg-primary/90 transition-colors
                               font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play size={12} />
                    {L("执行", "Run")}
                  </button>
                );
              })()}
              {advancedMode && step.status === "error" && !isDeploying && (
                <button
                  onClick={() => executeStep(i)}
                  className="flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg
                             border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20
                             transition-colors font-medium"
                >
                  <Play size={12} />
                  {L("重试", "Retry")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final result */}
      {finalResult && (
        <DeployResult
          finalResult={finalResult}
          mode={mode}
          isDeploying={isDeploying}
          sshUser={state.sshUser}
          sshHost={state.sshHost}
          aiProvider={state.aiProvider} setAiProvider={state.setAiProvider}
          aiApiKey={state.aiApiKey} setAiApiKey={state.setAiApiKey}
          isConfiguringAI={state.isConfiguringAI}
          aiConfigResult={state.aiConfigResult}
          aiVerifyStatus={state.aiVerifyStatus} setAiVerifyStatus={state.setAiVerifyStatus}
          aiVerifyMsg={state.aiVerifyMsg}
          handleConfigureAI={state.handleConfigureAI}
          handleOpenDashboard={state.handleOpenDashboard}
          ollamaPhase={ollamaPhase}
          onReset={mode === "local" ? resetAndRecheck : reset}
          onRetryFromFailed={retryFromFailed}
          failedStepIdx={failedStepIdx}
        />
      )}
    </div>
  );
}
