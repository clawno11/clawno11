/**
 * Token cost estimation — maps model names to per-token prices.
 *
 * Architecture:
 *   1. BUILTIN_PRICE_RULES  — shipped default prices, longest-match-wins.
 *   2. User overrides        — localStorage, keyed by exact lowercase model name.
 *   3. Calculation           — splits prompt / completion costs separately.
 *   4. Display               — optional currency conversion (USD ↔ CNY).
 *
 * Prices are approximate reference values.  Users should verify against
 * their actual provider invoices and adjust via the price-override UI.
 */

export type Currency        = "USD" | "CNY";
export type DisplayCurrency = "USD" | "CNY" | "ORIGINAL";

export interface ModelPrice {
  /** Price per 1 million input (prompt) tokens. */
  inputPer1M: number;
  /** Price per 1 million output (completion) tokens. */
  outputPer1M: number;
  currency: Currency;
  /** Mark model as free so cost always shows ¥0 / $0. */
  free?: boolean;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: Currency;
  /** true when the price came from a partial / fuzzy match */
  estimated: boolean;
  matchedRule: string;
}

// ── Storage keys ───────────────────────────────────────────────────────────

const OVERRIDES_KEY       = "clawno-model-price-overrides";
const DISPLAY_CURRENCY_KEY = "clawno-cost-display-currency";
const EXCHANGE_RATE_KEY   = "clawno-usd-cny-rate";

// ── Built-in price rules ───────────────────────────────────────────────────
// Rules are matched by checking whether the lowercase model name *contains*
// the rule key.  Longer keys win (sorted descending by length before matching).
// All prices are per 1 million tokens (prompt / completion).

