use super::*;

#[tokio::test]
async fn generated_codex_and_claude_configs_connect_to_tools_list() {
    install_test_rustls_provider();

    let home = tempfile::tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let status = state
        .mcp_http_server()
        .start(
            app.handle().clone(),
            Some(McpHttpServerStartRequest {
                host: Some("127.0.0.1".to_owned()),
                port: Some(0),
            }),
        )
        .await
        .expect("start mcp server");
    let endpoint = status.endpoint.clone().expect("endpoint");

    let workspace = ExternalAgentWorkspaceService::new(&paths.root, Some(endpoint.clone()), true);
    let codex_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare codex");
    let claude_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare claude");

    assert_launch_command(&codex_spec.shell, &codex_spec.args, "codex");
    assert_launch_command(&claude_spec.shell, &claude_spec.args, "claude");
    assert_eq!(codex_spec.cwd, path_to_string(&paths.root));
    assert_eq!(claude_spec.cwd, path_to_string(&paths.root));

    let codex_config =
        fs::read_to_string(paths.root.join(".codex").join("config.toml")).expect("codex config");
    assert!(codex_config.contains("[mcp_servers.kerminal]"));
    assert!(codex_config.contains(&format!("url = \"{endpoint}\"")));
    assert!(codex_config.contains("default_tools_approval_mode = \"prompt\""));

    let claude_config = fs::read_to_string(paths.root.join(".mcp.json")).expect("claude mcp json");
    let claude_root: Value = serde_json::from_str(&claude_config).expect("parse claude mcp json");
    assert_eq!(
        claude_root
            .pointer("/mcpServers/kerminal/type")
            .and_then(Value::as_str),
        Some("http")
    );
    assert_eq!(
        claude_root
            .pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some(endpoint.as_str())
    );

    let client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(endpoint.clone()),
        ))
        .await
        .expect("connect mcp client");
    let tools = client
        .peer()
        .list_tools(None)
        .await
        .expect("list tools through mcp endpoint");
    assert_tools_list_surface(&tools);

    let mut host_credential_arguments = serde_json::Map::new();
    host_credential_arguments.insert(
        "name".to_owned(),
        Value::String("Agent Vault Host".to_owned()),
    );
    host_credential_arguments.insert(
        "host".to_owned(),
        Value::String("agent-vault.internal".to_owned()),
    );
    host_credential_arguments.insert("username".to_owned(), Value::String("deploy".to_owned()));
    host_credential_arguments.insert(
        "password".to_owned(),
        Value::String("test-password".to_owned()),
    );
    host_credential_arguments.insert("production".to_owned(), Value::Bool(false));
    let saved_host = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.host.upsert_with_credential")
                .with_arguments(host_credential_arguments),
        )
        .await
        .expect("call host credential upsert through mcp endpoint");
    assert_eq!(saved_host.is_error, Some(false));
    let saved_host_payload = saved_host
        .structured_content
        .as_ref()
        .expect("structured saved host content");
    let saved_host_id = saved_host_payload
        .pointer("/data/hostId")
        .and_then(Value::as_str)
        .expect("saved host id")
        .to_owned();
    assert!(
        saved_host_payload
            .pointer("/data/secretRef")
            .and_then(Value::as_str)
            .is_some_and(|secret_ref| secret_ref.starts_with("credential:kerminal:ssh-host:")),
        "expected host upsert to return vault secret_ref"
    );

    let mut vault_arguments = serde_json::Map::new();
    vault_arguments.insert("kind".to_owned(), Value::String("ssh-host".to_owned()));
    vault_arguments.insert("hostId".to_owned(), Value::String(saved_host_id));
    vault_arguments.insert("scope".to_owned(), Value::String("target".to_owned()));
    vault_arguments.insert("material".to_owned(), Value::String("password".to_owned()));
    vault_arguments.insert(
        "plaintext".to_owned(),
        Value::String("rotated-password".to_owned()),
    );
    let encrypted_secret = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.vault.encrypt_secret")
                .with_arguments(vault_arguments),
        )
        .await
        .expect("call vault encrypt secret through mcp endpoint");
    assert_eq!(encrypted_secret.is_error, Some(false));
    assert!(
        encrypted_secret
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/secretRef"))
            .and_then(Value::as_str)
            .is_some_and(|secret_ref| secret_ref.starts_with("credential:kerminal:ssh-host:")),
        "expected vault encrypt tool to return secret_ref"
    );

    let mut tmux_probe_arguments = serde_json::Map::new();
    tmux_probe_arguments.insert("targetKind".to_owned(), Value::String("local".to_owned()));
    let tmux_probe = client
        .peer()
        .call_tool(CallToolRequestParams::new("tmux.probe").with_arguments(tmux_probe_arguments))
        .await
        .expect("call tmux probe through mcp endpoint");
    assert_eq!(tmux_probe.is_error, Some(false));
    let tmux_probe_payload = tmux_probe
        .structured_content
        .as_ref()
        .expect("structured tmux probe content");
    assert_eq!(
        tmux_probe_payload
            .pointer("/data/status/targetRef")
            .and_then(Value::as_str),
        Some("local")
    );
    assert!(
        tmux_probe_payload
            .pointer("/data/status/available")
            .and_then(Value::as_bool)
            .is_some(),
        "expected tmux probe to return availability status"
    );

    let app_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.app_guide"))
        .await
        .expect("call app guide through mcp endpoint");
    assert_eq!(app_guide.is_error, Some(false));
    let app_guide_payload = app_guide
        .structured_content
        .as_ref()
        .expect("structured app guide content");
    assert_app_guide_payload(app_guide_payload);

    let config_reference_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config_guide"))
        .await
        .expect("call config guide through mcp endpoint");
    assert_eq!(config_reference_guide.is_error, Some(false));
    let config_reference_payload = config_reference_guide
        .structured_content
        .as_ref()
        .expect("structured config guide content");
    assert_config_reference_payload(config_reference_payload);

    let capability_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.capabilities"))
        .await
        .expect("call capability guide through mcp endpoint");
    assert_eq!(capability_guide.is_error, Some(false));
    let capability_payload = capability_guide
        .structured_content
        .as_ref()
        .expect("structured capability guide content");
    assert_capability_payload(capability_payload);

    let mut terminal_tool_help_arguments = serde_json::Map::new();
    terminal_tool_help_arguments.insert(
        "toolId".to_owned(),
        Value::String("terminal.write".to_owned()),
    );
    terminal_tool_help_arguments.insert("includeSchemas".to_owned(), Value::Bool(true));
    let terminal_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(terminal_tool_help_arguments),
        )
        .await
        .expect("call terminal tool help through mcp endpoint");
    assert_eq!(terminal_tool_help.is_error, Some(false));
    let terminal_tool_help_payload = terminal_tool_help
        .structured_content
        .as_ref()
        .expect("structured terminal tool help content");
    assert_terminal_tool_help_payload(terminal_tool_help_payload);

    let mut container_tool_help_arguments = serde_json::Map::new();
    container_tool_help_arguments
        .insert("family".to_owned(), Value::String("container".to_owned()));
    let container_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(container_tool_help_arguments),
        )
        .await
        .expect("call container tool help through mcp endpoint");
    assert_eq!(container_tool_help.is_error, Some(false));
    let container_tool_help_payload = container_tool_help
        .structured_content
        .as_ref()
        .expect("structured container tool help content");
    assert_container_tool_help_payload(container_tool_help_payload);

    let mut absent_tool_help_arguments = serde_json::Map::new();
    absent_tool_help_arguments.insert(
        "query".to_owned(),
        Value::String("remote_host.tree".to_owned()),
    );
    let absent_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(absent_tool_help_arguments),
        )
        .await
        .expect("call absent tool help through mcp endpoint");
    assert_eq!(absent_tool_help.is_error, Some(false));
    let absent_tool_help_payload = absent_tool_help
        .structured_content
        .as_ref()
        .expect("structured absent tool help content");
    assert_absent_tool_help_payload(absent_tool_help_payload);

    let mut config_guide_arguments = serde_json::Map::new();
    config_guide_arguments.insert("intent".to_owned(), Value::String("config".to_owned()));
    config_guide_arguments.insert(
        "goal".to_owned(),
        Value::String("update a host config".to_owned()),
    );
    let config_operation_guide = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.operation_guide")
                .with_arguments(config_guide_arguments),
        )
        .await
        .expect("call config operation guide through mcp endpoint");
    assert_eq!(config_operation_guide.is_error, Some(false));
    let config_guide_payload = config_operation_guide
        .structured_content
        .as_ref()
        .expect("structured config operation guide content");
    assert_config_operation_guide_payload(config_guide_payload);

    let mut session_guide_arguments = serde_json::Map::new();
    session_guide_arguments.insert(
        "intent".to_owned(),
        Value::String("session-terminal".to_owned()),
    );
    let session_operation_guide = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.operation_guide")
                .with_arguments(session_guide_arguments),
        )
        .await
        .expect("call session operation guide through mcp endpoint");
    assert_eq!(session_operation_guide.is_error, Some(false));
    let session_guide_payload = session_operation_guide
        .structured_content
        .as_ref()
        .expect("structured session operation guide content");
    assert_session_operation_guide_payload(session_guide_payload);

    for guide_intent in [
        "overview",
        "terminal",
        "session-terminal",
        "ssh-command",
        "sftp",
        "tmux",
        "container",
        "port-forward",
        "server-info",
        "history",
        "config",
        "credentials",
        "diagnostics",
    ] {
        let mut guide_arguments = serde_json::Map::new();
        guide_arguments.insert("intent".to_owned(), Value::String(guide_intent.to_owned()));
        let operation_guide = client
            .peer()
            .call_tool(
                CallToolRequestParams::new("kerminal.operation_guide")
                    .with_arguments(guide_arguments),
            )
            .await
            .expect("call operation guide intent through mcp endpoint");
        assert_eq!(operation_guide.is_error, Some(false));
        let guide_payload = operation_guide
            .structured_content
            .as_ref()
            .expect("structured operation guide content");
        assert_eq!(
            guide_payload
                .pointer("/data/intent")
                .and_then(Value::as_str),
            Some(guide_intent)
        );
        assert_tool_reference_examples_match_schema(guide_payload);
        if guide_intent == "container" {
            assert!(guide_payload
                .pointer("/data/availableReferencedToolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| tool_ids
                    .iter()
                    .any(|tool_id| tool_id.as_str() == Some("container.remove"))));
            assert!(guide_payload
                .pointer("/data/availableReferencedToolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| tool_ids
                    .iter()
                    .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))));
            assert!(guide_payload
                .pointer("/data/toolReference")
                .and_then(Value::as_array)
                .is_some_and(
                    |tool_references| tool_references.iter().any(|tool_reference| {
                        tool_reference.pointer("/id").and_then(Value::as_str)
                            == Some("container.remove")
                            && tool_reference
                                .pointer("/annotations/destructiveHint")
                                .and_then(Value::as_bool)
                                == Some(true)
                            && tool_reference
                                .pointer("/exampleArguments/force")
                                .and_then(Value::as_bool)
                                == Some(false)
                    })
                ));
            assert!(guide_payload
                .pointer("/data/toolReference")
                .and_then(Value::as_array)
                .is_some_and(
                    |tool_references| tool_references.iter().any(|tool_reference| {
                        tool_reference.pointer("/id").and_then(Value::as_str)
                            == Some("container.files.delete")
                            && tool_reference
                                .pointer("/annotations/destructiveHint")
                                .and_then(Value::as_bool)
                                == Some(true)
                            && tool_reference
                                .pointer("/exampleArguments/directory")
                                .and_then(Value::as_bool)
                                == Some(false)
                    })
                ));
        }
    }

    let runtime_snapshot = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.runtime_snapshot"))
        .await
        .expect("call runtime snapshot through mcp endpoint");
    assert_eq!(runtime_snapshot.is_error, Some(false));
    let runtime_snapshot_payload = runtime_snapshot
        .structured_content
        .as_ref()
        .expect("structured runtime snapshot content");
    assert_runtime_snapshot_payload(runtime_snapshot_payload);

    let config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator through mcp endpoint");
    assert_eq!(config_validation.is_error, Some(false));
    assert_eq!(
        config_validation
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/valid"))
            .and_then(Value::as_bool),
        Some(true)
    );

    fs::create_dir_all(paths.root.join("hosts")).expect("hosts dir");
    fs::write(
        paths.root.join("hosts/agent-added.toml"),
        r#"schema_version = 1
id = "agent-added"
name = "Agent Added"
host = "agent-added.internal"
port = 22
username = "deploy"
auth_type = "agent"
tags = []
sort_order = 99
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("write host missing production");
    let warning_config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator for host warning");
    assert_eq!(warning_config_validation.is_error, Some(false));
    let warning_payload = warning_config_validation
        .structured_content
        .as_ref()
        .expect("structured config validation content");
    assert_eq!(
        warning_payload
            .pointer("/data/valid")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        warning_payload
            .pointer("/data/warningCount")
            .and_then(Value::as_u64),
        Some(1)
    );
    let diagnostics = warning_payload
        .pointer("/data/diagnostics")
        .and_then(Value::as_array)
        .expect("diagnostics");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic
                .pointer("/severity")
                .and_then(Value::as_str)
                .is_some_and(|severity| severity == "warning")
                && diagnostic
                    .pointer("/message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("production must be explicitly set"))
        }),
        "expected missing production diagnostic, got {diagnostics:?}"
    );
    fs::write(
        paths.root.join("hosts/agent-added.toml"),
        r#"schema_version = 1
id = "agent-added"
name = "Agent Added"
host = "agent-added.internal"
port = 22
username = "deploy"
auth_type = "agent"
production = "yes"
tags = []
sort_order = 99
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("write host invalid production");
    let invalid_config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator for invalid host");
    assert_eq!(invalid_config_validation.is_error, Some(false));
    let invalid_payload = invalid_config_validation
        .structured_content
        .as_ref()
        .expect("structured invalid config validation content");
    assert_eq!(
        invalid_payload
            .pointer("/data/valid")
            .and_then(Value::as_bool),
        Some(false)
    );
    let diagnostics = invalid_payload
        .pointer("/data/diagnostics")
        .and_then(Value::as_array)
        .expect("invalid diagnostics");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic
                .pointer("/severity")
                .and_then(Value::as_str)
                .is_some_and(|severity| severity == "error")
                && diagnostic
                    .pointer("/message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("production must be a boolean"))
                && diagnostic.pointer("/path").and_then(Value::as_str)
                    == Some("hosts/agent-added.toml")
                && diagnostic.pointer("/line").and_then(Value::as_u64) == Some(8)
                && diagnostic.pointer("/key").and_then(Value::as_str) == Some("production")
                && diagnostic
                    .pointer("/recovery")
                    .and_then(Value::as_str)
                    .is_some_and(|recovery| recovery.contains("production = true"))
        }),
        "expected invalid production diagnostic, got {diagnostics:?}"
    );

    let agent_session = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("Codex".to_owned()),
            launch: None,
            target: None,
            provider: None,
            mcp_endpoint: Some(format!("{endpoint}/agents/ags_test_scoped")),
        })
        .expect("create scoped agent session");
    let agent_session_id = agent_session.session.agent_session_id.as_str().to_owned();

    let session_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.clone()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare scoped codex session");
    let scoped_endpoint = session_spec
        .env
        .as_ref()
        .and_then(|env| env.get("KERMINAL_MCP_ENDPOINT"))
        .expect("session-scoped MCP endpoint")
        .clone();
    assert_eq!(
        scoped_endpoint,
        format!("{endpoint}/agents/{agent_session_id}")
    );
    let scoped_client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(scoped_endpoint),
        ))
        .await
        .expect("connect scoped mcp client");
    let scoped_tools = scoped_client
        .peer()
        .list_tools(None)
        .await
        .expect("list tools through scoped mcp endpoint");
    assert!(
        scoped_tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.agent.target_context"),
        "expected agent target context tool through scoped endpoint"
    );
    let current_session = scoped_client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.agent.current_session"))
        .await
        .expect("call current session through scoped endpoint without explicit agentSessionId");
    assert_eq!(current_session.is_error, Some(false));
    assert_eq!(
        current_session
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/agentSession/session/agent_session_id"))
            .and_then(Value::as_str),
        Some(agent_session_id.as_str())
    );

    let mut mismatched_arguments = serde_json::Map::new();
    mismatched_arguments.insert(
        "agentSessionId".to_owned(),
        Value::String("ags_other_session".to_owned()),
    );
    let mismatched_session = scoped_client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.agent.current_session")
                .with_arguments(mismatched_arguments),
        )
        .await;
    assert!(
        format!("{mismatched_session:?}").contains("does not match scoped MCP endpoint"),
        "expected scoped endpoint to reject mismatched agentSessionId, got {mismatched_session:?}"
    );

    let mut direct_write_arguments = serde_json::Map::new();
    direct_write_arguments.insert(
        "sessionId".to_owned(),
        Value::String("other-terminal-session".to_owned()),
    );
    direct_write_arguments.insert("data".to_owned(), Value::String("echo scoped\n".to_owned()));
    let direct_write = scoped_client
        .peer()
        .call_tool(
            CallToolRequestParams::new("terminal.write").with_arguments(direct_write_arguments),
        )
        .await
        .expect("scoped terminal.write returns a tool error");
    assert_eq!(direct_write.is_error, Some(true));
    assert!(
        format!("{direct_write:?}").contains("不能同时提供 sessionId"),
        "expected scoped terminal.write to reject explicit sessionId bypass, got {direct_write:?}"
    );
    let _ = scoped_client.cancel().await;

    let _ = client.cancel().await;
    state.mcp_http_server().stop().expect("stop mcp server");
}
