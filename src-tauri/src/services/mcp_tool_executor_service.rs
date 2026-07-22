//! MCP tools/call 直接执行服务。
//!
//! @author kongweiguang

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    error::{AppError, AppResult},
    models::{
        agent_session::{
            AgentMcpCallLogEntry, AgentSessionId, AgentSessionRecord, AgentTerminalSnapshotContext,
            AGENT_SESSION_SCHEMA_VERSION,
        },
        command_history::{
            CommandHistoryListRequest, CommandHistoryRecordRequest, CommandHistorySource,
            CommandHistoryTarget,
        },
        diagnostics::{DiagnosticBundle, RuntimeHealthSnapshot},
        docker::{
            DockerContainerChmodRequest, DockerContainerDeleteRequest,
            DockerContainerDirectoryListing, DockerContainerFilePreview,
            DockerContainerInfoRequest, DockerContainerInspectSummary,
            DockerContainerLifecycleAction, DockerContainerLifecycleRequest,
            DockerContainerLifecycleResult, DockerContainerListRequest, DockerContainerLogsRequest,
            DockerContainerLogsResult, DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerRenameRequest, DockerContainerStatsRequest, DockerContainerStatsResult,
            DockerContainerSummary, DockerContainerTransferRequest,
            DockerContainerWriteTextFileRequest, DockerContainerWriteTextFileResponse,
        },
        mcp_server::ToolDefinition,
        port_forward::{
            PortForwardCreateRequest, PortForwardKind, PortForwardOrigin,
            PortForwardProxyApplyScope, PortForwardProxyProtocol, PortForwardRemoteAccessScope,
            PortForwardStatus, PortForwardSummary,
        },
        remote_host::{
            build_vault_secret_ref, parse_vault_secret_ref, RemoteHost, RemoteHostAuthType,
            RemoteHostCreateRequest, RemoteHostUpdateRequest,
        },
        server_info::{ServerInfoRequest, ServerInfoSnapshot},
        sftp::{
            SftpChmodRequest, SftpDeleteRequest, SftpDirectoryListing, SftpEntryKind,
            SftpFilePreview, SftpListDirectoryRequest, SftpManagedTransferRequest, SftpPathRequest,
            SftpPreviewRequest, SftpRenameRequest, SftpTransferCancelRequest,
            SftpTransferConflictPolicy, SftpTransferDirection, SftpTransferKind,
            SftpTransferRequest, SftpTransferStatus, SftpTransferSummary,
        },
        ssh_command::{SshCommandOutput, SshCommandRequest},
        target::RemoteTargetRef,
        terminal::{
            TerminalOutputSnapshot, TerminalResizeRequest, TerminalSessionLogState,
            TerminalSessionSummary,
        },
        tmux::{
            TmuxAttachLaunch, TmuxAttachSessionRequest, TmuxCapabilityStatus,
            TmuxCapturePaneRequest, TmuxCreateSessionRequest, TmuxKillSessionRequest,
            TmuxListPanesRequest, TmuxListSessionsRequest, TmuxListWindowsRequest, TmuxPaneCapture,
            TmuxPaneSummary, TmuxProbeRequest, TmuxRenameSessionRequest, TmuxSessionSummary,
            TmuxTargetRef, TmuxWindowSummary,
        },
    },
    paths::KerminalPaths,
    security::redaction::redact_terminal_text,
    services::{
        agent_session_service::AgentSessionService,
        agent_target_hydration_service::{
            hydrate_agent_target_binding, resolve_hydrated_agent_target_binding,
        },
        command_history_service::CommandHistoryService,
        diagnostics_service::DiagnosticsService,
        docker_host_service::DockerHostService,
        encrypted_vault_service::EncryptedVaultService,
        external_launch::ExternalLaunchIntake,
        mcp_tool_catalog_service::ToolId,
        port_forward_service::PortForwardService,
        remote_host_service::RemoteHostService,
        server_info_service::ServerInfoService,
        settings_service::SettingsService,
        sftp_service::SftpService,
        ssh_command_service::SshCommandService,
        ssh_runtime::ManagedSshSessionManager,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::{
            AgentTargetBindingSnapshot, TerminalSessionBindingService,
        },
        tmux_service::TmuxService,
    },
    storage::{config_file_store::ConfigFileStore, CommandSqliteStore, RuntimeFileStore},
};

