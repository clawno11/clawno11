import { useTranslation } from "react-i18next";
import {
  CheckCircle, XCircle, Loader, ExternalLink,
  KeyRound, ChevronDown, RefreshCw, AlertTriangle, Info,
} from "lucide-react";
import type { DeployMode, FinalResult, VerifyStatus } from "./types";
import { AI_PROVIDERS } from "./types";
import { translateDetail } from "./translations";

interface DeployResultProps {
  finalResult: FinalResult;
  mode: DeployMode;
  isDeploying: boolean;
  sshUser: string;
  sshHost: string;
  aiProvider: string;
  setAiProvider: (v: string) => void;
  aiApiKey: string;
  setAiApiKey: (v: string) => void;
  isConfiguringAI: boolean;
  aiConfigResult: { ok: boolean; msg: string } | null;
  aiVerifyStatus: VerifyStatus;
  setAiVerifyStatus: (v: VerifyStatus) => void;
  aiVerifyMsg: string | undefined;
  handleConfigureAI: () => void;
  handleOpenDashboard: () => void;
  ollamaPhase: "idle" | "installing" | "ok" | "fail";
  onReset: () => void;
}

export function DeployResult(props: DeployResultProps) {
  const { t } = useTranslation();
  const {
    finalResult, mode, isDeploying,
    sshUser, sshHost,
    aiProvider, setAiProvider, aiApiKey, setAiApiKey,
    isConfiguringAI, aiConfigResult, aiVerifyStatus, setAiVerifyStatus, aiVerifyMsg,
    handleConfigureAI, handleOpenDashboard,
    ollamaPhase, onReset,
  } = props;

  return (
    <>
      <div className={`mb-4 rounded-xl border p-4 ${
        finalResult.success && finalResult.serviceStarted
          ? "bg-green-50 border-green-200"
          : finalResult.success
          ? "bg-amber-50 border-amber-200"
          : "bg-red-50 border-red-200"
      }`}>
        <div className="flex items-start gap-3">
          {finalResult.success && finalResult.serviceStarted
            ? <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
            : finalResult.success
            ? <CheckCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
            : <XCircle     size={18} className="text-red-500   mt-0.5 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${
              finalResult.success && finalResult.serviceStarted ? "text-green-700" :
              finalResult.success ? "text-amber-700" : "text-red-600"
            }`}>
              {finalResult.success ? t("deploy.success") : t("deploy.failed")}
            </p>
            {(!finalResult.serviceStarted || !finalResult.success) && (
              <p className="text-xs mt-0.5 text-muted-foreground">
                {translateDetail(finalResult.message)}
              </p>
            )}
            {finalResult.success && !finalResult.serviceStarted && (
              <p className="text-xs mt-1 text-amber-600">{t("deploy.serviceRecorded")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Configure AI Model — local: inline form */}
      {finalResult.success && finalResult.serviceStarted && mode === "local" && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound size={16} className="text-primary" />
            <p className="text-sm font-semibold">{t("instances.ai.title")} <span className="text-red-500">*</span></p>
            <span className="ml-auto text-xs text-muted-foreground">{t("instances.ai.notConfigured")}</span>
          </div>
          <div className="relative mb-2">
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
              disabled={isConfiguringAI || aiConfigResult?.ok === true}
              className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            >
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => { setAiApiKey(e.target.value); setAiVerifyStatus("idle"); }}
              placeholder={AI_PROVIDERS.find((p) => p.id === aiProvider)?.placeholder ?? "输入 API Key"}
              disabled={isConfiguringAI || aiVerifyStatus === "verifying" || aiConfigResult?.ok === true}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              onKeyDown={(e) => { if (e.key === "Enter") handleConfigureAI(); }}
            />
            <button
              onClick={handleConfigureAI}
              disabled={isConfiguringAI || aiVerifyStatus === "verifying" || !aiApiKey.trim() || aiConfigResult?.ok === true}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {isConfiguringAI || aiVerifyStatus === "verifying"
                ? <Loader size={14} className="animate-spin" />
                : aiVerifyStatus === "ok"
                  ? <CheckCircle size={14} />
                  : aiVerifyStatus === "failed"
                    ? <AlertTriangle size={14} />
                    : <KeyRound size={14} />}
              {isConfiguringAI
                ? t("deploy.deploying")
                : aiVerifyStatus === "verifying"
                  ? "验证中…"
                  : aiVerifyStatus === "ok"
                    ? "已配置（可用）"
                    : aiVerifyStatus === "failed"
                      ? "配置失败"
                      : aiVerifyStatus === "relay"
                        ? "已写入（中转）"
                        : aiConfigResult?.ok
                          ? t("instances.ai.configured")
                          : t("instances.actions.write")}
            </button>
          </div>
          {aiConfigResult && !aiConfigResult.ok && (
            <p className="text-xs mt-2 text-red-500">✗ {aiConfigResult.msg}</p>
          )}
          {aiConfigResult?.ok && aiVerifyStatus === "verifying" && (
            <p className="text-xs mt-2 text-blue-600 flex items-center gap-1">
              <RefreshCw size={11} className="animate-spin" /> Key 写入成功，正在验证可用性…
            </p>
          )}
          {aiConfigResult?.ok && aiVerifyStatus === "ok" && (
            <p className="text-xs mt-2 text-green-600">✓ Key 验证通过，配置成功，可以开始使用</p>
          )}
          {aiConfigResult?.ok && aiVerifyStatus === "relay" && (
            <p className="text-xs mt-2 text-amber-600">✓ Key 已写入（中转模式），请确保 OpenRouter 也已配置</p>
          )}
          {aiConfigResult?.ok && aiVerifyStatus === "failed" && (
            <p className="text-xs mt-2 text-red-500">
              ✗ Key 已写入但验证失败：{aiVerifyMsg ?? "无法连接服务商"} · 请检查 Key 是否正确
            </p>
          )}
        </div>
      )}

      {/* Remote: show SSH command the user must run on the server */}
      {finalResult.success && finalResult.serviceStarted && mode === "remote" && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={16} className="text-primary" />
            <p className="text-sm font-semibold">{t("instances.ai.title")}</p>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{t("deploy.ssh.aiKeyRemoteHint")}</p>
          <code className="block text-xs font-mono bg-muted/60 px-3 py-2 rounded-lg break-all select-all">
            {`openclaw models auth paste-token --provider PROVIDER`}
          </code>
          <p className="text-xs text-muted-foreground mt-1.5">
            {`ssh ${sshUser}@${sshHost}`}
          </p>
        </div>
      )}

      {/* Ollama engine background install status */}
      {finalResult.success && finalResult.serviceStarted && mode === "local" && ollamaPhase !== "idle" && (
        <div className={`mb-3 flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm ${
          ollamaPhase === "installing"
            ? "border-border bg-muted/30 text-muted-foreground"
            : ollamaPhase === "ok"
            ? "border-green-200 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400"
            : "border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400"
        }`}>
          {ollamaPhase === "installing" && <Loader size={14} className="animate-spin flex-shrink-0" />}
          {ollamaPhase === "ok"         && <CheckCircle size={14} className="flex-shrink-0" />}
          {ollamaPhase === "fail"       && <Info size={14} className="flex-shrink-0" />}
          <span className="text-xs">
            {ollamaPhase === "installing" && "正在后台安装本地模型引擎（Ollama）…"}
            {ollamaPhase === "ok"         && "本地模型引擎已就绪，无需 API Key 即可使用"}
            {ollamaPhase === "fail"       && "本地模型引擎安装遇到问题，可前往「本地」页手动安装"}
          </span>
        </div>
      )}

      {/* Open dashboard */}
      {finalResult.success && finalResult.serviceStarted && (
        <div className="mb-4">
          <button
            onClick={handleOpenDashboard}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <ExternalLink size={15} />
            {t("deploy.openDashboard")}
          </button>
          {mode === "local" && !aiConfigResult?.ok && (
            <p className="text-xs text-center text-muted-foreground mt-1">{t("deploy.noApiKeyHint")}</p>
          )}
        </div>
      )}

      {/* After deploy: reset button */}
      <button
        onClick={onReset}
        disabled={isDeploying}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-semibold
                   hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors flex items-center justify-center gap-2"
      >
        {finalResult.success && finalResult.serviceStarted
          ? t("deploy.redeploy")
          : finalResult.success && !finalResult.serviceStarted
          ? t("deploy.retryStart")
          : t("deploy.startDeploy")}
      </button>
    </>
  );
}
