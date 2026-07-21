//! tmux service parser and command contract tests.
//!
//! @author kongweiguang

mod support;

use kerminal_lib::{
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
        target::RemoteTargetRef,
        tmux::{TmuxCreateSessionRequest, TmuxListSessionsRequest, TmuxTargetRef},
    },
    paths::KerminalPaths,
    services::{
        ssh_runtime::{SshAuthIdentity, SshAuthSecretKind},
        tmux_service::{
            rules::{
                build_remote_command, command_args_with_socket, normalize_tmux_session_name,
                parse_panes, parse_sessions, parse_windows, stable_tmux_target_ref,
                validate_target, FIELD_SEPARATOR, SESSION_FORMAT,
            },
            TmuxService,
        },
    },
    state::AppState,
};
use std::sync::Arc;
use support::managed_ssh_runtime::{
    ssh_command_service_with_fake_runtime, FakeManagedExecOutput, FakeManagedSshRuntime,
};
use tempfile::{tempdir, TempDir};

fn local_target() -> TmuxTargetRef {
    TmuxTargetRef {
        socket_name: None,
        socket_path: None,
        target: RemoteTargetRef::Local { profile_id: None },
        tmux_path: None,
    }
}

#[test]
fn parses_tmux_session_format_output() {
    let sep = FIELD_SEPARATOR;
    let output = format!(
        "$0{sep}'dev api'{sep}1{sep}2{sep}1710000000{sep}1710000100{sep}'/srv/app data'{sep}3\n"
    );

    let sessions = parse_sessions(&output, "ssh:prod").expect("parse sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "$0");
    assert_eq!(sessions[0].name, "dev api");
    assert!(sessions[0].attached);
    assert_eq!(sessions[0].clients, 2);
    assert_eq!(sessions[0].windows, 3);
    assert_eq!(sessions[0].current_path.as_deref(), Some("/srv/app data"));
    assert_eq!(sessions[0].created_at, Some(1_710_000_000));
    assert_eq!(sessions[0].activity_at, Some(1_710_000_100));
}

#[test]
fn session_format_uses_attached_count_for_clients() {
    assert!(!SESSION_FORMAT.contains("#{q:"));
    assert!(SESSION_FORMAT.contains("#{session_name}"));
    assert!(!SESSION_FORMAT.contains("session_clients"));
    assert_eq!(SESSION_FORMAT.matches("session_attached").count(), 2);
}

#[test]
fn parses_attached_count_larger_than_one() {
    let sep = FIELD_SEPARATOR;
    let output =
        format!("$1{sep}'shared'{sep}2{sep}2{sep}1710000000{sep}1710000100{sep}'/srv/app'{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:prod").expect("parse sessions");

    assert!(sessions[0].attached);
    assert_eq!(sessions[0].clients, 2);
}

#[test]
fn parses_unquoted_numeric_session_name_from_tmux_27() {
    let sep = FIELD_SEPARATOR;
    let output = format!("$0{sep}0{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:primary").expect("parse sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "$0");
    assert_eq!(sessions[0].name, "0");
    assert!(!sessions[0].attached);
    assert_eq!(sessions[0].clients, 0);
    assert_eq!(sessions[0].current_path, None);
}

#[test]
fn parses_raw_tmux_fields_with_apostrophes() {
    let sep = FIELD_SEPARATOR;
    let output =
        format!("$1{sep}api's{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}/srv/api's{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:primary").expect("parse sessions");

    assert_eq!(sessions[0].name, "api's");
    assert_eq!(sessions[0].current_path.as_deref(), Some("/srv/api's"));
}

#[test]
fn normalizes_tmux_reserved_session_name_separators() {
    assert_eq!(
        normalize_tmux_session_name("124.70.71.166:root").expect("normalize session name"),
        "124_70_71_166_root"
    );
}

#[test]
fn rejects_tmux_session_output_with_wrong_field_count() {
    let error = parse_sessions("$0\ndev\n", "local").expect_err("invalid output");

    assert!(error.to_string().contains("字段数量不匹配"));
}

#[test]
fn parses_windows_and_panes_with_quoted_text() {
    let sep = FIELD_SEPARATOR;
    let windows =
        format!("@1{sep}$0{sep}0{sep}'app logs'{sep}1{sep}2{sep}'main-horizontal'{sep}'*'\n");
    let panes = format!(
        "%2{sep}@1{sep}1{sep}0{sep}'/srv/app'{sep}'tail -f'{sep}'logs pane'{sep}120{sep}30{sep}0\n"
    );

    let windows = parse_windows(&windows).expect("parse windows");
    let panes = parse_panes(&panes).expect("parse panes");

    assert_eq!(windows[0].name, "app logs");
    assert!(windows[0].active);
    assert_eq!(windows[0].layout.as_deref(), Some("main-horizontal"));
    assert_eq!(panes[0].current_command.as_deref(), Some("tail -f"));
    assert_eq!(panes[0].title.as_deref(), Some("logs pane"));
    assert!(!panes[0].dead);
}

#[test]
fn builds_socket_args_and_rejects_conflicting_socket_scope() {
    let mut target = local_target();
    target.socket_name = Some("work".to_owned());

    let args = command_args_with_socket(&target, &["list-sessions"]).expect("socket args");
    assert_eq!(args, vec!["-L", "work", "list-sessions"]);
    assert_eq!(stable_tmux_target_ref(&target), "local|L:work");

    target.socket_path = Some("/tmp/tmux.sock".to_owned());
    let error = validate_target(&target).expect_err("conflicting socket scope");
    assert!(error.to_string().contains("不能同时设置"));
}

#[test]
fn quotes_remote_tmux_command_arguments() {
    let command = build_remote_command(
        "tmux",
        &[
            "attach-session".to_owned(),
            "-t".to_owned(),
            "dev api's session".to_owned(),
        ],
    );

    assert_eq!(
        command,
        "'tmux' 'attach-session' '-t' 'dev api'\\''s session'"
    );
}

#[tokio::test]
async fn ssh_tmux_list_sessions_uses_managed_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let sep = FIELD_SEPARATOR;
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout(format!(
        "$0{sep}'managed'{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}'/srv/app'{sep}1\n"
    )));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));

    let sessions = TmuxService::new()
        .list_sessions(
            state.paths(),
            &ssh_commands,
            TmuxListSessionsRequest {
                target: TmuxTargetRef {
                    socket_name: None,
                    socket_path: None,
                    target: RemoteTargetRef::Ssh {
                        host_id: host_id.clone(),
                    },
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("list SSH tmux sessions through managed exec");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].name, "managed");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    let script = backend.last_exec_script().expect("managed exec script");
    assert!(script.contains("'tmux' 'list-sessions'"));
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    let key_debug = format!("{key:?}");
    assert!(!key_debug.contains("correct horse battery staple"));
    assert!(!key_debug.contains("credential:ssh"));
}

