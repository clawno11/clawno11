import { useTranslation } from "react-i18next";
import { HardDrive, Server } from "lucide-react";
import { fmtSec } from "./deploy/types";
import { useDeployState } from "./deploy/useDeployState";
import { StepRow } from "./deploy/StepRow";
import { SshForm } from "./deploy/SshForm";
import { LocalStatusCard } from "./deploy/LocalStatusCard";
import { DeployResult } from "./deploy/DeployResult";

export function DeployPage() {
  const { t } = useTranslation();
  const state = useDeployState();
  const {
    mode, setMode, steps, isDeploying, finalResult, activeIdx,
    ollamaPhase, reset, resetAndRecheck,
    totalEstSec, doneSec, activeSec, overallPct, freshEstSec,
  } = state;

  return (
    <div className="page-enter p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("deploy.title")}</h1>
        <span className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "rgba(6,182,212,0.1)", color: "hsl(187,85%,40%)", border: "1px solid rgba(6,182,212,0.2)" }}>
          OpenClaw
        </span>
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
        />
      )}

      {/* Pre-deploy status card (local only, before deploy starts) */}
      {mode === "local" && steps.length === 0 && !finalResult && (
        <LocalStatusCard
          checkPhase={state.checkPhase}
          deployStatus={state.deployStatus}
          isRechecking={state.isRechecking}
          isDeploying={isDeploying}
          runStatusCheck={state.runStatusCheck}
          handleDeploy={state.handleDeploy}
          freshEstSec={freshEstSec}
        />
      )}

      {/* Overall progress bar (shown during / after deploy) */}
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
            <StepRow key={i} step={step} isActive={i === activeIdx} />
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
        />
      )}
    </div>
  );
}
