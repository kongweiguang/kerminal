//! MCP 终端工具运行态回归测试。
//!
//! @author kongweiguang

use super::fixtures::*;
use kerminal_lib::{
    models::{
        agent_session::{AgentSessionScope, AgentSessionTarget, AgentTargetLiveStatus},
        terminal::TerminalCreateRequest,
    },
    services::terminal_session_binding_service::AgentTargetBindingRequest,
};

#[tokio::test]
async fn mcp_ssh_command_uses_managed_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("mcp-managed\n"));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "ssh.command",
            json!({
                "hostId": host_id,
                "command": "printf mcp-managed"
            }),
        )
        .await
        .expect("execute MCP ssh.command through managed exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_exec_script(),
        Some("printf mcp-managed\n".to_owned())
    );
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    assert!(!format!("{key:?}").contains("correct horse"));
}

#[tokio::test]
async fn mcp_container_files_upload_uses_managed_streaming_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    backend.set_streaming_output(Vec::new(), Vec::new(), Some(0));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let temp = tempdir().expect("tempdir");
    let source = temp.path().join("source.txt");
    std::fs::write(&source, "hello from mcp container upload").expect("write source");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "container.files.upload",
            json!({
                "hostId": host_id,
                "containerId": "container-1",
                "runtime": "docker",
                "remotePath": "/var/lib/app/target.txt",
                "localPath": source.to_string_lossy(),
                "kind": "file"
            }),
        )
        .await
        .expect("execute MCP container upload through managed streaming exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert!(output
        .summary
        .as_deref()
        .expect("upload summary")
        .contains("已上传到容器"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 0);
    assert_eq!(backend.streaming_exec_count(), 1);
    let command = backend
        .last_streaming_exec_command()
        .expect("streaming exec command");
    assert!(command.contains("docker"));
    assert!(command.contains("cp -"));
    assert!(command.contains("container-1:/var/lib/app"));

    let mut archive = tar::Archive::new(std::io::Cursor::new(backend.last_streaming_stdin()));
    let mut entries = archive.entries().expect("tar entries");
    let mut entry = entries
        .next()
        .expect("first tar entry")
        .expect("read tar entry");
    assert_eq!(
        entry.path().expect("entry path").as_ref(),
        Path::new("target.txt")
    );
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .expect("read uploaded tar");
    assert_eq!(content, "hello from mcp container upload");

    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    let serialized = format!(
        "{}{}{:?}",
        output.data,
        output.summary.as_deref().unwrap_or_default(),
        key
    );
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
}

#[tokio::test]
async fn mcp_container_files_download_uses_managed_streaming_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let temp = tempdir().expect("tempdir");
    let remote_source = temp.path().join("remote.txt");
    let local_target = temp.path().join("downloaded.txt");
    std::fs::write(&remote_source, "downloaded through mcp managed stream").expect("write remote");
    let mut tar_bytes = Vec::new();
    write_tar_stream(
        &mut tar_bytes,
        &remote_source,
        "remote.txt",
        SftpTransferKind::File,
    )
    .expect("build remote tar");
    backend.set_streaming_output(tar_bytes, Vec::new(), Some(0));

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "container.files.download",
            json!({
                "hostId": host_id,
                "containerId": "container-1",
                "runtime": "docker",
                "remotePath": "/var/lib/app/remote.txt",
                "localPath": local_target.to_string_lossy(),
                "kind": "file"
            }),
        )
        .await
        .expect("execute MCP container download through managed streaming exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert!(output
        .summary
        .as_deref()
        .expect("download summary")
        .contains("已下载到本地"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 0);
    assert_eq!(backend.streaming_exec_count(), 1);
    let command = backend
        .last_streaming_exec_command()
        .expect("streaming exec command");
    assert!(command.contains("docker"));
    assert!(command.contains("cp"));
    assert!(command.contains("container-1:/var/lib/app/remote.txt"));
    assert!(command.ends_with(" -"));
    assert_eq!(
        std::fs::read_to_string(&local_target).expect("read downloaded"),
        "downloaded through mcp managed stream"
    );
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    let serialized = format!(
        "{}{}{:?}",
        output.data,
        output.summary.as_deref().unwrap_or_default(),
        key
    );
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
}