#[tokio::test]
async fn ssh_tmux_create_returns_the_canonicalized_session() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let sep = FIELD_SEPARATOR;
    let canonical_name = "124_70_71_166-root-20260713-192215";
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout(format!(
        "$3{sep}{canonical_name}{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}/root{sep}1\n"
    )));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));

    let created = TmuxService::new()
        .create_session(
            state.paths(),
            &ssh_commands,
            TmuxCreateSessionRequest {
                cwd: Some("/root".to_owned()),
                name: "124.70.71.166-root-20260713-192215".to_owned(),
                target: TmuxTargetRef {
                    socket_name: None,
                    socket_path: None,
                    target: RemoteTargetRef::Ssh { host_id },
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("create canonicalized tmux session");

    assert_eq!(created.id, "$3");
    assert_eq!(created.name, canonical_name);
    assert_eq!(backend.exec_count(), 2);
}

#[tokio::test]
async fn ssh_tmux_create_keeps_success_when_summary_refresh_fails() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("unexpected tmux output"));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));

    let created = TmuxService::new()
        .create_session(
            state.paths(),
            &ssh_commands,
            TmuxCreateSessionRequest {
                cwd: Some("/root".to_owned()),
                name: "124.70.71.166-root-fallback".to_owned(),
                target: TmuxTargetRef {
                    socket_name: None,
                    socket_path: None,
                    target: RemoteTargetRef::Ssh { host_id },
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("keep successful tmux create when summary refresh fails");

    assert_eq!(created.id, "124_70_71_166-root-fallback");
    assert_eq!(created.name, "124_70_71_166-root-fallback");
    assert_eq!(created.current_path.as_deref(), Some("/root"));
    assert_eq!(created.windows, 1);
    assert_eq!(backend.exec_count(), 2);
}

#[tokio::test]
async fn ssh_tmux_create_recovers_a_duplicate_session_without_a_summary() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    backend.set_output(FakeManagedExecOutput {
        exit_code: Some(1),
        stderr: "duplicate session: 124_70_71_166-root-retry".to_owned(),
        stdout: String::new(),
    });
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));

    let created = TmuxService::new()
        .create_session(
            state.paths(),
            &ssh_commands,
            TmuxCreateSessionRequest {
                cwd: Some("/root".to_owned()),
                name: "124.70.71.166-root-retry".to_owned(),
                target: TmuxTargetRef {
                    socket_name: None,
                    socket_path: None,
                    target: RemoteTargetRef::Ssh { host_id },
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("recover duplicate tmux session without a summary");

    assert_eq!(created.id, "124_70_71_166-root-retry");
    assert_eq!(created.name, "124_70_71_166-root-retry");
    assert_eq!(created.current_path.as_deref(), Some("/root"));
    assert_eq!(backend.exec_count(), 2);
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn create_saved_password_host(state: &AppState) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create saved password host")
        .id
}
