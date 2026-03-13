import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  getBudget,
  saveBudget,
  type TokenBudget,
} from "../../stores/tokenLogStore";

export interface BudgetEditorProps {
  className?: string;
}

export function BudgetEditor({ className }: BudgetEditorProps) {
  const { t } = useTranslation();
  const [budget, setBudget] = useState<TokenBudget>(getBudget);
  const [saved, setSaved] = useState(false);

  const handleToggle = () => {
    const next = { ...budget, enabled: !budget.enabled };
    setBudget(next);
    saveBudget(next);
  };

  const handleSave = () => {
    saveBudget(budget);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="text-sm">{t("settings.budget.enable")}</span>
        <button
          onClick={handleToggle}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            budget.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-card shadow transition-all ${
              budget.enabled ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {budget.enabled && (
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("settings.budget.daily")}
            </label>
            <input
              type="number"
              min={0}
              value={budget.dailyLimit || ""}
              onChange={(e) =>
                setBudget((b) => ({
                  ...b,
                  dailyLimit: Math.max(0, Number(e.target.value) || 0),
                }))
              }
              placeholder="0 = ∞"
              className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("settings.budget.monthly")}
            </label>
            <input
              type="number"
              min={0}
              value={budget.monthlyLimit || ""}
              onChange={(e) =>
                setBudget((b) => ({
                  ...b,
                  monthlyLimit: Math.max(0, Number(e.target.value) || 0),
                }))
              }
              placeholder="0 = ∞"
              className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background"
            />
          </div>
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            {saved ? (
              <>
                <Check size={13} /> {t("settings.budgetSaved")}
              </>
            ) : (
              t("settings.budgetSave")
            )}
          </button>
        </div>
      )}
    </div>
  );
}
