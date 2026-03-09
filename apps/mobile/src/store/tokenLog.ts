/**
 * Token consumption logger — operates SQLite via @tauri-apps/plugin-sql.
 * Records every conversation turn and provides usage analytics.
 *
 * Timestamps are stored in **milliseconds** (consistent with chatHistory.ts).
 */

import Database from "@tauri-apps/plugin-sql";
import { DB_URL } from "./db";

// ── Singleton DB connection ────────────────────────────────────────────────

// A promise-cached singleton prevents redundant open() calls when multiple
// callers await db() before the first load resolves. The promise is reset on
// failure so that transient errors (e.g. busy lock) can be retried on the
// next call rather than permanently blocking all subsequent access.
let _dbPromise: Promise<Database> | null = null;

async function db(): Promise<Database> {
  if (!_dbPromise) {
    _dbPromise = Database.load(DB_URL).catch((err) => {
      // Reset so callers can retry after transient failures.
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
}

export interface UsageSummary {
  total24h: number;
  promptTotal24h: number;      // input tokens in the past 24 h
  completionTotal24h: number;  // output tokens in the past 24 h
  totalMonth: number;          // tokens consumed in the current calendar month
  hourly: HourlyUsage[];
  avg7d: number;               // 7-day daily average (excluding current 24 h window)
  anomaly: boolean;
  /** today / 7d-avg ratio, only set when anomaly === true */
  anomalyRatio: number | null;
  modelBreakdown: ModelBreakdown[];  // top models by token consumption in past 24 h
}

// ── Write ──────────────────────────────────────────────────────────────────

export async function recordTokenUsage(r: TokenRecord): Promise<void> {
  const conn = await db();
  const now   = Date.now(); // milliseconds, consistent with chatHistory.ts
  const total = r.promptTokens + r.completionTokens;
  await conn.execute(
    `INSERT INTO token_records
       (instance_id, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [r.instanceId, r.provider, r.model, r.promptTokens, r.completionTokens, total, now],
  );
}

// ── Read / Analytics ───────────────────────────────────────────────────────

export async function getUsageSummary(): Promise<UsageSummary> {
  const conn = await db();
  const now      = Date.now();              // milliseconds
  const since24h = now - 86_400_000;
  const since7d  = now - 86_400_000 * 7;
  const msPerHour  = 3_600_000;
  const msPerDay   = 86_400_000;

  // Start of the current calendar month (local time)
  const d = new Date();
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

  // All queries are independent — run in parallel for lower latency.
  const [totalRows, hourlyRows, avgRows, ioRows, modelRows, monthRows] = await Promise.all([
    // Total tokens in last 24 h
    conn.select<{ t: number }[]>(
      "SELECT COALESCE(SUM(total_tokens), 0) AS t FROM token_records WHERE created_at >= $1",
      [since24h],
    ),
    // Hourly buckets for the past 24 h
    conn.select<{ hour: number; total: number }[]>(
      `SELECT (created_at / $1) * $1 AS hour, SUM(total_tokens) AS total
       FROM token_records WHERE created_at >= $2
       GROUP BY hour ORDER BY hour ASC`,
      [msPerHour, since24h],
    ),
    // 7-day daily average — excludes the current 24 h window so today's spike
    // does not inflate the baseline and suppress its own anomaly alert.
    conn.select<{ avg: number }[]>(
      `SELECT COALESCE(AVG(daily), 0) AS avg FROM (
         SELECT (created_at / $1) AS day, SUM(total_tokens) AS daily
         FROM token_records WHERE created_at >= $2 AND created_at < $3
         GROUP BY day
       )`,
      [msPerDay, since7d, since24h],
    ),
    // Input (prompt) vs Output (completion) split for the past 24 h
    conn.select<{ pt: number; ct: number }[]>(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS pt,
              COALESCE(SUM(completion_tokens), 0) AS ct
       FROM token_records WHERE created_at >= $1`,
      [since24h],
    ),
    // Top-8 models by token consumption in the past 24 h
    conn.select<{ provider: string; model: string; tokens: number }[]>(
      `SELECT provider, model, SUM(total_tokens) AS tokens
       FROM token_records WHERE created_at >= $1
       GROUP BY provider, model ORDER BY tokens DESC LIMIT 8`,
      [since24h],
    ),
    // Total tokens in the current calendar month
    conn.select<{ t: number }[]>(
      "SELECT COALESCE(SUM(total_tokens), 0) AS t FROM token_records WHERE created_at >= $1",
      [startOfMonth],
    ),
  ]);

  const total24h = totalRows[0]?.t ?? 0;
  const promptTotal24h = ioRows[0]?.pt ?? 0;
  const completionTotal24h = ioRows[0]?.ct ?? 0;
  const totalMonth = monthRows[0]?.t ?? 0;
  const hourly: HourlyUsage[] = hourlyRows.map((r) => ({
    hour: r.hour,
    totalTokens: r.total,
  }));
  const avg7d = avgRows[0]?.avg ?? 0;
  const modelBreakdown: ModelBreakdown[] = modelRows.map((r) => ({
    provider: r.provider,
    model: r.model,
    tokens: r.tokens,
  }));

  const anomaly = avg7d > 0 && total24h > avg7d * 3;
  const anomalyRatio = anomaly ? total24h / avg7d : null;

  return { total24h, promptTotal24h, completionTotal24h, totalMonth, hourly, avg7d, anomaly, anomalyRatio, modelBreakdown };
}

/** Delete records older than `days` days. */
export async function purgeOldRecords(days = 30): Promise<void> {
  const conn = await db();
  const cutoff = Date.now() - days * 86_400_000;
  await conn.execute("DELETE FROM token_records WHERE created_at < $1", [cutoff]);
}
