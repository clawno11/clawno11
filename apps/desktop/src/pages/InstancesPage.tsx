import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Server, Wifi, WifiOff, RefreshCw, ExternalLink,
  Trash2, RotateCcw, PowerOff, HardDrive, Globe, Clock,
  Play, Loader, AlertCircle, CheckCircle, KeyRound, ChevronDown, X,
  Sparkles, CircleAlert,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import {
  probeInstanceHealth, configureApiKey,
  getBrowserUrl, openInBrowser, startLocalService, uninstallLocalInstance,
} from "../ipc";
import { useTranslation } from "react-i18next";
import { useInstanceStore, type ClawInstance, type InstanceHealth } from "../store/instances";
import { useAiConfigStore } from "../store/aiConfig";
import { maskApiKey } from "../store/utils";
import { verifyProviderKey, type VerifyStatus } from "../store/aiVerify";

// ── types ─────────────────────────────────────────────────────────────────────
type CardAction = "idle" | "starting" | "restarting" | "stopping";

// ── Featured AI providers shown as prominent cards (register + key input in one place) ──
const FEATURED_AI = [
  {
    id:          "zai" as const,
    emoji:       "🧠",
    name:        "智谱 AI (GLM)",
    badge:       "注册送额度",
    badgeClass:  "bg-emerald-50 border-emerald-200 text-emerald-700",
    highlight:   "注册送免费额度 · GLM-4-Flash 低价 · 配置简单",
    registerUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    placeholder: "输入 API Key",
  },
  {
    id:          "openrouter" as const,
    emoji:       "🌐",
    name:        "OpenRouter",
    badge:       "含免费模型",
    badgeClass:  "bg-blue-50 border-blue-200 text-blue-700",
    highlight:   "一个 Key 用遍所有模型 · 含免费 Llama / Phi · 多种支付方式",
    registerUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
  },
  {
    id:          "minimax" as const,
    emoji:       "🐋",
    name:        "MiniMax（海螺）",
    badge:       "注册送额度",
    badgeClass:  "bg-violet-50 border-violet-200 text-violet-700",
    highlight:   "海螺 AI 背后的模型 · 配置简单 · 注册送免费额度",
    registerUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    placeholder: "输入 API Key",
  },
] as const;

// ── Provider pricing hints ─────────────────────────────────────────────────────
// hasFree:   whether this provider has any free-tier model
// freeLabel: short name of the free model shown in the badge
// range:     price range string for paid providers
// priceNote: one-line pricing info shown in the expanded tip
interface ProviderPricing {
  hasFree?: boolean;
  freeLabel?: string;
  range?: string;
  priceNote: string;
}
const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  zai:         { hasFree: true,  freeLabel: "注册送额度",                              priceNote: "注册即送免费额度，多档模型可选，具体价格请查看官网" },
  minimax:     { hasFree: false,                                                       priceNote: "多档模型可选，具体价格请查看官网" },
  anthropic:   { hasFree: false,                                                       priceNote: "提供 Haiku / Sonnet / Opus 等多档模型，具体价格请查看官网" },
  openai:      { hasFree: false,                                                       priceNote: "提供 GPT-4o-mini / GPT-4o / o1 等多档模型，具体价格请查看官网" },
  openrouter:  { hasFree: true,  freeLabel: "含免费模型",                              priceNote: "聚合平台，含多种免费开源模型，付费模型价格与各厂商官网一致" },
  deepseek:    { hasFree: false,                                                       priceNote: "提供 DeepSeek-V3 / R1 等模型，具体价格请查看官网" },
  moonshot:    { hasFree: false,                                                       priceNote: "提供不同上下文长度模型，具体价格请查看官网" },
  qwen:        { hasFree: false,                                                       priceNote: "提供 Turbo / Plus / Max 等多档模型，具体价格请查看官网" },
  doubao:      { hasFree: false,                                                       priceNote: "提供 Lite / Pro 等多档模型，具体价格请查看官网" },
  hunyuan:     { hasFree: true,  freeLabel: "含免费模型",                              priceNote: "混元Lite 免费可用，更多模型请查看官网" },
  spark:       { hasFree: true,  freeLabel: "含免费模型",                              priceNote: "Spark Lite 免费可用，更多模型请查看官网" },
  baichuan:    { hasFree: false,                                                       priceNote: "提供 Turbo 等多档模型，具体价格请查看官网" },
  stepfun:     { hasFree: false,                                                       priceNote: "提供多档模型，具体价格请查看官网" },
  lingyi:      { hasFree: false,                                                       priceNote: "提供 Lightning / Medium / Large 等多档模型，具体价格请查看官网" },
  siliconflow: { hasFree: true,  freeLabel: "含免费模型",                              priceNote: "含多种免费开源模型，更多模型请查看官网" },
};

