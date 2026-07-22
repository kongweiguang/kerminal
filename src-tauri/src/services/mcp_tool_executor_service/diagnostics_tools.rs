use super::diagnostics_common::{absent_tool_families, exposed_tool_definitions, tool_references};
use super::*;
use crate::models::target::RemoteTargetRef;

pub(super) fn execute_kerminal_tool_help(
    tools: &[ToolDefinition],
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let requested_tool_id = optional_nonempty_argument(arguments, "toolId");
    let requested_family = optional_nonempty_argument(arguments, "family");
    let requested_query = optional_nonempty_argument(arguments, "query");
    let include_schemas = arguments
        .get("includeSchemas")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let (match_mode, matched_tool_ids) = if let Some(tool_id) = requested_tool_id.as_deref() {
        (
            "toolId",
            exposed_tools
                .iter()
                .filter(|tool| tool.id.as_str() == tool_id)
                .map(|tool| tool.id.as_str())
                .collect::<Vec<_>>(),
        )
    } else if let Some(family) = requested_family.as_deref() {
        ("family", tool_ids_for_help_family(&exposed_tools, family))
    } else if let Some(query) = requested_query.as_deref() {
        ("query", tool_ids_for_help_query(&exposed_tools, query))
    } else {
        (
            "default",
            tool_ids_matching_prefixes(
                &exposed_tools,
                &[
                    "kerminal.app_guide",
                    "kerminal.config_guide",
                    "kerminal.capabilities",
                    "kerminal.tool_help",
                    "kerminal.operation_guide",
                    "kerminal.runtime_snapshot",
                ],
            ),
        )
    };

    let mut tool_reference = tool_references(&exposed_tools, &matched_tool_ids);
    if !include_schemas {
        for reference in &mut tool_reference {
            if let Some(object) = reference.as_object_mut() {
                object.remove("inputSchema");
            }
        }
    }

    let missing_tool_ids = requested_tool_id
        .as_deref()
        .filter(|_| matched_tool_ids.is_empty())
        .map(|tool_id| vec![tool_id.to_owned()])
        .unwrap_or_default();
    let absent_filter = requested_tool_id
        .as_deref()
        .or(requested_family.as_deref())
        .or(requested_query.as_deref());
    let absent_tool_matches = matching_absent_tool_families(absent_filter);
    let summary_suffix = if matched_tool_ids.is_empty() && !absent_tool_matches.is_empty() {
        format!(
            "；请求匹配 {} 个故意缺席的工具族，请按替代路径处理",
            absent_tool_matches.len()
        )
    } else if matched_tool_ids.is_empty() {
        "；未匹配到当前暴露的 MCP tools".to_owned()
    } else {
        String::new()
    };
    let entities = matched_tool_ids
        .iter()
        .map(|tool_id| json!({ "type": "mcpTool", "id": tool_id }))
        .collect::<Vec<_>>();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 工具帮助已读取：matchMode={match_mode}，匹配 {} 个当前暴露 tools{}。",
            matched_tool_ids.len(),
            summary_suffix
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Return schema-backed help for currently exposed Kerminal MCP tools without executing the selected tools.",
            "filters": {
                "toolId": requested_tool_id,
                "family": requested_family,
                "query": requested_query,
                "includeSchemas": include_schemas
            },
            "matchMode": match_mode,
            "matchedToolCount": matched_tool_ids.len(),
            "toolReference": tool_reference,
            "availableToolIds": matched_tool_ids,
            "missingToolIds": missing_tool_ids,
            "absentToolMatches": absent_tool_matches,
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "fallbacks": [
                "Call kerminal.operation_guide when you need a task sequence rather than a single tool schema.",
                "Use tools/list for the raw MCP protocol list when your host needs the unprocessed catalog.",
                "For file-backed configuration, read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate.",
                "For SSH terminal/SFTP/exec/tmux/container/port-forward reuse, inspect kerminal.runtime_snapshot.managedSsh before assuming each tool opens a separate SSH connection.",
                "For external SSH launch compatibility, inspect kerminal.runtime_snapshot.externalLaunch; edit settings.toml externalLaunch and validate instead of looking for external_launch.* MCP control tools."
            ],
            "managedSshRuntime": {
                "inspectTool": "kerminal.runtime_snapshot",
                "snapshotPath": "managedSsh",
                "diagnosticFields": [
                    "runtime.managedSshActiveSessionCount",
                    "runtime.managedSshActiveChannelCount",
                    "managedSsh.sessions[].channelCounts",
                    "managedSsh.sessions[].pendingExecRequests",
                    "managedSsh.sessions[].lastError"
                ],
                "appliesToFamilies": ["ssh", "sftp", "tmux", "container", "portForward", "serverInfo"],
                "sharedSessionRule": "Kerminal owns the authenticated ManagedSshSession and opens separate shell, SFTP, exec, and forwarding channels for host-bound tools.",
                "fallbackRule": "Only unsupported or unwired managed backends may fall back to legacy paths; auth, host-key, connect, subsystem, exec, or channel-open failures should not silently create a new legacy SSH connection.",
                "secretBoundary": "managedSsh output is redacted and must not include passwords, private keys, key passphrases, raw env, or vault refs."
            },
            "safetyBoundaries": {
                "readOnly": "kerminal.tool_help is read-only and never invokes the referenced tool.",
                "hostPolicy": "The MCP host owns confirmation, approval, permissions, hooks, and audit before write or destructive tools.",
                "fileFirstConfiguration": "settings/profile/host/snippet/workflow CRUD tools are deliberately absent; use direct file edits plus validation.",
                "managedSsh": "SSH-bound tool families reuse a managed runtime where possible; diagnostics prove session/channel ownership without exposing credential material.",
                "externalLaunch": "External launch passwords and passphrases are session-only; MCP diagnostics expose policy, counts, launch ids, and redacted rejection metadata only.",
                "secrets": "Do not extract or print stored secrets. Authorized credential writes use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret."
            },
            "nextActions": [
                "Call the selected read-only discovery or runtime tool only after checking required arguments.",
                "For SSH-bound operations, call kerminal.runtime_snapshot and inspect managedSsh before and after the operation when debugging session reuse.",
                "For terminal.write, resolve and inspect the target first; session-bound writes require agentSessionId, bindingGeneration, and data.",
                "For destructive tools, require clear user intent and host-side approval/audit."
            ]
        })),
        entities,
        next_hints: vec![
            "Use kerminal.operation_guide for task-level call order.".to_owned(),
            "Use kerminal.config_guide and kerminal.config.validate for file-backed configuration work.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn optional_nonempty_argument(
    arguments: &serde_json::Map<String, Value>,
    name: &str,
) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn tool_ids_for_help_family<'a>(
    tools: &[&'a ToolDefinition],
    requested_family: &str,
) -> Vec<&'a str> {
    let normalized_family = requested_family
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    match normalized_family.as_str() {
        "discovery" | "guide" | "guides" => tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
            ],
        ),
        "agent" | "agent-session" | "session" => tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.agent.",
                "terminal.resolve_agent_target",
                "terminal.snapshot",
                "terminal.write",
            ],
        ),
        "terminal" => tool_ids_matching_prefixes(tools, &["terminal."]),
        "ssh" | "ssh-command" => tool_ids_matching_prefixes(tools, &["ssh."]),
        "sftp" => tool_ids_matching_prefixes(tools, &["sftp."]),
        "tmux" => tool_ids_matching_prefixes(tools, &["tmux."]),
        "container" | "docker" | "podman" => tool_ids_matching_prefixes(tools, &["container."]),
        "port" | "port-forward" | "port-forwarding" => {
            tool_ids_matching_prefixes(tools, &["port_forward."])
        }
        "server" | "server-info" => tool_ids_matching_prefixes(tools, &["server_info."]),
        "history" => tool_ids_matching_prefixes(tools, &["history."]),
        "diagnostics" | "diagnostic" => tool_ids_matching_prefixes(
            tools,
            &[
                "diagnostics.",
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
                "kerminal.config.validate",
            ],
        ),
        "external-launch" | "external-ssh-launch" | "bastion-launch" | "jump-host-launch" => {
            tool_ids_matching_prefixes(
                tools,
                &[
                    "kerminal.runtime_snapshot",
                    "kerminal.config_guide",
                    "kerminal.operation_guide",
                    "kerminal.tool_help",
                    "kerminal.config.validate",
                ],
            )
        }
        "config" | "configuration" => tool_ids_matching_prefixes(
            tools,
            &["kerminal.config_guide", "kerminal.config.validate"],
        ),
        "credentials" | "credential" | "vault" | "secret" => {
            tool_ids_matching_prefixes(tools, &["kerminal.host.", "kerminal.vault."])
        }
        _ => Vec::new(),
    }
}