mod app_guides;
mod arguments;
mod config_tools;
mod container_tools;
mod diagnostics_common;
mod diagnostics_tools;
mod execution;
mod execution_result;
mod history_tools;
mod host_vault_tools;
mod operation_guide;
mod port_forward_tools;
mod runtime_snapshot;
mod sftp_tools;
mod ssh_tools;
mod terminal_tools;
mod tmux_tools;
mod tool_examples;

pub use self::{
    diagnostics_tools::summarize_server_info_snapshot_for_agent,
    sftp_tools::{summarize_sftp_listing_for_agent, summarize_sftp_preview_for_agent},
    ssh_tools::summarize_ssh_command_output_for_agent,
};

#[doc(hidden)]
pub mod rules {
    use serde_json::Value;

    use crate::{
        error::AppResult,
        models::{port_forward::PortForwardCreateRequest, ssh_command::SshCommandRequest},
    };

    /// 解析 MCP `port_forward.create` 工具参数。
    pub fn port_forward_create_request_from_arguments(
        arguments: &serde_json::Map<String, Value>,
    ) -> AppResult<PortForwardCreateRequest> {
        super::port_forward_tools::port_forward_create_request_from_arguments(arguments)
    }

    /// 解析 MCP `ssh.command` 工具参数。
    pub fn ssh_command_request_from_arguments(
        arguments: &serde_json::Map<String, Value>,
    ) -> AppResult<SshCommandRequest> {
        super::ssh_tools::ssh_command_request_from_arguments(arguments)
    }

    /// 解析 MCP `tmux.probe` 工具参数。
    pub fn tmux_probe_request_from_arguments(
        arguments: &serde_json::Map<String, Value>,
    ) -> AppResult<crate::models::tmux::TmuxProbeRequest> {
        super::tmux_tools::tmux_probe_request_from_arguments(arguments)
    }
}

use self::{
    app_guides::*, arguments::*, config_tools::*, container_tools::*, diagnostics_tools::*,
    execution::*, execution_result::*, history_tools::*, host_vault_tools::*, operation_guide::*,
    port_forward_tools::*, runtime_snapshot::*, sftp_tools::*, ssh_tools::*, terminal_tools::*,
    tmux_tools::*,
};

const MCP_CALL_LOG_FIELD_MAX_CHARS: usize = 4096;

/// MCP tool 执行状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpToolExecutionStatus {
    /// 工具执行成功。
    Succeeded,
    /// 工具执行失败。
    Failed,
}

/// MCP 工具调用执行结果。
#[derive(Debug, Clone)]
struct ToolExecutionResult {
    pub(super) status: McpToolExecutionStatus,
    pub(super) result_summary: Option<String>,
    pub(super) error: Option<String>,
    pub(super) structured_result: Option<Value>,
    pub(super) entities: Vec<Value>,
    pub(super) error_kind: Option<String>,
    pub(super) recoverable: bool,
    pub(super) next_hints: Vec<String>,
}

impl Default for ToolExecutionResult {
    fn default() -> Self {
        Self {
            status: McpToolExecutionStatus::Failed,
            result_summary: None,
            error: None,
            structured_result: None,
            entities: Vec::new(),
            error_kind: None,
            recoverable: false,
            next_hints: Vec::new(),
        }
    }
}

/// MCP `tools/call` 直接执行输出。
#[derive(Debug, Clone)]
pub struct McpToolExecutionOutput {
    pub status: McpToolExecutionStatus,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub data: Value,
    pub entities: Vec<Value>,
    pub error_kind: Option<String>,
    pub recoverable: bool,
    pub next_hints: Vec<String>,
}

