use super::fixtures::*;

#[tokio::test]
async fn mcp_runtime_snapshot_reports_external_launch_policy_without_secrets() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();
    let mut settings = AppSettings::default();
    settings.external_launch.enabled = false;
    settings.external_launch.accept_vendor_args = false;
    settings.external_launch.auto_open_sftp = true;
    settings.external_launch.disabled_tools = vec![ExternalLaunchToolSetting::Putty];
    state
        .update_settings(settings)
        .expect("configure external launch policy");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["enabled"],
        false
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["acceptVendorArgs"],
        false
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["autoOpenSftp"],
        true
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["disabledTools"],
        json!(["putty"])
    );
    assert_eq!(output.data["runtime"]["externalLaunchPendingCount"], 0);
    assert_eq!(output.data["runtime"]["externalLaunchActiveSecretCount"], 0);
    let serialized = output.data.to_string();
    assert!(!serialized.contains("external-secret:"));
    assert!(!serialized.contains("correct horse"));
}

#[tokio::test]
async fn mcp_runtime_snapshot_reports_external_launch_rejection_without_raw_args_or_secrets() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "not-a-port".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("record rejected launch");
    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Rejected(_)));

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["externalLaunch"]["intake"]["rejectedCount"], 1);
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["entrypoint"],
        "direct-argv"
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["sourceTool"],
        "putty"
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["argCount"],
        7
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["cwdPresent"],
        true
    );
    assert!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["rawHash"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("ops@example.internal"));
    assert!(!serialized.contains("not-a-port"));
    assert!(!serialized.contains("-pw"));
}

#[tokio::test]
async fn mcp_capabilities_exposes_managed_ssh_runtime_guidance() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.capabilities",
            json!({}),
        )
        .await
        .expect("capabilities");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        output.data["managedSshRuntime"]["inspectTool"],
        "kerminal.runtime_snapshot"
    );
    assert_eq!(
        output.data["managedSshRuntime"]["snapshotPath"],
        "managedSsh"
    );
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["appliesToFamilies"],
        "sftp"
    ));
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["appliesToFamilies"],
        "portForward"
    ));

    let ssh_family = output.data["runtimeToolFamilies"]
        .as_array()
        .and_then(|families| {
            families
                .iter()
                .find(|family| family["family"].as_str() == Some("ssh"))
        })
        .expect("ssh family");
    assert!(ssh_family["useWhen"]
        .as_str()
        .expect("ssh useWhen")
        .contains("managed SSH exec facade"));
}

#[tokio::test]
async fn mcp_tool_help_query_managed_ssh_discovers_runtime_snapshot() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.tool_help",
            json!({
                "query": "managed ssh session reuse",
                "includeSchemas": false
            }),
        )
        .await
        .expect("tool help managed ssh query");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["matchMode"], "query");
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "ssh.command"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "sftp.list"
    ));
    assert_eq!(
        output.data["managedSshRuntime"]["snapshotPath"],
        "managedSsh"
    );
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].pendingExecRequests"
    ));
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].lastError"
    ));
    assert!(!value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].queueDepth"
    ));
    assert!(!value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].recentFailure"
    ));
    assert!(output.data["managedSshRuntime"]["fallbackRule"]
        .as_str()
        .expect("fallback rule")
        .contains("unsupported or unwired"));
}

#[tokio::test]
async fn mcp_tool_help_query_external_launch_discovers_runtime_and_config_without_control_tools() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.tool_help",
            json!({
                "query": "external launch bastion putty jump host",
                "includeSchemas": false
            }),
        )
        .await
        .expect("tool help external launch query");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["matchMode"], "query");
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.config_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.operation_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.config.validate"
    ));
    assert!(output.data["availableToolIds"]
        .as_array()
        .expect("available tool ids")
        .iter()
        .all(|tool_id| !tool_id
            .as_str()
            .unwrap_or_default()
            .starts_with("external_launch.")));
    assert!(output.data["safetyBoundaries"]["externalLaunch"]
        .as_str()
        .expect("external launch boundary")
        .contains("redacted rejection metadata"));

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("external-secret:"));
}