/// 缺少旧版 bindingGeneration 时仍使用 session 的首选 target，避免兼容 Agent
/// 因隐藏参数缺失而无法把命令写入当前用户终端。
#[tokio::test]
async fn mcp_terminal_write_without_generation_uses_preferred_target() {
    let (_home, state) = test_state();
    let terminal = state
        .terminals()
        .create_session(TerminalCreateRequest::default(), |_| true)
        .expect("create user terminal");
    let agent = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("preferred target".to_owned()),
            launch: None,
            scope: Some(AgentSessionScope::Tab {
                tab_id: "legacy-tab".to_owned(),
            }),
            target: Some(AgentSessionTarget {
                binding_id: None,
                binding_generation: 0,
                pane_id: Some("pane-preferred".to_owned()),
                tab_id: Some("legacy-tab".to_owned()),
                target_terminal_session_id: Some(terminal.id.clone()),
                target_ref: terminal.target_ref.clone(),
                target_kind: Some("local".to_owned()),
                cwd: terminal.cwd.clone(),
                shell: Some(terminal.shell.clone()),
                live_status: AgentTargetLiveStatus::Ready,
                last_seen_at: None,
            }),
            provider: None,
            mcp_endpoint: None,
        })
        .expect("create agent session");
    state
        .terminal_session_bindings()
        .save_agent_target_binding(AgentTargetBindingRequest {
            agent_session_id: agent.session.agent_session_id.as_str().to_owned(),
            target_terminal_session_id: terminal.id.clone(),
            pane_id: "pane-preferred".to_owned(),
            tab_id: Some("legacy-tab".to_owned()),
            target_ref: terminal.target_ref.clone(),
            cwd: terminal.cwd.clone(),
            shell: Some(terminal.shell.clone()),
        })
        .expect("save preferred target binding");
    let unbound_terminal = state
        .terminals()
        .create_session(TerminalCreateRequest::default(), |_| true)
        .expect("create unbound user terminal");

    let list_output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &state.mcp_tool_catalog().list_tools(),
            "terminal.list",
            json!({
                "agentSessionId": agent.session.agent_session_id.as_str()
            }),
        )
        .await
        .expect("list global terminals with missing pane binding");
    assert_eq!(list_output.status, McpToolExecutionStatus::Succeeded);
    let listed_terminals = list_output.data["terminals"]
        .as_array()
        .expect("terminal entries");
    assert!(listed_terminals.iter().any(|entry| {
        entry.get("sessionId").and_then(Value::as_str) == Some(unbound_terminal.id.as_str())
    }));

    let root_list_output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &state.mcp_tool_catalog().list_tools(),
            "terminal.list",
            json!({}),
        )
        .await
        .expect("list root global terminals");
    assert_eq!(root_list_output.status, McpToolExecutionStatus::Succeeded);
    assert!(root_list_output
        .summary
        .as_deref()
        .is_some_and(|summary| summary.contains("2 个可操作、0 个断线可恢复")));
    assert_eq!(
        root_list_output.data["sessions"], root_list_output.data["terminals"],
        "root compatibility fields must describe the same terminal entries"
    );
    assert_eq!(
        root_list_output.data["sessionCount"].as_u64(),
        root_list_output.data["terminals"]
            .as_array()
            .map(|entries| entries.len() as u64)
    );
    assert_eq!(
        root_list_output.entities.len(),
        root_list_output.data["terminals"]
            .as_array()
            .map(|entries| entries.len())
            .unwrap_or_default()
    );

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &state.mcp_tool_catalog().list_tools(),
            "terminal.write",
            json!({
                "agentSessionId": agent.session.agent_session_id.as_str(),
                "data": "echo preferred-target\r"
            }),
        )
        .await
        .expect("execute terminal.write without bindingGeneration");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    let unbound_write = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &state.mcp_tool_catalog().list_tools(),
            "terminal.write",
            json!({
                "agentSessionId": agent.session.agent_session_id.as_str(),
                "sessionId": unbound_terminal.id.clone(),
                "data": "echo unbound-target\r"
            }),
        )
        .await
        .expect("write to unbound global terminal");
    assert_eq!(unbound_write.status, McpToolExecutionStatus::Succeeded);
    state
        .terminals()
        .close(&terminal.id)
        .expect("close user terminal");
    state
        .terminals()
        .close(&unbound_terminal.id)
        .expect("close unbound user terminal");
}