impl From<ToolExecutionResult> for McpToolExecutionOutput {
    fn from(result: ToolExecutionResult) -> Self {
        Self {
            status: result.status,
            summary: result.result_summary,
            error: result.error,
            data: result.structured_result.unwrap_or_else(|| json!({})),
            entities: result.entities,
            error_kind: result.error_kind,
            recoverable: result.recoverable,
            next_hints: result.next_hints,
        }
    }
}

/// MCP tools/call 直接执行器。
#[derive(Debug, Clone, Default)]
pub struct McpToolExecutorService;

/// MCP 工具执行时需要访问的运行时服务集合。
#[derive(Debug, Clone, Copy)]
pub struct McpToolExecutionContext<'a> {
    /// 终端会话管理服务。
    pub terminals: &'a TerminalManager,
    /// 外部 Agent session 文件服务。
    pub agent_sessions: &'a AgentSessionService,
    /// Agent session 到目标终端的运行态绑定解析服务。
    pub terminal_session_bindings: &'a TerminalSessionBindingService,
    /// 命令历史服务。
    pub command_history: &'a CommandHistoryService,
    /// 命令历史和命令建议专用 SQLite 存储。
    pub command_store: &'a CommandSqliteStore,
    /// 应用设置服务。
    pub settings: &'a SettingsService,
    /// 远程主机配置服务。
    pub remote_hosts: &'a RemoteHostService,
    /// 服务器信息采集服务。
    pub server_info: &'a ServerInfoService,
    /// 本地诊断服务。
    pub diagnostics: &'a DiagnosticsService,
    /// SFTP 文件工具服务。
    pub sftp: &'a SftpService,
    /// Docker/Podman 容器服务。
    pub docker_hosts: &'a DockerHostService,
    /// 外部 SSH 启动 intake 服务。
    pub external_launch_intake: &'a ExternalLaunchIntake,
    /// 外部 SSH 创建任务运行态注册表。
    pub external_launch_tasks: &'a crate::services::external_launch::ExternalLaunchTaskRegistry,
    /// tmux 会话管理服务。
    pub tmux: &'a TmuxService,
    /// SSH 端口转发服务。
    pub port_forwards: &'a PortForwardService,
    /// SSH 非交互命令服务。
    pub ssh_commands: &'a SshCommandService,
    /// 受管 SSH 会话运行时。
    pub ssh_runtime: &'a ManagedSshSessionManager,
    /// 本地数据目录集合。
    pub paths: &'a KerminalPaths,
    /// Runtime file store entry for port-forward and local file audit state.
    pub storage: &'a RuntimeFileStore,
}

impl McpToolExecutorService {
    /// 创建 MCP tool 直接执行器。
    pub fn new() -> Self {
        Self
    }

    /// 直接执行一次 MCP tool 调用，不创建 pending invocation，也不执行二次确认策略。
    pub async fn execute(
        &self,
        context: McpToolExecutionContext<'_>,
        tools: &[ToolDefinition],
        tool_id: &str,
        arguments: Value,
    ) -> AppResult<McpToolExecutionOutput> {
        let tool_id = tool_id.trim();
        if tool_id.is_empty() {
            return Err(AppError::InvalidInput("工具 id 不能为空".to_owned()));
        }

        let tool = find_enabled_tool(tools, tool_id)?;
        let arguments = normalized_arguments(arguments)?;
        validate_required_arguments(&tool, &arguments)?;
        let typed_tool_id = ToolId::parse(&tool.id).ok_or_else(|| {
            AppError::InvalidInput(format!("工具未登记到 typed catalog: {}", tool.id))
        })?;
        let result = execute_tool(&context, tools, typed_tool_id, &arguments).await;
        append_agent_mcp_call_log(&context, &tool.id, &arguments, &result);
        Ok(result.into())
    }
}

