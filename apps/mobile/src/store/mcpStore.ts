/**
 * MCP (Model Context Protocol) adapter layer.
 *
 * Manages:
 *  - Server registry  : add / remove / toggle MCP server configs
 *  - Security scan    : Rust-side static + live analysis per server
 *  - Audit log        : record tool calls for post-session review
 */

import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { DB_URL } from "./db";
import { logSecurityEvent } from "./securityEventStore";

// ── DB singleton ───────────────────────────────────────────────────────────

/**
 * Cache the load() Promise (not the resolved value) so that concurrent
 * callers before the first open completes all share the same Promise and
 * Database.load() is only ever called once.
 */
let _dbPromise: Promise<Database> | null = null;

/** Return the shared SQLite connection, opening it once per process. */
function getDb(): Promise<Database> {
  if (!_dbPromise) _dbPromise = Database.load(DB_URL);
  return _dbPromise;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely deserialise the factors JSON column.
 * Returns [] on empty string (pre-migration rows) or any parse error,
 * so a single corrupted row never breaks the entire server list.
 */
function parseFactors(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type Transport = "http" | "sse" | "stdio";
export type RiskLevel = "safe" | "caution" | "danger" | "unknown";
export type AuditOutcome = "allowed" | "blocked" | "error";

export interface McpServer {
  id: string;
  name: string;
  endpoint: string;
  transport: Transport;
  /** Optional plain-text description of what this server does. */
  description: string;
  enabled: boolean;
  riskLevel: RiskLevel;
  /** JSON-encoded string array of risk factor keys, stored in DB. */
  factors: string[];
  lastScanned: number | null;
  createdAt: number;
}

export interface McpCallSummary {
  totalCalls: number;
  blockedCalls: number;
  recentTools: string[];
  lastCallAt: number | null;
}

export interface McpScanResult {
  riskLevel: RiskLevel;
  factors: string[];
  reachable: boolean;
}

export interface McpAuditEntry {
  id: number;
  serverId: string;
  serverName: string;
  toolName: string;
  argsPreview: string;
  outcome: AuditOutcome;
  createdAt: number;
}

// ── Server CRUD ────────────────────────────────────────────────────────────

export async function listServers(): Promise<McpServer[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; name: string; endpoint: string; transport: string;
    description: string; enabled: number; risk_level: string; factors: string;
    last_scanned: number | null; created_at: number;
  }>>(
    `SELECT id, name, endpoint, transport, description, enabled, risk_level, factors, last_scanned, created_at
     FROM mcp_servers ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, endpoint: r.endpoint,
    transport: r.transport as Transport,
    description: r.description ?? "",
    enabled: r.enabled === 1,
    riskLevel: r.risk_level as RiskLevel,
    factors: parseFactors(r.factors),
    lastScanned: r.last_scanned,
    createdAt: r.created_at,
  }));
}

export async function addServer(
  name: string, endpoint: string, transport: Transport, description = "",
): Promise<string> {
  const db  = await getDb();
  const id  = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO mcp_servers (id, name, endpoint, transport, description, enabled, risk_level, factors, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, 'unknown', '[]', $6)`,
    [id, name, endpoint, transport, description.trim(), now],
  );
  return id;
}

export async function toggleServer(id: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE mcp_servers SET enabled = $1 WHERE id = $2`, [enabled ? 1 : 0, id]);
}

/**
 * Delete a server and its associated audit entries.
 * mcp_audit has no FK cascade, so we clean up manually to avoid orphan rows.
 */
export async function deleteServer(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM mcp_audit WHERE server_id = $1`, [id]);
  await db.execute(`DELETE FROM mcp_servers WHERE id = $1`, [id]);
}

export async function updateServerRisk(
  id: string, riskLevel: RiskLevel, factors: string[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE mcp_servers SET risk_level = $1, factors = $2, last_scanned = $3 WHERE id = $4`,
    [riskLevel, JSON.stringify(factors), Date.now(), id],
  );
}

// ── Security scan ──────────────────────────────────────────────────────────

export async function scanServer(server: McpServer): Promise<McpScanResult> {
  const result = await invoke<McpScanResult>("scan_mcp_server", {
    endpoint: server.endpoint,
    transport: server.transport,
  });

  // Persist risk level + factors so they survive page reloads.
  await updateServerRisk(server.id, result.riskLevel, result.factors);

  if (result.riskLevel === "danger") {
    await toggleServer(server.id, false).catch(
      (err) => console.error("[MCP] auto-disable failed:", err),
    );

    await logSecurityEvent(
      "mcp_danger_detected",
      `MCP server "${server.name}" rated danger. Factors: ${result.factors.join(", ")}. Auto-disabled.`,
      "danger",
    ).catch(() => {});
  }

  // Record the security scan in the audit log.
  const argsPreview = `reachable=${result.reachable} factors=[${result.factors.join(", ")}]`;
  const outcome: AuditOutcome = result.riskLevel === "danger" ? "blocked" : "allowed";

  // Audit write failures are logged but must not mask the scan result.
  await writeAuditEntry(server.id, server.name, "security_scan", argsPreview, outcome).catch(
    (err) => console.error("[MCP] audit write failed:", err),
  );

  return result;
}

// ── Audit log ──────────────────────────────────────────────────────────────

export async function writeAuditEntry(
  serverId: string, serverName: string, toolName: string,
  argsPreview: string, outcome: AuditOutcome,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO mcp_audit (server_id, server_name, tool_name, args_preview, outcome, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [serverId, serverName, toolName, argsPreview, outcome, Date.now()],
  );
}

/** Load up to `limit` recent audit entries (most recent first). */
export async function listAuditEntries(limit = 200): Promise<McpAuditEntry[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: number; server_id: string; server_name: string;
    tool_name: string; args_preview: string; outcome: string; created_at: number;
  }>>(
    `SELECT id, server_id, server_name, tool_name, args_preview, outcome, created_at
     FROM mcp_audit ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, serverId: r.server_id, serverName: r.server_name,
    toolName: r.tool_name, argsPreview: r.args_preview,
    outcome: r.outcome as AuditOutcome, createdAt: r.created_at,
  }));
}

export async function clearAuditLog(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM mcp_audit`);
}

export async function getServerCallSummary(serverId: string): Promise<McpCallSummary> {
  const db = await getDb();

  const [counts] = await db.select<Array<{ total: number; blocked: number; last_at: number | null }>>(
    `SELECT
       COUNT(*)                                          AS total,
       SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked,
       MAX(created_at)                                   AS last_at
     FROM mcp_audit
     WHERE server_id = $1`,
    [serverId],
  );

  const toolRows = await db.select<Array<{ tool_name: string }>>(
    `SELECT DISTINCT tool_name
     FROM mcp_audit
     WHERE server_id = $1
       AND tool_name != 'security_scan'
     ORDER BY created_at DESC
     LIMIT 5`,
    [serverId],
  );

  return {
    totalCalls:   counts?.total   ?? 0,
    blockedCalls: counts?.blocked ?? 0,
    recentTools:  toolRows.map((r) => r.tool_name),
    lastCallAt:   counts?.last_at ?? null,
  };
}
