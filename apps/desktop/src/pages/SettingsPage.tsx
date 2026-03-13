import { useState, useEffect } from "react";
import { Settings, Info, Shield, Database, ExternalLink, Trash2, Check, ArrowRight, Wallet, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@clawno/shared/components/common/ToggleRow";
import { LangSelector } from "@clawno/shared/components/common/LangSelector";
import { useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import {
  purgeOldRecords,
  getBudget, saveBudget, getInstanceBudget, saveInstanceBudget, clearInstanceBudget,
  type TokenBudget,
} from "@clawno/shared/stores/tokenLogStore";
import {
  getDisplayCurrency, setDisplayCurrency, getExchangeRate, setExchangeRate,
  getUserPriceOverrides, setUserPriceOverride, removeUserPriceOverride, BUILTIN_MODEL_KEYS,
  type ModelPrice, type DisplayCurrency,
} from "../store/tokenPricing";
import { secureStore } from "../store/secureStore";
import { useAiConfigStore } from "../store/aiConfig";
import { useInstanceStore } from "../store/instances";

type Tab = "general" | "security" | "storage" | "about";

function TabBtn({ label, icon: Icon, active, onClick }: {
  label: string; icon: React.ElementType; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
        active
          ? "bg-primary/10 text-primary border border-primary/20"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

// ── General Tab ────────────────────────────────────────────────────────────

function GeneralTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <Section title={t("settings.lang.title")} desc={t("settings.lang.desc")}>
        <LangSelector
          langs={[
            { code: "zh", label: "简体中文" },
            { code: "en", label: "English" },
          ]}
          immediate={false}
        />
      </Section>

      <Section title={t("settings.startup.title")} desc={t("settings.startup.desc")}>
        <ToggleRow
          label={t("settings.startup.autoHealth")}
          desc={t("settings.startup.autoHealthDesc")}
          storageKey="clawno-auto-health"
          defaultOn={true}
        />
        <ToggleRow
          label={t("settings.startup.homeInstances")}
          desc={t("settings.startup.homeInstancesDesc")}
          storageKey="clawno-home-instances"
          defaultOn={true}
        />
      </Section>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────────────────

const SECURITY_PRESET_KEY = "clawno-security-preset";

function SecurityTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedLevel, setSelectedLevel] = useState<string>(
    () => localStorage.getItem(SECURITY_PRESET_KEY) ?? "medium"
  );

  const presets = [
    { level: "low",    color: "green",  labelKey: "settings.security.levelLow",    descKey: "settings.security.levelLowDesc"    },
    { level: "medium", color: "amber",  labelKey: "settings.security.levelMedium", descKey: "settings.security.levelMediumDesc" },
    { level: "high",   color: "red",    labelKey: "settings.security.levelHigh",   descKey: "settings.security.levelHighDesc"   },
  ];

  const handleSelectPreset = (level: string) => {
    setSelectedLevel(level);
    localStorage.setItem(SECURITY_PRESET_KEY, level);
  };

  const privacyItems = t("settings.security.privacyItems", { returnObjects: true }) as string[];

  return (
    <div className="space-y-6">
      <Section title={t("settings.security.presetTitle")} desc={t("settings.security.presetDesc")}>
        <div className="grid grid-cols-3 gap-3">
          {presets.map((p) => (
            <button
              key={p.level}
              onClick={() => handleSelectPreset(p.level)}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedLevel === p.level
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/40 border-border"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-semibold ${
                  p.color === "green" ? "text-green-600" :
                  p.color === "amber" ? "text-amber-600" : "text-red-600"
                }`}>{t(p.labelKey)}</span>
                {selectedLevel === p.level && <Check size={12} className="text-primary flex-shrink-0" />}
              </div>
              <div className="text-xs text-muted-foreground">{t(p.descKey)}</div>
            </button>
          ))}
        </div>
        <button
          onClick={() => navigate("/security")}
          className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ArrowRight size={12} />
          {t("settings.security.presetHint")}
        </button>
      </Section>

      <Section title={t("settings.security.privacyTitle")} desc="">
        <ul className="space-y-2">
          {privacyItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ── Shared budget limit inputs ──────────────────────────────────────────────

function BudgetLimitInputs({
  budget,
  onChange,
  onSave,
  saved,
}: {
  budget: TokenBudget;
  onChange: (b: TokenBudget) => void;
  onSave: () => void;
  saved: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 pt-2 border-t border-border/50">
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground w-20 flex-shrink-0">
          {t("settings.storage.budgetDailyLimit")}
        </label>
        <div className="flex-1 relative">
          <input
            type="number"
            min={0}
            value={budget.dailyLimit || ""}
            onChange={(e) => onChange({ ...budget, dailyLimit: Math.max(0, Number(e.target.value) || 0) })}
            placeholder={t("settings.storage.budgetUnlimited")}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background pr-16 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
            tokens
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground w-20 flex-shrink-0">
          {t("settings.storage.budgetMonthlyLimit")}
        </label>
        <div className="flex-1 relative">
          <input
            type="number"
            min={0}
            value={budget.monthlyLimit || ""}
            onChange={(e) => onChange({ ...budget, monthlyLimit: Math.max(0, Number(e.target.value) || 0) })}
            placeholder={t("settings.storage.budgetUnlimited")}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background pr-16 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
            tokens
          </span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("settings.storage.budgetUnitHint")}</p>
      <button
        onClick={onSave}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
      >
        {saved ? <><Check size={13} />{t("settings.storage.budgetSaved")}</> : t("common.save")}
      </button>
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-10 h-5 rounded-full transition-colors flex items-center flex-shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ── Per-instance budget row ─────────────────────────────────────────────────

function InstanceBudgetRow({ instanceId, name }: { instanceId: string; name: string }) {
  const { t } = useTranslation();
  const [budget,   setBudget]   = useState<TokenBudget>(() => getInstanceBudget(instanceId));
  const [expanded, setExpanded] = useState(false);
  const [saved,    setSaved]    = useState(false);

  const handleToggle = () => {
    const next = { ...budget, enabled: !budget.enabled };
    setBudget(next);
    saveInstanceBudget(instanceId, next);
  };

  const handleSave = () => {
    saveInstanceBudget(instanceId, budget);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    clearInstanceBudget(instanceId);
    setBudget({ enabled: false, dailyLimit: 0, monthlyLimit: 0 });
    setExpanded(false);
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors truncate"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span className="truncate">{name}</span>
          </button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            budget.enabled
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}>
            {budget.enabled ? t("settings.storage.budgetInstanceEnabled") : t("settings.storage.budgetInstanceDisabled")}
          </span>
        </div>
        <Toggle on={budget.enabled} onToggle={handleToggle} />
      </div>

      {expanded && budget.enabled && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3 bg-muted/20">
          <BudgetLimitInputs
            budget={budget}
            onChange={setBudget}
            onSave={handleSave}
            saved={saved}
          />
          <button
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            {t("settings.storage.budgetInstanceClear")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Budget Section ──────────────────────────────────────────────────────────

function BudgetSection() {
  const { t }     = useTranslation();
  const { instances } = useInstanceStore();
  const [budget,  setBudgetState] = useState<TokenBudget>(getBudget);
  const [saved,   setSaved]       = useState(false);

  const handleSave = () => {
    saveBudget(budget);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggle = () => {
    const next = { ...budget, enabled: !budget.enabled };
    setBudgetState(next);
    saveBudget(next);
  };

  return (
    <Section title={t("settings.storage.budgetTitle")} desc={t("settings.storage.budgetDesc")}>

      {/* ── Global budget ── */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("settings.storage.budgetGlobalTitle")}
        </p>
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium">{t("settings.storage.budgetEnable")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.storage.budgetEnableDesc")}</p>
          </div>
          <Toggle on={budget.enabled} onToggle={handleToggle} />
        </div>
        {budget.enabled && (
          <BudgetLimitInputs
            budget={budget}
            onChange={setBudgetState}
            onSave={handleSave}
            saved={saved}
          />
        )}
      </div>

      {/* ── Per-instance budgets ── */}
      <div className="space-y-3 pt-4 border-t border-border/50">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("settings.storage.budgetInstanceTitle")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.storage.budgetInstanceDesc")}</p>
        </div>

        {instances.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">{t("settings.storage.budgetInstanceNone")}</p>
        ) : (
          <div className="space-y-2">
            {instances.map((inst) => (
              <InstanceBudgetRow key={inst.id} instanceId={inst.id} name={inst.name} />
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Storage Tab ─────────────────────────────────────────────────────────────

function StorageTab() {
  const { t } = useTranslation();
  const [purging, setPurging]   = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [wiping, setWiping]     = useState(false);
  const [wipeDone, setWipeDone] = useState(false);

  const handlePurge = async (days: number) => {
    setPurging(true); setPurgeMsg(null);
    try {
      await purgeOldRecords(days);
      setPurgeMsg(t("settings.storage.purgeSuccess", { days }));
    } catch {
      setPurgeMsg(t("common.error"));
    } finally {
      setPurging(false);
    }
  };

  const handleWipeKeys = async () => {
    if (!window.confirm(t("settings.storage.wipeConfirm"))) return;
    setWiping(true);
    try {
      await secureStore.wipeAll();
      // Sync in-memory AI config cache so the Instances page reflects the cleared state
      await useAiConfigStore.getState().load();
      setWipeDone(true);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="space-y-6">
      <BudgetSection />

      <Section title={t("settings.storage.purgeTitle")} desc={t("settings.storage.purgeDesc")}>
        <div className="flex gap-2 flex-wrap">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => handlePurge(days)}
              disabled={purging}
              className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              {t("settings.storage.purgeBtn", { days })}
            </button>
          ))}
        </div>
        {purgeMsg && <p className="text-xs text-muted-foreground mt-2">{purgeMsg}</p>}
      </Section>

      <Section title={t("settings.storage.wipeTitle")} desc={t("settings.storage.wipeDesc")}>
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-red-600">{t("settings.storage.wipeKeysLabel")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settings.storage.wipeKeysDesc")}</p>
            </div>
            <button
              onClick={handleWipeKeys}
              disabled={wiping || wipeDone}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <Trash2 size={13} />
              {wipeDone ? t("settings.storage.wiped") : wiping ? t("settings.storage.wiping") : t("common.delete")}
            </button>
          </div>
        </div>
      </Section>

      <PricingSection />
    </div>
  );
}

// ── Pricing Section ────────────────────────────────────────────────────────

function PricingSection() {
  const { t } = useTranslation();

  // Display currency
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>(getDisplayCurrency);
  const handleCurrencyChange = (c: DisplayCurrency) => {
    setDisplayCurrency(c);
    setDisplayCurrencyState(c);
  };

  // Exchange rate
  const [rate, setRateState] = useState(() => String(getExchangeRate()));
  const [rateSaved, setRateSaved] = useState(false);
  const handleRateSave = () => {
    const n = parseFloat(rate);
    if (!isNaN(n) && n > 0) {
      setExchangeRate(n);
      setRateSaved(true);
      setTimeout(() => setRateSaved(false), 1500);
    }
  };

  // Custom overrides
  const [overrides, setOverrides] = useState<Record<string, ModelPrice>>(getUserPriceOverrides);
  const [adding, setAdding] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newInput, setNewInput] = useState("");
  const [newOutput, setNewOutput] = useState("");
  const [newCurrency, setNewCurrency] = useState<"USD" | "CNY">("CNY");
  const [newFree, setNewFree] = useState(false);

  const handleAddOverride = () => {
    const key = newModel.trim().toLowerCase();
    if (!key) return;
    const price: ModelPrice = {
      inputPer1M: newFree ? 0 : parseFloat(newInput) || 0,
      outputPer1M: newFree ? 0 : parseFloat(newOutput) || 0,
      currency: newCurrency,
      ...(newFree ? { free: true } : {}),
    };
    setUserPriceOverride(key, price);
    const updated = getUserPriceOverrides();
    setOverrides(updated);
    setAdding(false);
    setNewModel(""); setNewInput(""); setNewOutput(""); setNewFree(false);
  };

  const handleRemove = (key: string) => {
    removeUserPriceOverride(key);
    setOverrides(getUserPriceOverrides());
  };

  const CURRENCY_OPTIONS: { value: DisplayCurrency; label: string }[] = [
    { value: "ORIGINAL", label: t("settings.storage.pricingDisplayOriginal") },
    { value: "CNY",      label: t("settings.storage.pricingDisplayCNY") },
    { value: "USD",      label: t("settings.storage.pricingDisplayUSD") },
  ];

  return (
    <Section title={t("settings.storage.pricingTitle")} desc={t("settings.storage.pricingDesc")}>
      {/* Built-in coverage note */}
      <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
        {t("settings.storage.pricingNote", { count: BUILTIN_MODEL_KEYS.length })}
      </p>

      {/* Display currency */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">{t("settings.storage.pricingDisplayCurrency")}</label>
        <div className="flex gap-2 flex-wrap">
          {CURRENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleCurrencyChange(opt.value)}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                displayCurrency === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border hover:bg-muted/60 text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Exchange rate */}
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium">{t("settings.storage.pricingExchangeRate")}</label>
          <p className="text-[10px] text-muted-foreground">{t("settings.storage.pricingExchangeRateHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={rate}
            onChange={(e) => setRateState(e.target.value)}
            className="w-24 px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-right"
          />
          <button
            onClick={handleRateSave}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted/60 transition-colors min-w-[60px] justify-center"
          >
            {rateSaved ? <><Check size={12} /> {t("settings.storage.pricingSaved")}</> : t("common.save")}
          </button>
        </div>
      </div>

      {/* Custom overrides */}
      <div className="space-y-2 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">{t("settings.storage.pricingOverrides")}</p>
            <p className="text-[10px] text-muted-foreground">{t("settings.storage.pricingOverridesDesc")}</p>
          </div>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted/60 transition-colors"
          >
            <Plus size={11} />
            {t("settings.storage.pricingAddModel")}
          </button>
        </div>

        {/* Add form */}
        {adding && (
          <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
            <input
              type="text"
              placeholder={t("settings.storage.pricingModelName")}
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs"
            />
            <div className="flex gap-2">
              <select
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value as "USD" | "CNY")}
                className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs"
              >
                <option value="CNY">CNY (¥)</option>
                <option value="USD">USD ($)</option>
              </select>
              <input
                type="number" min="0" step="0.01"
                placeholder={t("settings.storage.pricingInputPrice")}
                value={newInput}
                onChange={(e) => setNewInput(e.target.value)}
                disabled={newFree}
                className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-xs disabled:opacity-50"
              />
              <input
                type="number" min="0" step="0.01"
                placeholder={t("settings.storage.pricingOutputPrice")}
                value={newOutput}
                onChange={(e) => setNewOutput(e.target.value)}
                disabled={newFree}
                className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-xs disabled:opacity-50"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={newFree} onChange={(e) => setNewFree(e.target.checked)} />
                {t("settings.storage.pricingFree")}
              </label>
              <div className="flex gap-2">
                <button onClick={() => setAdding(false)} className="px-2 py-1 rounded-lg text-xs border border-border hover:bg-muted/60">
                  {t("common.cancel")}
                </button>
                <button onClick={handleAddOverride} className="px-2 py-1 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                  {t("common.save")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Existing overrides list */}
        {Object.entries(overrides).length > 0 && (
          <div className="divide-y divide-border/40 rounded-lg border border-border overflow-hidden">
            {Object.entries(overrides).map(([key, price]) => (
              <div key={key} className="flex items-center justify-between px-3 py-2 text-xs gap-2 hover:bg-muted/20">
                <span className="font-mono text-foreground">{key}</span>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {price.free ? (
                    <span className="text-emerald-600 text-[10px]">免费</span>
                  ) : (
                    <span className="text-muted-foreground text-[10px]">
                      {price.currency === "CNY" ? "¥" : "$"}{price.inputPer1M} / {price.outputPer1M}
                    </span>
                  )}
                  <button
                    onClick={() => handleRemove(key)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {Object.entries(overrides).length === 0 && !adding && (
          <p className="text-[11px] text-muted-foreground italic text-center py-2">
            暂无自定义价格，使用内置默认值
          </p>
        )}
      </div>
    </Section>
  );
}

// ── About Tab ──────────────────────────────────────────────────────────────

function AboutTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("…");
  const links = t("settings.about.links", { returnObjects: true }) as Array<{ label: string; url: string }>;

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  return (
    <div className="space-y-6">
      <Section title={t("settings.about.versionTitle")} desc="">
        <div className="space-y-1.5 text-sm">
          <Row label={t("settings.about.version")} value={`v${version}`} />
          <Row label={t("settings.about.license")} value="Apache 2.0" />
          <Row label={t("settings.about.framework")} value="Tauri 2 + React 19" />
          <Row label={t("settings.about.identifier")} value="ai.clawno11.desktop" />
        </div>
      </Section>

      <Section title={t("settings.about.privacyTitle")} desc="">
        <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground leading-relaxed space-y-1">
          <p>{t("settings.about.privacyTagline1")}</p>
          <p>{t("settings.about.privacyTagline2")}</p>
        </div>
      </Section>

      <Section title={t("settings.about.linksTitle")} desc="">
        <div className="space-y-1.5">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline">
              <ExternalLink size={13} />
              {l.label}
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

// ToggleRow imported from @clawno/shared

// ── Main Page ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; labelKey: string; icon: React.ElementType }[] = [
  { id: "general",  labelKey: "settings.tabs.general",  icon: Settings },
  { id: "security", labelKey: "settings.tabs.security", icon: Shield   },
  { id: "storage",  labelKey: "settings.tabs.storage",  icon: Database },
  { id: "about",    labelKey: "settings.tabs.about",    icon: Info     },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings size={22} className="text-primary" />
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t("settings.desc")}</p>
      </div>

      <div className="flex gap-6">
        <aside className="w-32 flex-shrink-0 space-y-1">
          {TABS.map((tabDef) => (
            <TabBtn
              key={tabDef.id}
              label={t(tabDef.labelKey)}
              icon={tabDef.icon}
              active={tab === tabDef.id}
              onClick={() => setTab(tabDef.id)}
            />
          ))}
        </aside>

        <div className="flex-1 min-w-0">
          {tab === "general"  && <GeneralTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "storage"  && <StorageTab />}
          {tab === "about"    && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
