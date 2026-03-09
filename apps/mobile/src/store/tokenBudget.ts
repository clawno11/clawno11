/**
 * Token budget configuration — stored in localStorage so it survives restarts
 * without needing a backend or encrypted store (budget numbers are not sensitive).
 */

const BUDGET_KEY = "clawno-token-budget";

export interface TokenBudget {
  enabled: boolean;
  /** Daily token limit. 0 = unlimited. */
  dailyLimit: number;
  /** Monthly token limit. 0 = unlimited. */
  monthlyLimit: number;
}

const DEFAULT_BUDGET: TokenBudget = {
  enabled: false,
  dailyLimit: 0,
  monthlyLimit: 0,
};

export function getBudget(): TokenBudget {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (raw) return { ...DEFAULT_BUDGET, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BUDGET };
}

export function saveBudget(budget: TokenBudget): void {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
}

/** Returns the warning level for a given usage vs limit.
 *  "none" = under 50%, "warn" = 50–80%, "critical" = 80–100%, "over" = exceeded. */
export function budgetLevel(used: number, limit: number): "none" | "warn" | "critical" | "over" {
  if (limit <= 0) return "none";
  const pct = used / limit;
  if (pct >= 1)   return "over";
  if (pct >= 0.8) return "critical";
  if (pct >= 0.5) return "warn";
  return "none";
}