const BUILTIN_PRICE_RULES: Array<{ match: string; price: ModelPrice }> = [
  // ── OpenAI (USD) ──────────────────────────────────────────────────────────
  { match: "gpt-4o-mini",           price: { inputPer1M: 0.15,   outputPer1M: 0.60,    currency: "USD" } },
  { match: "gpt-4o",                price: { inputPer1M: 2.50,   outputPer1M: 10.00,   currency: "USD" } },
  { match: "gpt-4-turbo",           price: { inputPer1M: 10.00,  outputPer1M: 30.00,   currency: "USD" } },
  { match: "gpt-4",                 price: { inputPer1M: 30.00,  outputPer1M: 60.00,   currency: "USD" } },
  { match: "gpt-3.5-turbo",         price: { inputPer1M: 0.50,   outputPer1M: 1.50,    currency: "USD" } },
  { match: "o3-mini",               price: { inputPer1M: 1.10,   outputPer1M: 4.40,    currency: "USD" } },
  { match: "o1-mini",               price: { inputPer1M: 3.00,   outputPer1M: 12.00,   currency: "USD" } },
  { match: "o1",                    price: { inputPer1M: 15.00,  outputPer1M: 60.00,   currency: "USD" } },

  // ── Anthropic (USD) ───────────────────────────────────────────────────────
  { match: "claude-3-7-sonnet",     price: { inputPer1M: 3.00,   outputPer1M: 15.00,   currency: "USD" } },
  { match: "claude-3-5-haiku",      price: { inputPer1M: 0.80,   outputPer1M: 4.00,    currency: "USD" } },
  { match: "claude-3-5-sonnet",     price: { inputPer1M: 3.00,   outputPer1M: 15.00,   currency: "USD" } },
  { match: "claude-3-haiku",        price: { inputPer1M: 0.25,   outputPer1M: 1.25,    currency: "USD" } },
  { match: "claude-3-sonnet",       price: { inputPer1M: 3.00,   outputPer1M: 15.00,   currency: "USD" } },
  { match: "claude-3-opus",         price: { inputPer1M: 15.00,  outputPer1M: 75.00,   currency: "USD" } },

  // ── DeepSeek (CNY) ────────────────────────────────────────────────────────
  { match: "deepseek-r1",           price: { inputPer1M: 4.00,   outputPer1M: 16.00,   currency: "CNY" } },
  { match: "deepseek-reasoner",     price: { inputPer1M: 4.00,   outputPer1M: 16.00,   currency: "CNY" } },
  { match: "deepseek-v3",           price: { inputPer1M: 1.00,   outputPer1M: 4.00,    currency: "CNY" } },
  { match: "deepseek-chat",         price: { inputPer1M: 1.00,   outputPer1M: 4.00,    currency: "CNY" } },
  { match: "deepseek",              price: { inputPer1M: 1.00,   outputPer1M: 4.00,    currency: "CNY" } },

  // ── Moonshot / Kimi (CNY) ─────────────────────────────────────────────────
  { match: "moonshot-v1-128k",      price: { inputPer1M: 60.00,  outputPer1M: 60.00,   currency: "CNY" } },
  { match: "moonshot-v1-32k",       price: { inputPer1M: 24.00,  outputPer1M: 24.00,   currency: "CNY" } },
  { match: "moonshot-v1-8k",        price: { inputPer1M: 12.00,  outputPer1M: 12.00,   currency: "CNY" } },
  { match: "kimi",                  price: { inputPer1M: 12.00,  outputPer1M: 12.00,   currency: "CNY" } },
  { match: "moonshot",              price: { inputPer1M: 12.00,  outputPer1M: 12.00,   currency: "CNY" } },

  // ── Qwen / 通义千问 (CNY) ────────────────────────────────────────────────
  { match: "qwen-max",              price: { inputPer1M: 40.00,  outputPer1M: 120.00,  currency: "CNY" } },
  { match: "qwen-plus",             price: { inputPer1M: 4.00,   outputPer1M: 12.00,   currency: "CNY" } },
  { match: "qwen-turbo",            price: { inputPer1M: 2.00,   outputPer1M: 6.00,    currency: "CNY" } },
  { match: "qwen-long",             price: { inputPer1M: 0.50,   outputPer1M: 2.00,    currency: "CNY" } },
  { match: "qwq",                   price: { inputPer1M: 2.00,   outputPer1M: 6.00,    currency: "CNY" } },
  { match: "qwen",                  price: { inputPer1M: 4.00,   outputPer1M: 12.00,   currency: "CNY" } },

  // ── Doubao / 豆包 (CNY) ──────────────────────────────────────────────────
  { match: "doubao-pro",            price: { inputPer1M: 0.80,   outputPer1M: 2.00,    currency: "CNY" } },
  { match: "doubao-lite",           price: { inputPer1M: 0.30,   outputPer1M: 0.60,    currency: "CNY" } },
  { match: "doubao",                price: { inputPer1M: 0.80,   outputPer1M: 2.00,    currency: "CNY" } },

  // ── HunYuan / 混元 (CNY) ─────────────────────────────────────────────────
  { match: "hunyuan-lite",          price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "hunyuan-pro",           price: { inputPer1M: 30.00,  outputPer1M: 100.00,  currency: "CNY" } },
  { match: "hunyuan-standard",      price: { inputPer1M: 4.50,   outputPer1M: 5.00,    currency: "CNY" } },
  { match: "hunyuan",               price: { inputPer1M: 4.50,   outputPer1M: 5.00,    currency: "CNY" } },

  // ── Xinghuo / 讯飞星火 (CNY) ─────────────────────────────────────────────
  { match: "spark-lite",            price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "spark-4.0-ultra",       price: { inputPer1M: 30.00,  outputPer1M: 30.00,   currency: "CNY" } },
  { match: "spark-max",             price: { inputPer1M: 30.00,  outputPer1M: 30.00,   currency: "CNY" } },
  { match: "spark-pro",             price: { inputPer1M: 21.00,  outputPer1M: 21.00,   currency: "CNY" } },
  { match: "spark",                 price: { inputPer1M: 21.00,  outputPer1M: 21.00,   currency: "CNY" } },

  // ── Baichuan / 百川 (CNY) ────────────────────────────────────────────────
  { match: "baichuan3-turbo",       price: { inputPer1M: 4.00,   outputPer1M: 4.00,    currency: "CNY" } },
  { match: "baichuan2-turbo",       price: { inputPer1M: 8.00,   outputPer1M: 8.00,    currency: "CNY" } },
  { match: "baichuan",              price: { inputPer1M: 4.00,   outputPer1M: 4.00,    currency: "CNY" } },

  // ── StepFun / 阶跃星辰 (CNY) ─────────────────────────────────────────────
  { match: "step-1v",               price: { inputPer1M: 150.00, outputPer1M: 150.00,  currency: "CNY" } },
  { match: "step-2",                price: { inputPer1M: 38.00,  outputPer1M: 120.00,  currency: "CNY" } },
  { match: "step-1",                price: { inputPer1M: 40.00,  outputPer1M: 40.00,   currency: "CNY" } },
  { match: "step",                  price: { inputPer1M: 40.00,  outputPer1M: 40.00,   currency: "CNY" } },

  // ── Yi / 零一万物 (CNY) ──────────────────────────────────────────────────
  { match: "yi-lightning",          price: { inputPer1M: 0.99,   outputPer1M: 0.99,    currency: "CNY" } },
  { match: "yi-spark",              price: { inputPer1M: 1.00,   outputPer1M: 1.00,    currency: "CNY" } },
  { match: "yi-medium",             price: { inputPer1M: 2.50,   outputPer1M: 2.50,    currency: "CNY" } },
  { match: "yi-large",              price: { inputPer1M: 20.00,  outputPer1M: 20.00,   currency: "CNY" } },
  { match: "yi-",                   price: { inputPer1M: 2.50,   outputPer1M: 2.50,    currency: "CNY" } },

  // ── SiliconFlow (CNY, mix of free & paid) ────────────────────────────────
  { match: "qwen2.5-72b",           price: { inputPer1M: 4.00,   outputPer1M: 4.00,    currency: "CNY" } },
  { match: "qwen2.5-7b",            price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "llama-3.1-70b",         price: { inputPer1M: 4.13,   outputPer1M: 4.13,    currency: "CNY" } },
  { match: "llama-3.1-8b",         price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "llama-3",               price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "llama3",                price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },

  // ── ZAI / 智谱 (CNY) ─────────────────────────────────────────────────────
  { match: "glm-4-flash",           price: { inputPer1M: 0,      outputPer1M: 0,       currency: "CNY", free: true } },
  { match: "glm-4-air",             price: { inputPer1M: 1.00,   outputPer1M: 1.00,    currency: "CNY" } },
  { match: "glm-4-plus",            price: { inputPer1M: 50.00,  outputPer1M: 50.00,   currency: "CNY" } },
  { match: "glm-4",                 price: { inputPer1M: 100.00, outputPer1M: 100.00,  currency: "CNY" } },
  { match: "glm-3",                 price: { inputPer1M: 5.00,   outputPer1M: 5.00,    currency: "CNY" } },
  { match: "glm",                   price: { inputPer1M: 1.00,   outputPer1M: 1.00,    currency: "CNY" } },

  // ── MiniMax (CNY) ─────────────────────────────────────────────────────────
  { match: "abab6.5s",              price: { inputPer1M: 1.00,   outputPer1M: 1.00,    currency: "CNY" } },
  { match: "abab5.5",               price: { inputPer1M: 0.15,   outputPer1M: 0.15,    currency: "CNY" } },
  { match: "minimax",               price: { inputPer1M: 1.00,   outputPer1M: 1.00,    currency: "CNY" } },
];

