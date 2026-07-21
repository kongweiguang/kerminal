#![allow(unused_imports)]
pub use super::support::managed_ssh_runtime::{
    ssh_command_service_with_fake_runtime, FakeManagedSshRuntime,
};
pub use kerminal_lib::{
    models::{
        agent_session::{AgentId, AgentSessionCreateRequest},
        port_forward::{
            PortForwardKind, PortForwardOrigin, PortForwardProxyApplyScope,
            PortForwardProxyProtocol, PortForwardRemoteAccessScope,
        },
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
        settings::{AppSettings, ExternalLaunchToolSetting},
        sftp::SftpTransferKind,
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::rules::write_tar_stream,
        external_launch::{ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint},
        mcp_tool_executor_service::{
            rules::{
                port_forward_create_request_from_arguments, ssh_command_request_from_arguments,
            },
            McpToolExecutionContext, McpToolExecutionStatus,
        },
        ssh_command_service::SshCommandService,
        ssh_runtime::{ManagedSshSessionManager, SshAuthIdentity, SshAuthSecretKind},
    },
    state::AppState,
};
pub use serde_json::{json, Value};
pub use std::{fs, io::Read, path::Path, sync::Arc};
pub use tempfile::{tempdir, TempDir};
pub fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    mcp_context_with_ssh_runtime(state, ssh_commands, state.ssh_runtime())
}

pub fn mcp_context_with_ssh_runtime<'a>(
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
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

pub fn create_saved_password_host(state: &AppState) -> String {
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

pub fn value_array_contains_str(value: &Value, expected: &str) -> bool {
    value
        .as_array()
        .map(|items| items.iter().any(|item| item.as_str() == Some(expected)))
        .unwrap_or(false)
}
