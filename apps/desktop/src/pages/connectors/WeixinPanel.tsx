import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader, CheckCircle2, AlertTriangle,
  Download, QrCode, RefreshCw, Wifi,
  ChevronDown, Info, MessageCircle, Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkWeixinPlugin,
  installWeixinPlugin,
  getWeixinQrUrl,
  getWeixinChannelStatus,
  restartWeixinGateway,
  type WeixinChannelStatus,
} from "../../ipc";
import { GuideSteps } from "./helpers";

type Phase = "checking" | "not-installed" | "installing" | "installed" | "incompatible" | "qr" | "connected";

const QR_POLL_INTERVAL = 3000;
const QR_EXPIRE_SECONDS = 300;
const QR_LOAD_TIMEOUT = 30000;

export function WeixinPanel() {
  const { t } = useTranslation();

  const CACHE_KEY = "weixin_plugin_installed";
  const cached = localStorage.getItem(CACHE_KEY) === "1";
  const initialPhase: Phase = cached ? "installed" : "checking";

  const [phase, setPhase]           = useState<Phase>(initialPhase);
  const [error, setError]           = useState<string | null>(null);
  const [qrUrl, setQrUrl]          = useState<string | null>(null);
  const [status, setStatus]         = useState<WeixinChannelStatus | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState(QR_EXPIRE_SECONDS);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrLoadedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (qrTimeoutRef.current) { clearTimeout(qrTimeoutRef.current); qrTimeoutRef.current = null; }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startQrPolling = useCallback(() => {
    stopPolling();
    setQrCountdown(QR_EXPIRE_SECONDS);

    pollRef.current = setInterval(async () => {
      try {
        const st = await getWeixinChannelStatus();
        if (st.connected) {
          stopPolling();
          setStatus(st);
          setPhase("connected");
        }
      } catch { /* keep polling */ }
    }, QR_POLL_INTERVAL);

    countdownRef.current = setInterval(() => {
      setQrCountdown(prev => {
        if (prev <= 1) {
          stopPolling();
          setQrUrl(null);
          setError(t("connectors.weixin.qrExpired"));
          setPhase("installed");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopPolling, t]);

  const checkStatus = useCallback(async (silent = false) => {
    try {
      const st = await getWeixinChannelStatus();
      setStatus(st);
      if (st.connected) {
        localStorage.setItem(CACHE_KEY, "1");
        setPhase("connected");
      } else if (st.installed) {
        localStorage.setItem(CACHE_KEY, "1");
        if (!silent) setPhase("installed");
      } else {
        localStorage.removeItem(CACHE_KEY);
        setPhase("not-installed");
      }
    } catch {
      const installed = await checkWeixinPlugin().catch(() => false);
      if (installed) {
        localStorage.setItem(CACHE_KEY, "1");
        if (!silent) setPhase("installed");
      } else {
        localStorage.removeItem(CACHE_KEY);
        setPhase("not-installed");
      }
    }
  }, []);

  useEffect(() => { checkStatus(cached); }, [checkStatus]);

  const handleInstall = async () => {
    setPhase("installing");
    setError(null);
    setInstallMsg(null);
    try {
      const result = await installWeixinPlugin();
      if (result.ok) {
        const isIncompat = result.detail?.includes("不兼容");
        if (isIncompat) {
          setInstallMsg(result.detail);
          setPhase("incompatible");
        } else {
          setInstallMsg(result.detail || t("connectors.weixin.installSuccess"));
          await restartWeixinGateway().catch(() => {});
          await checkStatus();
        }
      } else {
        setError(result.detail || t("connectors.weixin.installFail"));
        setPhase("not-installed");
      }
    } catch (e) {
      setError(String(e));
      setPhase("not-installed");
    }
  };

  const handleShowQr = async () => {
    setError(null);
    setQrUrl(null);
    stopPolling();
    setPhase("qr");
    qrLoadedRef.current = false;

    qrTimeoutRef.current = setTimeout(() => {
      if (!qrLoadedRef.current) {
        setError(t("connectors.weixin.qrTimeout"));
        setPhase("installed");
      }
    }, QR_LOAD_TIMEOUT);

    try {
      const url = await getWeixinQrUrl();
      qrLoadedRef.current = true;
      if (qrTimeoutRef.current) { clearTimeout(qrTimeoutRef.current); qrTimeoutRef.current = null; }
      setQrUrl(url);
      startQrPolling();
    } catch (e) {
      qrLoadedRef.current = true;
      stopPolling();
      setError(String(e));
      setPhase("installed");
    }
  };

  const handleRefreshStatus = async () => {
    stopPolling();
    await checkStatus();
  };

  const WEIXIN_GREEN = "#07C160";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 border-b border-border"
        style={{ background: "rgba(7,193,96,0.05)" }}
      >
        <MessageCircle size={16} style={{ color: WEIXIN_GREEN }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{t("connectors.weixin.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("connectors.weixin.subtitle")}
          </p>
        </div>
        {phase === "connected" && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("connectors.weixin.statusOnline")}
          </span>
        )}
        {phase !== "checking" && (
          <button
            onClick={handleRefreshStatus}
            className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors"
            title={t("common.refresh")}
          >
            <RefreshCw size={14} className="text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* ── Checking ── */}
        {phase === "checking" && (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader size={16} className="animate-spin" />
            <span className="text-sm">{t("connectors.weixin.checking")}</span>
          </div>
        )}

        {/* ── Not installed ── */}
        {phase === "not-installed" && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("connectors.weixin.desc")}
            </p>
            <button
              onClick={handleInstall}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all text-white hover:opacity-90"
              style={{ background: `linear-gradient(135deg, ${WEIXIN_GREEN}, #06ae56)` }}
            >
              <Download size={14} />
              {t("connectors.weixin.install")}
            </button>
          </>
        )}

        {/* ── Installing ── */}
        {phase === "installing" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader size={20} className="animate-spin" style={{ color: WEIXIN_GREEN }} />
            <p className="text-sm text-muted-foreground">{t("connectors.weixin.installing")}</p>
            <p className="text-xs text-muted-foreground">{t("connectors.weixin.installWait")}</p>
          </div>
        )}

        {/* ── Installed (show QR option) ── */}
        {phase === "installed" && (
          <>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-800">
              <CheckCircle2 size={14} className="text-green-500" />
              {t("connectors.weixin.pluginReady")}
            </div>
            <button
              onClick={handleShowQr}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{
                background: `${WEIXIN_GREEN}15`,
                color: WEIXIN_GREEN,
                border: `1px solid ${WEIXIN_GREEN}30`,
              }}
            >
              <QrCode size={14} />
              {t("connectors.weixin.showQr")}
            </button>
          </>
        )}

        {/* ── Incompatible (installed but version mismatch) ── */}
        {phase === "incompatible" && (
          <>
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">{t("connectors.weixin.incompatTitle", "插件已安装，但版本暂不兼容")}</p>
                <p>{installMsg}</p>
                <p className="mt-1.5 text-amber-600">
                  {t("connectors.weixin.incompatHint", "微信插件尚未适配当前 OpenClaw 版本，请关注插件更新后重试。")}
                </p>
              </div>
            </div>
            <button
              onClick={handleInstall}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 bg-muted/60 text-muted-foreground border border-border"
            >
              <RefreshCw size={14} />
              {t("connectors.weixin.retryInstall", "重新安装")}
            </button>
          </>
        )}

        {/* ── QR code display ── */}
        {phase === "qr" && (
          <div className="flex flex-col items-center gap-4 py-2">
            {qrUrl ? (
              <>
                <div className="bg-white rounded-2xl shadow-sm border border-border p-4 flex items-center justify-center">
                  <pre
                    className="text-black select-none"
                    style={{
                      fontFamily: "'Courier New', Consolas, monospace",
                      fontSize: "4px",
                      lineHeight: "4.8px",
                      letterSpacing: "0.1em",
                      whiteSpace: "pre",
                      margin: 0,
                    }}
                  >{qrUrl}</pre>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  {t("connectors.weixin.scanHint")}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock size={12} />
                  <span>
                    {t("connectors.weixin.qrExpireIn", {
                      min: Math.floor(qrCountdown / 60),
                      sec: String(qrCountdown % 60).padStart(2, "0"),
                    })}
                  </span>
                  <Loader size={10} className="animate-spin ml-1 text-green-500" />
                  <span className="text-green-600">{t("connectors.weixin.autoDetecting")}</span>
                </div>
                <button
                  onClick={handleShowQr}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/60 text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RefreshCw size={12} className="inline mr-1" />
                  {t("connectors.weixin.refreshQr")}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 py-6 text-muted-foreground">
                <Loader size={16} className="animate-spin" />
                <span className="text-sm">{t("connectors.weixin.loadingQr")}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Connected ── */}
        {phase === "connected" && status && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200">
            <Wifi size={16} className="text-green-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-800">
                {t("connectors.weixin.connected")}
              </p>
              {status.account_name && (
                <p className="text-xs text-green-700 mt-0.5">
                  {t("connectors.weixin.account")}: {status.account_name}
                </p>
              )}
            </div>
            <button
              onClick={handleShowQr}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/80 text-green-700 border border-green-300 hover:bg-white transition-colors"
            >
              {t("connectors.weixin.reconnect")}
            </button>
          </div>
        )}

        {/* ── Install success message (only in non-incompatible phases) ── */}
        {installMsg && phase !== "incompatible" && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-green-700">{installMsg}</span>
          </div>
        )}

        {/* ── Error display ── */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {/* ── Setup guide ── */}
        <details className="group">
          <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <Info size={12} /> {t("connectors.weixin.guideTitle")}
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform ml-auto" />
          </summary>
          <GuideSteps steps={[
            t("connectors.weixin.step1"),
            t("connectors.weixin.step2"),
            t("connectors.weixin.step3"),
            t("connectors.weixin.step4"),
          ]} />
        </details>
      </div>
    </div>
  );
}
