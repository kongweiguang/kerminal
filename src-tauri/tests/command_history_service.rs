//! 命令历史服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::command_history::{
        CommandHistoryClearRequest, CommandHistoryListRequest, CommandHistoryRecordRequest,
        CommandHistorySource, CommandHistoryTarget,
    },
    paths::KerminalPaths,
    state::AppState,
};
use rusqlite::{params_from_iter, types::Value, Connection};
use tempfile::{tempdir, TempDir};

#[test]
fn record_history_persists_command_context() {
    let (_home, state) = test_state();

    let result = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: " git status --short\r ".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                tab_id: Some("tab-1".to_owned()),
                profile_id: Some("profile-1".to_owned()),
                remote_host_id: None,
                cwd: Some("C:/dev/rust/kerminal".to_owned()),
                shell: Some("pwsh.exe".to_owned()),
            },
        )
        .expect("record command");

    assert!(result.recorded);
    let entry = result.entry.expect("history entry");
    assert_eq!(entry.command, "git status --short");
    assert_eq!(entry.source, CommandHistorySource::User);
    assert_eq!(entry.target, CommandHistoryTarget::Local);
    assert_eq!(entry.session_id.as_deref(), Some("session-1"));
    assert_eq!(entry.cwd.as_deref(), Some("C:/dev/rust/kerminal"));
}

#[test]
fn record_history_normalizes_multiline_command_text() {
    let (_home, state) = test_state();

    let result = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "  echo one\r\necho two\r ".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect("record normalized command");

    assert!(result.recorded);
    assert_eq!(
        result.entry.expect("history entry").command,
        "echo one\necho two"
    );
}

#[test]
fn list_history_filters_by_query_target_source_and_host() {
    let (_home, state) = test_state();

    record(
        &state,
        "npm run check",
        CommandHistorySource::User,
        CommandHistoryTarget::Local,
        None,
    );
    record(
        &state,
        "journalctl -u app.service -n 200 --no-pager",
        CommandHistorySource::Tool,
        CommandHistoryTarget::Ssh,
        Some("host-prod"),
    );

    let local = state
        .command_history()
        .list_history(
            state.command_store(),
            CommandHistoryListRequest {
                query: Some("npm".to_owned()),
                source: Some(CommandHistorySource::User),
                target: Some(CommandHistoryTarget::Local),
                pane_id: None,
                remote_host_id: None,
                session_id: None,
                limit: Some(10),
            },
        )
        .expect("list local history");
    assert_eq!(local.len(), 1);
    assert_eq!(local[0].command, "npm run check");

    let remote = state
        .command_history()
        .list_history(
            state.command_store(),
            CommandHistoryListRequest {
                query: Some("journal".to_owned()),
                source: Some(CommandHistorySource::Tool),
                target: Some(CommandHistoryTarget::Ssh),
                pane_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                session_id: None,
                limit: Some(10),
            },
        )
        .expect("list remote history");
    assert_eq!(remote.len(), 1);
    assert_eq!(remote[0].remote_host_id.as_deref(), Some("host-prod"));
}

#[test]
fn list_history_filters_by_pane_id() {
    let (_home, state) = test_state();

    record_with_pane(
        &state,
        "git status",
        CommandHistorySource::User,
        CommandHistoryTarget::Local,
        "pane-left",
        None,
    );
    record_with_pane(
        &state,
        "npm run test",
        CommandHistorySource::User,
        CommandHistoryTarget::Local,
        "pane-right",
        None,
    );

    let entries = state
        .command_history()
        .list_history(
            state.command_store(),
            CommandHistoryListRequest {
                query: None,
                source: None,
                target: Some(CommandHistoryTarget::Local),
                pane_id: Some("pane-right".to_owned()),
                remote_host_id: None,
                session_id: None,
                limit: Some(10),
            },
        )
        .expect("list pane history");

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command, "npm run test");
    assert_eq!(entries[0].pane_id.as_deref(), Some("pane-right"));
}

#[test]
fn record_history_skips_disabled_or_sensitive_commands() {
    let (_home, state) = test_state();

    let disabled = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "echo ignored".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: Some(false),
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect("skip disabled history");
    assert!(!disabled.recorded);
    assert!(disabled
        .skip_reason
        .as_deref()
        .expect("skip reason")
        .contains("禁用"));

    let sensitive = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "curl -H 'Authorization: Bearer secret-token' https://api".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect("skip sensitive history");
    assert!(!sensitive.recorded);

    let api_key = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "echo api_key=secret-value".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect("skip api key history");
    assert!(!api_key.recorded);

    let entries = state
        .command_history()
        .list_history(state.command_store(), CommandHistoryListRequest::default())
        .expect("list history");
    assert!(entries.is_empty());
}

#[test]
fn delete_and_clear_history_round_trip() {
    let (_home, state) = test_state();
    record(
        &state,
        "git status",
        CommandHistorySource::User,
        CommandHistoryTarget::Local,
        None,
    );
    record(
        &state,
        "uptime",
        CommandHistorySource::Broadcast,
        CommandHistoryTarget::Ssh,
        Some("host-dev"),
    );
    record(
        &state,
        "npm run check",
        CommandHistorySource::Workflow,
        CommandHistoryTarget::Local,
        None,
    );

    let entries = state
        .command_history()
        .list_history(state.command_store(), CommandHistoryListRequest::default())
        .expect("list history");
    assert_eq!(entries.len(), 3);
    assert!(entries
        .iter()
        .any(|entry| entry.source == CommandHistorySource::Workflow));

    assert!(state
        .command_history()
        .delete_history(state.command_store(), &entries[0].id)
        .expect("delete history"));

    assert_eq!(
        state
            .command_history()
            .clear_history(state.command_store())
            .expect("clear history"),
        2
    );
    assert!(state
        .command_history()
        .list_history(state.command_store(), CommandHistoryListRequest::default())
        .expect("list after clear")
        .is_empty());
}

