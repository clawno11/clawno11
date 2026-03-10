/**
 * Token consumption logger — operates SQLite via @tauri-apps/plugin-sql.
 * Records every conversation turn and provides usage analytics.
 *
 * Timestamps are stored in **milliseconds** (consistent with chatHistory.ts).
 */

import Database from "@tauri-apps/plugin-sql";
import { DB_URL } from "./db";

// ── Singleton DB connection ────────────────────────────────────────────────

let _dbPromise: Promise<Database> | null = null;

async function db(): Promise<Database> {
  if (!_dbPromise) {
    _dbPromise = Database.load(DB_URL).catch((err) => {
      _dbPromise = null;
      throw err;
    });
  }
  return _dbPromise;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface TokenRecord {
  instanceId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface HourlyUsage {
  hour: number;      // Unix timestamp of hour start (milliseconds)
  totalTokens: number;
}

export interface ModelBreakdown {
  provider: string;
  model: string;
  tokens: number;
  /** Input (prompt) tokens — needed for per-model cost calculation. */
  promptTokens: number;
  /** Output (completion) tokens — needed for per-model cost calculation. */
  completionTokens: number;
}

/** Per-instance aggregate used in the comparison table on TokenPage. */
export interface InstanceUsage {
  instanceId: string;
  total24h: number;
  promptTotal24h: number;
  completionTotal24h: number;
  totalMonth: number;
}

export interface UsageSummary {
  total24h: number;
  promptTotal24h: number;
  completionTotal24h: number;
  totalMonth: number;
  hourly: HourlyUsage[];
  avg7d: number;
  anomaly: boolean;
  /** today / 7d-avg ratio, only set when anomaly === true */
  anomalyRatio: number | null;
  modelBreakdown: ModelBreakdown[];
  /** Per-instance breakdown — only populated in the global (no filter) view. */
  instanceBreakdown: InstanceUsage[];
}

// ── Write ──────────────────────────────────────────────────────────────────

export async function recordTokenUsage(r: TokenRecord): Promise<void> {
  const conn = await db();
  const now   = Date.now();
  const total = r.promptTokens + r.completionTokens;
  await conn.execute(
    `INSERT INTO token_records
       (instance_id, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [r.instanceId, r.provider, r.model, r.promptTokens, r.completionTokens, total, now],
  );
}

// ── Read / Analytics ───────────────────────────────────────────────────────

/**
 * Returns usage summary for either all instances (no filter) or a single
 * instance when `instanceId` is provided.
 *
 * When called without a filter the result also includes `instanceBreakdown`
 * (one row per distinct instance_id) so the UI can render a comparison table.
 */
export async function getUsageSummary(instanceId?: string): Promise<UsageSummary> {
  const conn = await db();
  const now        = Date.now();
  const since24h   = now - 86_400_000;
  const since7d    = now - 86_400_000 * 7;
  const msPerHour  = 3_600_000;
  const msPerDay   = 86_400_000;

  const d = new Date();
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

  // Build optional WHERE clause fragment
  const instFilter   = instanceId ? ` AND instance_id = '${instanceId}'` : "";
  const instFilter24 = instanceId ? ` AND instance_id = '${instanceId}'` : "";

  const [totalRows, hourlyRows, avgRows, ioRows, modelRows, monthRows, instRows] = await Promise.all([
    conn.select<{ t: number }[]>(
      `SELECT COALESCE(SUM(total_tokens), 0) AS t FROM token_records WHERE created_at >= $1${instFilter24}`,
      [since24h],
    ),
    conn.select<{ hour: number; total: number }[]>(
      `SELECT (created_at / $1) * $1 AS hour, SUM(total_tokens) AS total
       FROM token_records WHERE created_at >= $2${instFilter24}
       GROUP BY hour ORDER BY hour ASC`,
      [msPerHour, since24h],
    ),
    conn.select<{ avg: number }[]>(
      `SELECT COALESCE(AVG(daily), 0) AS avg FROM (
         SELECT (created_at / $1) AS day, SUM(total_tokens) AS daily
         FROM token_records WHERE created_at >= $2 AND created_at < $3${instFilter}
         GROUP BY day
       )`,
      [msPerDay, since7d, since24h],
    ),
    conn.select<{ pt: number; ct: number }[]>(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS pt,
              COALESCE(SUM(completion_tokens), 0) AS ct
       FROM token_records WHERE created_at >= $1${instFilter24}`,
      [since24h],
    ),
    conn.select<{ provider: string; model: string; tokens: number; prompt_tokens: number; completion_tokens: number }[]>(
      `SELECT provider, model,
              SUM(total_tokens)      AS tokens,
              SUM(prompt_tokens)     AS prompt_tokens,
              SUM(completion_tokens) AS completion_tokens
       FROM token_records WHERE created_at >= $1${instFilter24}
       GROUP BY provider, model ORDER BY tokens DESC LIMIT 8`,
      [since24h],
    ),
    conn.select<{ t: number }[]>(
      `SELECT COALESCE(SUM(total_tokens), 0) AS t FROM token_records WHERE created_at >= $1${instFilter}`,
      [startOfMonth],
    ),
    // Per-instance totals — only fetched in the global (unfiltered) view
    instanceId
      ? Promise.resolve([] as { instance_id: string; t24: number; pt24: number; ct24: number; tmonth: number }[])
      : conn.select<{ instance_id: string; t24: number; pt24: number; ct24: number; tmonth: number }[]>(
          `SELECT instance_id,
                  COALESCE(SUM(CASE WHEN created_at >= $1 THEN total_tokens ELSE 0 END), 0) AS t24,
                  COALESCE(SUM(CASE WHEN created_at >= $1 THEN prompt_tokens ELSE 0 END), 0) AS pt24,
                  COALESCE(SUM(CASE WHEN created_at >= $1 THEN completion_tokens ELSE 0 END), 0) AS ct24,
                  COALESCE(SUM(CASE WHEN created_at >= $2 THEN total_tokens ELSE 0 END), 0) AS tmonth
           FROM token_records
           GROUP BY instance_id
           ORDER BY t24 DESC`,
          [since24h, startOfMonth],
        ),
  ]);

  const total24h           = totalRows[0]?.t ?? 0;
  const promptTotal24h     = ioRows[0]?.pt ?? 0;
  const completionTotal24h = ioRows[0]?.ct ?? 0;
  const totalMonth         = monthRows[0]?.t ?? 0;
  const hourly: HourlyUsage[] = hourlyRows.map((r) => ({ hour: r.hour, totalTokens: r.total }));
  const avg7d              = avgRows[0]?.avg ?? 0;
  const modelBreakdown: ModelBreakdown[] = modelRows.map((r) => ({
    provider: r.provider,
    model: r.model,
    tokens: r.tokens,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
  }));
  const instanceBreakdown: InstanceUsage[] = instRows.map((r) => ({
    instanceId: r.instance_id,
    total24h: r.t24,
    promptTotal24h: r.pt24,
    completionTotal24h: r.ct24,
    totalMonth: r.tmonth,
  }));

  const anomaly      = avg7d > 0 && total24h > avg7d * 3;
  const anomalyRatio = anomaly ? total24h / avg7d : null;

  return {
    total24h, promptTotal24h, completionTotal24h, totalMonth,
    hourly, avg7d, anomaly, anomalyRatio, modelBreakdown, instanceBreakdown,
  };
}

/** Delete records older than `days` days. */
export async function purgeOldRecords(days = 30): Promise<void> {
  const conn = await db();
  const cutoff = Date.now() - days * 86_400_000;
  await conn.execute("DELETE FROM token_records WHERE created_at < $1", [cutoff]);
}
