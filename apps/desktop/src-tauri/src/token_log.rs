/// SQLite schema migrations for all ClawNo.11 tables.
/// Covers: token_records, security_events, rag_documents/chunks, mcp_servers/audit, chat_sessions/messages.
/// All runtime DB queries execute on the frontend via @tauri-apps/plugin-sql;
/// this module is only invoked at app startup to apply pending migrations.

use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:clawno.db";

/// Return the migrations that create/update all ClawNo.11 tables.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_token_records",
            sql: r#"
                CREATE TABLE IF NOT EXISTS token_records (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    instance_id       TEXT    NOT NULL DEFAULT '',
                    provider          TEXT    NOT NULL DEFAULT '',
                    model             TEXT    NOT NULL DEFAULT '',
                    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens      INTEGER NOT NULL DEFAULT 0,
                    created_at        INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_token_created
                    ON token_records (created_at);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_security_events",
            sql: r#"
                CREATE TABLE IF NOT EXISTS security_events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type  TEXT    NOT NULL,
                    detail      TEXT    NOT NULL DEFAULT '',
                    severity    TEXT    NOT NULL DEFAULT 'info',
                    created_at  INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_security_events_created
                    ON security_events (created_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
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
        Migration {
            version: 6,
            description: "mcp_servers_factors_and_uniqueness",
            sql: r#"
                -- Persist scan risk factors so they survive app restarts.
                ALTER TABLE mcp_servers ADD COLUMN factors TEXT NOT NULL DEFAULT '';

                -- Prevent duplicate server registrations (same name + endpoint).
                CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_unique
                    ON mcp_servers (name, endpoint);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "mcp_servers_description",
            sql: r#"
                -- User-provided plain-text description of what this MCP server does,
                -- shown in the UI to help users recall purpose at a glance.
                ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT '';
            "#,
            kind: MigrationKind::Up,
        },
    ]
}