fn tool_ids_matching_prefixes<'a>(
    tools: &[&'a ToolDefinition],
    prefixes_or_ids: &[&str],
) -> Vec<&'a str> {
    tools
        .iter()
        .filter(|tool| {
            prefixes_or_ids
                .iter()
                .any(|prefix_or_id| tool.id == *prefix_or_id || tool.id.starts_with(*prefix_or_id))
        })
        .map(|tool| tool.id.as_str())
        .collect()
}

fn tool_ids_for_help_query<'a>(
    tools: &[&'a ToolDefinition],
    requested_query: &str,
) -> Vec<&'a str> {
    let normalized_query = requested_query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Vec::new();
    }

    let mut matches = tools
        .iter()
        .filter(|tool| {
            tool.id.to_ascii_lowercase().contains(&normalized_query)
                || tool.title.to_ascii_lowercase().contains(&normalized_query)
                || tool
                    .description
                    .to_ascii_lowercase()
                    .contains(&normalized_query)
                || tool
                    .category
                    .label()
                    .to_ascii_lowercase()
                    .contains(&normalized_query)
        })
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();

    if normalized_query.contains("managed ssh")
        || normalized_query.contains("ssh reuse")
        || normalized_query.contains("session reuse")
        || normalized_query.contains("shared ssh")
        || normalized_query.contains("sftp reconnect")
        || normalized_query.contains("sftp reuse")
    {
        for tool_id in tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.runtime_snapshot",
                "ssh.",
                "sftp.",
                "tmux.",
                "container.",
                "port_forward.",
                "server_info.",
            ],
        ) {
            if !matches.contains(&tool_id) {
                matches.push(tool_id);
            }
        }
    }

    if normalized_query.contains("external launch")
        || normalized_query.contains("external ssh")
        || normalized_query.contains("bastion")
        || normalized_query.contains("jump host")
        || normalized_query.contains("jump-host")
        || normalized_query.contains("mobaxterm")
        || normalized_query.contains("putty")
    {
        for tool_id in tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.runtime_snapshot",
                "kerminal.config_guide",
                "kerminal.operation_guide",
                "kerminal.tool_help",
                "kerminal.config.validate",
            ],
        ) {
            if !matches.contains(&tool_id) {
                matches.push(tool_id);
            }
        }
    }

    matches
}

