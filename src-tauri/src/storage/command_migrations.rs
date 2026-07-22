//! Command-domain SQLite schema.
//!
//! @author kongweiguang

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Current command SQLite schema version.
pub const CURRENT_COMMAND_SCHEMA_VERSION: u32 = 3;

/// Applies the fresh command-domain schema.
///
/// This database intentionally ignores old app-wide Kerminal tables. File-first
/// storage does not read previous all-purpose SQLite data.
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let version = schema_version(conn)?;
    if version > CURRENT_COMMAND_SCHEMA_VERSION {
        return Err(AppError::UnsupportedSchemaVersion {
            database_version: version,
            supported_version: CURRENT_COMMAND_SCHEMA_VERSION,
        });
    }

    if version < 1 {
        migrate_to_v1(conn)?;
    }
    if version < 2 {
        migrate_to_v2(conn)?;
    }
    if version < 3 {
        migrate_to_v3(conn)?;
    }

    Ok(())
}

/// Reads SQLite `PRAGMA user_version`.
pub fn schema_version(conn: &Connection) -> AppResult<u32> {
    Ok(conn.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

fn migrate_to_v1(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(COMMAND_SCHEMA)?;
    tx.pragma_update(None, "user_version", 1)?;
    tx.commit()?;
    Ok(())
}

/// 扩展命令建议 provider 约束，并保留 v1 中的诊断、反馈和缓存数据。
fn migrate_to_v2(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(COMMAND_SUGGESTION_PROVIDER_V2_MIGRATION)?;
    tx.pragma_update(None, "user_version", 2)?;
    tx.commit()?;
    Ok(())
}

/// 新增片段收藏与使用统计；表中禁止保存命令正文、变量或目标信息。
fn migrate_to_v3(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(SNIPPET_PREFERENCES_V3_MIGRATION)?;
    tx.pragma_update(None, "user_version", 3)?;
    tx.commit()?;
    Ok(())
}

const COMMAND_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS command_history (
    id             TEXT PRIMARY KEY NOT NULL,
    command        TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'user'
        CHECK (source IN ('user', 'snippet', 'workflow', 'broadcast', 'tool')),
    target         TEXT NOT NULL DEFAULT 'local'
        CHECK (target IN ('local', 'ssh', 'telnet', 'serial', 'dockerContainer')),
    session_id     TEXT,
    pane_id        TEXT,
    tab_id         TEXT,
    profile_id     TEXT,
    remote_host_id TEXT,
    cwd            TEXT,
    shell          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_command_history_created_at
    ON command_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_target_created_at
    ON command_history(target, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_remote_host
    ON command_history(remote_host_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_session
    ON command_history(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_target_command_created
    ON command_history(target, command, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_target_host_command_created
    ON command_history(target, remote_host_id, command, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_target_recent
    ON command_history(target, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_history_target_host_recent
    ON command_history(target, remote_host_id, created_at DESC);

CREATE TABLE IF NOT EXISTS command_suggestion_provider_cache (
    provider           TEXT NOT NULL
        CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git')),
    host_id            TEXT NOT NULL,
    scope_key          TEXT NOT NULL,
    repo_root          TEXT,
    payload_json       TEXT NOT NULL,
    cached_at_unix_ms  INTEGER NOT NULL,
    expires_at_unix_ms INTEGER NOT NULL,
    ttl_seconds        INTEGER NOT NULL CHECK (ttl_seconds >= 1),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, host_id, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_expires
    ON command_suggestion_provider_cache(provider, expires_at_unix_ms);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_host
    ON command_suggestion_provider_cache(host_id, provider);

CREATE TABLE IF NOT EXISTS command_suggestion_feedback (
    id                 TEXT PRIMARY KEY NOT NULL,
    action             TEXT NOT NULL CHECK (action IN ('accepted', 'dismissed')),
    provider           TEXT NOT NULL
        CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec')),
    target             TEXT NOT NULL DEFAULT 'local'
        CHECK (target IN ('local', 'ssh', 'telnet', 'serial', 'dockerContainer')),
    replacement_text   TEXT NOT NULL,
    input              TEXT NOT NULL,
    source_id          TEXT,
    session_id         TEXT,
    pane_id            TEXT,
    profile_id         TEXT,
    remote_host_id     TEXT,
    cwd                TEXT,
    shell              TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_feedback_replacement
    ON command_suggestion_feedback(provider, replacement_text, created_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_feedback_remote_host
    ON command_suggestion_feedback(remote_host_id, provider, created_at_unix_ms DESC);

CREATE TABLE IF NOT EXISTS command_suggestion_telemetry (
    provider                 TEXT PRIMARY KEY NOT NULL
        CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec')),
    query_count              INTEGER NOT NULL DEFAULT 0 CHECK (query_count >= 0),
    candidate_count          INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    total_elapsed_ms         INTEGER NOT NULL DEFAULT 0 CHECK (total_elapsed_ms >= 0),
    cache_hit_count          INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit_count >= 0),
    cache_miss_count         INTEGER NOT NULL DEFAULT 0 CHECK (cache_miss_count >= 0),
    refresh_success_count    INTEGER NOT NULL DEFAULT 0 CHECK (refresh_success_count >= 0),
    refresh_failure_count    INTEGER NOT NULL DEFAULT 0 CHECK (refresh_failure_count >= 0),
    feedback_accepted_count  INTEGER NOT NULL DEFAULT 0 CHECK (feedback_accepted_count >= 0),
    feedback_dismissed_count INTEGER NOT NULL DEFAULT 0 CHECK (feedback_dismissed_count >= 0),
    feedback_skipped_count   INTEGER NOT NULL DEFAULT 0 CHECK (feedback_skipped_count >= 0),
    first_event_unix_ms      INTEGER NOT NULL,
    last_event_unix_ms       INTEGER NOT NULL,
    last_error               TEXT,
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_telemetry_last_event
    ON command_suggestion_telemetry(last_event_unix_ms DESC);

CREATE TABLE IF NOT EXISTS command_suggestion_audit_events (
    id                 TEXT PRIMARY KEY NOT NULL,
    event_kind         TEXT NOT NULL
        CHECK (event_kind IN ('remoteProbeSchedule', 'remoteProbeRefresh', 'feedback')),
    provider           TEXT CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec')),
    target             TEXT NOT NULL DEFAULT 'local'
        CHECK (target IN ('local', 'ssh', 'telnet', 'serial', 'dockerContainer')),
    decision           TEXT NOT NULL
        CHECK (decision IN ('allowed', 'skipped', 'succeeded', 'failed', 'recorded')),
    reason             TEXT,
    remote_host_id     TEXT,
    cwd                TEXT,
    path               TEXT,
    pane_id            TEXT,
    session_id         TEXT,
    metadata_json      TEXT NOT NULL DEFAULT '{}',
    created_at_unix_ms INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_created
    ON command_suggestion_audit_events(created_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_remote_host
    ON command_suggestion_audit_events(remote_host_id, created_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_kind_provider
    ON command_suggestion_audit_events(event_kind, provider, created_at_unix_ms DESC);
"#;

const COMMAND_SUGGESTION_PROVIDER_V2_MIGRATION: &str = r#"
CREATE TABLE command_suggestion_provider_cache_v2 (
    provider TEXT NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'snippet')),
    host_id TEXT NOT NULL, scope_key TEXT NOT NULL, repo_root TEXT, payload_json TEXT NOT NULL,
    cached_at_unix_ms INTEGER NOT NULL, expires_at_unix_ms INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds >= 1),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (provider, host_id, scope_key)
);
INSERT INTO command_suggestion_provider_cache_v2 SELECT * FROM command_suggestion_provider_cache;
DROP TABLE command_suggestion_provider_cache;
ALTER TABLE command_suggestion_provider_cache_v2 RENAME TO command_suggestion_provider_cache;
CREATE INDEX idx_command_suggestion_provider_cache_expires ON command_suggestion_provider_cache(provider, expires_at_unix_ms);
CREATE INDEX idx_command_suggestion_provider_cache_host ON command_suggestion_provider_cache(host_id, provider);

CREATE TABLE command_suggestion_feedback_v2 (
    id TEXT PRIMARY KEY NOT NULL, action TEXT NOT NULL CHECK (action IN ('accepted', 'dismissed')),
    provider TEXT NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'snippet')),
    target TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh', 'telnet', 'serial', 'dockerContainer')),
    replacement_text TEXT NOT NULL, input TEXT NOT NULL, source_id TEXT, session_id TEXT, pane_id TEXT,
    profile_id TEXT, remote_host_id TEXT, cwd TEXT, shell TEXT, created_at_unix_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO command_suggestion_feedback_v2 SELECT * FROM command_suggestion_feedback;
DROP TABLE command_suggestion_feedback;
ALTER TABLE command_suggestion_feedback_v2 RENAME TO command_suggestion_feedback;
CREATE INDEX idx_command_suggestion_feedback_replacement ON command_suggestion_feedback(provider, replacement_text, created_at_unix_ms DESC);
CREATE INDEX idx_command_suggestion_feedback_remote_host ON command_suggestion_feedback(remote_host_id, provider, created_at_unix_ms DESC);

CREATE TABLE command_suggestion_telemetry_v2 (
    provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'snippet')),
    query_count INTEGER NOT NULL DEFAULT 0 CHECK (query_count >= 0), candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    total_elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_elapsed_ms >= 0), cache_hit_count INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit_count >= 0),
    cache_miss_count INTEGER NOT NULL DEFAULT 0 CHECK (cache_miss_count >= 0), refresh_success_count INTEGER NOT NULL DEFAULT 0 CHECK (refresh_success_count >= 0),
    refresh_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (refresh_failure_count >= 0), feedback_accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (feedback_accepted_count >= 0),
    feedback_dismissed_count INTEGER NOT NULL DEFAULT 0 CHECK (feedback_dismissed_count >= 0), feedback_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (feedback_skipped_count >= 0),
    first_event_unix_ms INTEGER NOT NULL, last_event_unix_ms INTEGER NOT NULL, last_error TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO command_suggestion_telemetry_v2 SELECT * FROM command_suggestion_telemetry;
DROP TABLE command_suggestion_telemetry;
ALTER TABLE command_suggestion_telemetry_v2 RENAME TO command_suggestion_telemetry;
CREATE INDEX idx_command_suggestion_telemetry_last_event ON command_suggestion_telemetry(last_event_unix_ms DESC);

CREATE TABLE command_suggestion_audit_events_v2 (
    id TEXT PRIMARY KEY NOT NULL, event_kind TEXT NOT NULL CHECK (event_kind IN ('remoteProbeSchedule', 'remoteProbeRefresh', 'feedback')),
    provider TEXT CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'snippet')),
    target TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh', 'telnet', 'serial', 'dockerContainer')),
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'skipped', 'succeeded', 'failed', 'recorded')),
    reason TEXT, remote_host_id TEXT, cwd TEXT, path TEXT, pane_id TEXT, session_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at_unix_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO command_suggestion_audit_events_v2 SELECT * FROM command_suggestion_audit_events;
DROP TABLE command_suggestion_audit_events;
ALTER TABLE command_suggestion_audit_events_v2 RENAME TO command_suggestion_audit_events;
CREATE INDEX idx_command_suggestion_audit_created ON command_suggestion_audit_events(created_at_unix_ms DESC);
CREATE INDEX idx_command_suggestion_audit_remote_host ON command_suggestion_audit_events(remote_host_id, created_at_unix_ms DESC);
CREATE INDEX idx_command_suggestion_audit_kind_provider ON command_suggestion_audit_events(event_kind, provider, created_at_unix_ms DESC);
"#;

const SNIPPET_PREFERENCES_V3_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS snippet_preferences (
    origin TEXT NOT NULL CHECK (origin IN ('user', 'builtin')),
    snippet_id TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    last_action TEXT CHECK (last_action IN ('insert', 'run', 'copyRendered')),
    last_used_at_unix_ms INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (origin, snippet_id)
);
CREATE INDEX IF NOT EXISTS idx_snippet_preferences_recent
    ON snippet_preferences(last_used_at_unix_ms DESC);
CREATE INDEX IF NOT EXISTS idx_snippet_preferences_favorite
    ON snippet_preferences(favorite DESC, origin, snippet_id);

CREATE TABLE IF NOT EXISTS snippet_usage_receipts (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('user', 'builtin')),
    snippet_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('insert', 'run', 'copyRendered')),
    created_at_unix_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snippet_usage_receipts_created
    ON snippet_usage_receipts(created_at_unix_ms DESC);
"#;
