#![allow(dead_code)]
// @author kongweiguang

use rmcp::model::ListToolsResult;
use serde_json::Value;

const EXPECTED_TOOL_IDS: &[&str] = &[
    "container.files.list",
    "container.files.preview",
    "container.files.write_text",
    "container.files.create_directory",
    "container.files.rename",
    "container.files.chmod",
    "container.files.upload",
    "container.files.download",
    "container.files.delete",
    "container.inspect",
    "container.list",
    "container.logs.tail",
    "container.remove",
    "container.restart",
    "container.start",
    "container.stats",
    "container.stop",
    "diagnostics.create_bundle",
    "diagnostics.runtime_health",
    "history.search",
    "kerminal.agent.current_session",
    "kerminal.agent.target_context",
    "kerminal.app_guide",
    "kerminal.capabilities",
    "kerminal.config_guide",
    "kerminal.config.validate",
    "kerminal.host.upsert_with_credential",
    "kerminal.tool_help",
    "kerminal.operation_guide",
    "kerminal.runtime_snapshot",
    "kerminal.vault.encrypt_secret",
    "port_forward.close",
    "port_forward.create",
    "port_forward.list",
    "server_info.snapshot",
    "sftp.chmod",
    "sftp.create_directory",
    "sftp.delete",
    "sftp.download",
    "sftp.download_directory",
    "sftp.list",
    "sftp.move",
    "sftp.preview",
    "sftp.rename",
    "sftp.transfer.cancel",
    "sftp.transfer.clear_completed",
    "sftp.transfer.enqueue",
    "sftp.transfer.list",
    "sftp.upload",
    "sftp.upload_directory",
    "ssh.command",
    "ssh.command_on_resolved_host",
    "terminal.close",
    "terminal.list",
    "terminal.reconnect",
    "terminal.log.start",
    "terminal.log.state",
    "terminal.log.stop",
    "terminal.resize",
    "terminal.resolve_agent_target",
    "terminal.snapshot",
    "terminal.write",
    "tmux.attach_plan",
    "tmux.capture_pane",
    "tmux.create_session",
    "tmux.kill_session",
    "tmux.list_panes",
    "tmux.list_sessions",
    "tmux.list_windows",
    "tmux.probe",
    "tmux.rename_session",
];

pub fn expected_mcp_tool_count() -> usize {
    EXPECTED_TOOL_IDS.len()
}

pub fn assert_tools_list_surface(tools: &ListToolsResult) {
    let tool_names = tools
        .tools
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(
        tool_names.len(),
        EXPECTED_TOOL_IDS.len(),
        "tools/list changed; update Kerminal MCP capability docs and tests"
    );
    for expected_tool in EXPECTED_TOOL_IDS {
        assert!(
            tool_names.contains(expected_tool),
            "expected {expected_tool} in tools/list"
        );
    }

    for required_tool in [
        "terminal.write",
        "ssh.command",
        "history.search",
        "diagnostics.runtime_health",
        "kerminal.app_guide",
        "kerminal.capabilities",
        "kerminal.config_guide",
        "kerminal.config.validate",
        "kerminal.tool_help",
        "kerminal.operation_guide",
        "kerminal.host.upsert_with_credential",
        "kerminal.vault.encrypt_secret",
        "tmux.probe",
        "tmux.list_sessions",
        "tmux.capture_pane",
        "tmux.attach_plan",
        "container.inspect",
        "container.logs.tail",
        "container.stats",
        "container.start",
        "container.stop",
        "container.restart",
        "container.remove",
        "container.files.write_text",
        "container.files.upload",
        "container.files.download",
        "container.files.delete",
    ] {
        assert!(
            tools.tools.iter().any(|tool| tool.name == required_tool),
            "expected {required_tool} in tools/list"
        );
    }

    for destructive_tool in ["container.remove", "container.files.delete"] {
        assert!(
            tools.tools.iter().any(|tool| {
                tool.name == destructive_tool
                    && tool
                        .annotations
                        .as_ref()
                        .and_then(|annotations| annotations.destructive_hint)
                        == Some(true)
            }),
            "{destructive_tool} must stay marked destructive"
        );
    }

    for removed_tool in [
        "remote_host.tree",
        "settings.get",
        "profile.list",
        "snippet.create",
        "workflow.run",
        "terminal.create",
        "workspace.focus_tab",
        "history.clear",
        "kerminal.host.migrate_legacy_secrets",
    ] {
        assert!(
            tools.tools.iter().all(|tool| tool.name != removed_tool),
            "{removed_tool} must stay out of tools/list"
        );
    }
}

