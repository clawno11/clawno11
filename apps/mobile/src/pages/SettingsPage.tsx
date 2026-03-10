/**
 * SettingsPage — mobile version.
 *
 * A single scrollable page (no sidebar tabs) with:
 *  - Language selector
 *  - PII/RAG/Routing defaults
 *  - Token budget
 *  - Storage management (purge + wipe)
 *  - About
 */
import { useState, useEffect, useCallback } from "react";
import {
  Database, Shield,
  CheckCircle2, AlertTriangle, ChevronRight, Wallet,
  ExternalLink, Sparkles, Key, Eye, EyeOff, Trash2,
  Loader, Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { purgeOldRecords } from "../store/tokenLog";
import { getBudget, saveBudget, type TokenBudget } from "../store/tokenBudget";
import { secureStore, secureApiKeys } from "../store/secureStore";
import { useAiConfigStore } from "../store/aiConfig";
import { TopBar } from "../components/TopBar";

// ── 推广跳转域名（通过 Cloudflare Worker，ID 不在源码里）────────────────────
const REFER_BASE = "https://refer.clawno11.ai";

// ── 精选 AI 提供商（手机端引导注册用）────────────────────────────────────────
const MOBILE_FEATURED_AI = [
  {
    id:          "zai",
    emoji:       "🧠",
    name:        "智谱 AI (GLM)",
    badge:       "永久免费",
    badgeColor:  "#059669",
    badgeBg:     "rgba(5,150,105,0.1)",
    highlight:   "GLM-4-Flash 完全免费 · 国内直连 · 无需翻墙",
    registerUrl: `${REFER_BASE}/zhipu`,
  },
  {
    id:          "openrouter",
    emoji:       "🌐",
    name:        "OpenRouter",
    badge:       "含免费模型",
    badgeColor:  "#2563eb",
    badgeBg:     "rgba(37,99,235,0.1)",
    highlight:   "一个 Key 用所有模型 · 支持国内支付",
    registerUrl: "https://openrouter.ai/keys",
  },
  {
    id:          "minimax",
    emoji:       "🐋",
    name:        "MiniMax（海螺）",
    badge:       "国内直连",
    badgeColor:  "#7c3aed",
    badgeBg:     "rgba(124,58,237,0.1)",
    highlight:   "海螺 AI 背后的模型 · 注册送免费额度",
    registerUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },
] as const;

// ── AI provider definitions (id must match server-side provider ID) ───────

const AI_PROVIDERS = [
  {
    id:          "zhipu",
    emoji:       "🧠",
    name:        "智谱 AI (GLM)",
    placeholder: "粘贴您的 GLM API Key",
    docsUrl:     "https://open.bigmodel.cn/usercenter/apikeys",
    badge:       "免费",
    badgeColor:  "#059669",
  },
  {
    id:          "openrouter",
    emoji:       "🌐",
    name:        "OpenRouter",
    placeholder: "sk-or-v1-...",
    docsUrl:     "https://openrouter.ai/keys",
    badge:       "多模型",
    badgeColor:  "#2563eb",
  },
  {
    id:          "minimax",
    emoji:       "🐋",
    name:        "MiniMax",
    placeholder: "粘贴您的 MiniMax API Key",
    docsUrl:     "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    badge:       "国内",
    badgeColor:  "#7c3aed",
  },
  {
    id:          "openai",
    emoji:       "✦",
    name:        "OpenAI",
    placeholder: "sk-...",
    docsUrl:     "https://platform.openai.com/api-keys",
    badge:       "",
    badgeColor:  "#16a34a",
  },
  {
    id:          "anthropic",
    emoji:       "◎",
    name:        "Anthropic (Claude)",
    placeholder: "sk-ant-...",
    docsUrl:     "https://console.anthropic.com/settings/keys",
    badge:       "",
    badgeColor:  "#d97706",
  },
] as const;

type ProviderId = typeof AI_PROVIDERS[number]["id"];

// ── Single provider key row ────────────────────────────────────────────────

function ProviderKeyRow({
  provider,
  onSaved,
  onDeleted,
}: {
  provider: typeof AI_PROVIDERS[number];
  onSaved: (id: ProviderId) => void;
  onDeleted: (id: ProviderId) => void;
}) {
  const { t } = useTranslation();
  const [existing, setExisting]   = useState<string | null>(null);
  const [input, setInput]         = useState("");
  const [show, setShow]           = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [expanded, setExpanded]   = useState(false);

  const load = useCallback(async () => {
    const val = await secureApiKeys.get(provider.id);
    setExisting(val);
  }, [provider.id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await secureApiKeys.set(provider.id, trimmed);
      setExisting(trimmed);
      setInput("");
      setSaved(true);
      onSaved(provider.id as ProviderId);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t("settings.apiKey.deleteConfirm", { name: provider.name }))) return;
    setDeleting(true);
    try {
      await secureApiKeys.delete(provider.id);
      setExisting(null);
      setInput("");
      onDeleted(provider.id as ProviderId);
    } finally {
      setDeleting(false);
    }
  };

  const maskedKey = existing
    ? existing.slice(0, 8) + "••••••••" + existing.slice(-4)
    : null;

  return (
    <div className="border-b border-[hsl(var(--border))]/50 last:border-0">
      {/* Row header — always visible */}
      <button
        className="touch-btn w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-lg flex-shrink-0">{provider.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{provider.name}</span>
            {provider.badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ color: provider.badgeColor, background: `${provider.badgeColor}18` }}>
                {provider.badge}
              </span>
            )}
          </div>
          {existing ? (
            <p className="text-xs text-green-600 font-mono mt-0.5">{maskedKey}</p>
          ) : (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t("settings.apiKey.notConfigured")}
            </p>
          )}
        </div>
        {existing
          ? <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
          : <ChevronRight size={16} className={`text-[hsl(var(--muted-foreground))]/40 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        }
      </button>

      {/* Expanded input area */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={provider.placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              className="w-full px-3 py-2.5 pr-10 rounded-xl border border-[hsl(var(--border))] text-sm font-mono bg-[hsl(var(--background))] focus:ring-2 focus:ring-[hsl(var(--primary))]/30 focus:border-[hsl(var(--primary))]/60"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="touch-btn absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--muted-foreground))]"
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!input.trim() || saving}
              className="touch-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "hsl(var(--primary))" }}
            >
              {saving
                ? <Loader size={14} className="animate-spin" />
                : saved
                  ? <Check size={14} />
                  : <Key size={14} />}
              {saved ? t("settings.apiKey.saved") : t("settings.apiKey.save")}
            </button>

            {existing && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="touch-btn px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm disabled:opacity-40"
              >
                {deleting ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            )}
          </div>

          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            <ExternalLink size={11} />
            {t("settings.apiKey.getKeyLink", { name: provider.name })}
          </a>
        </div>
      )}
    </div>
  );
}

// ── API Key panel ─────────────────────────────────────────────────────────

function ApiKeyPanel() {
  const { t } = useTranslation();
  const { markConfigured, unmark } = useAiConfigStore();

  const handleSaved = useCallback(async (id: ProviderId) => {
    await markConfigured(id);
  }, [markConfigured]);

  const handleDeleted = useCallback(async (id: ProviderId) => {
    await unmark(id);
  }, [unmark]);

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
      {/* Hint banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-blue-50 border-b border-blue-100">
        <Key size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 leading-relaxed">
          {t("settings.apiKey.hint")}
        </p>
      </div>
      {AI_PROVIDERS.map((p) => (
        <ProviderKeyRow key={p.id} provider={p} onSaved={handleSaved} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider px-1 mb-2 mt-5 first:mt-0">
      {title}
    </p>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────

function SettingRow({
  icon: Icon,
  label,
  desc,
  right,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  desc?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`touch-btn w-full flex items-center gap-3 px-4 py-3.5 bg-white border-b border-[hsl(var(--border))]/50 last:border-0 text-left ${
        danger ? "text-red-600" : "text-[hsl(var(--foreground))]"
      }`}
    >
      <Icon size={18} className={danger ? "text-red-500 flex-shrink-0" : "text-[hsl(var(--primary))] flex-shrink-0"} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{desc}</p>}
      </div>
      {right ?? (onClick ? <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]/40 flex-shrink-0" /> : null)}
    </button>
  );
}

// ── Language selector ─────────────────────────────────────────────────────

function LangSelector() {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState(() => localStorage.getItem("clawno-lang") ?? i18n.language);

  const handleChange = (code: string) => {
    setLang(code);
    localStorage.setItem("clawno-lang", code);
    i18n.changeLanguage(code);
  };

  return (
    <div className="flex gap-2">
      {[{ code: "zh", label: "中文" }, { code: "en", label: "English" }].map((l) => (
        <button
          key={l.code}
          onClick={() => handleChange(l.code)}
          className={`touch-btn flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
            lang === l.code
              ? "border-[hsl(var(--primary))]/60 bg-[hsl(var(--primary))]/8 text-[hsl(var(--primary))]"
              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

// ── Budget editor ─────────────────────────────────────────────────────────

function BudgetEditor() {
  const { t } = useTranslation();
  const [budget, setBudget] = useState<TokenBudget>(getBudget);
  const [saved, setSaved] = useState(false);

  const save = () => {
    saveBudget(budget);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm">{t("settings.budget.enable")}</span>
        <button
          onClick={() => setBudget((b) => ({ ...b, enabled: !b.enabled }))}
          className={`touch-btn relative w-11 h-6 rounded-full transition-colors ${
            budget.enabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--border))]"
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            budget.enabled ? "left-5" : "left-0.5"
          }`} />
        </button>
      </div>

      {budget.enabled && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-[hsl(var(--muted-foreground))]">{t("settings.budget.daily")}</label>
            <input
              type="number"
              value={budget.dailyLimit || ""}
              onChange={(e) => setBudget((b) => ({ ...b, dailyLimit: parseInt(e.target.value) || 0 }))}
              placeholder="0 = ∞"
              className="w-full px-3 py-2 rounded-xl border border-[hsl(var(--border))] text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[hsl(var(--muted-foreground))]">{t("settings.budget.monthly")}</label>
            <input
              type="number"
              value={budget.monthlyLimit || ""}
              onChange={(e) => setBudget((b) => ({ ...b, monthlyLimit: parseInt(e.target.value) || 0 }))}
              placeholder="0 = ∞"
              className="w-full px-3 py-2 rounded-xl border border-[hsl(var(--border))] text-sm"
            />
          </div>
          <button
            onClick={save}
            className="touch-btn w-full py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "hsl(var(--primary))" }}
          >
            {saved ? t("settings.budgetSaved") : t("settings.budgetSave")}
          </button>
        </>
      )}
    </div>
  );
}

// ── Toggle switch (extracted to avoid hooks-in-map violation) ─────────────

function ToggleRow({ storageKey, label, desc, defaultOn }: {
  storageKey: string; label: string; desc: string; defaultOn: boolean;
}) {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    // No stored value → use the default; otherwise honour the explicit saved value.
    if (stored === null) return defaultOn;
    return stored !== "false";
  });
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => { const n = !enabled; setEnabled(n); localStorage.setItem(storageKey, String(n)); }}
        className={`touch-btn relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--border))]"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation();
  const { configured } = useAiConfigStore();
  const [version, setVersion] = useState<string>("...");
  const [purging, setPurging] = useState(false);
  const [purgeDone, setPurgeDone] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeDone, setWipeDone] = useState(false);
  const [showBudget, setShowBudget] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  const handlePurge = async () => {
    if (!window.confirm(t("settings.purgeConfirm"))) return;
    setPurging(true);
    try {
      await purgeOldRecords(30);
      setPurgeDone(true);
      setTimeout(() => setPurgeDone(false), 3000);
    } finally {
      setPurging(false);
    }
  };

  const handleWipe = async () => {
    if (!window.confirm(t("settings.wipeConfirm"))) return;
    setWiping(true);
    try {
      await secureStore.wipeAll();
      setWipeDone(true);
      setTimeout(() => setWipeDone(false), 3000);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("settings.title")} subtitle={t("settings.desc")} />

      <div className="flex-1 scrollable p-4 pb-8">

        {/* ── Language ── */}
        <SectionHeader title={t("settings.sectionLang")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden p-4">
          <LangSelector />
        </div>

        {/* ── Defaults ── */}
        <SectionHeader title={t("settings.sectionDefaults")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          {[
            {
              key: "clawno-pii",
              label: t("pii.settingTitle"),
              desc: t("settings.piiDesc"),
              default: true,
            },
            {
              key: "clawno-rag",
              label: t("rag.ragSwitch"),
              desc: t("settings.ragDesc"),
              default: true,
            },
            {
              key: "clawno-routing",
              label: t("router.switch"),
              desc: t("settings.routingDesc"),
              default: true,
            },
          ].map(({ key, label, desc, default: def }) => (
            <ToggleRow
              key={key}
              storageKey={key}
              label={label}
              desc={desc}
              defaultOn={def}
            />
          ))}
        </div>

        {/* ── Token budget ── */}
        <SectionHeader title={t("settings.sectionBudget")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <button
            onClick={() => setShowBudget((v) => !v)}
            className="touch-btn w-full flex items-center gap-3 px-4 py-3.5 text-left"
          >
            <Wallet size={18} className="text-[hsl(var(--primary))] flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{t("settings.budgetLabel")}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("settings.budgetLabelDesc")}</p>
            </div>
            <ChevronRight size={16} className={`text-[hsl(var(--muted-foreground))]/40 transition-transform ${showBudget ? "rotate-90" : ""}`} />
          </button>
          {showBudget && <BudgetEditor />}
        </div>

        {/* ── API Key 配置 ── */}
        <SectionHeader title={t("settings.sectionApiKeys")} />
        <ApiKeyPanel />

        {/* ── AI 提供商推荐 ── */}
        <SectionHeader title={t("settings.sectionAiProviders")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden mb-2">
          {/* 引导说明 */}
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <Sparkles size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              <span className="font-semibold">{t("settings.aiProvidersHint")}</span>
            </p>
          </div>
          {/* 提供商列表 */}
          {MOBILE_FEATURED_AI.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => window.open(p.registerUrl, "_blank")}
              className={`touch-btn w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-gray-50 ${
                idx < MOBILE_FEATURED_AI.length - 1 ? "border-b border-[hsl(var(--border))]/50" : ""
              }`}
            >
              <span className="text-xl flex-shrink-0">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: p.badgeColor, background: p.badgeBg }}
                  >
                    {p.badge}
                  </span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{p.highlight}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0" style={{ color: "hsl(var(--primary))" }}>
                <span className="text-xs font-medium">{t("settings.aiProviderRegisterBtn")}</span>
                <ExternalLink size={12} />
              </div>
            </button>
          ))}
        </div>

        {/* ── Configured providers ── */}
        {configured.length > 0 && (
          <>
            <SectionHeader title={t("settings.sectionProviders")} />
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
              {configured.map((p) => (
                <div key={p} className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/50 last:border-0">
                  <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                  <span className="text-sm font-mono">{p}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Storage ── */}
        <SectionHeader title={t("settings.sectionStorage")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <SettingRow
            icon={Database}
            label={purging ? t("tokens.purging") : purgeDone ? t("tokens.purgeShortcutDone") : t("settings.storage.purgeTitle")}
            desc={t("settings.storage.purgeDesc")}
            onClick={handlePurge}
            right={<span />}
          />
          <SettingRow
            icon={Shield}
            label={wiping ? t("settings.storage.wiping") : wipeDone ? t("settings.storage.wiped") : t("settings.storage.wipeKeysLabel")}
            desc={t("settings.storage.wipeKeysDesc")}
            onClick={handleWipe}
            danger
            right={<AlertTriangle size={15} className="text-red-400 flex-shrink-0" />}
          />
        </div>

        {/* ── About ── */}
        <SectionHeader title={t("settings.sectionAbout")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <span className="text-2xl">🦀</span>
              </div>
              <div>
                <p className="font-bold text-base">ClawNo.11 Mobile</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">v{version} · Tauri 2 · React 19</p>
              </div>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
              {t("settings.aboutDesc")}
            </p>
            <div className="flex gap-2 flex-wrap mt-2">
              {(t("settings.aboutTags", { returnObjects: true }) as string[]).map((tag) => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(6,182,212,0.1)", color: "hsl(var(--primary))", border: "1px solid rgba(6,182,212,0.2)" }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