#[tokio::test]
async fn mcp_operation_guide_sftp_requires_managed_ssh_runtime_inspection() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.operation_guide",
            json!({ "intent": "sftp" }),
        )
        .await
        .expect("sftp operation guide");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["intent"], "sftp");
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.runtime_snapshot"
    ));
    assert_eq!(
        output.data["managedSshRuntime"]["inspectTool"],
        "kerminal.runtime_snapshot"
    );
    let workflow = output.data["workflow"].as_array().expect("workflow");
    assert_eq!(workflow[0]["phase"], "inspect-runtime");
    assert_eq!(workflow[0]["toolId"], "kerminal.runtime_snapshot");
    assert!(workflow[0]["action"]
        .as_str()
        .expect("inspect runtime action")
        .contains("managedSsh session/channel diagnostics"));
}

#[tokio::test]
async fn mcp_operation_guide_external_launch_uses_file_first_redacted_policy() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.operation_guide",
            json!({ "intent": "external-launch" }),
        )
        .await
        .expect("external launch operation guide");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["intent"], "external-launch");
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.config_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.config.validate"
    ));
    let workflow = output.data["workflow"].as_array().expect("workflow");
    assert_eq!(workflow[0]["phase"], "inspect-runtime");
    assert_eq!(workflow[0]["toolId"], "kerminal.runtime_snapshot");
    assert!(workflow[0]["action"]
        .as_str()
        .expect("inspect action")
        .contains("redacted last rejection"));
    assert_eq!(workflow[1]["phase"], "read-config-rules");
    assert_eq!(workflow[1]["toolId"], "kerminal.config_guide");
    assert!(workflow[2]["action"]
        .as_str()
        .expect("edit policy action")
        .contains("settings.toml externalLaunch"));
    assert!(output.data["safetyBoundaries"]["externalLaunch"]
        .as_str()
        .expect("external launch boundary")
        .contains("settings.toml externalLaunch"));

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("external-secret:"));
}

#[tokio::test]
async fn mcp_runtime_snapshot_reports_managed_ssh_runtime_without_secrets() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("managed snapshot\n"));
    let ssh_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let ssh_commands = SshCommandService::with_ssh_runtime(
        ssh_runtime.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let tools = state.mcp_tool_catalog().list_tools();

    state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "ssh.command",
            json!({
                "hostId": host_id,
                "command": "printf managed-snapshot"
            }),
        )
        .await
        .expect("prime managed SSH runtime through MCP ssh.command");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot with managed SSH diagnostics");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["runtime"]["managedSshActiveSessionCount"], 1);
    assert_eq!(output.data["runtime"]["managedSshActiveChannelCount"], 0);
    assert_eq!(output.data["managedSsh"]["activeSessions"], 1);
    assert_eq!(output.data["managedSsh"]["activeChannels"], 0);
    assert_eq!(
        output.data["managedSsh"]["recentLegacyFallbacks"],
        json!([])
    );
    assert_eq!(
        output.data["managedSsh"]["sessions"][0]["key"]["target"],
        "deploy@dev.internal:2222"
    );
    assert_eq!(
        output.data["managedSsh"]["sessions"][0]["channelCounts"]["exec"],
        1
    );
    assert_eq!(backend.connect_count(), 1);

    let serialized = output.data.to_string();
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
    assert!(!serialized.contains("kerminal://host/"));
}

#[tokio::test]
async fn mcp_tool_call_log_includes_redacted_runtime_audit() {
    let (_home, state) = test_state();
    let agent = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("runtime audit".to_owned()),
            launch: None,
            target: None,
            provider: None,
            mcp_endpoint: None,
        })
        .expect("create agent session");
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("audit ok\n"));
    let ssh_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let ssh_commands = SshCommandService::with_ssh_runtime(
        ssh_runtime.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "ssh.command",
            json!({
                "agentSessionId": agent.session.agent_session_id.as_str(),
                "hostId": host_id,
                "command": "printf audit"
            }),
        )
        .await
        .expect("execute MCP ssh.command with agent call log");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    let log_path = Path::new(&agent.paths.session_root)
        .join("logs")
        .join("mcp-calls.jsonl");
    let log = fs::read_to_string(log_path).expect("mcp call log");
    let line: Value = serde_json::from_str(log.trim()).expect("log json");
    let audit = line
        .pointer("/runtimeAudit")
        .and_then(Value::as_str)
        .expect("runtime audit");

    assert!(audit.contains("tool=ssh.command"));
    assert!(audit.contains("hostId="));
    assert!(audit.contains("backend=managed-ssh-runtime"));
    assert!(audit.contains("activeSessions=1"));
    assert!(audit.contains("deploy@dev.internal:2222"));
    assert!(!log.contains("correct horse"));
    assert!(!log.contains("battery staple"));
    assert!(!log.contains("kerminal://host/"));
}
