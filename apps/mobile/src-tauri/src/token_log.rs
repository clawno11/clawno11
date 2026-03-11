/**
 * SQLite schema migration for ClawNo.11 mobile database.
 *
 * The schema is identical to desktop so that users can (in future) sync
 * or export their data between platforms without conversion.
 *
 * Called once at startup from lib.rs to ensure all tables exist.
 */
use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:clawno.db";

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
            description: "create_rag_knowledge_base",
            sql: r#"
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
                    doc_id      TEXT    NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL,
                    content     TEXT    NOT NULL,
                    created_at  INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id
                    ON rag_chunks (doc_id);
            "#,
            kind: MigrationKind::Up,
        },
        // v4: MCP server registry + audit log
        Migration {
            version: 4,
            description: "create_mcp_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id           TEXT    PRIMARY KEY,
                    name         TEXT    NOT NULL,
                    endpoint     TEXT    NOT NULL,
                    transport    TEXT    NOT NULL DEFAULT 'http',
                    enabled      INTEGER NOT NULL DEFAULT 1,
                    risk_level   TEXT    NOT NULL DEFAULT 'unknown',
                    last_scanned INTEGER,
                    created_at   INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS mcp_audit (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_id    TEXT    NOT NULL DEFAULT '',
                    server_name  TEXT    NOT NULL DEFAULT '',
                    tool_name    TEXT    NOT NULL,
                    args_preview TEXT    NOT NULL DEFAULT '',
                    outcome      TEXT    NOT NULL DEFAULT 'allowed',
                    created_at   INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_mcp_audit_created
                    ON mcp_audit (created_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
        // v5: Chat history
        Migration {
            version: 5,
            description: "create_chat_history",
            sql: r#"
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id          TEXT    PRIMARY KEY,
                    instance_id TEXT    NOT NULL DEFAULT '',
                    title       TEXT    NOT NULL DEFAULT '',
                    created_at  INTEGER NOT NULL,
                    updated_at  INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id         TEXT    PRIMARY KEY,
                    session_id TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role       TEXT    NOT NULL,
                    content    TEXT    NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_chat_messages_session
                    ON chat_messages (session_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated
                    ON chat_sessions (updated_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
        // v6: MCP factors + unique index
        Migration {
            version: 6,
            description: "mcp_servers_factors_and_uniqueness",
            sql: r#"
                ALTER TABLE mcp_servers ADD COLUMN factors TEXT NOT NULL DEFAULT '';

                CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_unique
                    ON mcp_servers (name, endpoint);
            "#,
            kind: MigrationKind::Up,
        },
        // v7: MCP description column
        Migration {
            version: 7,
            description: "mcp_servers_description",
            sql: r#"
                ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT '';
            "#,
            kind: MigrationKind::Up,
        },
    ]
}
