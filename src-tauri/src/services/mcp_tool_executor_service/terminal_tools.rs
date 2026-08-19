//! MCP 终端工具执行与 Agent scope 授权。
//!
//! @author kongweiguang

use super::*;
use crate::models::agent_session::AgentSessionScope;
use crate::services::terminal_reconnect_service::TerminalReconnectService;
use crate::services::terminal_session_binding_service::{
    TerminalSessionBindingSnapshot, TerminalSessionBindingStatus,
};

const DEFAULT_TERMINAL_SNAPSHOT_BYTES: usize = 24 * 1024;

pub(super) fn execute_terminal_list(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let agent_session_id = match optional_non_empty_string_arg(arguments, "agentSessionId") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    match (terminals.list_sessions(), agent_session_id) {
        (Ok(sessions), None) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_sessions_for_agent(&sessions)),
            error: None,
            structured_result: Some(json!({
                "sessionCount": sessions.len(),
                "sessions": sessions.clone(),
                "scope": null,
                "terminals": sessions.clone(),
            })),
            entities: sessions
                .iter()
                .map(|session| {
                    json!({
                        "type": "terminalSession",
                        "id": session.id,
                        "shell": session.shell,
                        "cols": session.cols,
                        "rows": session.rows,
                        "pid": session.pid,
                    })
                })
                .collect(),
            ..ToolExecutionResult::default()
        },
        (Ok(sessions), Some(agent_session_id)) => {
            let agent_session_id = match AgentSessionId::new(agent_session_id) {
                Ok(value) => value,
                Err(error) => return failure(error.to_string()),
            };
            let record = match agent_sessions.get_session(&agent_session_id) {
                Ok(record) => record,
                Err(error) => return failure(error.to_string()),
            };
            let scope = record.session.effective_scope();
            let terminals =
                match scoped_terminal_entries(&scope, &sessions, terminal_session_bindings) {
                    Ok(entries) => entries,
                    Err(error) => return failure(error.to_string()),
                };
            let session_count = terminals.len();
            let entities = terminals
                .iter()
                .filter_map(|terminal| {
                    terminal
                        .get("id")
                        .and_then(Value::as_str)
                        .map(|id| json!({ "type": "terminalSession", "id": id }))
                })
                .collect();
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!(
                    "当前 Agent scope {:?} 包含 {} 个用户终端。",
                    scope,
                    terminals.len()
                )),
                error: None,
                structured_result: Some(json!({
                    "scope": scope,
                    "sessions": terminals.clone(),
                    "terminals": terminals,
                    "sessionCount": session_count,
                })),
                entities,
                ..ToolExecutionResult::default()
            }
        }
        (Err(error), _) => failure(error.to_string()),
    }
}

/// 请求前端复用 pane 现有连接配置重连，并等待 request/ack 结果。
pub(super) async fn execute_terminal_reconnect(
    agent_sessions: &AgentSessionService,
    terminal_session_bindings: &TerminalSessionBindingService,
    terminal_reconnect: &TerminalReconnectService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let pane_id = match required_string_arg(arguments, "paneId") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    if let Err(error) = validate_pane_scope(
        agent_sessions,
        terminal_session_bindings,
        arguments,
        &pane_id,
    ) {
        return failure(error.to_string());
    }
    let timeout_ms = match optional_u64_arg(arguments, "timeoutMs") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    match terminal_reconnect
        .request(pane_id.clone(), timeout_ms)
        .await
    {
        Ok(result) if result.success => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!("终端 pane {pane_id} 已完成重连。")),
            error: None,
            structured_result: Some(json!({ "reconnect": result })),
            ..ToolExecutionResult::default()
        },
        Ok(result) => ToolExecutionResult {
            status: McpToolExecutionStatus::Failed,
            result_summary: None,
            error: result.error.clone(),
            structured_result: Some(json!({ "reconnect": result })),
            error_kind: Some("terminalReconnectFailed".to_owned()),
            recoverable: true,
            next_hints: vec!["检查终端认证/网络后再次调用 terminal.reconnect。".to_owned()],
            entities: Vec::new(),
        },
        Err(error) => {
            let message = error.to_string();
            let timed_out = message.contains("timed out");
            ToolExecutionResult {
                status: McpToolExecutionStatus::Failed,
                result_summary: None,
                error: Some(message),
                structured_result: Some(json!({
                    "paneId": pane_id,
                    "success": false,
                })),
                error_kind: Some(if timed_out {
                    "terminalReconnectTimeout".to_owned()
                } else {
                    "terminalReconnectUnavailable".to_owned()
                }),
                recoverable: true,
                next_hints: vec![
                    "确认目标 pane 仍在 Kerminal 中，然后重试 terminal.reconnect。".to_owned(),
                ],
                entities: Vec::new(),
            }
        }
    }
}

