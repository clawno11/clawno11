import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronRight, ChevronLeft, CheckCircle2,
  AlertTriangle, Loader, ExternalLink,
  Check, BadgeCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  testFeishuConnection,
  saveFeishuConfig,
  getFeishuConfig,
  type FeishuTestResult,
} from "../../ipc";
import { REQUIRED_SCOPES, SafeStepHtml, StepDot } from "./helpers";

export function FeishuWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FeishuTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedAppId, setSavedAppId] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    getFeishuConfig()
      .then(setSavedAppId)
      .catch(() => setSavedAppId(null))
      .finally(() => setLoadingExisting(false));
  }, []);

  const handleAppIdChange = useCallback((v: string) => {
    setAppId(v);
    setTestResult(null);
    setSaved(false);
  }, []);
  const handleAppSecretChange = useCallback((v: string) => {
    setAppSecret(v);
    setTestResult(null);
    setSaved(false);
  }, []);

  const FEISHU_STEPS = useMemo(() => [
    { title: t("connectors.feishu.step1Title"), desc: t("connectors.feishu.step1Desc") },
    { title: t("connectors.feishu.step2Title"), desc: t("connectors.feishu.step2Desc") },
    { title: t("connectors.feishu.step3Title"), desc: t("connectors.feishu.step3Desc") },
    { title: t("connectors.feishu.step4Title"), desc: t("connectors.feishu.step4Desc") },
  ], [t]);

  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!appId.trim() || !appSecret.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testFeishuConnection(appId.trim(), appSecret.trim());
      setTestResult(result);
      if (result.ok) setStep(FEISHU_STEPS.length - 1);
    } catch (e: unknown) {
      setTestError(typeof e === "string" ? e : t("common.error"));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!appId.trim() || !appSecret.trim()) return;
    if (!testResult?.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveFeishuConfig(appId.trim(), appSecret.trim());
      setSaved(true);
      setSavedAppId(appId.trim());
    } catch (e: unknown) {
      setSaveError(typeof e === "string" ? e : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    if (step === 2 && !testResult?.ok) return;
    setStep((s) => Math.min(FEISHU_STEPS.length - 1, s + 1));
  };

  const nextDisabled =
    step === FEISHU_STEPS.length - 1 ||
    (step === 2 && !testResult?.ok);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">🪽</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">{t("connectors.feishu.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("connectors.feishu.subtitle")}</p>
        </div>
        {!loadingExisting && savedAppId && (
          <div className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 border border-green-500/20 rounded-full px-2.5 py-0.5 flex-shrink-0">
            <BadgeCheck size={12} />
            <span className="hidden sm:inline">{t("connectors.feishu.configured")}</span>
          </div>
        )}
      </div>

      {/* Step indicators */}
      <div className="flex items-center px-5 py-3 gap-1 border-b border-border bg-muted/20">
        {FEISHU_STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-1 flex-1">
            <StepDot index={i} current={step} />
            <span className={`text-[10px] hidden sm:block truncate ${
              i === step ? "text-foreground font-medium" : "text-muted-foreground"
            }`}>{s.title}</span>
            {i < FEISHU_STEPS.length - 1 && (
              <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="p-5 space-y-4 min-h-[220px]">
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {FEISHU_STEPS[0]?.desc}
            </p>
            <ol className="space-y-2 text-sm">
              {(t("connectors.feishu.createSteps", { returnObjects: true }) as string[]).map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed">
                    <SafeStepHtml html={item} />
                  </span>
                </li>
              ))}
            </ol>
            <a
              href="https://open.feishu.cn/app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={13} /> {t("connectors.feishu.openPlatform")}
            </a>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{FEISHU_STEPS[1]?.desc}</p>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-medium">{t("connectors.feishu.requiredScopes")}</p>
              {REQUIRED_SCOPES.map((scope) => (
                <div key={scope} className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-primary" />
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{scope}</code>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("connectors.feishu.scopeHint")}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{FEISHU_STEPS[2]?.desc}</p>
            {savedAppId && !appId && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/8 border border-blue-500/20 text-xs text-blue-700">
                <BadgeCheck size={13} className="flex-shrink-0" />
                {t("connectors.feishu.alreadyConfigured", { appId: savedAppId })}
              </div>
            )}
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium block mb-1">App ID</label>
                <input
                  value={appId}
                  onChange={(e) => handleAppIdChange(e.target.value)}
                  placeholder="cli_xxxxxxxxx"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">App Secret</label>
                <input
                  type="password"
                  value={appSecret}
                  onChange={(e) => handleAppSecretChange(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <button
              onClick={handleTest}
              disabled={testing || !appId.trim() || !appSecret.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {testing ? <Loader size={14} className="animate-spin" /> : null}
              {testing ? t("connectors.feishu.testing") : t("connectors.feishu.test")}
            </button>
            {testError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/20 text-red-700 text-sm">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{testError}</span>
              </div>
            )}
            {testResult && (
              <div className={`space-y-1 p-3 rounded-lg text-sm ${
                testResult.ok
                  ? "bg-green-500/8 border border-green-500/20 text-green-700"
                  : "bg-red-500/8 border border-red-500/20 text-red-700"
              }`}>
                <div className="flex items-start gap-2">
                  {testResult.ok
                    ? <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />
                    : <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />}
                  <span>{testResult.msg}</span>
                </div>
                {testResult.missing_scopes.length > 0 && (
                  <ul className="ml-5 mt-1 space-y-0.5 text-xs">
                    {testResult.missing_scopes.map((s) => (
                      <li key={s}>• {t("connectors.feishu.missingScope")}<code className="bg-red-500/10 px-1 rounded">{s}</code></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/8 border border-green-500/20">
              <CheckCircle2 size={18} className="text-green-500" />
              <span className="text-sm font-medium text-green-700">{t("connectors.feishu.verified")}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("connectors.feishu.saveHint")}
            </p>
            <button
              onClick={handleSave}
              disabled={saving || saved || !testResult?.ok}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saved
                ? <><Check size={14} /> {t("connectors.feishu.saved")}</>
                : saving
                  ? <><Loader size={14} className="animate-spin" /> {t("connectors.feishu.saving")}</>
                  : t("connectors.feishu.save")}
            </button>
            {saved && (
              <p className="text-xs text-muted-foreground">
                {t("connectors.feishu.savedNote")}
              </p>
            )}
            {saveError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/20 text-red-700 text-sm">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{saveError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={15} /> {t("connectors.feishu.prev")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("connectors.feishu.stepOf", { current: step + 1, total: FEISHU_STEPS.length })}
        </span>
        <button
          onClick={goNext}
          disabled={nextDisabled}
          className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 disabled:opacity-30 transition-colors"
          title={step === 2 && !testResult?.ok ? t("connectors.feishu.testFirst") : undefined}
        >
          {t("connectors.feishu.next")} <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