#[test]
fn clear_history_scoped_keeps_other_panes_and_hosts() {
    let (_home, state) = test_state();
    record_with_pane(
        &state,
        "echo prod left",
        CommandHistorySource::User,
        CommandHistoryTarget::Ssh,
        "pane-left",
        Some("host-prod"),
    );
    record_with_pane(
        &state,
        "echo prod right",
        CommandHistorySource::User,
        CommandHistoryTarget::Ssh,
        "pane-right",
        Some("host-prod"),
    );
    record_with_pane(
        &state,
        "echo stage left",
        CommandHistorySource::User,
        CommandHistoryTarget::Ssh,
        "pane-left",
        Some("host-stage"),
    );

    let cleared = state
        .command_history()
        .clear_history_scoped(
            state.command_store(),
            CommandHistoryClearRequest {
                target: Some(CommandHistoryTarget::Ssh),
                pane_id: Some(" pane-left ".to_owned()),
                remote_host_id: Some(" host-prod ".to_owned()),
                session_id: None,
            },
        )
        .expect("clear scoped history");
    assert_eq!(cleared, 1);

    let remaining = state
        .command_history()
        .list_history(state.command_store(), CommandHistoryListRequest::default())
        .expect("list remaining history");
    assert_eq!(remaining.len(), 2);
    assert!(remaining
        .iter()
        .any(|entry| entry.command == "echo prod right"));
    assert!(remaining
        .iter()
        .any(|entry| entry.command == "echo stage left"));
}

#[test]
fn record_history_rejects_empty_or_too_long_commands() {
    let (_home, state) = test_state();

    let empty = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "   ".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect_err("reject empty command");
    assert!(matches!(empty, AppError::InvalidInput(_)));

    let long = state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: "x".repeat(4_001),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        )
        .expect_err("reject long command");
    assert!(matches!(long, AppError::InvalidInput(_)));
}

#[test]
fn feedback_batch_query_uses_replacement_index_for_8_32_and_64_candidates() {
    let (_home, state) = test_state();
    let database_file = state.command_store().database_file();
    let conn = Connection::open(database_file).expect("open command database");

    for candidate_count in [8usize, 32, 64] {
        let values = std::iter::repeat_n("(?, ?)", candidate_count)
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "
            EXPLAIN QUERY PLAN
            WITH requested(provider, replacement_text) AS (
                VALUES {values}
            )
            SELECT requested.provider, requested.replacement_text
            FROM requested
            LEFT JOIN command_suggestion_feedback AS feedback
                INDEXED BY idx_command_suggestion_feedback_replacement
              ON feedback.provider = requested.provider
             AND feedback.replacement_text = requested.replacement_text
             AND feedback.target = ?
             AND (
                (? IS NULL AND feedback.remote_host_id IS NULL)
                OR (
                    ? IS NOT NULL
                    AND (
                        feedback.remote_host_id IS NULL
                        OR feedback.remote_host_id = ?
                    )
                )
             )
            GROUP BY requested.provider, requested.replacement_text
            "
        );
        let mut parameters = Vec::with_capacity(candidate_count * 2 + 4);
        for index in 0..candidate_count {
            parameters.push(Value::Text("history".to_owned()));
            parameters.push(Value::Text(format!("git status --short {index}")));
        }
        parameters.push(Value::Text("local".to_owned()));
        parameters.extend([Value::Null, Value::Null, Value::Null]);

        let mut stmt = conn.prepare(&sql).expect("prepare query plan");
        let details = stmt
            .query_map(params_from_iter(parameters), |row| row.get::<_, String>(3))
            .expect("query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect query plan");
        println!(
            "feedback_batch candidates={candidate_count} sqlite_round_trips=1 plan={}",
            details.join(" | ")
        );
        assert!(
            details.iter().any(|detail| {
                detail.contains("idx_command_suggestion_feedback_replacement")
                    && detail.contains("provider=?")
                    && detail.contains("replacement_text=?")
            }),
            "candidate_count={candidate_count}, plan={details:?}"
        );
    }
}

fn record(
    state: &AppState,
    command: &str,
    source: CommandHistorySource,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
) {
    record_with_pane(state, command, source, target, "pane-1", remote_host_id);
}

fn record_with_pane(
    state: &AppState,
    command: &str,
    source: CommandHistorySource,
    target: CommandHistoryTarget,
    pane_id: &str,
    remote_host_id: Option<&str>,
) {
    state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: command.to_owned(),
                source,
                target,
                record: None,
                session_id: Some("session-1".to_owned()),
                pane_id: Some(pane_id.to_owned()),
                tab_id: None,
                profile_id: None,
                remote_host_id: remote_host_id.map(ToOwned::to_owned),
                cwd: None,
                shell: None,
            },
        )
        .expect("record test command");
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