pub fn assert_app_guide_payload(app_guide_payload: &Value) {
    assert_eq!(
        app_guide_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert!(app_guide_payload
        .pointer("/data/applicationSurfaces")
        .and_then(Value::as_array)
        .is_some_and(|surfaces| surfaces.iter().any(|surface| {
            surface.pointer("/surface").and_then(Value::as_str) == Some("rightToolPanel")
                && surface
                    .pointer("/runtimeTools/container")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/applicationSurfaces")
        .and_then(Value::as_array)
        .is_some_and(|surfaces| surfaces.iter().any(|surface| {
            surface.pointer("/surface").and_then(Value::as_str) == Some("machineSidebar")
                && surface
                    .pointer("/boundaries")
                    .and_then(Value::as_array)
                    .is_some_and(|boundaries| {
                        boundaries.iter().any(|boundary| {
                            boundary.as_str().is_some_and(|rule| {
                                rule.contains("SFTP-only")
                                    && rule.contains("host_capability_not_supported")
                            })
                        })
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/taskRoutes")
        .and_then(Value::as_array)
        .is_some_and(|routes| routes.iter().any(|route| {
            route.pointer("/task").and_then(Value::as_str) == Some("edit-kerminal-config")
                && route
                    .pointer("/toolIds")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("kerminal.config_guide"))
                            && tool_ids
                                .iter()
                                .any(|tool_id| tool_id.as_str() == Some("kerminal.config.validate"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/taskRoutes")
        .and_then(Value::as_array)
        .is_some_and(|routes| routes.iter().any(|route| {
            route.pointer("/task").and_then(Value::as_str) == Some("discover-mcp-capabilities")
                && route
                    .pointer("/toolIds")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("kerminal.capabilities"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/mcpBoundaries/configCrudAbsent")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));
}

pub fn assert_config_reference_payload(config_reference_payload: &Value) {
    assert_eq!(
        config_reference_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        config_reference_payload
            .pointer("/data/guideFile")
            .and_then(Value::as_str),
        Some("kerminal-config.md")
    );
    assert_eq!(
        config_reference_payload
            .pointer("/data/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    assert!(config_reference_payload
        .pointer("/data/markdown")
        .and_then(Value::as_str)
        .is_some_and(|markdown| {
            markdown.contains("Kerminal Configuration Guide")
                && markdown.contains("Do not look for MCP CRUD tools")
                && markdown.contains("kerminal.host.upsert_with_credential")
                && markdown.contains("key_passphrase_ref")
                && markdown.contains("inline_private_key")
        }));
    assert!(config_reference_payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));
}

pub fn assert_capability_payload(capability_payload: &Value) {
    assert_eq!(
        capability_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        capability_payload
            .pointer("/data/fileFirstConfiguration/manualGuideTool")
            .and_then(Value::as_str),
        Some("kerminal.config_guide")
    );
    assert_eq!(
        capability_payload
            .pointer("/data/fileFirstConfiguration/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    let capability_families = capability_payload
        .pointer("/data/runtimeToolFamilies")
        .and_then(Value::as_array)
        .expect("capability families");
    assert!(capability_families.iter().any(|family| {
        family
            .pointer("/family")
            .and_then(Value::as_str)
            .is_some_and(|name| name == "tmux")
            && family
                .pointer("/toolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| {
                    tool_ids
                        .iter()
                        .any(|tool_id| tool_id.as_str() == Some("tmux.capture_pane"))
                })
    }));
    let deliberately_absent = capability_payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .expect("absent tool families");
    assert!(deliberately_absent
        .iter()
        .any(|tool_family| tool_family.as_str() == Some("settings.*")));
    assert!(capability_payload
        .pointer("/data/sessionWorkspace/readFirst")
        .and_then(Value::as_array)
        .is_some_and(|paths| paths
            .iter()
            .any(|path| path.as_str() == Some("context/target-binding.json"))));
    for recommended_tool in [
        "kerminal.app_guide",
        "kerminal.config_guide",
        "kerminal.tool_help",
        "kerminal.operation_guide",
    ] {
        assert!(capability_payload
            .pointer("/data/recommendedFirstCalls")
            .and_then(Value::as_array)
            .is_some_and(|tool_ids| tool_ids
                .iter()
                .any(|tool_id| tool_id.as_str() == Some(recommended_tool))));
    }
}

pub fn assert_terminal_tool_help_payload(payload: &Value) {
    assert_eq!(
        payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        payload.pointer("/data/matchMode").and_then(Value::as_str),
        Some("toolId")
    );
    assert_tool_reference_examples_match_schema(payload);
    assert!(payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str) == Some("terminal.write")
                    && tool_reference
                        .pointer("/inputSchema/properties/data")
                        .is_some()
                    && tool_reference
                        .pointer("/exampleArguments/sessionId")
                        .and_then(Value::as_str)
                        .is_some()
                    && tool_reference
                        .pointer("/exampleArguments/agentSessionId")
                        .and_then(Value::as_str)
                        .is_some()
                    && tool_reference
                        .pointer("/annotations/readOnlyHint")
                        .and_then(Value::as_bool)
                        == Some(false)
            })
        }));
}

pub fn assert_container_tool_help_payload(payload: &Value) {
    assert_eq!(
        payload.pointer("/data/matchMode").and_then(Value::as_str),
        Some("family")
    );
    assert_tool_reference_examples_match_schema(payload);
    assert!(payload
        .pointer("/data/availableToolIds")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))));
    assert!(payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("container.files.delete")
                    && tool_reference
                        .pointer("/annotations/destructiveHint")
                        .and_then(Value::as_bool)
                        == Some(true)
            })
        }));
}

pub fn assert_absent_tool_help_payload(payload: &Value) {
    assert_eq!(
        payload
            .pointer("/data/matchedToolCount")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert!(payload
        .pointer("/data/absentToolMatches")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));
}

pub fn assert_config_operation_guide_payload(payload: &Value) {
    assert_eq!(
        payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        payload.pointer("/data/intent").and_then(Value::as_str),
        Some("config")
    );
    assert_eq!(
        payload
            .pointer("/data/fileFirstConfiguration/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    for workflow_tool in ["kerminal.config_guide", "kerminal.config.validate"] {
        assert!(payload
            .pointer("/data/workflow")
            .and_then(Value::as_array)
            .is_some_and(|steps| steps
                .iter()
                .any(
                    |step| step.pointer("/toolId").and_then(Value::as_str) == Some(workflow_tool)
                )));
    }
    assert!(payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));
    assert_tool_reference_examples_match_schema(payload);
    assert!(payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("kerminal.config_guide")
                    && tool_reference
                        .pointer("/exampleArguments")
                        .and_then(Value::as_object)
                        .is_some_and(|arguments| arguments.is_empty())
            }) && tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("kerminal.config.validate")
                    && tool_reference
                        .pointer("/exampleArguments/scope")
                        .and_then(Value::as_str)
                        == Some("all")
            })
        }));
}

pub fn assert_session_operation_guide_payload(payload: &Value) {
    assert_eq!(
        payload.pointer("/data/intent").and_then(Value::as_str),
        Some("session-terminal")
    );
    assert!(payload
        .pointer("/data/availableReferencedToolIds")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.agent.target_context"))));
    assert!(payload
        .pointer("/data/workflow")
        .and_then(Value::as_array)
        .is_some_and(|steps| {
            steps.iter().any(|step| {
                step.pointer("/toolId").and_then(Value::as_str) == Some("terminal.write")
            })
        }));
    assert_tool_reference_examples_match_schema(payload);
    assert!(payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str) == Some("terminal.write")
                    && tool_reference
                        .pointer("/exampleArguments/sessionId")
                        .and_then(Value::as_str)
                        .is_some()
                    && tool_reference
                        .pointer("/exampleArguments/agentSessionId")
                        .and_then(Value::as_str)
                        .is_some()
            })
        }));
}

