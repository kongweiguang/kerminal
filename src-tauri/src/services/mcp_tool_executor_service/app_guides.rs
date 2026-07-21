//! Kerminal MCP app/capability/config guide tools.
//!
//! @author kongweiguang

use super::diagnostics_common::{
    absent_tool_families, available_tool_ids, exposed_tool_definitions,
};
use super::*;
use crate::services::external_agent_workspace::CONFIG_REFERENCE_BODY;

pub(super) fn execute_kerminal_capabilities(tools: &[ToolDefinition]) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let exposed_tool_count = exposed_tools.len();
    let write_tool_ids = exposed_tools
        .iter()
        .filter(|tool| !tool.annotations.read_only_hint && !tool.annotations.destructive_hint)
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();
    let destructive_tool_ids = exposed_tools
        .iter()
        .filter(|tool| tool.annotations.destructive_hint)
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal MCP 能力指南已读取：当前暴露 {exposed_tool_count} 个 tools；配置文件优先直接编辑，运行态能力通过 MCP 调用。"
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Help external AI agents understand which Kerminal MCP tools to call, which workspace files to read, and which capabilities are intentionally file-first or host-owned.",
            "recommendedFirstCalls": [
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
                "kerminal.agent.current_session",
                "kerminal.agent.target_context",
                "terminal.list",
                "kerminal.config.validate"
            ],
            "sessionWorkspace": {
                "readFirst": [
                    "AGENTS.md",
                    "CLAUDE.md",
                    "context/mcp-endpoint.json",
                    "context/target-binding.json",
                    "context/terminal-snapshot.json",
                    "kerminal-config.md"
                ],
                "refreshTools": [
                    "kerminal.agent.current_session",
                    "kerminal.agent.target_context",
                    "terminal.snapshot"
                ],
                "terminalWriteRule": "Before terminal.write, resolve the target with kerminal.agent.target_context or terminal.resolve_agent_target. For session-bound writes pass agentSessionId, bindingGeneration, and data; stale or mismatched targets require user rebind."
            },
            "managedSshRuntime": {
                "inspectTool": "kerminal.runtime_snapshot",
                "snapshotPath": "managedSsh",
                "appliesToFamilies": ["ssh", "sftp", "tmux", "container", "portForward", "serverInfo"],
                "sharedSessionRule": "SSH hosts may reuse one authenticated ManagedSshSession across terminal, SFTP, exec/tmux/system/container, port-forward, and MCP SSH tools. SFTP-only hosts may use only SFTP channels; shell-derived capability families fail closed before transport.",
                "channelRule": "Reuse does not mean a single blocking stream: shell, SFTP, exec, and forwarding use separate managed channels with counts, queue depth, timeout, cancel, cleanup, and recent-failure diagnostics.",
                "fallbackRule": "Only unsupported or unwired managed backends may fall back to legacy paths; auth, host-key, connect, subsystem, exec, or channel-open failures must remain managed runtime errors.",
                "secretBoundary": "managedSsh diagnostics are redacted and must not expose passwords, private keys, key passphrases, raw env, or vault refs."
            },
            "runtimeToolFamilies": [
                capability_family("agentSession", "Use the current Kerminal Agent session and bound target safely.", &exposed_tools, &["kerminal.agent.", "terminal.resolve_agent_target"]),
                capability_family("terminal", "Read and write existing terminal sessions; creation and UI focus stay in the app/UI host.", &exposed_tools, &["terminal."]),
                capability_family("ssh", "Run non-interactive commands on saved SSH hosts through the managed SSH exec facade; SFTP-only hosts are rejected before transport.", &exposed_tools, &["ssh."]),
                capability_family("sftp", "Browse, preview, transfer, and manage remote files for saved SSH or SFTP-only hosts through the managed SSH SFTP subsystem/runtime.", &exposed_tools, &["sftp."]),
                capability_family("tmux", "Probe, list, create, rename, kill, inspect, capture, and attach-plan tmux sessions through managed exec on SSH targets.", &exposed_tools, &["tmux."]),
                capability_family("container", "List, inspect, tail logs, read stats, manage lifecycle, and browse, edit, transfer, or manage files for SSH-host Docker/Podman containers through managed SSH exec/SFTP capabilities.", &exposed_tools, &["container."]),
                capability_family("portForward", "Create, list, and close managed SSH port forwards and local proxy entries; runtime diagnostics show session/channel/tunnel ownership.", &exposed_tools, &["port_forward."]),
                capability_family("serverInfo", "Read machine health and system snapshots for SSH hosts through managed SSH exec.", &exposed_tools, &["server_info."]),
                capability_family("history", "Search command history; history writes, deletes, and clears are intentionally absent.", &exposed_tools, &["history."]),
                capability_family("diagnostics", "Read app guide, generated config guide, tool help, runtime health, operation guide, runtime snapshot, create redacted diagnostic bundles, and validate file-backed config.", &exposed_tools, &["diagnostics.", "kerminal.config.validate", "kerminal.app_guide", "kerminal.config_guide", "kerminal.capabilities", "kerminal.tool_help", "kerminal.operation_guide", "kerminal.runtime_snapshot"]),
                capability_family("credentials", "Save authorized SSH credentials into the encrypted vault without writing plaintext into ordinary config files.", &exposed_tools, &["kerminal.host.", "kerminal.vault."])
            ],
            "fileFirstConfiguration": {
                "editableFiles": [
                    "settings.toml",
                    "profiles/*.toml",
                    "hosts/groups.toml",
                    "hosts/*.toml",
                    "snippets/*.toml",
                    "workflows/*.toml"
                ],
                "manualGuide": "kerminal-config.md",
                "manualGuideTool": "kerminal.config_guide",
                "validator": "kerminal.config.validate",
                "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential changes use the UI save flow, kerminal.host.upsert_with_credential, or kerminal.vault.encrypt_secret; ordinary host files keep secret_ref only.",
                "autoRefresh": "When Kerminal is running, valid file-backed config edits auto-refresh the UI; invalid TOML keeps last-known-good. This does not replace validation."
            },
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "hostPolicy": {
                "approvalOwner": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "kerminalRole": "Kerminal exposes tools, validates arguments, restricts HTTP MCP to loopback, and redacts sensitive output where applicable."
            },
            "toolCounts": {
                "exposed": exposed_tool_count,
                "write": write_tool_ids.len(),
                "destructive": destructive_tool_ids.len()
            },
            "writeToolIds": write_tool_ids,
            "destructiveToolIds": destructive_tool_ids
        })),
        entities: exposed_tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "mcpTool",
                    "id": tool.id.as_str(),
                    "category": tool.category.clone(),
                    "categoryLabel": tool.category.label(),
                    "readOnly": tool.annotations.read_only_hint,
                    "destructive": tool.annotations.destructive_hint,
                    "openWorld": tool.annotations.open_world_hint
                })
            })
            .collect(),
        next_hints: vec![
            "When you know the task type, call kerminal.operation_guide with an intent such as terminal, config, sftp, tmux, or credentials.".to_owned(),
            "For session work, call kerminal.agent.target_context before terminal.write.".to_owned(),
            "For SSH-bound tools, inspect kerminal.runtime_snapshot.managedSsh to confirm managed session/channel reuse before assuming a separate SSH connection is needed.".to_owned(),
            "For config edits, read kerminal-config.md, edit files directly, then call kerminal.config.validate.".to_owned(),
            "Use kerminal.tool_help for exact schemas, examples, and safety annotations before calling a specific runtime tool.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_app_guide(tools: &[ToolDefinition]) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let tool_family = |candidate_tool_ids: &[&'static str]| {
        available_tool_ids(&exposed_tools, candidate_tool_ids)
    };
    let discovery_tools = tool_family(&[
        "kerminal.app_guide",
        "kerminal.capabilities",
        "kerminal.tool_help",
        "kerminal.operation_guide",
        "kerminal.runtime_snapshot",
        "kerminal.agent.current_session",
        "kerminal.agent.target_context",
        "terminal.list",
        "terminal.snapshot",
    ]);
    let terminal_tools = tool_family(&[
        "terminal.list",
        "terminal.snapshot",
        "terminal.write",
        "terminal.resize",
        "terminal.resolve_agent_target",
        "terminal.log.start",
        "terminal.log.stop",
        "terminal.log.state",
        "terminal.close",
    ]);
    let remote_tools = tool_family(&[
        "ssh.command",
        "ssh.command_on_resolved_host",
        "server_info.snapshot",
        "history.search",
    ]);
    let sftp_tools = tool_family(&[
        "sftp.list",
        "sftp.preview",
        "sftp.upload",
        "sftp.upload_directory",
        "sftp.download",
        "sftp.download_directory",
        "sftp.rename",
        "sftp.move",
        "sftp.create_directory",
        "sftp.chmod",
        "sftp.delete",
        "sftp.transfer.enqueue",
        "sftp.transfer.list",
        "sftp.transfer.cancel",
        "sftp.transfer.clear_completed",
    ]);
    let container_tools = tool_family(&[
        "container.list",
        "container.inspect",
        "container.logs.tail",
        "container.stats",
        "container.start",
        "container.stop",
        "container.restart",
        "container.remove",
        "container.files.list",
        "container.files.preview",
        "container.files.write_text",
        "container.files.upload",
        "container.files.download",
        "container.files.create_directory",
        "container.files.rename",
        "container.files.chmod",
        "container.files.delete",
    ]);
    let tmux_tools = tool_family(&[
        "tmux.probe",
        "tmux.list_sessions",
        "tmux.create_session",
        "tmux.rename_session",
        "tmux.kill_session",
        "tmux.list_windows",
        "tmux.list_panes",
        "tmux.capture_pane",
        "tmux.attach_plan",
    ]);
    let port_forward_tools = tool_family(&[
        "port_forward.list",
        "port_forward.create",
        "port_forward.close",
    ]);
    let credential_tools = tool_family(&[
        "kerminal.host.upsert_with_credential",
        "kerminal.vault.encrypt_secret",
    ]);
    let config_tools = tool_family(&["kerminal.config_guide", "kerminal.config.validate"]);
    let diagnostics_tools = tool_family(&[
        "diagnostics.runtime_health",
        "diagnostics.create_bundle",
        "kerminal.config_guide",
        "kerminal.config.validate",
    ]);

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(
            "Kerminal 应用导航指南已读取：返回主界面区域、AI 可用 runtime 工具、配置文件边界和推荐入口。".to_owned(),
        ),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Give external AI agents a product-level map of Kerminal before choosing low-level runtime tools. This guide is read-only and does not perform UI choreography.",
            "recommendedEntrySequence": [
                "Read AGENTS.md / CLAUDE.md in the workspace or session root.",
                "Call kerminal.app_guide for product structure and MCP routing.",
                "Call kerminal.capabilities for the exact tool map and absent-tool boundaries.",
                "Call kerminal.tool_help with a toolId, family, or query when you need exact schemas, examples, and safety annotations.",
                "Call kerminal.config_guide before file-backed configuration edits when kerminal-config.md is not already available.",
                "Call kerminal.runtime_snapshot for the current live terminals, Agent sessions, and port forwards.",
                "Call kerminal.operation_guide with a task intent before invoking write or destructive tools."
            ],
            "applicationSurfaces": [
                {
                    "surface": "machineSidebar",
                    "userSees": "Saved Local/SSH/SFTP/RDP/Telnet/Serial targets, groups, tags, connection entry points, and host context actions. Double-clicking an SFTP-only host opens the central transfer workbench without creating a terminal.",
                    "aiCanDo": [
                        "Read or update host/profile/group files directly when the user asks for configuration changes.",
                        "Run non-interactive SSH commands through saved credentials.",
                        "Open runtime views indirectly by using the corresponding MCP tool family rather than UI choreography."
                    ],
                    "runtimeTools": remote_tools.clone(),
                    "fileBackedConfig": ["hosts/groups.toml", "hosts/*.toml", "profiles/*.toml"],
                    "boundaries": [
                        "Do not expect remote_host.* CRUD/list MCP tools.",
                        "Do not read secrets/vault*.toml directly.",
                        "SFTP-only hosts expose file operations only; SSH command, terminal, tmux, container, server-info, and port-forward tools reject them with host_capability_not_supported.",
                        "Ask for user/host approval before production writes or destructive remote commands."
                    ]
                },
                {
                    "surface": "terminalWorkspace",
                    "userSees": "Tabs, panes, split terminal workspace, command blocks, search, terminal logs, and bound target terminals for Agent sessions.",
                    "aiCanDo": [
                        "List and inspect existing terminals.",
                        "Write to an explicitly selected live terminal or the generation-matched Agent-bound target.",
                        "Resize terminals and manage terminal logging when requested."
                    ],
                    "runtimeTools": terminal_tools.clone(),
                    "sessionContextFiles": [
                        "context/mcp-endpoint.json",
                        "context/target-binding.json",
                        "context/terminal-snapshot.json"
                    ],
                    "boundaries": [
                        "MCP does not create terminals or focus UI tabs.",
                        "Before terminal.write, resolve and inspect the target.",
                        "Stale, closed, missing, or generation-mismatched Agent targets require user rebind."
                    ]
                },
                {
                    "surface": "rightToolPanel",
                    "userSees": "Agent Launcher, System, Files/SFTP, Ports, tmux, Snippets, Logs, and Settings.",
                    "aiCanDo": [
                        "Use runtime tools matching the right-panel domain.",
                        "Use file-first config for snippets, workflows, settings, hosts, and profiles.",
                        "Use diagnostics and runtime snapshot for app health, current state, and managed SSH session/channel reuse."
                    ],
                    "runtimeTools": {
                        "sftp": sftp_tools.clone(),
                        "tmux": tmux_tools.clone(),
                        "container": container_tools.clone(),
                        "portForward": port_forward_tools.clone(),
                        "diagnostics": diagnostics_tools.clone()
                    },
                    "fileBackedConfig": [
                        "settings.toml",
                        "snippets/*.toml",
                        "workflows/*.toml"
                    ],
                    "boundaries": [
                        "Do not expect settings.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools.",
                        "Edit configuration files directly and validate.",
                        "Inspect kerminal.runtime_snapshot.managedSsh before treating SFTP, tmux, container, server-info, or port-forward failures as independent SSH login failures.",
                        "MCP host owns confirmation, approval, permissions, hooks, and audit."
                    ]
                },
                {
                    "surface": "agentLauncher",
                    "userSees": "Codex, Claude, or custom CLI sessions launched from Kerminal with session-scoped workspace files.",
                    "aiCanDo": [
                        "Read current Agent session metadata.",
                        "Resolve the bound target and refresh terminal snapshot.",
                        "Operate the bound target with generation-checked terminal.write."
                    ],
                    "runtimeTools": discovery_tools.clone(),
                    "sessionWorkspaceFiles": [
                        "AGENTS.md",
                        "CLAUDE.md",
                        ".codex/config.toml",
                        ".mcp.json",
                        "context/mcp-endpoint.json",
                        "context/target-binding.json",
                        "context/terminal-snapshot.json"
                    ],
                    "boundaries": [
                        "Kerminal does not own model provider, account state, approval UI, hooks, or audit.",
                        "Agent terminal TUI behavior remains owned by the external CLI and MCP host."
                    ]
                },
                {
                    "surface": "configurationWorkspace",
                    "userSees": "~/.kerminal as the file-backed runtime workspace.",
                    "aiCanDo": [
                        "Read kerminal-config.md or call kerminal.config_guide before edits.",
                        "Edit ordinary TOML files directly.",
                        "Validate with kerminal.config.validate after every config edit.",
                        "Use authorized credential tools for encrypted vault writes."
                    ],
                    "runtimeTools": {
                        "config": config_tools.clone(),
                        "credentials": credential_tools.clone()
                    },
                    "editableFiles": [
                        "settings.toml",
                        "profiles/*.toml",
                        "hosts/groups.toml",
                        "hosts/*.toml",
                        "snippets/*.toml",
                        "workflows/*.toml"
                    ],
                    "protectedFiles": [
                        "data/command.sqlite",
                        "secrets/vault.toml",
                        "secrets/vault-key.toml",
                        "logs/",
                        "cache/",
                        "temp/"
                    ]
                }
            ],
            "taskRoutes": [
                app_task_route("understand-current-state", "Call kerminal.runtime_snapshot, then terminal.list or kerminal.agent.target_context if terminal context matters.", &discovery_tools),
                app_task_route("discover-mcp-capabilities", "Call kerminal.capabilities to read the current tool map, recommended first calls, file-first configuration boundary, and deliberately absent tool families.", &discovery_tools),
                app_task_route("operate-terminal", "Use terminal.list/snapshot/write on an explicit live terminal; in Agent sessions use kerminal.agent.target_context first.", &terminal_tools),
                app_task_route("run-ssh-command", "Identify a protocol=ssh host id from target context or hosts/*.toml, inspect managedSsh runtime reuse, then use ssh.command_on_resolved_host or ssh.command. Do not invoke this route for protocol=sftp hosts.", &remote_tools),
                app_task_route("manage-remote-files", "Identify an SSH or SFTP-only host, inspect managedSsh runtime reuse, then use sftp.list/preview before transfer or path changes; use transfer queue for long work.", &sftp_tools),
                app_task_route("manage-containers", "Inspect managedSsh runtime reuse, then use container.list/inspect/logs/stats first; use container.files.* for container filesystem work.", &container_tools),
                app_task_route("manage-tmux", "Inspect managedSsh runtime reuse, then probe and list sessions before capture/create/rename/kill/attach planning.", &tmux_tools),
                app_task_route("manage-port-forwarding", "Inspect managedSsh runtime reuse, then use port_forward.list before create or close; keep risky remote exposure behind user approval.", &port_forward_tools),
                app_task_route("edit-kerminal-config", "Read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate.", &config_tools),
                app_task_route("save-credentials", "Use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret only when the user explicitly provides/authorizes credential material.", &credential_tools),
                app_task_route("diagnose-app", "Use diagnostics.runtime_health, diagnostics.create_bundle, and runtime_snapshot; outputs are redacted where applicable.", &diagnostics_tools)
                ,
                app_task_route("inspect-tool-schema", "Use kerminal.tool_help with toolId, family, or query to retrieve schema-backed examples and safety annotations.", &discovery_tools)
            ],
            "mcpBoundaries": {
                "toolsOnly": true,
                "hostPolicyOwner": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "configCrudAbsent": ["settings.*", "profile.*", "remote_host.*", "snippet.*", "workflow.*", "workspace.*"],
                "uiChoreographyAbsent": ["terminal.create", "terminal.resolve_current", "workspace.focus_tab"],
                "historyWriteAbsent": ["history.record", "history.delete", "history.clear"]
            },
            "nextActions": [
                "Use this app guide for product orientation, then call kerminal.operation_guide with the closest intent.",
                "Use kerminal.tool_help for exact schemas, examples, and safety annotations before invoking any non-read-only tool.",
                "For config edits, call kerminal.config_guide or read kerminal-config.md before editing.",
                "For file-backed config, prefer direct file edits plus kerminal.config.validate instead of looking for MCP CRUD."
            ]
        })),
        entities: exposed_tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "mcpTool",
                    "id": tool.id.as_str(),
                    "category": tool.category.clone(),
                    "readOnly": tool.annotations.read_only_hint,
                    "destructive": tool.annotations.destructive_hint
                })
            })
            .collect(),
        next_hints: vec![
            "Call kerminal.operation_guide with a specific intent before write or destructive actions."
                .to_owned(),
            "Call kerminal.runtime_snapshot to see current live app state.".to_owned(),
            "Use direct file edits plus kerminal.config.validate for file-backed configuration."
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_config_guide() -> ToolExecutionResult {
    let line_count = CONFIG_REFERENCE_BODY.lines().count();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 配置指南已读取：返回与 kerminal-config.md 同源的 {line_count} 行规则正文；配置仍然是直接编辑文件后调用 kerminal.config.validate。"
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "guideFile": "kerminal-config.md",
            "lineCount": line_count,
            "purpose": "Expose the generated Kerminal configuration guide through MCP for external agents that do not have direct access to the initialized workspace files. This tool is read-only and does not perform config CRUD.",
            "markdown": CONFIG_REFERENCE_BODY,
            "editableFiles": [
                "settings.toml",
                "profiles/*.toml",
                "hosts/groups.toml",
                "hosts/*.toml",
                "snippets/*.toml",
                "workflows/*.toml"
            ],
            "protectedPaths": [
                "data/command.sqlite",
                "secrets/vault.toml",
                "secrets/vault-key.toml",
                "logs/",
                "cache/",
                "temp/"
            ],
            "validator": "kerminal.config.validate",
            "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential work uses kerminal.host.upsert_with_credential, kerminal.vault.encrypt_secret, or the Kerminal UI save flow; ordinary host files keep secret_ref only.",
            "mcpCrudBoundary": "Do not look for settings.*, profile.*, remote_host.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools. Edit file-backed config directly and validate.",
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "nextActions": [
                "Use this guide before editing file-backed Kerminal configuration.",
                "After edits, call kerminal.config.validate with scope all or the narrowest matching scope.",
                "For credential material, use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret instead of ordinary TOML fields."
            ]
        })),
        entities: vec![json!({
            "type": "configGuide",
            "path": "kerminal-config.md",
            "validator": "kerminal.config.validate"
        })],
        next_hints: vec![
            "For config edits, keep changes in ordinary TOML files small and validate with kerminal.config.validate.".to_owned(),
            "For secrets, do not read secrets/; use authorized credential tools instead.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn capability_family(
    family: &str,
    use_when: &str,
    tools: &[&ToolDefinition],
    prefixes_or_ids: &[&str],
) -> Value {
    let tool_ids = tools
        .iter()
        .filter(|tool| {
            prefixes_or_ids
                .iter()
                .any(|prefix_or_id| tool.id == *prefix_or_id || tool.id.starts_with(*prefix_or_id))
        })
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();

    json!({
        "family": family,
        "useWhen": use_when,
        "toolIds": tool_ids
    })
}

fn app_task_route(task: &str, route: &str, tool_ids: &[&str]) -> Value {
    json!({
        "task": task,
        "route": route,
        "toolIds": tool_ids
    })
}
