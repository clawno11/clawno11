/**
 * SQLite schema migration for ClawNo.11 mobile database.
 *
 * The schema is identical to desktop so that users can (in future) sync
 * or export their data between platforms without conversion.
 *
 * Called once at startup from lib.rs to ensure all tables exist.
 */
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        // v1: Token usage records
        Migration {
            version: 1,
            description: "create token_records",
            sql: "
                CREATE TABLE IF NOT EXISTS token_records (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    instance_id      TEXT    NOT NULL DEFAULT '',
                    provider         TEXT    NOT NULL DEFAULT '',
                    model            TEXT    NOT NULL DEFAULT '',
                    prompt_tokens    INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens     INTEGER NOT NULL DEFAULT 0,
                    created_at       INTEGER NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        // v2: Security event log
        Migration {
            version: 2,
            description: "create security_events",
            sql: "
                CREATE TABLE IF NOT EXISTS security_events (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT    NOT NULL,
                    detail     TEXT    NOT NULL DEFAULT '',
                    severity   TEXT    NOT NULL DEFAULT 'info',
                    created_at INTEGER NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        // v3: RAG knowledge base
        Migration {
            version: 3,
            description: "create rag tables",
            sql: "
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id          TEXT    PRIMARY KEY,
                    name        TEXT    NOT NULL,
                    path        TEXT,
                    mime        TEXT    NOT NULL DEFAULT 'text/plain',
                    char_count  INTEGER NOT NULL DEFAULT 0,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    created_at  INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    id          TEXT    PRIMARY KEY,
                    doc_id      TEXT    NOT NULL REFERENCES rag_documents(id),
                    chunk_index INTEGER NOT NULL,
                    content     TEXT    NOT NULL,
                    created_at  INTEGER NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        // v4: MCP server registry + audit log
        Migration {
            version: 4,
            description: "create mcp tables",
            sql: "
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id           TEXT    PRIMARY KEY,
                    name         TEXT    NOT NULL,
                    endpoint     TEXT    NOT NULL,
                    transport    TEXT    NOT NULL DEFAULT 'http',
                    enabled      INTEGER NOT NULL DEFAULT 1,
                    risk_level   TEXT    NOT NULL DEFAULT 'unknown',
                    factors      TEXT    NOT NULL DEFAULT '[]',
                    last_scanned INTEGER,
                    created_at   INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mcp_audit (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_id   TEXT    NOT NULL,
                    server_name TEXT    NOT NULL DEFAULT '',
                    tool_name   TEXT    NOT NULL,
                    args_preview TEXT   NOT NULL DEFAULT '',
                    outcome     TEXT    NOT NULL DEFAULT 'allowed',
                    created_at  INTEGER NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        // v5: Chat history
        Migration {
            version: 5,
            description: "create chat tables",
            sql: "
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id          TEXT    PRIMARY KEY,
                    instance_id TEXT    NOT NULL DEFAULT '',
                    title       TEXT    NOT NULL,
                    created_at  INTEGER NOT NULL,
                    updated_at  INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id         TEXT    PRIMARY KEY,
                    session_id TEXT    NOT NULL REFERENCES chat_sessions(id),
                    role       TEXT    NOT NULL,
                    content    TEXT    NOT NULL,
                    created_at INTEGER NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
    ]
}
