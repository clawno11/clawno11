/**
 * SettingsPage — mobile version.
 *
 * A single scrollable page (no sidebar tabs) with:
 *  - Language selector
 *  - PII/RAG/Routing defaults
 *  - Token budget
 *  - Storage management (purge + wipe)
 *  - About
 *
 * AI API Key configuration lives in the Instance card (ConfigureAIPanel),
 * matching the desktop pattern where keys are per-instance.
 */
import { useState, useEffect } from "react";
import {
  Database, Shield, AlertTriangle, ChevronRight, Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@clawno/shared/components/common/ToggleRow";
import { LangSelector } from "@clawno/shared/components/common/LangSelector";
import { BudgetEditor } from "@clawno/shared/components/common/BudgetEditor";
import { getVersion } from "@tauri-apps/api/app";
import { purgeOldRecords } from "@clawno/shared/stores/tokenLogStore";
import { secureStore } from "../store/secureStore";
import { TopBar } from "../components/TopBar";

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
      className={`touch-btn w-full flex items-center gap-3 px-4 py-3.5 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]/50 last:border-0 text-left ${
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

// LangSelector and BudgetEditor imported from @clawno/shared
// ToggleRow imported from @clawno/shared

// ── Main page ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation();
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
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden p-4">
          <LangSelector />
        </div>

        {/* ── Defaults ── */}
        <SectionHeader title={t("settings.sectionDefaults")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
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
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
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
          {showBudget && <BudgetEditor className="px-4 py-3 space-y-3" />}
        </div>

        {/* ── Storage ── */}
        <SectionHeader title={t("settings.sectionStorage")} />
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
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
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
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