pub(super) fn summarize_terminal_sessions_for_agent(sessions: &[TerminalSessionSummary]) -> String {
    if sessions.is_empty() {
        return "当前没有运行中的本地终端会话。".to_owned();
    }

    let samples = sessions
        .iter()
        .take(5)
        .map(|session| {
            format!(
                "{}（{}，{}x{}，pid={}）",
                truncate_string(&session.id),
                truncate_string(&session.shell),
                session.cols,
                session.rows,
                session
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "-".to_owned())
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个本地终端会话。示例：{}。",
        sessions.len(),
        samples
    )
}

/// 按 Agent scope 动态解析当前用户终端，重连期间保留 pane 成员事实。
///
/// TerminalManager 只保存 live session，因此 disconnected binding 会以精简
/// entry 出现在结果中，调用方可以据此选择 `terminal.reconnect`；Agent 自身
/// 的 pane/session 永远被排除，避免右栏把自己当成用户目标。
fn scoped_terminal_entries(
    scope: &AgentSessionScope,
    sessions: &[TerminalSessionSummary],
    bindings: &TerminalSessionBindingService,
) -> AppResult<Vec<Value>> {
    let scoped_bindings = bindings.bindings_for_scope(scope)?;
    let binding_by_session = scoped_bindings
        .iter()
        .map(|binding| (binding.session_id.as_str(), binding))
        .collect::<std::collections::HashMap<_, _>>();
    let mut entries = sessions
        .iter()
        .filter(|session| session.agent_session_id.is_none())
        .filter_map(|session| {
            let binding = binding_by_session.get(session.id.as_str()).copied()?;
            let mut value = serde_json::to_value(session).ok()?;
            let object = value.as_object_mut()?;
            object.insert("paneId".to_owned(), json!(binding.pane_id));
            object.insert(
                "connectionState".to_owned(),
                json!(match binding.status {
                    TerminalSessionBindingStatus::Registered => "connecting",
                    TerminalSessionBindingStatus::Ready => "connected",
                    TerminalSessionBindingStatus::Disconnected => "disconnected",
                }),
            );
            insert_terminal_binding_metadata(object, binding);
            Some(value)
        })
        .collect::<Vec<_>>();

    let live_session_ids = sessions
        .iter()
        .map(|session| session.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for binding in scoped_bindings {
        if binding.status == TerminalSessionBindingStatus::Disconnected
            && !live_session_ids.contains(binding.session_id.as_str())
        {
            entries.push(json!({
                "id": binding.session_id,
                "sessionId": binding.session_id,
                "paneId": binding.pane_id,
                "tabId": binding.metadata.as_ref().and_then(|metadata| metadata.tab_id.clone()),
                "status": "disconnected",
                "connectionState": "disconnected",
                "connected": false,
                "targetRef": binding.metadata.as_ref().and_then(|metadata| metadata.target_ref.clone()),
                "cwd": binding.metadata.as_ref().and_then(|metadata| metadata.cwd.clone()),
                "shell": binding.metadata.as_ref().and_then(|metadata| metadata.shell.clone()),
            }));
        }
    }
    entries.sort_by(|left, right| {
        left.get("paneId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                right
                    .get("paneId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });
    Ok(entries)
}

/// 把 pane 绑定元数据补进 live TerminalManager 摘要，使 global scope 能区分
/// 不同 Tab/主机；只在元数据存在时覆盖，避免用 null 抹掉运行态已有字段。
fn insert_terminal_binding_metadata(
    object: &mut serde_json::Map<String, Value>,
    binding: &TerminalSessionBindingSnapshot,
) {
    let Some(metadata) = binding.metadata.as_ref() else {
        return;
    };
    for (key, value) in [
        ("tabId", metadata.tab_id.as_ref()),
        ("targetRef", metadata.target_ref.as_ref()),
        ("targetKind", metadata.target_kind.as_ref()),
        ("remoteHostId", metadata.remote_host_id.as_ref()),
        ("profileId", metadata.profile_id.as_ref()),
        ("cwd", metadata.cwd.as_ref()),
        ("shell", metadata.shell.as_ref()),
    ] {
        if let Some(value) = value {
            object.insert(key.to_owned(), json!(value));
        }
    }
}

/// 校验显式 sessionId 是否属于 Agent 当前 scope，阻止 tab Agent 跨 tab 操作。
fn ensure_terminal_session_in_scope(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    bindings: &TerminalSessionBindingService,
    agent_session_id: &str,
    session_id: &str,
) -> AppResult<()> {
    let agent_session_id = AgentSessionId::new(agent_session_id.to_owned())?;
    let record = agent_sessions.get_session(&agent_session_id)?;
    let summary = terminals.session_summary(session_id)?;
    if summary.agent_session_id.is_some() {
        return Err(AppError::InvalidInput(
            "Agent 不能操作右栏 Agent 自身的终端 session".to_owned(),
        ));
    }
    let scope = record.session.effective_scope();
    let binding = bindings.binding_for_session(session_id)?.ok_or_else(|| {
        AppError::InvalidInput(format!(
            "终端 session {session_id} 尚未注册 pane binding，无法确认 Agent scope"
        ))
    })?;
    if !scope_binding_matches(&scope, &binding) {
        return Err(AppError::InvalidInput(format!(
            "终端 session {session_id} 不属于 Agent scope {scope:?}"
        )));
    }
    Ok(())
}

/// 对带 agentSessionId 的普通终端操作复用显式 session membership 校验。
fn validate_explicit_terminal_scope(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<()> {
    let Some(agent_session_id) = optional_non_empty_string_arg(arguments, "agentSessionId")? else {
        return Ok(());
    };
    let Some(session_id) = optional_non_empty_string_arg(arguments, "sessionId")? else {
        return Err(AppError::InvalidInput(
            "提供 agentSessionId 时必须同时提供 sessionId 以确认目标终端".to_owned(),
        ));
    };
    ensure_terminal_session_in_scope(
        agent_sessions,
        terminals,
        bindings,
        &agent_session_id,
        &session_id,
    )
}

/// 校验 reconnect pane 属于 Agent scope；未带 agentSessionId 时按 global 入口处理。
fn validate_pane_scope(
    agent_sessions: &AgentSessionService,
    bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
    pane_id: &str,
) -> AppResult<()> {
    if pane_id.starts_with("agent-terminal-") {
        return Err(AppError::InvalidInput(
            "Agent 不能重连右栏 Agent 自身的 pane".to_owned(),
        ));
    }
    // Reconnect is a live-pane operation: require the registry fact even for
    // the unbound/global route, otherwise a typo could create an orphaned
    // request that no XtermPane can acknowledge.
    let binding = bindings.binding_for_pane(pane_id)?.ok_or_else(|| {
        AppError::InvalidInput(format!("pane {pane_id} 尚未注册终端 binding，无法执行重连"))
    })?;
    let Some(agent_session_id) = optional_non_empty_string_arg(arguments, "agentSessionId")? else {
        return Ok(());
    };
    let record = agent_sessions.get_session(&AgentSessionId::new(agent_session_id)?)?;
    if !scope_binding_matches(&record.session.effective_scope(), &binding) {
        return Err(AppError::InvalidInput(format!(
            "pane {pane_id} 不属于 Agent scope"
        )));
    }
    Ok(())
}

/// 判断一个 pane binding 是否落在 scope 中，读取和写入共用同一规则。
fn scope_binding_matches(
    scope: &AgentSessionScope,
    binding: &TerminalSessionBindingSnapshot,
) -> bool {
    match scope {
        AgentSessionScope::Global => true,
        AgentSessionScope::Tab { tab_id } => binding
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.tab_id.as_deref())
            .is_some_and(|candidate| candidate == tab_id),
    }
}

pub(super) fn execute_terminal_close(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    if let Err(error) = validate_explicit_terminal_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        return failure(error.to_string());
    }

    match terminals.close(&session_id) {
        Ok(()) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "终端会话已关闭：{}。",
                truncate_string(&session_id)
            )),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_start(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    if let Err(error) = validate_explicit_terminal_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        return failure(error.to_string());
    }

    match terminals.start_log(&session_id, &paths.logs) {
        Ok(state) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_stop(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    if let Err(error) = validate_explicit_terminal_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        return failure(error.to_string());
    }

    match terminals.stop_log(&session_id) {
        Ok(state) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_state(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    if let Err(error) = validate_explicit_terminal_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        return failure(error.to_string());
    }

    match terminals.log_state(&session_id) {
        Ok(state) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_terminal_log_state_for_agent(
    session_id: &str,
    state: &TerminalSessionLogState,
) -> String {
    let path = state.path.as_deref().unwrap_or("-");
    let status = if state.active {
        "记录中"
    } else {
        "未记录"
    };
    format!(
        "终端日志状态：{}，session={}，已写入 {}，路径：{}。",
        status,
        truncate_string(session_id),
        byte_size_summary(state.bytes_written),
        path
    )
}

pub(super) fn execute_terminal_resize(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(session_id) = arguments.get("sessionId").and_then(Value::as_str) else {
        return failure("sessionId 必须是字符串。");
    };
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return failure("cols 必须是 1 到 65535 的数字。");
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return failure("rows 必须是 1 到 65535 的数字。");
    };
    if let Err(error) = validate_explicit_terminal_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        return failure(error.to_string());
    }

    match terminals.resize(session_id, TerminalResizeRequest { cols, rows }) {
        Ok(()) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!("终端尺寸已调整为 {cols}x{rows}。")),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_write(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    command_history: &CommandHistoryService,
    storage: &CommandSqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(data) = arguments.get("data").and_then(Value::as_str) else {
        return failure("data 必须是字符串。");
    };
    if data.is_empty() {
        return failure("data 不能为空。");
    }
    let session_id = match resolve_terminal_write_session_id(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.write(&session_id, data) {
        Ok(()) => {
            record_terminal_write_history(command_history, storage, &session_id, data);
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!("已向终端写入 {} 字节。", data.len())),
                error: None,
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match resolve_terminal_snapshot_session_id(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    let max_bytes = optional_usize_arg(arguments, "maxBytes")
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_TERMINAL_SNAPSHOT_BYTES);
    match terminals.output_snapshot(&session_id, max_bytes) {
        Ok((summary, snapshot)) => {
            let (data, redacted) = redact_terminal_text(&snapshot.data);
            if let Ok(agent_session_id) = required_agent_session_id(arguments) {
                let _ = persist_agent_terminal_snapshot(
                    agent_sessions,
                    &agent_session_id,
                    &session_id,
                    &snapshot,
                    &data,
                    redacted,
                );
            }
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!(
                    "已读取终端 {} 最近 {} 字节输出{}。",
                    truncate_string(&session_id),
                    snapshot.captured_bytes,
                    if snapshot.truncated {
                        "（已截断）"
                    } else {
                        ""
                    }
                )),
                error: None,
                structured_result: Some(json!({
                    "session": summary,
                    "snapshot": {
                        "data": data,
                        "capturedBytes": snapshot.captured_bytes,
                        "maxBytes": snapshot.max_bytes,
                        "truncated": snapshot.truncated,
                        "redacted": redacted
                    }
                })),
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_resolve_agent_target(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    match resolve_agent_target_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(binding) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "Agent session {} 当前目标终端为 {}，状态：{:?}。",
                truncate_string(&binding.agent_session_id),
                truncate_string(&binding.target_terminal_session_id),
                binding.status
            )),
            error: None,
            structured_result: Some(json!({ "targetBinding": binding })),
            entities: vec![json!({
                "type": "agentTargetBinding",
                "agentSessionId": binding.agent_session_id,
                "terminalSessionId": binding.target_terminal_session_id,
                "status": binding.status,
            })],
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_agent_current_session(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let agent_session_id = match required_agent_session_id(arguments) {
        Ok(agent_session_id) => agent_session_id,
        Err(error) => return failure(error.to_string()),
    };
    let live_ids = match live_terminal_session_ids(terminals) {
        Ok(live_ids) => live_ids,
        Err(error) => return failure(error.to_string()),
    };
    match hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    ) {
        Ok(record) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "已读取 Agent session {}。",
                truncate_string(agent_session_id.as_str())
            )),
            error: None,
            structured_result: Some(json!({ "agentSession": record })),
            entities: vec![json!({
                "type": "agentSession",
                "id": agent_session_id.as_str(),
            })],
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_agent_target_context(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let agent_session_id = match required_agent_session_id(arguments) {
        Ok(agent_session_id) => agent_session_id,
        Err(error) => return failure(error.to_string()),
    };
    // target_context 本身用于发现 scope 成员，不能在发现前要求显式 sessionId。
    let live_ids = match live_terminal_session_ids(terminals) {
        Ok(live_ids) => live_ids,
        Err(error) => return failure(error.to_string()),
    };
    let record = match hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    ) {
        Ok(record) => record,
        Err(error) => return failure(error.to_string()),
    };
    let scope = record.session.effective_scope();
    let binding = resolve_hydrated_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    )
    .ok()
    .map(|(_, binding)| binding);
    let current_sessions = match terminals.list_sessions() {
        Ok(sessions) => sessions,
        Err(error) => return failure(error.to_string()),
    };
    let scoped_terminals =
        match scoped_terminal_entries(&scope, &current_sessions, terminal_session_bindings) {
            Ok(entries) => entries,
            Err(error) => return failure(error.to_string()),
        };
    let max_bytes = optional_usize_arg(arguments, "maxBytes")
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_TERMINAL_SNAPSHOT_BYTES);
    let snapshot = if binding.as_ref().is_some_and(|binding| binding.live) {
        let binding = binding.as_ref().expect("checked above");
        match terminals.output_snapshot(&binding.target_terminal_session_id, max_bytes) {
            Ok((summary, snapshot)) => {
                let (data, redacted) = redact_terminal_text(&snapshot.data);
                let _ = persist_agent_terminal_snapshot(
                    agent_sessions,
                    &agent_session_id,
                    &binding.target_terminal_session_id,
                    &snapshot,
                    &data,
                    redacted,
                );
                Some(json!({
                    "session": summary,
                    "snapshot": {
                        "data": data,
                        "capturedBytes": snapshot.captured_bytes,
                        "maxBytes": snapshot.max_bytes,
                        "truncated": snapshot.truncated,
                        "redacted": redacted
                    }
                }))
            }
            Err(error) => return failure(error.to_string()),
        }
    } else {
        None
    };
    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Agent session {} 的目标终端状态：{:?}。",
            truncate_string(agent_session_id.as_str()),
            binding.as_ref().map(|binding| binding.status),
        )),
        error: None,
        structured_result: Some(json!({
        "agentSession": record,
            "scope": scope,
            "targetBinding": binding,
            "terminals": scoped_terminals,
            "terminal": snapshot,
        })),
        ..ToolExecutionResult::default()
    }
}

fn persist_agent_terminal_snapshot(
    agent_sessions: &AgentSessionService,
    agent_session_id: &AgentSessionId,
    target_terminal_session_id: &str,
    snapshot: &TerminalOutputSnapshot,
    output: &str,
    redacted: bool,
) -> AppResult<()> {
    agent_sessions.write_terminal_snapshot_context(&AgentTerminalSnapshotContext {
        schema_version: AGENT_SESSION_SCHEMA_VERSION,
        agent_session_id: agent_session_id.clone(),
        target_terminal_session_id: Some(target_terminal_session_id.to_owned()),
        captured_bytes: output.len(),
        max_bytes: snapshot.max_bytes,
        truncated: snapshot.truncated,
        redacted,
        output: output.to_owned(),
        generated_at: current_unix_timestamp(),
    })
}

fn resolve_terminal_write_session_id(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<String> {
    let agent_session_id = optional_non_empty_string_arg(arguments, "agentSessionId")?;
    if let Some(session_id) = optional_non_empty_string_arg(arguments, "sessionId")? {
        if agent_session_id.is_some() {
            ensure_terminal_session_in_scope(
                agent_sessions,
                terminals,
                terminal_session_bindings,
                agent_session_id.as_deref().expect("checked above"),
                &session_id,
            )?;
        }
        return Ok(session_id);
    }
    let agent_session_id = agent_session_id.ok_or_else(|| {
        AppError::InvalidInput("sessionId 或 agentSessionId 必须提供。".to_owned())
    })?;
    let expected_generation =
        optional_u64_arg(arguments, "bindingGeneration")?.ok_or_else(|| {
            AppError::InvalidInput(
                "通过 agentSessionId 写入终端时必须提供 bindingGeneration。".to_owned(),
            )
        })?;
    let agent_session_id = AgentSessionId::new(agent_session_id.clone())?;
    let live_ids = live_terminal_session_ids(terminals)?;
    hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    )?;
    let target_session_id = terminal_session_bindings
        .resolve_agent_target_for_write(
            agent_session_id.as_str(),
            expected_generation,
            live_ids.iter().map(String::as_str),
        )?
        .target_terminal_session_id;
    ensure_terminal_session_in_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        agent_session_id.as_str(),
        &target_session_id,
    )?;
    Ok(target_session_id)
}

fn resolve_terminal_snapshot_session_id(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<String> {
    if let Some(session_id) = optional_non_empty_string_arg(arguments, "sessionId")? {
        if let Some(agent_session_id) = optional_non_empty_string_arg(arguments, "agentSessionId")?
        {
            ensure_terminal_session_in_scope(
                agent_sessions,
                terminals,
                terminal_session_bindings,
                &agent_session_id,
                &session_id,
            )?;
        }
        return Ok(session_id);
    }
    let binding = resolve_agent_target_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    )?;
    if !binding.live {
        return Err(AppError::InvalidInput(format!(
            "agent target binding stale for {}: target terminal {} is not live",
            binding.agent_session_id, binding.target_terminal_session_id
        )));
    }
    ensure_terminal_session_in_scope(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        &binding.agent_session_id,
        &binding.target_terminal_session_id,
    )?;
    Ok(binding.target_terminal_session_id)
}

fn resolve_agent_target_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AgentTargetBindingSnapshot> {
    resolve_agent_target_record_and_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    )
    .map(|(_, binding)| binding)
}

fn resolve_agent_target_record_and_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<(AgentSessionRecord, AgentTargetBindingSnapshot)> {
    let agent_session_id = required_agent_session_id(arguments)?;
    let live_ids = live_terminal_session_ids(terminals)?;
    resolve_hydrated_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    )
}

