//! External SSH launch production smoke tests.
//!
//! @author kongweiguang

use std::{fs, path::Path};

use kerminal_lib::{
    commands::external_launch::external_launch_snapshot_to_dto,
    paths::KerminalPaths,
    services::{
        external_launch::{
            ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchSourceTool,
            ExternalLaunchTaskSnapshot,
        },
        mcp_tool_executor_service::{McpToolExecutionContext, McpToolExecutionStatus},
        ssh_command_service::SshCommandService,
        ssh_runtime::ManagedSshSessionManager,
    },
    state::AppState,
};
use serde_json::json;
use tempfile::tempdir;

const SMOKE_SECRET_PREFIX: &str = "KERM_EXTERNAL_SMOKE_SECRET_";
const DIRECT_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_DIRECT_DO_NOT_USE";

#[tokio::test]
async fn direct_kerminal_args_materialize_password_no_save_and_public_surfaces_are_redacted() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");

    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@direct-smoke.example.internal".to_owned(),
                "-P".to_owned(),
                "2207".to_owned(),
                "-pw".to_owned(),
                DIRECT_SECRET.to_owned(),
            ],
            Some("C:\\Program Files\\Jump Host".to_owned()),
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue direct kerminal.exe vendor-style launch");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued direct launch, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::DirectArgv);
    assert_eq!(queued.target.host, "direct-smoke.example.internal");
    assert_no_public_secret("queued event", &format!("{queued:?}"));

    let snapshot_dto = external_launch_snapshot_to_dto(
        state
            .external_launch_intake()
            .snapshot()
            .expect("intake snapshot"),
        state
            .external_launch_intake()
            .secret_broker()
            .snapshot()
            .expect("secret snapshot"),
        ExternalLaunchTaskSnapshot::default(),
    );
    assert_no_public_secret(
        "external launch DTO snapshot",
        &serde_json::to_string(&snapshot_dto).expect("serialize snapshot dto"),
    );

    let tools = state.mcp_tool_catalog().list_tools();
    let mcp_output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");
    assert_eq!(mcp_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(mcp_output.data["runtime"]["externalLaunchPendingCount"], 1);
    assert_eq!(
        mcp_output.data["runtime"]["externalLaunchActiveSecretCount"],
        1
    );
    assert_no_public_secret("mcp runtime snapshot", &mcp_output.data.to_string());

    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending direct launch");
    assert_eq!(pending.len(), 1);
    let launch_id = pending[0].id.clone();
    assert_eq!(launch_id, queued.launch_id);
    assert_no_public_secret("pending request debug", &format!("{pending:?}"));

    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize direct external launch");
    assert_eq!(target.host.host, "direct-smoke.example.internal");
    assert_eq!(target.host.username, "ops");
    assert_no_public_secret("materialized target debug", &format!("{target:?}"));

    assert_eq!(
        state
            .external_launch_intake()
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("ack external launch secret"),
        1
    );
    assert_eq!(
        state
            .external_launch_intake()
            .secret_broker()
            .snapshot()
            .expect("secret snapshot after ack")
            .active_secret_count,
        0
    );

    let root = state.paths().root.clone();
    drop(state);
    assert_tree_does_not_contain_public_secret(&root);
}

fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    mcp_context_with_ssh_runtime(state, ssh_commands, state.ssh_runtime())
}

fn mcp_context_with_ssh_runtime<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
    ssh_runtime: &'a ManagedSshSessionManager,
) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        agent_sessions: state.agent_sessions(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        diagnostics: state.diagnostics(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        paths: state.paths(),
        port_forwards: state.port_forwards(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        settings: state.settings(),
        sftp: state.sftp(),
        ssh_commands,
        ssh_runtime,
        storage: state.storage(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminal_reconnect: state.terminal_reconnect(),
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

fn assert_no_public_secret(label: &str, text: &str) {
    assert!(
        !text.contains(SMOKE_SECRET_PREFIX),
        "{label} leaked smoke secret: {text}"
    );
    assert!(
        !text.contains("external-secret:"),
        "{label} leaked external secret ref: {text}"
    );
}

fn assert_tree_does_not_contain_public_secret(root: &Path) {
    if !root.exists() {
        return;
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::metadata(&path).expect("scan metadata");
        if metadata.is_dir() {
            for entry in fs::read_dir(&path).expect("scan directory") {
                stack.push(entry.expect("scan directory entry").path());
            }
            continue;
        }
        let bytes = fs::read(&path).expect("scan file bytes");
        assert!(
            !contains_bytes(&bytes, SMOKE_SECRET_PREFIX.as_bytes()),
            "workspace/config/log file leaked smoke secret: {}",
            path.display()
        );
        assert!(
            !contains_bytes(&bytes, b"external-secret:"),
            "workspace/config/log file leaked external secret ref: {}",
            path.display()
        );
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}
