import { useState } from "react";
import {
  ExternalLink, RefreshCw, Loader, AlertCircle, CheckCircle, AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { maskApiKey } from "../../utils";
import { verifyProviderKey, type VerifyStatus } from "../../stores/aiVerify";
import type { FEATURED_AI } from "./types";

export interface FeaturedCardProps {
  p: typeof FEATURED_AI[number];
  isConfigured: boolean;
  onConfigure: (provider: string, key: string) => Promise<{ ok: boolean; detail: string }>;
  onMarkConfigured: (provider: string) => Promise<void>;
  onOpenUrl?: (url: string) => void;
}

export function FeaturedCard({ p, isConfigured: configured, onConfigure, onMarkConfigured, onOpenUrl }: FeaturedCardProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<{ ok: boolean; msg: string } | null>(null);
  const [updateMode, setUpdateMode] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyMsg, setVerifyMsg]   = useState<string | undefined>();
  const showInput  = !configured || updateMode;

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
        // Rust 侧已验证 OpenClaw 识别了该 Key，可以标记为已配置
        await onMarkConfigured(p.id);
        setResult({ ok: true, msg: maskApiKey(key) });
        setApiKey("");
        setUpdateMode(false);
        // 进一步前端侧验证 Key 可用性（直连探测）
        setVerifyStatus("verifying");
        const v = await verifyProviderKey(p.id, key, true);
        setVerifyStatus(v.status);
        setVerifyMsg(v.message);
      } else {
        // Rust 侧写入或验证失败，不标记为已配置
        setResult({ ok: false, msg: res.detail });
      }
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const StatusBadge = () => {
    if (verifyStatus === "verifying") return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
        <RefreshCw size={8} className="animate-spin" /> 验证中…
      </span>
    );
    if (verifyStatus === "ok") return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
        <CheckCircle size={8} /> 已配置（可用）
      </span>
    );
    if (verifyStatus === "unreachable") return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
        <AlertTriangle size={8} /> 已写入（待验证）
      </span>
    );
    if (verifyStatus === "failed") return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
        <AlertCircle size={8} /> Key 无效
      </span>
    );
    if (configured) return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
        <CheckCircle size={8} /> 已配置
      </span>
    );
    return (
      <span className={`flex-shrink-0 text-[9px] font-semibold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${p.badgeClass}`}>
        {p.badge}
      </span>
    );
  };

  const borderColor = verifyStatus === "failed" ? "border-red-300 bg-red-50/30"
    : verifyStatus === "unreachable" ? "border-amber-300 bg-amber-50/30"
    : verifyStatus === "ok" || (configured && verifyStatus === "idle") ? "border-green-300 bg-green-50/40"
    : "border-border bg-background hover:border-primary/40";

  return (
    <div className={`flex flex-col rounded-xl border-2 p-3 transition-colors ${borderColor}`}>
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base leading-none flex-shrink-0">{p.emoji}</span>
          <span className="text-xs font-bold leading-tight truncate">{p.name}</span>
        </div>
        <StatusBadge />
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed mb-2.5">{p.highlight}</p>

      <button
        onClick={() => openUrl(p.registerUrl)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-white text-[11px] font-semibold transition-all hover:opacity-90 mb-2"
        style={{ background: "hsl(var(--primary))", boxShadow: "0 0 10px rgba(6,182,212,0.3)" }}
      >
        <ExternalLink size={11} />
        {configured ? "重新注册 / 获取新 Key" : "前往注册，获取 API Key"}
      </button>

      {configured && !updateMode ? (
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-1 text-[10px] ${
            verifyStatus === "failed" ? "text-red-600"
            : verifyStatus === "unreachable" ? "text-amber-600"
            : "text-green-600"
          }`}>
            {verifyStatus === "failed"
              ? <AlertCircle size={11} className="flex-shrink-0" />
              : verifyStatus === "unreachable"
                ? <AlertTriangle size={11} className="flex-shrink-0" />
                : <CheckCircle size={11} className="flex-shrink-0" />}
            <span>
              {verifyStatus === "failed" ? verifyMsg ?? "Key 无效或已过期"
                : verifyStatus === "unreachable" ? "Key 已写入，暂时无法在线验证"
                : verifyStatus === "ok" ? "Key 验证通过，可直接使用"
                : "Key 已写入"}
            </span>
          </div>
          <button
            onClick={() => { setUpdateMode(true); setVerifyStatus("idle"); setVerifyMsg(undefined); }}
            className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 flex-shrink-0"
          >
            更换
          </button>
        </div>
      ) : showInput && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setResult(null); setVerifyStatus("idle"); }}
              placeholder={configured ? "粘贴新 API Key" : p.placeholder}
              disabled={loading || verifyStatus === "verifying"}
              className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-[11px] focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || verifyStatus === "verifying" || !apiKey.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              {loading || verifyStatus === "verifying"
                ? <Loader size={11} className="animate-spin" />
                : t("instances.actions.write")}
            </button>
          </div>
          {updateMode && (
            <button
              onClick={() => { setUpdateMode(false); setApiKey(""); setResult(null); setVerifyStatus("idle"); }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          )}
        </div>
      )}

      {result && !result.ok && (
        <p className="text-[10px] mt-1.5 text-red-500">✗ {result.msg}</p>
      )}
      {result?.ok && verifyStatus === "verifying" && (
        <p className="text-[10px] mt-1.5 text-blue-600 flex items-center gap-1">
          <RefreshCw size={9} className="animate-spin" /> Key 写入成功，正在验证可用性…
        </p>
      )}
      {result?.ok && verifyStatus === "ok" && (
        <p className="text-[10px] mt-1.5 text-green-600">✓ {result.msg} · Key 验证通过，配置成功</p>
      )}
      {result?.ok && verifyStatus === "unreachable" && (
        <p className="text-[10px] mt-1.5 text-amber-600">
          ⚠ Key 已成功写入 · {verifyMsg ?? "暂时无法连接到服务商验证"} · 不影响正常使用
        </p>
      )}
      {result?.ok && verifyStatus === "failed" && (
        <p className="text-[10px] mt-1.5 text-red-500">
          ✗ Key 已写入但验证失败 · {verifyMsg ?? "Key 无效或已过期"} · 请检查 Key 是否正确
        </p>
      )}
    </div>
  );
}
