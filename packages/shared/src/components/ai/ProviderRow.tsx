import { useState } from "react";
import {
  ExternalLink, RefreshCw, Loader, AlertCircle, CheckCircle,
  KeyRound, ChevronDown, Sparkles, CircleAlert, AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { maskApiKey } from "../../utils";
import { verifyProviderKey, type VerifyStatus } from "../../stores/aiVerify";
import { PROVIDER_PRICING, type AI_PROVIDERS } from "./types";

export interface ProviderRowProps {
  p: typeof AI_PROVIDERS[number];
  isConfigured: boolean;
  onConfigure: (provider: string, key: string) => Promise<{ ok: boolean; detail: string }>;
  onMarkConfigured: (provider: string) => Promise<void>;
  onOpenUrl?: (url: string) => void;
}

export function ProviderRow({ p, isConfigured: configured, onConfigure, onMarkConfigured, onOpenUrl }: ProviderRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded]         = useState(false);
  const [updateMode, setUpdateMode]     = useState(false);
  const [apiKey, setApiKey]             = useState("");
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<{ ok: boolean; msg: string } | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyMsg, setVerifyMsg]       = useState<string | undefined>();
  const pricing    = PROVIDER_PRICING[p.id];

  const openUrl = (url: string) => {
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noopener");
  };

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setResult(null);
    setVerifyStatus("idle");
    const key = apiKey.trim();
    try {
      const res = await onConfigure(p.id, key);
      if (res.ok) {
        // 先设为验证中并请求探测
        setVerifyStatus("verifying");
        const v = await verifyProviderKey(p.id, key, p.direct);
        setVerifyStatus(v.status);
        setVerifyMsg(v.message);
        
        if (v.status === "ok" || v.status === "relay") {
          // 验证通过才标记为已配置
          await onMarkConfigured(p.id);
          setResult({ ok: true, msg: t("instances.ai.configuredMsg", { key: maskApiKey(key) }) });
          setApiKey("");
          setUpdateMode(false);
        } else {
          // 验证不通过时，不标记为已配置，并提示错误
          setResult({ ok: false, msg: v.message ?? "Key 写入成功但验证未通过" });
        }
      } else {
        setResult({ ok: false, msg: res.detail });
      }
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    setExpanded((v) => !v);
    setResult(null);
    setApiKey("");
    setUpdateMode(false);
  };

  const handleCancelUpdate = () => {
    setUpdateMode(false);
    setApiKey("");
    setResult(null);
    setVerifyStatus("idle");
    setVerifyMsg(undefined);
  };

  const showLocked = configured && !updateMode;

  const ConfigBadge = () => {
    if (verifyStatus === "verifying") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
        <RefreshCw size={9} className="animate-spin" /> 验证中…
      </span>
    );
    if (verifyStatus === "ok") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
        <CheckCircle size={9} /> 已配置（可用）
      </span>
    );
    if (verifyStatus === "relay") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
        <CheckCircle size={9} /> 已写入
      </span>
    );
    if (verifyStatus === "unreachable") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
        <AlertTriangle size={9} /> 已写入（待验证）
      </span>
    );
    if (verifyStatus === "failed") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
        <AlertCircle size={9} /> Key 无效
      </span>
    );
    if (configured) return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
        <CheckCircle size={9} /> {t("instances.ai.configured")}
      </span>
    );
    return (
      <span className="flex-shrink-0 text-[10px] text-muted-foreground">{t("instances.ai.notConfigured")}</span>
    );
  };

  const expandBorder = verifyStatus === "failed"
    ? "border-red-300 bg-red-50/30"
    : verifyStatus === "unreachable"
      ? "border-amber-300 bg-amber-50/30"
      : verifyStatus === "ok" || (configured && !updateMode && verifyStatus === "idle")
        ? "border-green-300 bg-green-50/50"
        : "border-primary/40 bg-primary/5";

  const LockedPanel = () => {
    if (verifyStatus === "unreachable") return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-amber-700">Key 已写入，暂时无法在线验证</p>
            <p className="text-[10px] text-amber-600/80 mt-0.5">{verifyMsg ?? "无法连接到服务商"} · 不影响正常使用</p>
          </div>
        </div>
        <button
          onClick={() => { setUpdateMode(true); setVerifyStatus("idle"); setVerifyMsg(undefined); }}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <KeyRound size={11} /> 更换
        </button>
      </div>
    );
    if (verifyStatus === "failed") return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg bg-red-50 border border-red-200">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-red-700">Key 无效或已过期</p>
            <p className="text-[10px] text-red-600/80 mt-0.5">{verifyMsg ?? "Key 无效，请重新获取"}</p>
          </div>
        </div>
        <button
          onClick={() => { setUpdateMode(true); setVerifyStatus("idle"); setVerifyMsg(undefined); }}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border border-red-300 text-red-700 hover:bg-red-100 transition-colors"
        >
          <KeyRound size={11} /> 重新配置
        </button>
      </div>
    );
    if (verifyStatus === "relay") return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-amber-700">Key 已写入（中转模式）</p>
            <p className="text-[10px] text-amber-600/80 mt-0.5">需通过 OpenRouter 中转，请确保 OpenRouter Key 也已配置</p>
          </div>
        </div>
        <button
          onClick={() => { setUpdateMode(true); setVerifyStatus("idle"); setVerifyMsg(undefined); }}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <KeyRound size={11} /> {t("instances.ai.replaceKey")}
        </button>
      </div>
    );
    return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg bg-green-50 border border-green-200">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-green-700">
              {verifyStatus === "ok" ? "Key 验证通过，可直接使用" : t("instances.ai.keyWritten")}
            </p>
            <p className="text-[10px] text-green-600/80 mt-0.5">{t("instances.ai.keyWrittenHint")}</p>
          </div>
        </div>
        <button
          onClick={() => setUpdateMode(true)}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-100 transition-colors"
        >
          <KeyRound size={11} /> {t("instances.ai.replaceKey")}
        </button>
      </div>
    );
  };

  return (
    <div className={`rounded-lg border transition-colors ${
      expanded ? expandBorder : "border-border bg-background hover:bg-muted/40"
    }`}>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
        onClick={handleToggle}
      >
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate">{p.label}</span>
        </div>

        {pricing?.hasFree ? (
          <span className="flex-shrink-0 flex items-center gap-1 text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">
            <Sparkles size={8} />
            {pricing.freeLabel ?? "有免费模型"}
          </span>
        ) : pricing?.range ? (
          <span className="flex-shrink-0 text-[9px] text-muted-foreground/70 font-mono whitespace-nowrap">
            {pricing.range}
          </span>
        ) : null}

        {p.direct ? (
          <span className="flex-shrink-0 text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
            {t("instances.ai.direct")}
          </span>
        ) : (
          <span className="flex-shrink-0 text-[9px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-1.5 py-0.5">
            {t("instances.ai.relay")}
          </span>
        )}
        <ConfigBadge />
        <ChevronDown size={11} className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {showLocked ? (
            <LockedPanel />
          ) : (
            <>
              {!p.direct && (
                <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-orange-50 border border-orange-200">
                  <CircleAlert size={12} className="flex-shrink-0 mt-0.5 text-orange-500" />
                  <span className="text-[11px] text-orange-800 font-semibold leading-tight">{t("instances.ai.relayWarn")}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground leading-tight">{p.tip}</span>
                <button
                  onClick={() => openUrl(p.registerUrl)}
                  className="flex-shrink-0 flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {t("instances.ai.getKey")} <ExternalLink size={9} />
                </button>
              </div>

              {pricing?.priceNote && (
                <div className={`flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] leading-snug ${
                  pricing.hasFree
                    ? "bg-emerald-50 border border-emerald-100 text-emerald-800"
                    : "bg-muted/40 border border-border text-muted-foreground"
                }`}>
                  {pricing.hasFree
                    ? <Sparkles size={10} className="flex-shrink-0 mt-0.5 text-emerald-600" />
                    : <span className="flex-shrink-0 mt-0.5 text-[10px] leading-none">💰</span>
                  }
                  <span>{pricing.priceNote}</span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setResult(null); setVerifyStatus("idle"); }}
                  placeholder={p.placeholder}
                  disabled={loading || verifyStatus === "verifying"}
                  autoFocus
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={loading || verifyStatus === "verifying" || !apiKey.trim()}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading || verifyStatus === "verifying"
                    ? <Loader size={12} className="animate-spin" />
                    : t("instances.actions.write")}
                </button>
                {updateMode && (
                  <button
                    onClick={handleCancelUpdate}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                )}
              </div>
            </>
          )}

          {result && !result.ok && (
            <p className="text-[11px] text-red-500">✗ {result.msg}</p>
          )}
          {result?.ok && verifyStatus === "verifying" && (
            <p className="text-[11px] text-blue-600 flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" /> Key 写入成功，正在验证可用性…
            </p>
          )}
          {result?.ok && verifyStatus === "ok" && (
            <p className="text-[11px] text-green-600">✓ {result.msg} · 验证通过，配置成功</p>
          )}
          {result?.ok && verifyStatus === "relay" && (
            <p className="text-[11px] text-amber-600">✓ Key 已写入（中转模式，需配合 OpenRouter 使用）</p>
          )}
          {result?.ok && verifyStatus === "unreachable" && (
            <p className="text-[11px] text-amber-600">
              ⚠ Key 已成功写入 · {verifyMsg ?? "暂时无法连接到服务商验证"} · 不影响正常使用
            </p>
          )}
          {result?.ok && verifyStatus === "failed" && (
            <p className="text-[11px] text-red-500">
              ✗ Key 已写入但验证失败 · {verifyMsg ?? "Key 无效或已过期"} · 请检查 Key 是否正确
            </p>
          )}
        </div>
      )}
    </div>
  );
}