// Sort once at module load: longer keys are more specific and win.
const SORTED_RULES = [...BUILTIN_PRICE_RULES].sort((a, b) => b.match.length - a.match.length);

// ── User overrides ─────────────────────────────────────────────────────────

export function getUserPriceOverrides(): Record<string, ModelPrice> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (raw) return JSON.parse(raw) as Record<string, ModelPrice>;
  } catch { /* ignore */ }
  return {};
}

export function setUserPriceOverride(model: string, price: ModelPrice): void {
  const overrides = getUserPriceOverrides();
  overrides[model.toLowerCase()] = price;
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export function removeUserPriceOverride(model: string): void {
  const overrides = getUserPriceOverrides();
  delete overrides[model.toLowerCase()];
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

// ── Price matching ─────────────────────────────────────────────────────────

export function findModelPrice(
  model: string,
  _provider?: string,
): { price: ModelPrice; rule: string; exact: boolean } | null {
  const key = model.toLowerCase().trim();
  if (!key || key === "main" || key === "default" || key === "unknown") return null;

  // 1. User exact override
  const overrides = getUserPriceOverrides();
  if (overrides[key]) return { price: overrides[key]!, rule: key, exact: true };

  // 2. User partial override (substring)
  for (const [oKey, oPrice] of Object.entries(overrides)) {
    if (key.includes(oKey) || oKey.includes(key)) {
      return { price: oPrice, rule: oKey, exact: false };
    }
  }

  // 3. Built-in rules (longest-match-first)
  for (const rule of SORTED_RULES) {
    if (key.includes(rule.match)) {
      return { price: rule.price, rule: rule.match, exact: key === rule.match };
    }
  }

  return null;
}

// ── Cost calculation ───────────────────────────────────────────────────────

export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  model: string,
  provider?: string,
): CostBreakdown | null {
  const found = findModelPrice(model, provider);
  if (!found) return null;

  const { price, rule, exact } = found;
  const inputCost  = price.free ? 0 : (promptTokens     / 1_000_000) * price.inputPer1M;
  const outputCost = price.free ? 0 : (completionTokens / 1_000_000) * price.outputPer1M;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency:  price.currency,
    estimated: !exact,
    matchedRule: rule,
  };
}