// direct: true  = OpenClaw 原生支持，配完即用
// direct: false = 需先在 OpenRouter 里开通对应模型，再填 OpenRouter Key
const AI_PROVIDERS = [
  // ── 原生支持
  { id: "zai",         direct: true,  label: "智谱 AI / ZAI (GLM)",    placeholder: "...",          registerUrl: "https://open.bigmodel.cn/usercenter/apikeys",                            tip: "注册即送免费额度，配完即可聊天" },
  { id: "minimax",     direct: true,  label: "MiniMax（海螺）",         placeholder: "...",          registerUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", tip: "注册送额度，配置后即可使用" },
  { id: "anthropic",   direct: true,  label: "Anthropic (Claude)",      placeholder: "sk-ant-api03-...", registerUrl: "https://console.anthropic.com/",                                  tip: "需在官网注册并获取 API Key" },
  { id: "openai",      direct: true,  label: "OpenAI (GPT)",            placeholder: "sk-proj-...",  registerUrl: "https://platform.openai.com/api-keys",                               tip: "需在官网注册并获取 API Key" },
  // ── 通过 OpenRouter 中转（需先注册 OpenRouter）
  { id: "openrouter",  direct: true,  label: "OpenRouter（聚合平台）",  placeholder: "sk-or-v1-...", registerUrl: "https://openrouter.ai/keys",                                          tip: "一个 Key 可用 DeepSeek/Claude/GPT 等多种模型" },
  { id: "deepseek",    direct: false, label: "DeepSeek（深度求索）",    placeholder: "sk-...",       registerUrl: "https://platform.deepseek.com/api_keys",                             tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "moonshot",    direct: false, label: "Moonshot / Kimi",         placeholder: "sk-...",       registerUrl: "https://platform.moonshot.cn/console/api-keys",                     tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "qwen",        direct: false, label: "阿里通义千问 (Qwen)",     placeholder: "sk-...",       registerUrl: "https://bailian.console.aliyun.com/",                                tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "doubao",      direct: false, label: "字节豆包 (Doubao)",       placeholder: "...",          registerUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",    tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "hunyuan",     direct: false, label: "腾讯混元 (Hunyuan)",      placeholder: "sk-...",       registerUrl: "https://console.cloud.tencent.com/hunyuan/api-key",                  tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "spark",       direct: false, label: "讯飞星火 (Spark)",        placeholder: "...",          registerUrl: "https://xinghuo.xfyun.cn/sparkapi",                                  tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "baichuan",    direct: false, label: "百川智能 (Baichuan)",     placeholder: "sk-...",       registerUrl: "https://platform.baichuan-ai.com/console/apikey",                    tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "stepfun",     direct: false, label: "阶跃星辰 (Step)",         placeholder: "sk-...",       registerUrl: "https://platform.stepfun.com/interface-key",                         tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "lingyi",      direct: false, label: "零一万物 (Yi)",           placeholder: "...",          registerUrl: "https://platform.lingyiwanwu.com/apikeys",                           tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "siliconflow", direct: false, label: "硅基流动 (SiliconFlow)",  placeholder: "sk-...",       registerUrl: "https://cloud.siliconflow.cn/account/ak",                            tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
] as const;

// ── translate backend keys ────────────────────────────────────────────────────
function translateDetail(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith("gateway-ready:")) return "服务已启动，正在运行";
  if (raw.startsWith("pm2-start-failed:")) return `pm2 启动失败：${raw.slice(17)}`;
  if (raw.startsWith("gateway-timeout:")) return `启动超时：${raw.slice(16)}`;
  if (raw.startsWith("gateway-crash:")) return `服务崩溃：${raw.slice(14)}`;
  if (raw.startsWith("openclaw-mjs-not-found:")) return "找不到 openclaw 安装文件，请重新部署";
  if (raw.startsWith("npm-root-not-found:")) return "找不到 npm，请重启应用后重试";
  if (raw.startsWith("wrapper-write-failed:")) return "无法写入启动脚本（磁盘权限问题）";
  return raw;
}

// ── health probe ──────────────────────────────────────────────────────────────
async function probeHealth(inst: ClawInstance): Promise<{ health: InstanceHealth; latencyMs: number }> {
  try {
    const result = await probeInstanceHealth(inst.port);
    return { health: result.online ? "online" : "offline", latencyMs: result.latency_ms };
  } catch {
    return { health: "offline", latencyMs: 0 };
  }
}

// ── HealthBadge ───────────────────────────────────────────────────────────────
function HealthBadge({ health, latencyMs }: { health: InstanceHealth; latencyMs?: number }) {
  const { t } = useTranslation();
  if (health === "online") return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: "rgba(16,185,129,0.1)", color: "#059669", border: "1px solid rgba(16,185,129,0.25)" }}>
      <span className="status-online-dot w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      {t("instances.health.online")}
      {latencyMs !== undefined && (
        <span className="font-mono" style={{ fontSize: 10, opacity: 0.75 }}>{latencyMs}ms</span>
      )}
    </span>
  );
  if (health === "offline") return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
      <WifiOff size={11} /> {t("instances.health.offline")}
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
      style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)" }}>
      <RefreshCw size={11} className="animate-spin" /> {t("instances.health.unknown")}
    </span>
  );
}

