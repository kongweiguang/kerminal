//! Kerminal data directory and fresh storage schema integration tests.
//!
//! @author kongweiguang

use std::{
    collections::BTreeSet,
    ffi::{OsStr, OsString},
    sync::{Arc, Mutex, OnceLock},
};

use kerminal_lib::{
    error::AppError,
    paths::{
        expand_home_relative_path, KerminalPaths, COMMAND_DATABASE_FILE_NAME,
        KERMINAL_CONFIG_ROOT_ENV, KERMINAL_DIR_NAME,
    },
    state::{AppState, AppStateBuildObserver, AppStateBuildPhase, AppStateBuilder},
    storage::{
        command_migrations::{self, CURRENT_COMMAND_SCHEMA_VERSION},
        local_file_operations::LocalFileOperationAuditWrite,
    },
};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn resolves_kerminal_paths_under_home_directory() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    assert_eq!(paths.root, home.path().join(KERMINAL_DIR_NAME));
    assert_eq!(
        paths.command_database_file,
        paths.root.join("data").join(COMMAND_DATABASE_FILE_NAME)
    );
    assert_eq!(paths.data, paths.root.join("data"));
    assert_eq!(paths.logs, paths.root.join("logs"));
    assert_eq!(paths.cache, paths.root.join("cache"));
    assert_eq!(paths.themes, paths.root.join("themes"));
    assert_eq!(paths.snippets, paths.root.join("snippets"));
    assert_eq!(paths.exports, paths.root.join("exports"));
    assert_eq!(paths.temp, paths.root.join("temp"));
    assert_eq!(paths.diagnostics, paths.root.join("diagnostics"));
}

#[test]
fn app_state_builder_initializes_explicit_paths() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppStateBuilder::with_paths(paths.clone())
        .build()
        .expect("build app state");

    assert_eq!(state.paths(), &paths);
    assert!(paths.command_database_file.exists());
}

#[test]
fn app_state_builder_stops_after_an_injected_configuration_failure() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let observer = Arc::new(FailingBuildObserver::new(AppStateBuildPhase::Configuration));

    let error = AppStateBuilder::with_paths(paths.clone())
        .with_build_observer(observer.clone())
        .build()
        .expect_err("configuration observer should stop initialization");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message == "injected build failure")
    );
    assert_eq!(
        observer.seen(),
        vec![
            AppStateBuildPhase::Operations,
            AppStateBuildPhase::Configuration
        ]
    );
    assert!(paths.command_database_file.is_file());
    assert!(
        !paths.root.join("settings.toml").exists(),
        "configuration seed must not run after its phase was rejected"
    );
}

#[test]
fn ensure_directories_creates_managed_directory_tree() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    paths.ensure_directories().expect("create managed dirs");

    for directory in paths.managed_directories() {
        assert!(
            directory.is_dir(),
            "expected managed directory to exist: {}",
            directory.display()
        );
    }
}

#[test]
fn app_state_initialize_uses_explicit_config_root_environment_override() {
    let _guard = env_lock().lock().expect("lock env mutation");
    let parent = tempdir().expect("create temp parent");
    let root = parent.path().join("isolated-kerminal");
    let _env = ScopedEnvVar::set(KERMINAL_CONFIG_ROOT_ENV, &root);

    let state = AppState::initialize().expect("initialize app state from env config root");

    assert_eq!(state.paths().root, root);
    assert_eq!(
        state.command_store().database_file(),
        state.paths().command_database_file.as_path()
    );
    assert!(state.paths().command_database_file.is_file());
    for directory in state.paths().managed_directories() {
        assert!(
            directory.is_dir(),
            "managed directory: {}",
            directory.display()
        );
    }
    assert!(
        state.paths().root.join("settings.toml").is_file(),
        "seed settings should stay under the isolated config root"
    );
}

#[test]
fn expands_current_user_home_relative_paths() {
    let home = dirs::home_dir().expect("current user home");

    assert_eq!(expand_home_relative_path("~").unwrap(), home);
    assert_eq!(
        expand_home_relative_path("~/.kerminal").unwrap(),
        home.join(".kerminal")
    );
    assert_eq!(
        expand_home_relative_path("~\\.ssh\\id_ed25519").unwrap(),
        home.join(".ssh").join("id_ed25519")
    );
}

#[test]
fn leaves_non_current_user_home_notation_unchanged() {
    assert_eq!(
        expand_home_relative_path("~other/.ssh/id_ed25519").unwrap(),
        std::path::PathBuf::from("~other/.ssh/id_ed25519")
    );
}

#[test]
fn app_state_initialization_creates_command_database_without_legacy_runtime_db() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");

    assert_eq!(state.paths(), &paths);
    assert_eq!(
        state.command_store().database_file(),
        paths.command_database_file.as_path()
    );
    assert!(paths.command_database_file.is_file());
    assert_eq!(
        state
            .command_store()
            .schema_version()
            .expect("read command schema version"),
        CURRENT_COMMAND_SCHEMA_VERSION
    );
    assert!(!paths.root.join("kerminal.db").exists());
    assert!(!paths.data.join("runtime.sqlite").exists());
}

#[test]
fn command_sqlite_creates_only_command_domain_tables() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let _state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");

    let conn = Connection::open(paths.command_database_file).expect("open command database");
    let tables = user_tables(&conn);

    assert_eq!(
        tables,
        BTreeSet::from([
            "command_history".to_owned(),
            "command_suggestion_audit_events".to_owned(),
            "command_suggestion_feedback".to_owned(),
            "command_suggestion_provider_cache".to_owned(),
            "command_suggestion_telemetry".to_owned(),
            "snippet_preferences".to_owned(),
            "snippet_usage_receipts".to_owned(),
        ])
    );
}

