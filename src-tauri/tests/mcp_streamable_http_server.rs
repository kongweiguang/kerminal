//! Streamable HTTP MCP Server smoke tests.
//!
//! @author kongweiguang

mod support;

use std::fs;

use kerminal_lib::{
    models::{
        agent_session::{AgentId, AgentSessionCreateRequest},
        mcp_server::{McpHttpServerStartRequest, McpToolAnnotations, ToolCategory, ToolDefinition},
        sftp::SftpTrustHostKeyRequest,
        target::RemoteTargetRef,
    },
    paths::KerminalPaths,
    services::{
        external_agent_workspace::{
            ExternalAgentWorkspaceService, PrepareExternalAgentWorkspaceRequest,
        },
        mcp_streamable_http_server::rules,
        mcp_tool_executor_service::rules as executor_rules,
    },
    state::AppState,
};
use rmcp::{
    model::{CallToolRequestParams, ClientInfo},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
    },
    ServiceExt,
};
use serde_json::Value;
use support::mcp_streamable_http::{
    assert_absent_tool_help_payload, assert_app_guide_payload, assert_capability_payload,
    assert_config_operation_guide_payload, assert_config_reference_payload,
    assert_container_tool_help_payload, assert_runtime_snapshot_payload,
    assert_session_operation_guide_payload, assert_terminal_create_tool_help_payload,
    assert_terminal_tool_help_payload, assert_tool_reference_examples_match_schema,
    assert_tools_list_surface,
};
use tauri::Manager;

#[path = "mcp_streamable_http_server/generated_configs.rs"]
mod generated_configs;
#[allow(dead_code)]
#[path = "sftp_service/support/mod.rs"]
mod sftp_test_support;
#[test]
fn filters_disabled_or_unexposed_tools_from_external_mcp_surface() {
    let mut disabled = tool("terminal.list");
    disabled.enabled = false;

    let mut internal = tool("diagnostics.runtime_health");
    internal.exposed_to_mcp = false;

    assert!(!rules::is_externally_callable_tool(&disabled));
    assert!(!rules::is_externally_callable_tool(&internal));
    assert!(rules::is_externally_callable_tool(&tool("history.search")));
}

#[test]
fn only_accepts_loopback_bind_addresses() {
    assert_eq!(
        rules::normalize_bind_address(None).unwrap(),
        rules::default_bind_address().to_owned()
    );
    assert_eq!(
        rules::normalize_bind_address(Some("localhost")).unwrap(),
        rules::default_bind_address().to_owned()
    );
    assert!(rules::normalize_bind_address(Some("0.0.0.0")).is_err());
}

#[test]
fn uses_fixed_default_mcp_http_port() {
    assert_eq!(
        rules::requested_start_port(None),
        rules::default_mcp_http_port()
    );
    assert_eq!(
        rules::requested_start_port(Some(0)),
        rules::default_mcp_http_port()
    );
    assert_eq!(rules::requested_start_port(Some(48123)), 48123);
}

#[test]
fn parses_tmux_probe_arguments_from_flat_mcp_shape() {
    let mut arguments = serde_json::Map::new();
    arguments.insert("targetKind".to_owned(), Value::String("ssh".to_owned()));
    arguments.insert("hostId".to_owned(), Value::String("prod-web".to_owned()));
    arguments.insert("socketName".to_owned(), Value::String("work".to_owned()));
    arguments.insert(
        "tmuxPath".to_owned(),
        Value::String("/usr/bin/tmux".to_owned()),
    );

    let request =
        executor_rules::tmux_probe_request_from_arguments(&arguments).expect("tmux request");

    assert_eq!(
        request.target.target,
        RemoteTargetRef::Ssh {
            host_id: "prod-web".to_owned()
        }
    );
    assert_eq!(request.target.socket_name.as_deref(), Some("work"));
    assert_eq!(request.target.socket_path, None);
    assert_eq!(request.target.tmux_path.as_deref(), Some("/usr/bin/tmux"));
}

#[tokio::test]
async fn moves_to_next_loopback_port_when_start_port_is_occupied() {
    let (occupied, occupied_port) = occupied_loopback_port_below_scan_ceiling().await;

    let (_listener, local_addr) = rules::bind_loopback_port_from(occupied_port).await.unwrap();

    assert!(local_addr.port() > occupied_port);
    assert!(local_addr.port() - occupied_port < rules::mcp_http_port_scan_limit());
    drop(occupied);
}

fn path_to_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn install_test_rustls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn assert_launch_command(shell: &str, args: &[String], command: &str) {
    #[cfg(windows)]
    {
        if shell.eq_ignore_ascii_case("cmd.exe") {
            assert_eq!(
                args.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["/d", "/s", "/k", command]
            );
        } else {
            assert!(
                shell.eq_ignore_ascii_case("pwsh.exe")
                    || shell.eq_ignore_ascii_case("powershell.exe")
            );
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoLogo")));
            assert!(args
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("-NoProfile")));
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoExit")));
            let command_index = args
                .iter()
                .position(|arg| arg.eq_ignore_ascii_case("-Command"))
                .expect("PowerShell wrapper includes -Command");
            assert_eq!(
                args.get(command_index + 1).map(String::as_str),
                Some(command)
            );
        }
    }

    #[cfg(not(windows))]
    {
        assert_eq!(shell, command);
        assert!(args.is_empty());
    }
}

fn tool(id: &str) -> ToolDefinition {
    ToolDefinition {
        id: id.to_owned(),
        title: id.to_owned(),
        description: id.to_owned(),
        category: ToolCategory::Terminal,
        annotations: McpToolAnnotations {
            read_only_hint: true,
            idempotent_hint: true,
            ..McpToolAnnotations::default()
        },
        enabled: true,
        exposed_to_mcp: true,
        input_schema: serde_json::json!({"type": "object"}),
    }
}

async fn occupied_loopback_port_below_scan_ceiling() -> (tokio::net::TcpListener, u16) {
    for _ in 0..128 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        if port <= u16::MAX - rules::mcp_http_port_scan_limit() {
            return (listener, port);
        }
    }

    panic!("could not reserve a loopback test port below the scan ceiling");
}