fn matching_absent_tool_families(filter: Option<&str>) -> Vec<&'static str> {
    let Some(filter) = filter else {
        return Vec::new();
    };
    let normalized_filter = filter.trim().to_ascii_lowercase();
    let dashed_filter = normalized_filter.replace('_', "-");

    absent_tool_families()
        .into_iter()
        .filter(|family| {
            let family_lower = family.to_ascii_lowercase();
            let family_token = family_lower
                .trim_end_matches('*')
                .trim_end_matches('.')
                .to_owned();
            let dashed_family_token = family_token.replace('_', "-");

            normalized_filter.contains(&family_token)
                || dashed_filter.contains(&dashed_family_token)
                || family_lower.contains(&normalized_filter)
        })
        .collect()
}

pub(super) async fn execute_server_info_snapshot(
    server_info: &ServerInfoService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };

    match server_info
        .snapshot_native(
            remote_hosts,
            paths,
            ssh_commands,
            ServerInfoRequest {
                target: RemoteTargetRef::Ssh {
                    host_id: host_id.clone(),
                },
                host_id,
            },
        )
        .await
    {
        Ok(snapshot) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_server_info_snapshot_for_agent(&snapshot)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

/// 将服务器信息快照压缩成外部 Agent 可读摘要。
pub fn summarize_server_info_snapshot_for_agent(snapshot: &ServerInfoSnapshot) -> String {
    let system = [snapshot.os.as_deref(), snapshot.architecture.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let system = if system.is_empty() {
        "未知系统"
    } else {
        &system
    };
    let cpu = snapshot
        .cpu_usage_percent
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "未知".to_owned());
    let memory = percent_summary(snapshot.memory_used_bytes, snapshot.memory_total_bytes);
    let disk = percent_summary(snapshot.disk_used_bytes, snapshot.disk_total_bytes);
    let uptime = snapshot
        .uptime_seconds
        .map(format_duration)
        .unwrap_or_else(|| "未知".to_owned());

    format!(
        "服务器信息已读取：{}（{}@{}:{}），系统：{}，CPU：{}，内存：{}，磁盘：{}，运行时间：{}。",
        snapshot.host_name,
        snapshot.username,
        snapshot.host,
        snapshot.port,
        system,
        cpu,
        memory,
        disk,
        uptime
    )
}

pub(super) fn execute_diagnostics_runtime_health(
    diagnostics: &DiagnosticsService,
    paths: &KerminalPaths,
    command_store: &CommandSqliteStore,
) -> ToolExecutionResult {
    match diagnostics.runtime_health(paths, command_store) {
        Ok(snapshot) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_runtime_health_for_agent(&snapshot)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_diagnostics_create_bundle(
    diagnostics: &DiagnosticsService,
    paths: &KerminalPaths,
    command_store: &CommandSqliteStore,
    settings: &SettingsService,
    terminals: &TerminalManager,
) -> ToolExecutionResult {
    let settings = match settings.load_settings() {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    match diagnostics.create_bundle(paths, command_store, terminals, settings) {
        Ok(bundle) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_diagnostic_bundle_for_agent(&bundle)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_runtime_health_for_agent(snapshot: &RuntimeHealthSnapshot) -> String {
    let process_memory = byte_size_summary(snapshot.process.memory_bytes);
    let system_memory = percent_summary(
        Some(snapshot.system.used_memory_bytes),
        Some(snapshot.system.total_memory_bytes),
    );
    let data_root_size = byte_size_summary(snapshot.storage.root_size_bytes);
    let command_database_size =
        byte_size_summary(snapshot.storage.command_database_file_size_bytes);

    format!(
        "运行体检已读取：进程 {}({}) CPU {:.1}%，内存 {}；系统 {} {}，CPU {:.1}%，内存 {}；数据目录 {}，命令库 {}；采样 {} / {}ms，已脱敏。",
        snapshot.process.name,
        snapshot.process.pid,
        snapshot.process.cpu_usage_percent,
        process_memory,
        snapshot.system.os,
        snapshot.system.arch,
        snapshot.system.global_cpu_usage_percent,
        system_memory,
        data_root_size,
        command_database_size,
        snapshot.sampling.source,
        snapshot.sampling.cpu_sample_interval_ms
    )
}

pub(super) fn summarize_diagnostic_bundle_for_agent(bundle: &DiagnosticBundle) -> String {
    let redacted_label = if bundle.redacted { "是" } else { "否" };
    format!(
        "诊断包已生成：{}，大小 {}，分区 {} 个，已脱敏：{}，路径：{}。",
        bundle.file_name,
        byte_size_summary(bundle.bytes_written),
        bundle.sections.len(),
        redacted_label,
        bundle.path
    )
}

pub(super) fn percent_summary(used: Option<u64>, total: Option<u64>) -> String {
    match (used, total) {
        (Some(used), Some(total)) if total > 0 => {
            format!("{:.1}%", used as f64 * 100.0 / total as f64)
        }
        _ => "未知".to_owned(),
    }
}

pub(super) fn byte_size_summary(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{} B", bytes as u64)
    }
}

pub(super) fn format_duration(seconds: u64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    if days > 0 {
        format!("{days} 天 {hours} 小时")
    } else {
        format!("{hours} 小时")
    }
}
