/**
 * Token budget configuration — stored in localStorage so it survives restarts
 * without needing a backend or encrypted store (budget numbers are not sensitive).
 *
 * Two-tier model:
 *   1. Global budget  — applies to the aggregated total across all instances.
 *   2. Instance budget — per-instance override; when set, the instance gets its
 *      own daily/monthly quota shown on the Token page.
 */

const GLOBAL_BUDGET_KEY          = "clawno-token-budget";
const INSTANCE_BUDGET_KEY_PREFIX = "clawno-token-budget-inst-";

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

// ── Global budget ──────────────────────────────────────────────────────────

export function getBudget(): TokenBudget {
  try {
    const raw = localStorage.getItem(GLOBAL_BUDGET_KEY);
    if (raw) return { ...DEFAULT_BUDGET, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BUDGET };
}

export function saveBudget(budget: TokenBudget): void {
  localStorage.setItem(GLOBAL_BUDGET_KEY, JSON.stringify(budget));
}

// ── Instance-level budget ──────────────────────────────────────────────────

export function getInstanceBudget(instanceId: string): TokenBudget {
  try {
    const raw = localStorage.getItem(`${INSTANCE_BUDGET_KEY_PREFIX}${instanceId}`);
    if (raw) return { ...DEFAULT_BUDGET, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BUDGET };
}

export function saveInstanceBudget(instanceId: string, budget: TokenBudget): void {
  localStorage.setItem(
    `${INSTANCE_BUDGET_KEY_PREFIX}${instanceId}`,
    JSON.stringify(budget),
  );
}

export function clearInstanceBudget(instanceId: string): void {
  localStorage.removeItem(`${INSTANCE_BUDGET_KEY_PREFIX}${instanceId}`);
}

/** Returns all instance IDs that have a budget configured. */
export function listInstanceBudgetIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(INSTANCE_BUDGET_KEY_PREFIX)) {
      ids.push(key.slice(INSTANCE_BUDGET_KEY_PREFIX.length));
    }
  }
  return ids;
}

// ── Shared utility ─────────────────────────────────────────────────────────

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
