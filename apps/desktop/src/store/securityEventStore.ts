/**
 * Security event log — persists notable security-related actions to the
 * `security_events` table (created in migration v2).
 *
 * Fix E-1: Database connection is shared via a module-level singleton to avoid
 *          opening a new connection on every function call.
 * Fix E-2: getRecentSecurityEvents now has error handling and a safe fallback.
 * Fix E-3: severity is validated when reading from the database.
 */

import Database from "@tauri-apps/plugin-sql";
import { DB_URL } from "./db";

export type SecurityEventSeverity = "info" | "warn" | "danger";

export interface SecurityEvent {
  id: number;
  eventType: string;
  detail: string;
  severity: SecurityEventSeverity;
  createdAt: number;
}

// Fix E-1: singleton — reuse the same connection across all calls in this module.
let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load(DB_URL);
  }
  return _db;
}

/** Coerce an arbitrary string to a valid SecurityEventSeverity (Fix E-3). */
function parseSeverity(raw: string): SecurityEventSeverity {
  if (raw === "warn" || raw === "danger") return raw;
  return "info";
}

/** Write a security event to the persistent log. Non-blocking — errors are swallowed. */
export async function logSecurityEvent(
  eventType: string,
  detail: string,
  severity: SecurityEventSeverity = "info",
): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO security_events (event_type, detail, severity, created_at)
       VALUES ($1, $2, $3, $4)`,
      [eventType, detail, severity, Date.now()],
    );
  } catch {
    // Security event logging must never crash the caller.
  }
}

/**
 * Fetch the most recent security events (newest first).
 * Fix E-2: errors return an empty array instead of propagating to callers.
 */
export async function getRecentSecurityEvents(limit = 30): Promise<SecurityEvent[]> {
  try {
    const db = await getDb();
    const rows = await db.select<Array<{
      id: number;
      event_type: string;
      detail: string;
      severity: string;
      created_at: number;
    }>>(
      `SELECT id, event_type, detail, severity, created_at
       FROM security_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      detail: r.detail,
      severity: parseSeverity(r.severity), // Fix E-3: validated cast
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** Delete all security event records. */
export async function clearSecurityEvents(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM security_events`);
}
