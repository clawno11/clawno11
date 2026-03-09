/**
 * Chat history persistence layer.
 *
 * Every conversation is a "session". Each session contains ordered messages.
 * All data is stored locally in SQLite — nothing leaves the machine.
 *
 * Usage in ChatPage:
 *   1. On first user message → createSession() → store sessionId in state
 *   2. After each turn        → addMessage() for both user and assistant
 *   3. Sidebar               → listSessions() / searchSessions() / loadMessages()
 */

import Database from "@tauri-apps/plugin-sql";
import { DB_URL } from "./db";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  instanceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Injected after load — not stored in this table */
  messageCount?: number;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

// ── LIKE escape helper ─────────────────────────────────────────────────────

/** Escape SQL LIKE metacharacters so user input is treated as a literal string. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

// ── Session CRUD ───────────────────────────────────────────────────────────

export async function createSession(title: string, instanceId = ""): Promise<string> {
  const db  = await Database.load(DB_URL);
  const id  = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO chat_sessions (id, instance_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, instanceId, title.slice(0, 60), now, now],
  );
  return id;
}

export async function listSessions(limit = 60): Promise<ChatSession[]> {
  const db = await Database.load(DB_URL);
  const rows = await db.select<Array<{
    id: string; instance_id: string; title: string;
    created_at: number; updated_at: number; msg_count: number;
  }>>(
    `SELECT s.id, s.instance_id, s.title, s.created_at, s.updated_at,
            COUNT(m.id) as msg_count
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id
     GROUP BY s.id
     ORDER BY s.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, instanceId: r.instance_id, title: r.title,
    createdAt: r.created_at, updatedAt: r.updated_at,
    messageCount: r.msg_count,
  }));
}

export async function searchSessions(query: string, limit = 40): Promise<ChatSession[]> {
  if (!query.trim()) return listSessions(limit);
  const db = await Database.load(DB_URL);
  // Escape LIKE metacharacters to prevent wildcard injection.
  const q = `%${escapeLike(query.trim())}%`;
  const rows = await db.select<Array<{
    id: string; instance_id: string; title: string;
    created_at: number; updated_at: number;
  }>>(
    `SELECT DISTINCT s.id, s.instance_id, s.title, s.created_at, s.updated_at
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id
     WHERE s.title LIKE $1 ESCAPE '\\' OR m.content LIKE $1 ESCAPE '\\'
     ORDER BY s.updated_at DESC
     LIMIT $2`,
    [q, limit],
  );
  return rows.map((r) => ({
    id: r.id, instanceId: r.instance_id, title: r.title,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await Database.load(DB_URL);
  // SQLite's ON DELETE CASCADE requires PRAGMA foreign_keys = ON, which is not
  // guaranteed by tauri-plugin-sql. Explicitly delete child rows in a transaction
  // so messages are never left as orphans regardless of FK settings.
  await db.execute("BEGIN");
  try {
    await db.execute(`DELETE FROM chat_messages WHERE session_id = $1`, [sessionId]);
    await db.execute(`DELETE FROM chat_sessions  WHERE id         = $1`, [sessionId]);
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const db = await Database.load(DB_URL);
  await db.execute(
    `UPDATE chat_sessions SET title = $1 WHERE id = $2`,
    [title.slice(0, 60), sessionId],
  );
}

// ── Message CRUD ───────────────────────────────────────────────────────────

export async function addMessage(
  sessionId: string, role: "user" | "assistant", content: string,
): Promise<string> {
  const db  = await Database.load(DB_URL);
  const id  = crypto.randomUUID();
  const now = Date.now();
  // Both writes must succeed atomically: if the UPDATE fails the INSERT should
  // also be rolled back, otherwise the session sinks to the bottom of the list.
  await db.execute("BEGIN");
  try {
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, sessionId, role, content, now],
    );
    // Bump session timestamp so it floats to the top of the list.
    await db.execute(
      `UPDATE chat_sessions SET updated_at = $1 WHERE id = $2`,
      [now, sessionId],
    );
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
  return id;
}

export async function loadMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = await Database.load(DB_URL);
  const rows = await db.select<Array<{
    id: string; session_id: string; role: string; content: string; created_at: number;
  }>>(
    `SELECT id, session_id, role, content, created_at
     FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id,
    role: r.role as "user" | "assistant",
    content: r.content, createdAt: r.created_at,
  }));
}