pub fn assert_runtime_snapshot_payload(payload: &Value) {
    assert_eq!(
        payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        payload
            .pointer("/data/mcp/toolsOnly")
            .and_then(Value::as_bool),
        Some(true)
    );
    for (pointer, expected) in [
        ("/data/mcp/selfDiscoveryTool", "kerminal.capabilities"),
        ("/data/mcp/appGuideTool", "kerminal.app_guide"),
        ("/data/mcp/configGuideTool", "kerminal.config_guide"),
        ("/data/mcp/toolHelpTool", "kerminal.tool_help"),
        ("/data/mcp/operationGuideTool", "kerminal.operation_guide"),
        (
            "/data/fileFirstConfiguration/validator",
            "kerminal.config.validate",
        ),
    ] {
        assert_eq!(
            payload.pointer(pointer).and_then(Value::as_str),
            Some(expected)
        );
    }
    assert_eq!(
        payload
            .pointer("/data/mcp/exposedToolCount")
            .and_then(Value::as_u64),
        Some(expected_mcp_tool_count() as u64)
    );
    assert!(payload
        .pointer("/data/fileFirstConfiguration/hostDiscovery")
        .and_then(Value::as_str)
        .is_some_and(|rule| rule.contains("hosts/*.toml") && rule.contains("remote_host.*")));
}

pub fn assert_tool_reference_examples_match_schema(payload: &Value) {
    let tool_references = payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .expect("operation guide toolReference");
    assert!(
        !tool_references.is_empty(),
        "operation guide should include schema-backed tool references"
    );

    for tool_reference in tool_references {
        let tool_id = tool_reference
            .pointer("/id")
            .and_then(Value::as_str)
            .expect("tool reference id");
        let schema_properties = tool_reference
            .pointer("/inputSchema/properties")
            .and_then(Value::as_object)
            .expect("tool reference input schema properties");
        let Some(example_arguments) = tool_reference
            .pointer("/exampleArguments")
            .and_then(Value::as_object)
        else {
            continue;
        };

        for key in example_arguments.keys() {
            assert!(
                schema_properties.contains_key(key),
                "exampleArguments for {tool_id} contains `{key}`, but inputSchema does not"
            );
        }
    }
}