#[test]
fn local_file_operation_audit_records_delete_success() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");

    let audit = state
        .storage()
        .insert_local_file_operation_audit(&LocalFileOperationAuditWrite {
            confirmation_matched: true,
            error: None,
            kind: "file".to_owned(),
            operation: "delete".to_owned(),
            parent_path: Some("C:\\Users\\24052".to_owned()),
            path: "C:\\Users\\24052\\notes.md".to_owned(),
            recursive: false,
            root_path: Some("C:\\Users\\24052".to_owned()),
            status: "succeeded".to_owned(),
        })
        .expect("insert local file audit");

    let records = state
        .storage()
        .list_local_file_operation_audits(10)
        .expect("list local file audits");
    let audit_dir = paths.root.join("logs").join("local-file-operations");
    let audit_files = std::fs::read_dir(&audit_dir)
        .expect("read local file audit directory")
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "jsonl")
        })
        .count();

    assert_eq!(audit_files, 1);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0], audit);
    assert_eq!(records[0].operation, "delete");
    assert_eq!(records[0].status, "succeeded");
    assert_eq!(records[0].path, "C:\\Users\\24052\\notes.md");
    assert_eq!(records[0].root_path.as_deref(), Some("C:\\Users\\24052"));
}

#[test]
fn command_database_rejects_future_schema_version() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("create managed dirs");

    let conn = Connection::open(&paths.command_database_file).expect("create future command db");
    conn.pragma_update(None, "user_version", CURRENT_COMMAND_SCHEMA_VERSION + 1)
        .expect("set future command schema version");
    drop(conn);

    let error = AppState::initialize_with_paths(paths).expect_err("reject future command schema");

    assert!(matches!(
        error,
        AppError::UnsupportedSchemaVersion {
            database_version,
            supported_version
        } if database_version == CURRENT_COMMAND_SCHEMA_VERSION + 1
            && supported_version == CURRENT_COMMAND_SCHEMA_VERSION
    ));
}

#[test]
fn command_schema_upgrade_preserves_v1_rows_and_accepts_snippet_provider() {
    let mut conn = Connection::open_in_memory().expect("open command database");
    command_migrations::migrate(&mut conn).expect("create current schema");
    conn.execute(
        "INSERT INTO command_suggestion_feedback (id, action, provider, replacement_text, input, created_at_unix_ms) VALUES ('old', 'accepted', 'history', 'pwd', 'pw', 1)",
        [],
    )
    .expect("seed existing feedback");
    conn.pragma_update(None, "user_version", 1)
        .expect("simulate v1 database");

    command_migrations::migrate(&mut conn).expect("migrate v1 database");

    let preserved: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_feedback WHERE id = 'old'",
            [],
            |row| row.get(0),
        )
        .expect("read preserved feedback");
    assert_eq!(preserved, 1);
    assert_eq!(
        command_migrations::schema_version(&conn).expect("read migrated version"),
        CURRENT_COMMAND_SCHEMA_VERSION
    );

    conn.execute(
        "INSERT INTO command_suggestion_provider_cache (provider, host_id, scope_key, payload_json, cached_at_unix_ms, expires_at_unix_ms, ttl_seconds) VALUES ('snippet', 'local', 'catalog', '[]', 1, 2, 1)",
        [],
    )
    .expect("insert snippet cache");
    conn.execute(
        "INSERT INTO command_suggestion_feedback (id, action, provider, replacement_text, input, created_at_unix_ms) VALUES ('snippet-feedback', 'accepted', 'snippet', 'systemctl status nginx', 'system', 2)",
        [],
    )
    .expect("insert snippet feedback");
    conn.execute(
        "INSERT INTO command_suggestion_telemetry (provider, first_event_unix_ms, last_event_unix_ms) VALUES ('snippet', 1, 2)",
        [],
    )
    .expect("insert snippet telemetry");
    conn.execute(
        "INSERT INTO command_suggestion_audit_events (id, event_kind, provider, decision, created_at_unix_ms) VALUES ('snippet-audit', 'feedback', 'snippet', 'recorded', 2)",
        [],
    )
    .expect("insert snippet audit");
}

#[test]
fn initialization_fails_when_root_path_is_an_existing_file() {
    let file = tempfile::NamedTempFile::new().expect("create temp file");
    let paths = KerminalPaths::from_root(file.path());
    let error = AppState::initialize_with_paths(paths).expect_err("reject file as root dir");

    assert!(matches!(error, AppError::Io(_)));
}

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct ScopedEnvVar {
    key: &'static str,
    previous: Option<OsString>,
}

#[derive(Debug)]
struct FailingBuildObserver {
    fail_at: AppStateBuildPhase,
    seen: Mutex<Vec<AppStateBuildPhase>>,
}

impl FailingBuildObserver {
    fn new(fail_at: AppStateBuildPhase) -> Self {
        Self {
            fail_at,
            seen: Mutex::new(Vec::new()),
        }
    }

    fn seen(&self) -> Vec<AppStateBuildPhase> {
        self.seen.lock().expect("read observed phases").clone()
    }
}

impl AppStateBuildObserver for FailingBuildObserver {
    fn before_phase(&self, phase: AppStateBuildPhase) -> Result<(), AppError> {
        self.seen.lock().expect("record observed phase").push(phase);
        if phase == self.fail_at {
            return Err(AppError::InvalidInput("injected build failure".to_owned()));
        }
        Ok(())
    }
}

impl ScopedEnvVar {
    fn set(key: &'static str, value: impl AsRef<OsStr>) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn user_tables(conn: &Connection) -> BTreeSet<String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            ",
        )
        .expect("prepare table query");
    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect("query tables")
        .collect::<Result<BTreeSet<_>, _>>()
        .expect("collect table names")
}