// ── Display currency ───────────────────────────────────────────────────────

export function getDisplayCurrency(): DisplayCurrency {
  return (localStorage.getItem(DISPLAY_CURRENCY_KEY) as DisplayCurrency | null) ?? "ORIGINAL";
}

export function setDisplayCurrency(c: DisplayCurrency): void {
  localStorage.setItem(DISPLAY_CURRENCY_KEY, c);
}

export function getExchangeRate(): number {
  const raw = localStorage.getItem(EXCHANGE_RATE_KEY);
  if (raw) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0) return n;
  }
  return 7.25; // default CNY per USD
}

export function setExchangeRate(rate: number): void {
  localStorage.setItem(EXCHANGE_RATE_KEY, String(rate));
}

// ── Currency conversion & formatting ──────────────────────────────────────

export function convertCost(cost: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return cost;
  return from === "USD" ? cost * rate : cost / rate;
}

/**
 * Format a cost value for display, applying currency conversion if needed.
 */
export function formatCost(
  cost: number,
  fromCurrency: Currency,
  displayCurrency: DisplayCurrency,
  rate: number,
): string {
  const targetCurrency: Currency =
    displayCurrency === "ORIGINAL" ? fromCurrency : displayCurrency;

  const displayed =
    displayCurrency === "ORIGINAL" || fromCurrency === targetCurrency
      ? cost
      : convertCost(cost, fromCurrency, targetCurrency, rate);

  const symbol = targetCurrency === "USD" ? "$" : "¥";

  if (displayed === 0) return `${symbol}0.00`;
  if (displayed < 0.001) return `${symbol}< 0.001`;
  if (displayed < 0.01)  return `${symbol}${displayed.toFixed(4)}`;
  if (displayed < 10)    return `${symbol}${displayed.toFixed(3)}`;
  if (displayed < 100)   return `${symbol}${displayed.toFixed(2)}`;
  return `${symbol}${displayed.toFixed(1)}`;
}

/** Aggregate cost breakdown across multiple models, converting to a single display currency. */
export interface AggregatedCost {
  total: number;
  currency: Currency;
  /** true when any individual model had no price found */
  hasUnknown: boolean;
  /** model keys with no price configured */
  unknownModels: string[];
}

export function aggregateCosts(
  items: Array<{ model: string; provider: string; promptTokens: number; completionTokens: number }>,
  displayCurrency: DisplayCurrency,
  rate: number,
): AggregatedCost {
  const target: Currency = displayCurrency === "ORIGINAL" ? "CNY" : displayCurrency;
  let total = 0;
  const unknownModels: string[] = [];

  for (const item of items) {
    const cost = calculateCost(item.promptTokens, item.completionTokens, item.model, item.provider);
    if (!cost) {
      if (!unknownModels.includes(item.model)) unknownModels.push(item.model);
      continue;
    }
    total += convertCost(cost.totalCost, cost.currency, target, rate);
  }

  return { total, currency: target, hasUnknown: unknownModels.length > 0, unknownModels };
}

// ── Exported constants for UI ──────────────────────────────────────────────

/** All built-in rule match keys, sorted longest-first (for display in settings). */
export const BUILTIN_MODEL_KEYS = SORTED_RULES.map((r) => r.match);

export const DEFAULT_EXCHANGE_RATE = 7.25;