// ── FeaturedCard ──────────────────────────────────────────────────────────────
function FeaturedCard({ p }: { p: typeof FEATURED_AI[number] }) {
  const { t } = useTranslation();
  const { isConfigured, markConfigured } = useAiConfigStore();
  const [apiKey, setApiKey]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<{ ok: boolean; msg: string } | null>(null);
  const [updateMode, setUpdateMode] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyMsg, setVerifyMsg]   = useState<string | undefined>();
  const configured = isConfigured(p.id);
  const showInput  = !configured || updateMode;

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setResult(null);
    setVerifyStatus("idle");
    const key = apiKey.trim();
    try {
      const res = await configureApiKey(p.id, key);
      if (res.ok) {
        await markConfigured(p.id);
        setResult({ ok: true, msg: maskApiKey(key) });
        setApiKey("");
        setUpdateMode(false);
        // Auto-verify the key
        setVerifyStatus("verifying");
        const v = await verifyProviderKey(p.id, key, true);
        setVerifyStatus(v.status);
        setVerifyMsg(v.message);
      } else {
        setResult({ ok: false, msg: res.detail });
      }
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  // Badge reflecting verification state
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
    if (verifyStatus === "failed") return (
      <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
        <AlertCircle size={8} /> 配置失败
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
    : verifyStatus === "ok" || (configured && verifyStatus === "idle") ? "border-green-300 bg-green-50/40"
    : "border-border bg-background hover:border-primary/40";

  return (
    <div className={`flex flex-col rounded-xl border-2 p-3 transition-colors ${borderColor}`}>
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base leading-none flex-shrink-0">{p.emoji}</span>
          <span className="text-xs font-bold leading-tight truncate">{p.name}</span>
        </div>
        <StatusBadge />
      </div>

      {/* 亮点说明 */}
      <p className="text-[10px] text-muted-foreground leading-relaxed mb-2.5">{p.highlight}</p>

      {/* 注册按钮 — 最醒目的元素 */}
      <button
        onClick={() => open(p.registerUrl)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-white text-[11px] font-semibold transition-all hover:opacity-90 mb-2"
        style={{ background: "hsl(var(--primary))", boxShadow: "0 0 10px rgba(6,182,212,0.3)" }}
      >
        <ExternalLink size={11} />
        {configured ? "重新注册 / 获取新 Key" : "前往注册，获取 API Key"}
      </button>

      {/* Key 输入区 */}
      {configured && !updateMode ? (
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-1 text-[10px] ${verifyStatus === "failed" ? "text-red-600" : "text-green-600"}`}>
            {verifyStatus === "failed"
              ? <AlertCircle size={11} className="flex-shrink-0" />
              : <CheckCircle size={11} className="flex-shrink-0" />}
            <span>
              {verifyStatus === "failed" ? verifyMsg ?? "Key 验证失败，请重新配置"
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

      {/* 结果反馈 */}
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
      {result?.ok && verifyStatus === "failed" && (
        <p className="text-[10px] mt-1.5 text-red-500">
          ✗ Key 已写入但验证失败：{verifyMsg ?? "无法连接到服务商"} · 请检查 Key 是否正确
        </p>
      )}
    </div>
  );
}

// ── ProviderRow ───────────────────────────────────────────────────────────────
const DIRECT_IDS = ["zai", "minimax", "anthropic", "openai", "openrouter"];

function ProviderRow({ p }: { p: typeof AI_PROVIDERS[number] }) {
  const { t } = useTranslation();
  const { isConfigured, markConfigured } = useAiConfigStore();
  const [expanded, setExpanded]         = useState(false);
  const [updateMode, setUpdateMode]     = useState(false);
  const [apiKey, setApiKey]             = useState("");
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<{ ok: boolean; msg: string } | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyMsg, setVerifyMsg]       = useState<string | undefined>();
  const configured = isConfigured(p.id);
  const pricing    = PROVIDER_PRICING[p.id];

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setResult(null);
    setVerifyStatus("idle");
    const key = apiKey.trim();
    try {
      const res = await configureApiKey(p.id, key);
      if (res.ok) {
        await markConfigured(p.id);
        setResult({ ok: true, msg: t("instances.ai.configuredMsg", { key: maskApiKey(key) }) });
        setApiKey("");
        setUpdateMode(false);
        // Auto-verify
        setVerifyStatus("verifying");
        const v = await verifyProviderKey(p.id, key, p.direct);
        setVerifyStatus(v.status);
        setVerifyMsg(v.message);
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

  // 展开区域内容：根据「已配置 + 非更换模式」决定显示锁定态还是输入态
  const showLocked = configured && !updateMode;

  // 配置状态 badge（行头右侧）
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
    if (verifyStatus === "failed") return (
      <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
        <AlertCircle size={9} /> 配置失败
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
    : verifyStatus === "ok" || (configured && !updateMode && verifyStatus === "idle")
      ? "border-green-300 bg-green-50/50"
      : "border-primary/40 bg-primary/5";

  // 已配置锁定态：根据 verifyStatus 展示不同内容
  const LockedPanel = () => {
    if (verifyStatus === "failed") return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg bg-red-50 border border-red-200">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-red-700">Key 验证失败</p>
            <p className="text-[10px] text-red-600/80 mt-0.5">{verifyMsg ?? "Key 无效或无法连接服务商，请重新配置"}</p>
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
      {/* 行头 */}
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
        onClick={handleToggle}
      >
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate">{p.label}</span>
        </div>

        {/* ── 价格 badge ── */}
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

      {/* 展开区域 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">

          {/* ── 已配置锁定态 ── */}
          {showLocked ? (
            <LockedPanel />
          ) : (
            <>
              {/* 非直连警告 */}
              {!p.direct && (
                <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-orange-50 border border-orange-200">
                  <CircleAlert size={12} className="flex-shrink-0 mt-0.5 text-orange-500" />
                  <span className="text-[11px] text-orange-800 font-semibold leading-tight">{t("instances.ai.relayWarn")}</span>
                </div>
              )}

              {/* 提示 + 官网链接 */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground leading-tight">{p.tip}</span>
                <button
                  onClick={() => open(p.registerUrl)}
                  className="flex-shrink-0 flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {t("instances.ai.getKey")} <ExternalLink size={9} />
                </button>
              </div>

              {/* 价格说明 */}
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

              {/* 输入 + 提交 */}
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

          {/* 结果反馈 */}
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
          {result?.ok && verifyStatus === "failed" && (
            <p className="text-[11px] text-red-500">
              ✗ Key 已写入但验证失败：{verifyMsg ?? "无法连接服务商"} · 请检查 Key 是否正确
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConfigureAIPanel ──────────────────────────────────────────────────────────
const FEATURED_IDS = FEATURED_AI.map((f) => f.id as string);

function ConfigureAIPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { configured } = useAiConfigStore();
  const [showMore, setShowMore] = useState(false);

  return (
    <div className="mx-4 mb-3 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">

      {/* ── 标题栏 ── */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
        <Sparkles size={13} className="text-primary" />
        <span className="text-xs font-semibold text-primary">{t("instances.ai.title")}</span>
        {configured.length > 0 && (
          <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5 font-medium">
            {t("instances.configuredCount", { count: configured.length })}
          </span>
        )}
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      </div>

      {/* ── 操作引导横幅 ── */}
      <div className="mx-3 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
        <span className="font-semibold">三步开始使用：</span>
        {"  ①点击「前往注册」→ ②获取 API Key → ③粘贴到下方输入框并写入"}
      </div>

      {/* ── 精选推荐大卡片 ── */}
      <div className="px-3 mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          ⭐ 精选推荐（新手从这里开始）
        </p>
        <div className="grid grid-cols-3 gap-2">
          {FEATURED_AI.map((p) => (
            <FeaturedCard key={p.id} p={p} />
          ))}
        </div>
      </div>

      {/* ── 更多平台（可折叠）── */}
      <div className="px-3 pb-3">
        <button
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
        >
          <ChevronDown size={11} className={`transition-transform ${showMore ? "rotate-180" : ""}`} />
          {showMore ? "收起其他平台" : "更多 AI 平台（Anthropic · OpenAI · DeepSeek · Kimi 等）"}
        </button>

        {showMore && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t("instances.ai.directGroup")}
              </p>
              <div className="space-y-1">
                {AI_PROVIDERS
                  .filter((p) => p.direct && !FEATURED_IDS.includes(p.id))
                  .map((p) => <ProviderRow key={p.id} p={p} />)}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t("instances.ai.relayGroup")}
              </p>
              <div className="space-y-1">
                {AI_PROVIDERS
                  .filter((p) => !p.direct && !FEATURED_IDS.includes(p.id))
                  .map((p) => <ProviderRow key={p.id} p={p} />)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── InstanceCard ──────────────────────────────────────────────────────────────
function InstanceCard({
  inst,
  onRefresh,
  onOpen,
  onStop,
  onStart,
  onRestart,
  onRemove,
}: {
  inst: ClawInstance;
  onRefresh: () => void;
  onOpen: () => void;
  onStop: () => Promise<{ ok: boolean; msg: string }>;
  onStart: () => Promise<{ ok: boolean; msg: string }>;
  onRestart: () => Promise<{ ok: boolean; msg: string }>;
  onRemove: () => void;
}) {
  const [action, setAction] = useState<CardAction>("idle");
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showConfigAI, setShowConfigAI] = useState(false);
  const { configured } = useAiConfigStore();
  const hasAI = configured.length > 0;

  const deployedDate = new Date(inst.deployedAt).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const withFeedback = async (
    kind: "starting" | "restarting" | "stopping",
    fn: () => Promise<{ ok: boolean; msg: string } | void>,
  ) => {
    setAction(kind);
    setActionResult(null);
    try {
      const result = await fn();
      if (result && typeof result === "object") {
        setActionResult(result);
      }
    } catch (e) {
      setActionResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setAction("idle");
    }
  };

  const { t } = useTranslation();
  const actionLabel: Record<CardAction, string> = {
    idle: "",
    starting: t("instances.status.starting"),
    restarting: t("instances.status.restarting"),
    stopping: t("instances.status.stopping"),
  };

  const isOffline = inst.health === "offline";

  return (
    <div className="card-enter rounded-2xl overflow-hidden"
      style={{
        background: "white",
        border: `1px solid ${isOffline ? "rgba(239,68,68,0.2)" : "rgba(6,182,212,0.15)"}`,
        boxShadow: isOffline
          ? "0 1px 8px rgba(239,68,68,0.06)"
          : "0 1px 12px rgba(6,182,212,0.08), 0 0 0 0 transparent",
      }}
    >
      {/* header */}
      <div className="flex items-center gap-3.5 px-4 py-3.5 border-b"
        style={{ borderColor: isOffline ? "rgba(239,68,68,0.12)" : "rgba(6,182,212,0.1)" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: isOffline ? "rgba(239,68,68,0.06)" : "rgba(6,182,212,0.1)" }}>
          {inst.kind === "local"
            ? <HardDrive size={20} style={{ color: isOffline ? "#f87171" : "hsl(var(--primary))" }} />
            : <Globe     size={20} style={{ color: isOffline ? "#f87171" : "hsl(var(--primary))" }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{inst.name}</p>
          <p className="font-mono truncate" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{inst.uiUrl}</p>
        </div>
        <HealthBadge health={inst.health} {...(inst.latencyMs !== undefined ? { latencyMs: inst.latencyMs } : {})} />
      </div>

      {/* meta — 等宽字体让数字更有科技感 */}
      <div className="px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1"
        style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
        <span className="flex items-center gap-1.5">
          <Server size={10} />
          <span>Gateway </span>
          <span className="font-mono">:{inst.port}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Globe size={10} />
          <span className="font-mono">127.0.0.1:{inst.port}</span>
        </span>
        <span className="flex items-center gap-1.5 col-span-2">
          <Clock size={10} /> {deployedDate}
        </span>
      </div>

      {/* action feedback */}
      {action !== "idle" && (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-xs text-primary">
          <Loader size={12} className="animate-spin" />
          {actionLabel[action]}
        </div>
      )}
      {actionResult && action === "idle" && (
        <div className={`mx-4 mb-2 flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
          actionResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {actionResult.ok
            ? <CheckCircle size={12} className="mt-0.5 flex-shrink-0" />
            : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
          <span>{actionResult.msg}</span>
        </div>
      )}

      {/* 未配置 AI 引导横幅 — 服务在线时才显示 */}
      {!isOffline && !hasAI && !showConfigAI && (
        <div className="mx-4 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <CircleAlert size={13} className="flex-shrink-0 text-amber-500" />
          <span className="flex-1">{t("instances.ai.title")}</span>
          <button
            onClick={() => setShowConfigAI(true)}
            className="flex-shrink-0 flex items-center gap-1 font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            {t("instances.actions.configureAI")} <ChevronDown size={11} className="-rotate-90" />
          </button>
        </div>
      )}

      {/* Configure AI panel */}
      {showConfigAI && <ConfigureAIPanel onClose={() => setShowConfigAI(false)} />}

      {/* actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t"
        style={{ borderColor: "rgba(6,182,212,0.1)", background: "rgba(6,182,212,0.02)" }}>
        {/* Open console — only useful when online */}
        <button
          onClick={onOpen}
          disabled={isOffline}
          title={t("instances.actions.openBrowser")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: isOffline ? "#94a3b8" : "hsl(var(--primary))",
            boxShadow: isOffline ? "none" : "0 0 10px rgba(6,182,212,0.35)",
          }}
        >
          <ExternalLink size={13} /> {t("instances.actions.openBrowser")}
        </button>

        {/* Configure AI — 未配置时突出显示 */}
        <button
          onClick={() => setShowConfigAI((v) => !v)}
          title={t("instances.actions.configureAI")}
          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
            showConfigAI
              ? "border-primary/50 bg-primary/10 text-primary"
              : hasAI
                ? "border-border hover:bg-accent"
                : "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
        >
          <KeyRound size={13} />
          {t("instances.actions.configureAI")}
          {!hasAI && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange-500" />
          )}
          {hasAI && (
            <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1 font-medium">
              {configured.length}
            </span>
          )}
        </button>

        {/* Refresh health */}
        <button
          onClick={onRefresh}
          title={t("instances.actions.checkHealth")}
          disabled={action !== "idle"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} />
        </button>

        {inst.kind === "local" && (
          <>
            {/* Start (when offline) or Restart (when online) */}
            {isOffline ? (
              <button
                onClick={() => withFeedback("starting", onStart)}
                disabled={action !== "idle"}
                title={t("instances.actions.start")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-green-400 text-green-600 text-xs hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                {action === "starting" ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
                <span>{action === "starting" ? t("instances.status.starting") : t("instances.actions.start")}</span>
              </button>
            ) : (
              <button
                onClick={() => withFeedback("restarting", onRestart)}
                disabled={action !== "idle"}
                title={t("instances.actions.restart")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent transition-colors disabled:opacity-40"
              >
                {action === "restarting" ? <Loader size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                <span>{action === "restarting" ? t("instances.status.restarting") : t("instances.actions.restart")}</span>
              </button>
            )}

            {/* Stop */}
            <button
              onClick={() => withFeedback("stopping", onStop)}
              disabled={action !== "idle" || isOffline}
              title={t("instances.actions.stop")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-40"
            >
              {action === "stopping" ? <Loader size={13} className="animate-spin" /> : <PowerOff size={13} />}
              <span>{action === "stopping" ? t("instances.status.stopping") : t("instances.actions.stop")}</span>
            </button>
          </>
        )}

        <button
          onClick={onRemove}
          title={t("instances.actions.delete")}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export function InstancesPage() {
  const navigate = useNavigate();
  const { instances, setHealth, remove } = useInstanceStore();

  const checkAll = useCallback(async () => {
    instances.forEach((i) => setHealth(i.id, "unknown"));
    await Promise.all(
      instances.map(async (inst) => {
        const { health, latencyMs } = await probeHealth(inst);
        setHealth(inst.id, health, latencyMs);
      }),
    );
  }, [instances, setHealth]);

  useEffect(() => {
    const autoHealth = localStorage.getItem("clawno-auto-health");
    const enabled = autoHealth === null ? true : autoHealth === "1";
    if (enabled && instances.length > 0) checkAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — initial probe only

  // Separate interval effect that re-registers whenever checkAll (instances) changes,
  // so the timer always captures the latest instance list — no stale closure.
  useEffect(() => {
    const timer = setInterval(() => {
      if (instances.length > 0) checkAll();
    }, 30_000);
    return () => clearInterval(timer);
  }, [checkAll]);

  const handleOpen = async (_inst: ClawInstance) => {
    try {
      const url = await getBrowserUrl();
      await openInBrowser(url);
    } catch (e) {
      console.error("open_in_browser failed:", e);
    }
  };

  const { t } = useTranslation();

  const handleStart = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    const res = await startLocalService(inst.port);
    if (res.ok) {
      setHealth(inst.id, "online");
      return { ok: true, msg: t("instances.status.starting").replace("…", "") };
    } else {
      setHealth(inst.id, "offline");
      return { ok: false, msg: translateDetail(res.detail) };
    }
  };

  const handleRestart = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    setHealth(inst.id, "unknown");
    const { restartLocalService } = await import("../ipc");
    await restartLocalService();
    await new Promise((r) => setTimeout(r, 2500));
    const { health, latencyMs } = await probeHealth(inst);
    setHealth(inst.id, health, latencyMs);
    return health === "online"
      ? { ok: true, msg: t("instances.actions.restart") }
      : { ok: false, msg: t("common.error") };
  };

  const handleStop = async (inst: ClawInstance): Promise<{ ok: boolean; msg: string }> => {
    const { stopLocalService } = await import("../ipc");
    await stopLocalService();
    await new Promise((r) => setTimeout(r, 800));
    setHealth(inst.id, "offline");
    return { ok: true, msg: t("instances.actions.stop") };
  };

  const handleRemove = async (inst: ClawInstance) => {
    if (inst.kind === "local") {
      const confirmed = window.confirm(
        "确认删除本机 OpenClaw 实例？\n\n" +
        "• 服务进程将被停止并卸载\n" +
        "• 历史对话和配置数据（~/.openclaw/）将保留，重新部署后可恢复\n\n" +
        "确认要继续吗？"
      );
      if (!confirmed) return;
      await uninstallLocalInstance();
    }
    remove(inst.id);
  };

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-2xl font-bold tracking-tight">{t("instances.title")}</h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(6,182,212,0.1)", color: "hsl(var(--primary))", border: "1px solid rgba(6,182,212,0.2)" }}>
              OpenClaw
            </span>
          </div>
          <p className="text-muted-foreground text-sm">{t("instances.desc")}</p>
        </div>
        {instances.length > 0 && (
          <button
            onClick={checkAll}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ border: "1px solid rgba(6,182,212,0.3)", color: "hsl(var(--primary))" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(6,182,212,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <RefreshCw size={13} />
            {t("instances.actions.checkHealth")}
          </button>
        )}
      </div>

      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.25)" }}>
            <Server size={28} style={{ color: "rgba(6,182,212,0.4)" }} />
          </div>
          <p className="text-base font-semibold text-foreground/70">{t("instances.empty")}</p>
          <p className="text-sm mt-1 mb-6">{t("instances.desc")}</p>
          <button
            onClick={() => navigate("/deploy")}
            className="px-5 py-2 rounded-xl text-white text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "hsl(var(--primary))", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
          >
            {t("instances.emptyBtn")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              onRefresh={async () => {
                setHealth(inst.id, "unknown");
                const { health, latencyMs } = await probeHealth(inst);
                setHealth(inst.id, health, latencyMs);
              }}
              onOpen={() => handleOpen(inst)}
              onStart={() => handleStart(inst)}
              onStop={() => handleStop(inst)}
              onRestart={() => handleRestart(inst)}
              onRemove={() => handleRemove(inst)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
