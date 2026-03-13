pub const DB_URL: &str = "sqlite:clawno.db";

pub struct MigrationDef {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

pub fn migrations() -> Vec<MigrationDef> {
    vec![
        MigrationDef {
            version: 1,
            description: "create_token_records",
            sql: concat!(
                "CREATE TABLE IF NOT EXISTS token_records (",
                "  id                INTEGER PRIMARY KEY AUTOINCREMENT,",
                "  instance_id       TEXT    NOT NULL DEFAULT '',",
                "  provider          TEXT    NOT NULL DEFAULT '',",
                "  model             TEXT    NOT NULL DEFAULT '',",
                "  prompt_tokens     INTEGER NOT NULL DEFAULT 0,",
                "  completion_tokens INTEGER NOT NULL DEFAULT 0,",
                "  total_tokens      INTEGER NOT NULL DEFAULT 0,",
                "  created_at        INTEGER NOT NULL",
                ");",
            ),
        },
        MigrationDef {
            version: 2,
            description: "create_security_events",
            sql: concat!(
                "CREATE TABLE IF NOT EXISTS security_events (",
                "  id          INTEGER PRIMARY KEY AUTOINCREMENT,",
                "  event_type  TEXT    NOT NULL,",
                "  detail      TEXT    NOT NULL DEFAULT '',",
                "  severity    TEXT    NOT NULL DEFAULT 'info',",
                "  created_at  INTEGER NOT NULL",
                ");",
            ),
        },
        MigrationDef {
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
        },
        MigrationDef {
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
        },
        MigrationDef {
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
        },
        MigrationDef {
            version: 6,
            description: "mcp_servers_factors_and_uniqueness",
            sql: r#"
                ALTER TABLE mcp_servers ADD COLUMN factors TEXT NOT NULL DEFAULT '';
                CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_unique
                    ON mcp_servers (name, endpoint);
            "#,
        },
        MigrationDef {
            version: 7,
            description: "mcp_servers_description",
            sql: "ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT '';",
        },
        MigrationDef {
            version: 8,
            description: "create_evolution_patches",
            sql: concat!(
                "CREATE TABLE IF NOT EXISTS evolution_patches (",
                "  id              TEXT    PRIMARY KEY,",
                "  bug_signature   TEXT    NOT NULL,",
                "  source          TEXT    NOT NULL,",
                "  platform        TEXT,",
                "  openclaw_ver    TEXT,",
                "  diagnosis       TEXT,",
                "  remedy_type     TEXT    NOT NULL,",
                "  remedy_payload  TEXT    NOT NULL,",
                "  success_count   INTEGER DEFAULT 0,",
                "  attempt_count   INTEGER DEFAULT 0,",
                "  created_at      INTEGER NOT NULL,",
                "  last_used_at    INTEGER,",
                "  status          TEXT    NOT NULL DEFAULT 'active',",
                "  min_version     TEXT,",
                "  max_version     TEXT,",
                "  superseded_by   TEXT,",
                "  trust_level     TEXT    NOT NULL DEFAULT 'local',",
                "  author_fingerprint TEXT",
                ");",
                "CREATE INDEX IF NOT EXISTS idx_evo_sig ON evolution_patches(bug_signature);",
                "CREATE INDEX IF NOT EXISTS idx_evo_status ON evolution_patches(status);"
            ),
        },
    ]
}

/// Returns all migrations, optionally including desktop-only indexes.
pub fn all_migrations(include_desktop_indexes: bool) -> Vec<MigrationDef> {
    let mut out = migrations();
    if include_desktop_indexes {
        out.extend(desktop_extra_indexes());
    }
    out
}

// ── Tauri migration adapter macro ────────────────────────────────────────────

/// Generate the `DB_URL` constant and `migrations()` function that converts
/// `clawno_core::token_log::MigrationDef` into `tauri_plugin_sql::Migration`.
///
/// ```ignore
/// clawno_core::define_token_log_migrations!(include_desktop_indexes: true);
/// ```
#[macro_export]
macro_rules! define_token_log_migrations {
    (include_desktop_indexes: $desktop:expr) => {
        pub const DB_URL: &str = clawno_core::token_log::DB_URL;

        pub fn migrations() -> Vec<tauri_plugin_sql::Migration> {
            clawno_core::token_log::all_migrations($desktop)
                .into_iter()
                .map(|m| tauri_plugin_sql::Migration {
                    version: m.version,
                    description: m.description,
                    sql: m.sql,
                    kind: tauri_plugin_sql::MigrationKind::Up,
                })
                .collect()
        }
    };
}

/// Desktop-only indexes for performance on larger datasets.
pub fn desktop_extra_indexes() -> Vec<MigrationDef> {
    vec![
        MigrationDef {
            version: 100,
            description: "desktop_token_records_index",
            sql: "CREATE INDEX IF NOT EXISTS idx_token_created ON token_records (created_at);",
        },
        MigrationDef {
            version: 101,
            description: "desktop_security_events_index",
            sql: "CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC);",
        },
    ]
}