fn append_agent_mcp_call_log(
    context: &McpToolExecutionContext<'_>,
    tool_id: &str,
    arguments: &serde_json::Map<String, Value>,
    result: &ToolExecutionResult,
) {
    let Some(agent_session_id) = arguments.get("agentSessionId").and_then(Value::as_str) else {
        return;
    };
    let Ok(agent_session_id) = AgentSessionId::new(agent_session_id.to_owned()) else {
        return;
    };
    let status = match result.status {
        McpToolExecutionStatus::Succeeded => "succeeded",
        McpToolExecutionStatus::Failed => "failed",
    };
    let entry = AgentMcpCallLogEntry {
        schema_version: AGENT_SESSION_SCHEMA_VERSION,
        agent_session_id,
        tool_id: tool_id.to_owned(),
        status: status.to_owned(),
        summary: mcp_call_log_field(result.result_summary.as_deref()),
        error: mcp_call_log_field(result.error.as_deref()),
        runtime_audit: mcp_call_log_field(Some(&mcp_runtime_audit(context, tool_id, arguments))),
        generated_at: current_unix_timestamp(),
    };
    let _ = context.agent_sessions.append_mcp_call_log(&entry);
}

fn mcp_runtime_audit(
    context: &McpToolExecutionContext<'_>,
    tool_id: &str,
    arguments: &serde_json::Map<String, Value>,
) -> String {
    let host_id = arguments
        .get("hostId")
        .and_then(Value::as_str)
        .or_else(|| arguments.get("targetHostId").and_then(Value::as_str));
    match context.ssh_runtime.snapshot() {
        Ok(snapshot) => {
            let sessions = snapshot
                .sessions
                .iter()
                .map(|session| {
                    format!(
                        "{}|state={:?}|channels={}|flags={}",
                        session.key.target,
                        session.state,
                        session.active_channels,
                        session.key.runtime_flags.join("+")
                    )
                })
                .take(8)
                .collect::<Vec<_>>();
            let fallbacks = snapshot
                .recent_legacy_fallbacks
                .iter()
                .map(|fallback| {
                    format!(
                        "{}|count={}|target={}|reason={}",
                        fallback.capability,
                        fallback.count,
                        fallback.target.as_deref().unwrap_or("unknown"),
                        fallback.reason
                    )
                })
                .take(8)
                .collect::<Vec<_>>();
            format!(
                "tool={tool_id}; hostId={}; backend=managed-ssh-runtime; activeSessions={}; activeChannels={}; sessions=[{}]; fallbacks=[{}]",
                host_id.unwrap_or("none"),
                snapshot.active_sessions,
                snapshot.active_channels,
                sessions.join(", "),
                fallbacks.join(", ")
            )
        }
        Err(error) => format!(
            "tool={tool_id}; hostId={}; backend=managed-ssh-runtime; snapshotError={error}",
            host_id.unwrap_or("none")
        ),
    }
}

fn mcp_call_log_field(value: Option<&str>) -> Option<String> {
    value.map(|value| {
        let (redacted, _) = redact_terminal_text(value);
        truncate_log_field(&redacted, MCP_CALL_LOG_FIELD_MAX_CHARS)
    })
}

fn truncate_log_field(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn current_unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn find_enabled_tool(tools: &[ToolDefinition], tool_id: &str) -> AppResult<ToolDefinition> {
    let tool = tools
        .iter()
        .find(|tool| tool.id == tool_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("工具不存在: {tool_id}")))?;

    if !tool.enabled {
        return Err(AppError::InvalidInput(format!("工具未启用: {tool_id}")));
    }

    Ok(tool)
}

fn normalized_arguments(value: Value) -> AppResult<serde_json::Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(serde_json::Map::new()),
        _ => Err(AppError::InvalidInput(
            "工具参数必须是 JSON object".to_owned(),
        )),
    }
}

fn validate_required_arguments(
    tool: &ToolDefinition,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<()> {
    let required = tool
        .input_schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);

    for key in required {
        if !arguments.contains_key(key) || arguments.get(key).is_some_and(Value::is_null) {
            return Err(AppError::InvalidInput(format!(
                "工具 {} 缺少必填参数: {}",
                tool.id, key
            )));
        }
    }

    Ok(())
}

pub(super) fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn truncate_string(value: &str) -> String {
    const MAX_CHARS: usize = 160;
    let value = value.trim();
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