fn live_terminal_session_ids(terminals: &TerminalManager) -> AppResult<Vec<String>> {
    Ok(terminals
        .list_sessions()?
        .into_iter()
        .map(|session| session.id)
        .collect())
}

fn required_agent_session_id(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AgentSessionId> {
    AgentSessionId::new(required_string_arg(arguments, "agentSessionId")?)
}

fn optional_non_empty_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    Ok(optional_string_arg(arguments, key)?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty()))
}

pub(super) fn record_terminal_write_history(
    command_history: &CommandHistoryService,
    storage: &CommandSqliteStore,
    session_id: &str,
    data: &str,
) {
    for command in commands_from_terminal_write_data(data) {
        let _ = command_history.record_command(
            storage,
            CommandHistoryRecordRequest {
                command,
                source: CommandHistorySource::Tool,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: Some(session_id.to_owned()),
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        );
    }
}

pub(super) fn commands_from_terminal_write_data(data: &str) -> Vec<String> {
    data.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    use crate::services::terminal_session_binding_service::TerminalSessionBindingMetadata;

    /// 写入权限的底层 membership 判定必须拒绝其他 Tab，同时允许 global。
    #[test]
    fn scope_membership_rejects_cross_tab_and_allows_global() {
        let binding = TerminalSessionBindingSnapshot {
            pane_id: "pane-b".to_owned(),
            session_id: "session-b".to_owned(),
            generation: 1,
            metadata: Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-b".to_owned()),
                target_ref: None,
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: None,
                cwd: None,
                shell: Some("pwsh".to_owned()),
            }),
            status: TerminalSessionBindingStatus::Ready,
            registered_at_ms: 1,
            updated_at_ms: 1,
            ready_at_ms: Some(1),
            disconnected_at_ms: None,
            last_snapshot_status: None,
        };

        assert!(!scope_binding_matches(
            &AgentSessionScope::Tab {
                tab_id: "tab-a".to_owned(),
            },
            &binding,
        ));
        assert!(scope_binding_matches(
            &AgentSessionScope::Tab {
                tab_id: "tab-b".to_owned(),
            },
            &binding,
        ));
        assert!(scope_binding_matches(&AgentSessionScope::Global, &binding));
    }

    /// global terminal.list 必须携带足够的 pane 元数据，Agent 才能安全区分跨 Tab 目标。
    #[test]
    fn live_terminal_entry_includes_binding_metadata() {
        let binding = TerminalSessionBindingSnapshot {
            pane_id: "pane-a".to_owned(),
            session_id: "session-a".to_owned(),
            generation: 1,
            metadata: Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("ssh:host-a".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-a".to_owned()),
                profile_id: None,
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
            }),
            status: TerminalSessionBindingStatus::Ready,
            registered_at_ms: 1,
            updated_at_ms: 1,
            ready_at_ms: Some(1),
            disconnected_at_ms: None,
            last_snapshot_status: None,
        };
        let mut object = serde_json::Map::new();

        insert_terminal_binding_metadata(&mut object, &binding);

        assert_eq!(object.get("tabId"), Some(&json!("tab-a")));
        assert_eq!(object.get("targetRef"), Some(&json!("ssh:host-a")));
        assert_eq!(object.get("remoteHostId"), Some(&json!("host-a")));
        assert_eq!(object.get("cwd"), Some(&json!("/srv/app")));
        assert_eq!(object.get("shell"), Some(&json!("bash")));
    }
}
