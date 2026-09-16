//! MCP headless terminal creation tests.
//!
//! @author kongweiguang

use super::fixtures::*;
use crate::support::ssh_terminal_smoke::{
    create_loopback_terminal_harness, LoopbackTerminalServer, COMMAND_MARKER, LOOPBACK_PASSWORD,
    LOOPBACK_READY_MARKER, LOOPBACK_USER,
};
use kerminal_lib::{
    models::remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
    state::AppState,
};
use std::{
    thread,
    time::{Duration, Instant},
};

/// 验证 root MCP endpoint 不依赖 UI Tab：创建后的 headless session 能经
/// orphan reaper 保留，并完整走 snapshot/write/close 生命周期。
#[tokio::test]
async fn local_headless_terminal_survives_orphan_reaper_and_is_operable() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();
    let created = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "terminal.create",
            json!({ "target": "local" }),
        )
        .await
        .expect("create local headless terminal");

    assert_eq!(created.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(created.data["headless"], true);
    assert_eq!(created.data["scope"], "global");
    assert_eq!(created.data["ui"]["tabCreated"], false);
    assert_eq!(created.data["outputBuffered"], true);
    let session_id = created.data["sessionId"]
        .as_str()
        .expect("headless session id")
        .to_owned();
    assert_eq!(created.data["session"]["targetRef"].as_str(), Some("local"));

    let reap = state
        .terminals()
        .reap_orphan_sessions()
        .expect("reap UI orphan sessions");
    assert_eq!(reap.reaped_count, 0);
    assert!(
        state.terminals().session_summary(&session_id).is_ok(),
        "MCP-owned session must survive UI orphan reaper"
    );

    let write = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "terminal.write",
            json!({
                "sessionId": session_id,
                "data": if cfg!(windows) { "echo headless-local\r\n" } else { "printf headless-local\n" }
            }),
        )
        .await
        .expect("write local headless terminal");
    assert_eq!(write.status, McpToolExecutionStatus::Succeeded);

    let snapshot = wait_for_snapshot(&state, &session_id, "headless-local");
    assert!(snapshot.contains("headless-local"), "{snapshot:?}");

    let close = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "terminal.close",
            json!({ "sessionId": session_id }),
        )
        .await
        .expect("close local headless terminal");
    assert_eq!(close.status, McpToolExecutionStatus::Succeeded);
    assert!(state.terminals().session_summary(&session_id).is_err());
}

/// 验证 MCP async executor 在 current-thread Tokio 下也能创建真实 loopback
/// SSH PTY；实现不能在同一线程嵌套 SshTerminalService 的 runtime.block_on。
#[test]
fn ssh_headless_terminal_uses_saved_host_and_real_loopback_pty() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_terminal_harness(&server);
    let host_id = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "mcp headless loopback".to_owned(),
            port: server.addr.port(),
            protocol: Default::default(),
            ssh_options: Default::default(),
            tags: vec!["mcp-headless-test".to_owned()],
            username: LOOPBACK_USER.to_owned(),
        })
        .expect("create saved loopback host")
        .id;
    let tools = state.mcp_tool_catalog().list_tools();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("create current-thread MCP runtime");
    let created = runtime.block_on(async {
        state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                "terminal.create",
                json!({
                    "target": "ssh",
                    "hostId": host_id,
                    "cols": 96,
                    "rows": 28
                }),
            )
            .await
            .expect("create SSH headless terminal")
    });
    assert_eq!(created.status, McpToolExecutionStatus::Succeeded);
    let session_id = created.data["sessionId"]
        .as_str()
        .expect("SSH headless session id")
        .to_owned();
    let expected_target_ref = format!("ssh:{}", host_id);
    assert_eq!(
        created.data["session"]["targetRef"].as_str(),
        Some(expected_target_ref.as_str())
    );
    let ready = wait_for_snapshot(&state, &session_id, LOOPBACK_READY_MARKER);
    assert!(ready.contains(LOOPBACK_READY_MARKER), "{ready:?}");

    let write = runtime.block_on(async {
        state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                "terminal.write",
                json!({
                    "sessionId": session_id,
                    "data": format!("echo {COMMAND_MARKER}\r")
                }),
            )
            .await
            .expect("write SSH headless terminal")
    });
    assert_eq!(write.status, McpToolExecutionStatus::Succeeded);
    let output = wait_for_snapshot(&state, &session_id, COMMAND_MARKER);
    assert!(output.contains(COMMAND_MARKER), "{output:?}");

    let close = runtime.block_on(async {
        state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                "terminal.close",
                json!({ "sessionId": session_id }),
            )
            .await
            .expect("close SSH headless terminal")
    });
    assert_eq!(close.status, McpToolExecutionStatus::Succeeded);
    assert!(state.terminals().session_summary(&session_id).is_err());
}

/// 轮询共享 output buffer，给 reader/flusher 线程一个确定的输出收口窗口。
fn wait_for_snapshot(state: &AppState, session_id: &str, marker: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let snapshot = state
            .terminals()
            .output_snapshot(session_id, 32 * 1024)
            .expect("read terminal snapshot")
            .1
            .data;
        if snapshot.contains(marker) {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for marker {marker:?}; output={snapshot:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}
