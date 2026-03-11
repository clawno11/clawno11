import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plug, ChevronRight, ChevronLeft, CheckCircle2,
  AlertTriangle, Loader, Network, ExternalLink,
  Copy, Check, Wifi, RefreshCw, BadgeCheck,
  ChevronDown, ChevronUp, Info, Smartphone, QrCode,
  Send, MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import { useInstanceStore } from "../store/instances";
import {
  testFeishuConnection,
  saveFeishuConfig,
  getFeishuConfig,
  getTailscaleStatus,
  getLanInfo,
  generatePairQrWithHost,
  type PairQrPayload,
  testTelegramConfig,
  saveTelegramConfig,
  getTelegramConfig,
  startTelegramBot,
  stopTelegramBot,
  getTelegramBotStatus,
  testDiscordConfig,
  saveDiscordConfig,
  getDiscordConfig,
  startDiscordBot,
  stopDiscordBot,
  getDiscordBotStatus,
  type FeishuTestResult,
  type TailscaleStatus,
  type TelegramBotInfo,
  type DiscordBotInfo,
} from "../ipc";

// ── Constants ──────────────────────────────────────────────────────────────

/** Default port used when no online instance is found. */
const DEFAULT_PORT = 18789;

const REQUIRED_SCOPES = [
  "im:message",
  "im:message:send_as_bot",
  "im:resource",
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Render a step description that may contain safe inline links/code.
 * Instead of dangerouslySetInnerHTML, we parse a small known subset:
 * <a href="..." target="_blank" rel="...">text</a> and <code>text</code>.
 * Unrecognised tags are stripped.
 */
function SafeStepHtml({ html }: { html: string }) {
  // Split on tags we explicitly allow, render everything else as plain text.
  const parts = html.split(/(<a [^>]+>.*?<\/a>|<code[^>]*>.*?<\/code>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const aMatch = part.match(/^<a href="([^"]+)"[^>]*>(.*?)<\/a>$/);
        if (aMatch) {
          return (
            <a
              key={i}
              href={aMatch[1]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {aMatch[2]}
            </a>
          );
        }
        const codeMatch = part.match(/^<code[^>]*>(.*?)<\/code>$/);
        if (codeMatch) {
          return (
            <code key={i} className="bg-muted px-1 rounded text-xs">
              {codeMatch[1]}
            </code>
          );
        }
        // Strip any remaining unknown tags; render as plain text.
        return <span key={i}>{part.replace(/<[^>]+>/g, "")}</span>;
      })}
    </>
  );
}

// ── Feishu Wizard ─────────────────────────────────────────────────────────

function FeishuWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FeishuTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** App ID already stored in secure store (shown as "already configured" hint). */
  const [savedAppId, setSavedAppId] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // Load existing configuration on mount so the user knows if it's already set up.
  useEffect(() => {
    getFeishuConfig()
      .then(setSavedAppId)
      .catch(() => setSavedAppId(null))
      .finally(() => setLoadingExisting(false));
  }, []);

  // Reset validation state whenever credentials change so the user must re-test.
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
      // Auto-advance to save step only on full success (credentials + scopes OK)
      if (result.ok) setStep(FEISHU_STEPS.length - 1);
    } catch (e: unknown) {
      // Rust IPC error (e.g. HTTP client failed to build, network unreachable at OS level)
      setTestError(typeof e === "string" ? e : t("common.error"));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    // Guard: only save if credentials are non-empty and have been validated.
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

  /** Navigate to the next step. Step 2→3 is gated on a successful test. */
  const goNext = () => {
    if (step === 2 && !testResult?.ok) return; // Must test successfully first
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
        {/* Already-configured badge */}
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
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              i < step ? "bg-green-500 text-white" :
              i === step ? "bg-primary text-primary-foreground" :
              "bg-muted text-muted-foreground"
            }`}>
              {i < step ? <CheckCircle2 size={12} /> : String(i + 1)}
            </div>
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
            {/* Show pre-filled hint if already configured */}
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
            {/* IPC-level error (Rust returned Err, not a FeishuTestResult) */}
            {testError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/20 text-red-700 text-sm">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{testError}</span>
              </div>
            )}
            {/* Application-level result (Feishu API responded) */}
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

// ── Tailscale Panel ───────────────────────────────────────────────────────

function TailscalePanel() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const activePort = instances.find((i) => i.health === "online")?.port ?? DEFAULT_PORT;

  const refresh = useCallback(() => {
    setLoading(true);
    getTailscaleStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const accessUrl = status?.ip ? `http://${status.ip}:${activePort}` : null;

  const copyUrl = async () => {
    if (!accessUrl) return;
    try {
      await navigator.clipboard.writeText(accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore; user can copy manually
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Network size={18} className="text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">{t("connectors.tailscale.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("connectors.tailscale.subtitle")}</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-40"
          title={t("common.refresh")}
        >
          <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-muted-foreground"} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {status && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            status.running
              ? "border-green-500/20 bg-green-500/5"
              : status.installed
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-border bg-muted/20"
          }`}>
            <Wifi size={16} className={
              status.running ? "text-green-500" :
              status.installed ? "text-amber-500" : "text-muted-foreground"
            } />
            <div>
              <p className="text-sm font-medium">
                {status.running ? t("connectors.tailscale.connected") :
                 status.installed ? t("connectors.tailscale.notRunning") :
                 t("connectors.tailscale.notInstalled")}
              </p>
              {status.version && (
                <p className="text-xs text-muted-foreground">{t("connectors.tailscale.version")}{status.version}</p>
              )}
              {status.ip && (
                <p className="text-xs text-muted-foreground">{t("connectors.tailscale.ip")}{status.ip}</p>
              )}
            </div>
          </div>
        )}

        {accessUrl && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">{t("connectors.tailscale.accessUrl")}</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/30">
              <code className="flex-1 text-xs text-primary font-mono truncate">{accessUrl}</code>
              <button
                onClick={copyUrl}
                className="flex-shrink-0 p-1 rounded hover:bg-muted/60 transition-colors"
                title={t("connectors.tailscale.copy")}
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("connectors.tailscale.accessHint")}
            </p>
          </div>
        )}

        {status && !status.installed && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("connectors.tailscale.installHint")}
            </p>
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 transition-colors"
            >
              <ExternalLink size={13} /> {t("connectors.tailscale.download")}
            </a>
            <p className="text-xs text-muted-foreground">
              {t("connectors.tailscale.privacyNote")}
            </p>
          </div>
        )}

        {status && status.installed && !status.running && (
          <p className="text-sm text-muted-foreground">
            {t("connectors.tailscale.startHint")}
          </p>
        )}
      </div>
    </div>
  );
}

// ── xEdge Panel ───────────────────────────────────────────────────────────

function XEdgePanel() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const [open, setOpen] = useState(false);

  const activePort = instances.find((i) => i.health === "online")?.port ?? DEFAULT_PORT;

  return (
    <div className="rounded-xl border-2 border-cyan-500/30 bg-card overflow-hidden"
      style={{ boxShadow: "0 0 0 1px rgba(6,182,212,0.1), 0 2px 12px rgba(6,182,212,0.06)" }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border relative">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center flex-shrink-0">
          <span className="text-base font-black" style={{ color: "#06b6d4", fontFamily: "monospace" }}>X</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">{t("connectors.xedge.title")}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t("connectors.xedge.subtitle")}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted/60 transition-colors"
        >
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
      </div>

      {open && (
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{t("connectors.xedge.desc")}</p>

          {/* Free tier badge */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-cyan-700 bg-cyan-500/8 border border-cyan-500/20">
            <CheckCircle2 size={12} />
            {t("connectors.xedge.free")}
          </div>

          <GuideSteps steps={[
            t("connectors.xedge.step1"),
            t("connectors.xedge.step2"),
            t("connectors.xedge.step3"),
            t("connectors.xedge.step4", { port: activePort }),
          ]} />

          {/* Compatibility tip */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-xs text-cyan-800">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>{t("connectors.xedge.tip")}</span>
          </div>

          <a
            href="https://xedge.cc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}
          >
            <ExternalLink size={13} /> {t("connectors.xedge.download")}
          </a>
        </div>
      )}
    </div>
  );
}

// ── Secure Mobile QR Code Panel ───────────────────────────────────────────────
//
// Security design (modelled on Bluetooth Numeric Comparison):
//   1. Desktop generates a crypto-random OTP token (20 bytes) via Rust backend.
//   2. Token expires in 120 s; QR auto-refreshes at T-5 s.
//   3. Host (IP:port) and server name are Base64-encoded in the QR — not plaintext.
//   4. Desktop shows a 6-char PIN derived from the token.
//   5. Mobile scans QR, derives the same PIN, and asks the user to verify it
//      matches what is shown on the desktop before proceeding.
//   This prevents phishing (modified QR would produce a different PIN) and
//   makes screenshot/photo leaks less immediately dangerous.

const PAIR_TTL = 120; // seconds — must match TOKEN_TTL_SECS in pairing.rs

function MobileQrPanel() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();

  const [lanIp, setLanIp]         = useState<string | null>(null);
  const [payload, setPayload]     = useState<PairQrPayload | null>(null);
  const [loading, setLoading]     = useState(false);
  const [countdown, setCountdown] = useState(PAIR_TTL);
  const [expired, setExpired]     = useState(false);

  const onlineInstance = instances.find((i) => i.health === "online");
  const port           = onlineInstance?.port ?? 18789;
  const serverName     = onlineInstance?.name ?? "My Server";

  // Resolve LAN IP once.
  useEffect(() => {
    getLanInfo()
      .then((info) => { if (info?.ip) setLanIp(info.ip); })
      .catch(() => {});
  }, []);

  // Generate a new pairing token whenever lanIp resolves or token expires.
  const refresh = useCallback(async () => {
    if (!lanIp) return;
    setLoading(true);
    setExpired(false);
    try {
      const p = await generatePairQrWithHost(lanIp, port, serverName);
      setPayload(p);
      setCountdown(PAIR_TTL);
    } catch {
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [lanIp, port, serverName]);

  useEffect(() => {
    if (lanIp) refresh();
  }, [lanIp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown ticker — auto-refresh when approaching expiry.
  useEffect(() => {
    if (!payload) return;
    let autoRefreshId: ReturnType<typeof setTimeout> | null = null;
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setExpired(true);
          clearInterval(tick);
          autoRefreshId = setTimeout(() => refresh(), 1000);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      clearInterval(tick);
      if (autoRefreshId !== null) clearTimeout(autoRefreshId);
    };
  }, [payload, refresh]);

  // Colour of countdown ring: green → yellow → red.
  const pct     = countdown / PAIR_TTL;
  const ringClr = pct > 0.5 ? "#22c55e" : pct > 0.25 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
        <Smartphone size={16} className="text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{t("connectors.mobileQr.title")}</p>
          <p className="text-xs text-muted-foreground">{t("connectors.mobileQr.desc")}</p>
        </div>
        {/* Security badge */}
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700 flex items-center gap-1">
          <CheckCircle2 size={10} /> OTP 加密
        </span>
      </div>

      <div className="p-5 flex flex-col sm:flex-row gap-6 items-center">
        {/* QR + countdown ring */}
        <div className="flex-shrink-0 flex flex-col items-center gap-2">
          <div className="relative p-2.5 bg-white rounded-xl border border-border shadow-sm">
            {!lanIp ? (
              <div className="w-[140px] h-[140px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <QrCode size={36} className="opacity-30" />
                <p className="text-[11px] text-center leading-tight px-2">{t("connectors.mobileQr.noLan")}</p>
              </div>
            ) : loading ? (
              <div className="w-[140px] h-[140px] flex items-center justify-center">
                <Loader size={28} className="animate-spin text-primary/40" />
              </div>
            ) : payload ? (
              <div className={expired ? "opacity-30 blur-[1px]" : ""}>
                <QRCode value={payload.qr_data} size={140} />
              </div>
            ) : (
              <div className="w-[140px] h-[140px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <AlertTriangle size={28} className="text-amber-400" />
                <p className="text-[11px] text-center">{t("connectors.mobileQr.genError")}</p>
              </div>
            )}

            {/* Expired overlay */}
            {expired && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 rounded-xl">
                <RefreshCw size={20} className="text-primary animate-spin" />
                <p className="text-[11px] mt-1 text-muted-foreground">{t("connectors.mobileQr.refreshing")}</p>
              </div>
            )}
          </div>

          {/* Countdown + manual refresh */}
          {payload && !expired && (
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-mono font-bold"
                style={{ color: ringClr }}
              >
                {String(Math.floor(countdown / 60)).padStart(2, "0")}:{String(countdown % 60).padStart(2, "0")}
              </span>
              <button
                onClick={refresh}
                title={t("connectors.mobileQr.refreshBtn")}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Right column: steps */}
        <div className="flex-1 space-y-4 min-w-0">
          {/* Steps */}
          <ol className="space-y-2">
            {[
              t("connectors.mobileQr.step1"),
              t("connectors.mobileQr.step2"),
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>

          {!lanIp && (
            <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {t("connectors.mobileQr.noLanWarn")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Telegram Bot Panel ───────────────────────────────────────────────────────

function TelegramPanel({ activePort }: { activePort: number }) {
  const [token, setToken]               = useState("");
  const [testing, setTesting]           = useState(false);
  const [botInfo, setBotInfo]           = useState<TelegramBotInfo | null>(null);
  const [testErr, setTestErr]           = useState<string | null>(null);
  const [saveErr, setSaveErr]           = useState<string | null>(null);
  const [toggleErr, setToggleErr]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [running, setRunning]           = useState(false);
  const [toggling, setToggling]         = useState(false);
  const [savedHint, setSavedHint]       = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    getTelegramConfig()
      .then((t) => { if (t) setSavedHint(t.slice(0, 8) + "…"); })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
    getTelegramBotStatus().then(setRunning).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!token.trim()) return;
    setTesting(true); setTestErr(null); setBotInfo(null); setSaveErr(null); setToggleErr(null);
    try {
      const info = await testTelegramConfig(token.trim());
      setBotInfo(info);
    } catch (e) {
      setTestErr(String(e));
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!botInfo) return;
    setSaving(true); setSaveErr(null);
    try {
      await saveTelegramConfig(token.trim());
      setSaved(true);
      setSavedHint(token.trim().slice(0, 8) + "…");
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveErr(String(e));
    } finally { setSaving(false); }
  };

  const handleToggle = async () => {
    setToggling(true); setToggleErr(null);
    try {
      if (running) {
        await stopTelegramBot();
        setRunning(false);
      } else {
        await startTelegramBot(activePort);
        setRunning(true);
      }
    } catch (e) {
      setToggleErr(String(e));
    } finally { setToggling(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border"
        style={{ background: "rgba(42,171,238,0.05)" }}>
        <Send size={16} style={{ color: "#2AABEE" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Telegram Bot</p>
          <p className="text-xs text-muted-foreground">用 @BotFather 创建机器人，轮询对话，无需公网 IP</p>
        </div>
        {running && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            运行中
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {loadingExisting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader size={13} className="animate-spin" /> 读取已保存配置…
          </div>
        ) : savedHint ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <BadgeCheck size={14} className="text-blue-500" />
            已配置 Token（前缀：{savedHint}）
          </div>
        ) : null}

        {/* Token input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Bot Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setBotInfo(null); setTestErr(null); }}
              placeholder="从 @BotFather 获取，格式：123456:ABC-DEF…"
              className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleTest}
              disabled={testing || !token.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {testing ? <Loader size={14} className="animate-spin" /> : "验证"}
            </button>
          </div>
        </div>

        {/* Validation result */}
        {botInfo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            <span className="text-xs text-green-800 flex-1">
              已验证：<strong>@{botInfo.username}</strong>（{botInfo.first_name}）
            </span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader size={12} className="animate-spin" /> : saved ? <Check size={12} /> : "保存"}
            </button>
          </div>
        )}

        {testErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{testErr}</span>
          </div>
        )}
        {saveErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">保存失败：{saveErr}</span>
          </div>
        )}
        {toggleErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">启停失败：{toggleErr}</span>
          </div>
        )}

        {/* Start / Stop */}
        <button
          onClick={handleToggle}
          disabled={toggling || (!savedHint && !botInfo)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 ${
            running
              ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              : "bg-[#2AABEE]/10 text-[#2AABEE] border border-[#2AABEE]/20 hover:bg-[#2AABEE]/20"
          }`}
        >
          {toggling ? <Loader size={14} className="animate-spin" /> : running ? <Wifi size={14} /> : <Wifi size={14} />}
          {running ? "停止机器人" : "启动机器人"}
        </button>

        {/* Guide */}
        <details className="group">
          <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <Info size={12} /> 如何创建 Telegram 机器人
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform ml-auto" />
          </summary>
          <GuideSteps steps={[
            "在 Telegram 搜索 @BotFather，发送 /newbot",
            "按提示设置机器人名称（如「我的AI助手」）和用户名（必须以 bot 结尾）",
            "BotFather 会回复一个 Token，复制粘贴到上方输入框",
            "点击「验证」确认无误后点「保存」，再点「启动机器人」",
            "机器人启动后，在 Telegram 与它对话即可",
          ]} />
        </details>
      </div>
    </div>
  );
}

// ── Discord Bot Panel ─────────────────────────────────────────────────────────

function DiscordPanel({ activePort }: { activePort: number }) {
  const [token, setToken]               = useState("");
  const [testing, setTesting]           = useState(false);
  const [botInfo, setBotInfo]           = useState<DiscordBotInfo | null>(null);
  const [testErr, setTestErr]           = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [saveErr, setSaveErr]           = useState<string | null>(null);
  const [running, setRunning]           = useState(false);
  const [toggling, setToggling]         = useState(false);
  const [toggleErr, setToggleErr]       = useState<string | null>(null);
  const [savedHint, setSavedHint]       = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    getDiscordConfig()
      .then((t) => { if (t) setSavedHint(t.slice(0, 8) + "…"); })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
    getDiscordBotStatus().then(setRunning).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!token.trim()) return;
    setTesting(true); setTestErr(null); setBotInfo(null); setSaveErr(null); setToggleErr(null);
    try {
      const info = await testDiscordConfig(token.trim());
      setBotInfo(info);
    } catch (e) {
      setTestErr(String(e));
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!botInfo) return;
    setSaving(true); setSaveErr(null);
    try {
      await saveDiscordConfig(token.trim());
      setSaved(true);
      setSavedHint(token.trim().slice(0, 8) + "…");
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveErr(String(e));
    } finally { setSaving(false); }
  };

  const handleToggle = async () => {
    setToggling(true); setToggleErr(null);
    try {
      if (running) {
        await stopDiscordBot();
        setRunning(false);
      } else {
        await startDiscordBot(activePort);
        setRunning(true);
      }
    } catch (e) {
      setToggleErr(String(e));
    } finally { setToggling(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border"
        style={{ background: "rgba(88,101,242,0.05)" }}>
        <MessageSquare size={16} style={{ color: "#5865F2" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Discord Bot</p>
          <p className="text-xs text-muted-foreground">接入 Discord 服务器，@提及或私信触发 AI 回复</p>
        </div>
        {running && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            运行中
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {loadingExisting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader size={13} className="animate-spin" /> 读取已保存配置…
          </div>
        ) : savedHint ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-800">
            <BadgeCheck size={14} className="text-indigo-500" />
            已配置 Token（前缀：{savedHint}）
          </div>
        ) : null}

        {/* Token input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Bot Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setBotInfo(null); setTestErr(null); }}
              placeholder="从 Discord 开发者后台获取 Bot Token"
              className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleTest}
              disabled={testing || !token.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {testing ? <Loader size={14} className="animate-spin" /> : "验证"}
            </button>
          </div>
        </div>

        {/* Validation result */}
        {botInfo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            <span className="text-xs text-green-800 flex-1">
              已验证：<strong>{botInfo.username}</strong>
              {botInfo.discriminator !== "0" ? `#${botInfo.discriminator}` : ""}
            </span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader size={12} className="animate-spin" /> : saved ? <Check size={12} /> : "保存"}
            </button>
          </div>
        )}

        {testErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{testErr}</span>
          </div>
        )}
        {saveErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">保存失败：{saveErr}</span>
          </div>
        )}
        {toggleErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">启停失败：{toggleErr}</span>
          </div>
        )}

        {/* Important: MESSAGE_CONTENT intent notice */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>需在 Discord 开发者后台启用 <strong>MESSAGE CONTENT</strong> 特权意图，否则 Bot 只能接收私信。</span>
        </div>

        {/* Start / Stop */}
        <button
          onClick={handleToggle}
          disabled={toggling || (!savedHint && !botInfo)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 ${
            running
              ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              : "bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20 hover:bg-[#5865F2]/20"
          }`}
        >
          {toggling ? <Loader size={14} className="animate-spin" /> : <MessageSquare size={14} />}
          {running ? "停止机器人" : "启动机器人"}
        </button>

        {/* Guide */}
        <details className="group">
          <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <Info size={12} /> 如何创建 Discord 机器人
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform ml-auto" />
          </summary>
          <GuideSteps steps={[
            "访问 discord.com/developers/applications，新建应用",
            "左侧菜单选「Bot」，点「Reset Token」获取 Token",
            "在「Privileged Gateway Intents」区域开启「MESSAGE CONTENT INTENT」",
            "在「OAuth2 → URL Generator」选 bot 权限，生成邀请链接，把 Bot 加入你的服务器",
            "将 Token 粘贴到上方输入框，验证后保存，再点「启动机器人」",
            "在服务器中 @提及机器人，或通过私信与 AI 对话",
          ]} />
        </details>
      </div>
    </div>
  );
}

// ── Shared guide step list ────────────────────────────────────────────────

function GuideSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2.5 mt-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            {i + 1}
          </span>
          <span className="leading-relaxed whitespace-pre-line">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export function ConnectorsPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const onlineInstance = instances.find((i) => i.health === "online");
  const activePort = onlineInstance?.port ?? 18789;

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plug size={22} className="text-primary" />
          {t("connectors.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {t("connectors.desc")}
        </p>
      </div>

      {/* ── 手机 App 扫码连接 ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.mobileConnTitle")}
        </p>
        <MobileQrPanel />
      </div>

      {/* ── 飞书机器人（国内）── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.imTitle")}
        </p>
        <FeishuWizard />
      </div>

      {/* ── 国际 IM：Telegram + Discord ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.intlImTitle")}
        </p>
        <div className="space-y-3">
          <TelegramPanel activePort={activePort} />
          <DiscordPanel activePort={activePort} />
        </div>
      </div>

      {/* ── 远程访问：xEdge（国内）+ Tailscale（国际）── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.remoteAccessTitle")}
        </p>
        <div className="space-y-3">
          <XEdgePanel />
          <TailscalePanel />
        </div>
      </div>
    </div>
  );
}
