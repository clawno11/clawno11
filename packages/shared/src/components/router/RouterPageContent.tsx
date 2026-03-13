import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch, Plus, Trash2, ChevronUp, ChevronDown,
  Check, Zap, X, ArrowRight, Edit2, Save, AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listRules, addRule, updateRule, deleteRule, matchRule, RULE_TEMPLATES,
  type RoutingRule,
} from "../../modelRouter";

// ── Types ───────────────────────────────────────────────────────────────────

interface InstanceOption {
  id: string;
  name: string;
  health?: "online" | "offline" | "unknown";
  httpUrl?: string;
}

// ── Rule card ───────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  instances,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  rule: RoutingRule;
  instances: InstanceOption[];
  onUpdate: (id: string, patch: Partial<RoutingRule>) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing]       = useState(false);
  const [name, setName]             = useState(rule.name);
  const [kwRaw, setKwRaw]           = useState(rule.keywords.join(", "));
  const [instanceId, setInstanceId] = useState(rule.instanceId);
  const [confirming, setConfirming] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) {
      setName(rule.name);
      setKwRaw(rule.keywords.join(", "));
      setInstanceId(rule.instanceId);
    }
  }, [rule, editing]);

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  const handleSave = () => {
    const keywords = [...new Set(kwRaw.split(",").map((s) => s.trim()).filter(Boolean))];
    if (!name.trim() || keywords.length === 0 || !instanceId) return;
    onUpdate(rule.id, { name, keywords, instanceId });
    setEditing(false);
  };

  const startConfirm = () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirming(true);
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      setConfirming(false);
    }, 3000);
  };

  return (
    <div className={`rounded-xl border bg-card transition-colors ${
      rule.enabled ? "border-border" : "border-border/40 opacity-60"
    }`}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <button onClick={() => onMoveUp(rule.id)} disabled={isFirst}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            <ChevronUp size={13} />
          </button>
          <button onClick={() => onMoveDown(rule.id)} disabled={isLast}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            <ChevronDown size={13} />
          </button>
        </div>

        <span className="w-6 text-center text-xs font-mono text-muted-foreground">{rule.priority}</span>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder={t("router.ruleName")}
                className="w-full px-2 py-1 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <input value={kwRaw} onChange={(e) => setKwRaw(e.target.value)}
                placeholder={t("router.keywordsPlaceholder")}
                className="w-full px-2 py-1 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-shrink-0">{t("router.routeTo")}</span>
                <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-background">
                  <option value="">{t("router.selectInstance")}</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(false)}
                  className="px-2 py-1 rounded border border-border text-xs hover:bg-muted/50 transition-colors">
                  {t("common.cancel")}
                </button>
                <button onClick={handleSave}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors">
                  <Save size={11} /> {t("common.save")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs font-medium">{rule.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <div className="flex flex-wrap gap-1">
                  {rule.keywords.slice(0, 6).map((kw) => (
                    <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border font-mono">{kw}</span>
                  ))}
                  {rule.keywords.length > 6 && (
                    <span className="text-[10px] text-muted-foreground">+{rule.keywords.length - 6}</span>
                  )}
                </div>
                {rule.instanceId && (() => {
                  const inst = instances.find((i) => i.id === rule.instanceId);
                  return (
                    <>
                      <ArrowRight size={10} className="text-muted-foreground flex-shrink-0" />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                        inst
                          ? "bg-primary/8 border-primary/20 text-primary"
                          : "bg-red-50 border-red-200 text-red-500"
                      }`}>
                        {inst ? inst.name : `⚠ ${t("router.instanceGone")}`}
                      </span>
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => onUpdate(rule.id, { enabled: !rule.enabled })}
              className={`relative w-8 h-4 rounded-full transition-colors ${rule.enabled ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${rule.enabled ? "left-[18px]" : "left-0.5"}`} />
            </button>
            <button onClick={() => setEditing(true)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
              <Edit2 size={12} />
            </button>
            {confirming ? (
              <>
                <button onClick={() => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); onDelete(rule.id); setConfirming(false); }}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-red-500 text-white hover:bg-red-600 transition-colors">
                  {t("common.confirm")}
                </button>
                <button onClick={() => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); setConfirming(false); }}
                  className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                  <X size={12} />
                </button>
              </>
            ) : (
              <button onClick={startConfirm}
                className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Test panel ──────────────────────────────────────────────────────────────

function TestPanel({ rules, instances }: { rules: RoutingRule[]; instances: InstanceOption[] }) {
  const { t } = useTranslation();
  const [testInput, setTestInput] = useState("");
  const matched = testInput.trim() ? matchRule(testInput, rules) : null;
  const matchedInst = matched ? instances.find((i) => i.id === matched.instanceId) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Zap size={14} className="text-primary" />
        {t("router.testTitle")}
      </h2>
      <input
        value={testInput}
        onChange={(e) => setTestInput(e.target.value)}
        placeholder={t("router.testPlaceholder")}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {testInput.trim() && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
          matched && matchedInst
            ? "bg-primary/8 border border-primary/20"
            : matched && !matchedInst
              ? "bg-red-50 border border-red-200"
              : "bg-muted/30 border border-border"
        }`}>
          {matched && matchedInst ? (
            <>
              <Check size={14} className="text-primary flex-shrink-0" />
              <span>
                {t("router.testMatched", { rule: matched.name })}
                {" → "}<span className="font-semibold text-primary">{matchedInst.name}</span>
              </span>
            </>
          ) : matched && !matchedInst ? (
            <>
              <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
              <span className="text-red-600">
                {t("router.testMatched", { rule: matched.name })} — {t("router.instanceGone")}
              </span>
            </>
          ) : (
            <>
              <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t("router.testNoMatch")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add rule form ───────────────────────────────────────────────────────────

function AddRuleForm({
  instances,
  onAdded,
}: {
  instances: InstanceOption[];
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen]             = useState(false);
  const [name, setName]             = useState("");
  const [kwRaw, setKwRaw]           = useState("");
  const [instanceId, setInstanceId] = useState("");

  const handleAdd = () => {
    if (!name.trim() || !kwRaw.trim() || !instanceId) return;
    const keywords = [...new Set(kwRaw.split(",").map((s) => s.trim()).filter(Boolean))];
    if (keywords.length === 0) return;
    const rules = listRules();
    const nextPriority = rules.length > 0
      ? rules.reduce((max, r) => Math.max(max, r.priority), 0) + 10
      : 10;
    addRule({ name, keywords, instanceId, priority: nextPriority, enabled: true });
    setName(""); setKwRaw(""); setInstanceId("");
    setOpen(false);
    onAdded();
  };

  const handleClose = () => {
    setOpen(false);
    setName(""); setKwRaw(""); setInstanceId("");
  };

  const handleTemplate = (tpl: typeof RULE_TEMPLATES[0]) => {
    setName(tpl.name);
    setKwRaw(tpl.keywords.join(", "));
    setInstanceId("");
    setOpen(true);
  };

  if (!open) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus size={15} /> {t("router.addRule")}
          </button>
        </div>
        {RULE_TEMPLATES.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t("router.templates")}</p>
            <div className="flex flex-wrap gap-1.5">
              {RULE_TEMPLATES.map((tpl, i) => (
                <button key={i} onClick={() => handleTemplate(tpl)}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs hover:bg-primary/8 hover:border-primary/30 hover:text-primary transition-colors">
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("router.addRule")}</p>
        <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("router.ruleName")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("router.ruleNamePlaceholder")}
            className="w-full px-2 py-1.5 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("router.routeTo")}</label>
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="">{t("router.selectInstance")}</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t("router.keywords")}</label>
        <input value={kwRaw} onChange={(e) => setKwRaw(e.target.value)}
          placeholder={t("router.keywordsPlaceholder")}
          className="w-full px-2 py-1.5 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
        <p className="text-[10px] text-muted-foreground">{t("router.keywordsHint")}</p>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={handleClose}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors">
          {t("common.cancel")}
        </button>
        <button onClick={handleAdd} disabled={!name.trim() || !kwRaw.trim() || !instanceId}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

// ── Main content (shared between desktop and mobile) ────────────────────────

export function RouterPageContent({
  instances,
}: {
  instances: InstanceOption[];
}) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<RoutingRule[]>(() => listRules());

  const instanceOptions = instances.map((i) => ({ id: i.id, name: i.name }));

  const reload = useCallback(() => setRules(listRules()), []);

  const handleUpdate = useCallback((id: string, patch: Partial<RoutingRule>) => {
    updateRule(id, patch);
    reload();
  }, [reload]);

  const handleDelete = useCallback((id: string) => {
    deleteRule(id);
    reload();
  }, [reload]);

  const handleMove = useCallback((id: string, dir: "up" | "down") => {
    const sorted = listRules();
    const idx    = sorted.findIndex((r) => r.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const current = sorted[idx]!;
    const swap    = sorted[swapIdx]!;
    const tmpPrio = current.priority;
    updateRule(current.id, { priority: swap.priority });
    updateRule(swap.id,    { priority: tmpPrio });
    reload();
  }, [reload]);

  return (
    <>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch size={22} className="text-primary" />
          {t("router.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t("router.desc")}</p>
      </div>

      {/* How it works */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
        <GitBranch size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">{t("router.howTitle")}</p>
          {(t("router.howSteps", { returnObjects: true }) as string[]).map((s, i) => (
            <p key={i}>• {s}</p>
          ))}
        </div>
      </div>

      {/* Instance overview */}
      {instances.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">{t("router.availableInstances")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {instances.map((inst) => (
              <div key={inst.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  inst.health === "online" ? "bg-emerald-500" :
                  inst.health === "offline" ? "bg-red-400" : "bg-slate-300"
                }`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{inst.name}</p>
                  {inst.httpUrl && <p className="text-[10px] text-muted-foreground font-mono truncate">{inst.httpUrl}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test panel */}
      <TestPanel rules={rules} instances={instanceOptions} />

      {/* Rules list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">
          {t("router.rules")}
          {rules.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">({rules.length})</span>
          )}
        </h2>

        <AddRuleForm instances={instanceOptions} onAdded={reload} />

        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 rounded-xl border border-dashed border-border text-muted-foreground text-sm">
            <GitBranch size={22} className="mb-2 opacity-30" />
            {t("router.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule, idx) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                instances={instanceOptions}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onMoveUp={(id) => handleMove(id, "up")}
                onMoveDown={(id) => handleMove(id, "down")}
                isFirst={idx === 0}
                isLast={idx === rules.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("router.tip")}</p>
    </>
  );
}
