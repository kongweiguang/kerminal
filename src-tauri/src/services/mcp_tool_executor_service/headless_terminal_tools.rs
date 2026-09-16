//! MCP-owned headless terminal creation.
//!
//! @author kongweiguang

use super::*;
use crate::{
    models::terminal::{
        host_terminal_target_ref, local_terminal_target_ref, SshTerminalCreateRequest,
        TerminalCreateRequest, TerminalSessionSummary,
    },
    paths::KerminalPaths,
    services::{
        remote_host_service::RemoteHostService, ssh_terminal_service::SshTerminalService,
        terminal_manager::TerminalManager,
    },
};

const DEFAULT_HEADLESS_TERMINAL_COLS: u16 = 120;
const DEFAULT_HEADLESS_TERMINAL_ROWS: u16 = 30;

/// 在没有 UI pane 时创建 MCP-owned PTY；沿用 TerminalManager 的唯一 session
/// registry，让 root MCP endpoint 拿到 sessionId 后直接继续 snapshot/write/resize/close。
pub(super) async fn execute_terminal_create(
    terminals: &TerminalManager,
    ssh_terminals: &SshTerminalService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let target = match optional_string_arg(arguments, "target") {
        Ok(value) => value
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_else(|| "local".to_owned()),
        Err(error) => return failure(error.to_string()),
    };
    let cwd = match optional_string_arg(arguments, "cwd") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let shell = match optional_string_arg(arguments, "shell") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let cols = match headless_terminal_dimension(arguments, "cols", DEFAULT_HEADLESS_TERMINAL_COLS)
    {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let rows = match headless_terminal_dimension(arguments, "rows", DEFAULT_HEADLESS_TERMINAL_ROWS)
    {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };

    let created = match target.as_str() {
        "local" => {
            if let Err(error) = reject_empty_optional_text(cwd.as_deref(), "cwd") {
                return failure(error.to_string());
            }
            create_local_headless_session(
                terminals,
                TerminalCreateRequest {
                    shell,
                    args: Vec::new(),
                    cwd,
                    cols,
                    rows,
                    env: std::collections::HashMap::new(),
                    cleanup_paths: Vec::new(),
                },
            )
        }
        "ssh" => {
            let host_id = match required_string_arg(arguments, "hostId") {
                Ok(value) => value,
                Err(error) => return failure(error.to_string()),
            };
            if shell.is_some() {
                return failure("shell 仅支持 target=local；SSH 使用已保存主机的登录 shell。");
            }
            create_ssh_headless_session(
                terminals,
                ssh_terminals,
                remote_hosts,
                paths,
                SshTerminalCreateRequest {
                    host_id: host_id.clone(),
                    cwd,
                    remote_command: None,
                    cols,
                    rows,
                },
            )
            .await
        }
        other => {
            return failure(format!("target 必须是 local 或 ssh，当前值为 {other}。"));
        }
    };

    match created {
        Ok(summary) => {
            let host_id = if target == "ssh" {
                arguments
                    .get("hostId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            } else {
                None
            };
            let session_id = summary.id.clone();
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!(
                    "已创建 headless {} PTY，session={}；可继续使用 terminal.snapshot/write/resize/close。",
                    target,
                    truncate_string(&session_id)
                )),
                error: None,
                structured_result: Some(json!({
                    "sessionId": session_id,
                    "session": summary,
                    "target": target.clone(),
                    "hostId": host_id,
                    "headless": true,
                    "scope": "global",
                    "outputBuffered": true,
                    "ui": {
                        "tabCreated": false,
                        "paneCreated": false,
                    },
                })),
                entities: vec![json!({
                    "type": "terminalSession",
                    "id": session_id,
                    "headless": true,
                    "target": target.clone(),
                    "hostId": host_id,
                })],
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

/// 将 JSON number 转成有界 PTY 尺寸；公共 schema 保持易用，最终合法性仍由
/// TerminalManager 的 native PTY 校验负责。
fn headless_terminal_dimension(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
    default: u16,
) -> AppResult<u16> {
    let Some(value) = optional_usize_arg(arguments, key)? else {
        return Ok(default);
    };
    let value = u16::try_from(value)
        .map_err(|_| AppError::InvalidInput(format!("{key} 必须是 1 到 65535 的数字。")))?;
    if value == 0 {
        return Err(AppError::InvalidInput(format!(
            "{key} 必须是 1 到 65535 的数字。"
        )));
    }
    Ok(value)
}

/// 区分“未提供 cwd”和“显式空 cwd”，避免空白参数静默改变本地启动目录。
fn reject_empty_optional_text(value: Option<&str>, key: &str) -> AppResult<()> {
    if value.is_some_and(|value| value.trim().is_empty()) {
        return Err(AppError::InvalidInput(format!("{key} 不能为空。")));
    }
    Ok(())
}

/// 创建本地 headless PTY 后立即写入与 UI 路径一致的 local targetRef；
/// targetRef 写入失败时回收刚登记的 session，避免留下不可解析的孤儿。
fn create_local_headless_session(
    terminals: &TerminalManager,
    request: TerminalCreateRequest,
) -> AppResult<TerminalSessionSummary> {
    let summary = terminals.create_headless_session(request, |_| true)?;
    match terminals.set_target_ref(&summary.id, local_terminal_target_ref()) {
        Ok(bound) => Ok(bound),
        Err(error) => {
            let _ = terminals.close(&summary.id);
            Err(error)
        }
    }
}

/// 在不会嵌套 Tokio runtime 的 blocking 上下文中创建 SSH headless PTY；
/// MCP HTTP 的多线程 runtime 使用 block_in_place，current-thread 测试则
/// 用 scoped OS thread 承载 SSH service 自有 runtime。
async fn create_ssh_headless_session(
    terminals: &TerminalManager,
    ssh_terminals: &SshTerminalService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    request: SshTerminalCreateRequest,
) -> AppResult<TerminalSessionSummary> {
    let host_id = request.host_id.clone();
    let create =
        || ssh_terminals.create_headless_session(remote_hosts, paths, terminals, request, |_| true);
    let summary = match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(create)?
        }
        Ok(_) => std::thread::scope(|scope| {
            scope
                .spawn(create)
                .join()
                .map_err(|_| AppError::Terminal("SSH headless 创建线程异常退出".to_owned()))?
        })?,
        Err(_) => create()?,
    };
    match terminals.set_target_ref(&summary.id, host_terminal_target_ref("ssh", &host_id)) {
        Ok(bound) => Ok(bound),
        Err(error) => {
            let _ = terminals.close(&summary.id);
            Err(error)
        }
    }
}
