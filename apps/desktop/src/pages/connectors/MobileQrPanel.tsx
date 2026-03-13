import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, AlertTriangle, Loader,
  RefreshCw, Smartphone, QrCode,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import { useInstanceStore } from "../../store/instances";
import {
  getLanInfo,
  generatePairQrWithHost,
  type PairQrPayload,
} from "../../ipc";

const PAIR_TTL = 120;

export function MobileQrPanel() {
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

  useEffect(() => {
    getLanInfo()
      .then((info) => { if (info?.ip) setLanIp(info.ip); })
      .catch(() => {});
  }, []);

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

            {expired && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 rounded-xl">
                <RefreshCw size={20} className="text-primary animate-spin" />
                <p className="text-[11px] mt-1 text-muted-foreground">{t("connectors.mobileQr.refreshing")}</p>
              </div>
            )}
          </div>

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
