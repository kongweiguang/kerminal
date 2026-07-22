//! 命令历史业务服务。
//!
//! @author kongweiguang

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::command_history::{
        CommandHistoryClearRequest, CommandHistoryEntry, CommandHistoryListRequest,
        CommandHistoryRecordRequest, CommandHistoryRecordResult, CommandHistoryTarget,
    },
    storage::{
        command_history::{
            CommandHistoryClearFilter, CommandHistoryListFilter, CommandHistoryWrite,
        },
        CommandSqliteStore,
    },
};

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;
const MAX_SUGGESTION_SCAN_LIMIT: usize = 2_048;
const MAX_COMMAND_CHARS: usize = 4_000;
const MAX_ID_CHARS: usize = 160;
const MAX_PATH_CHARS: usize = 1_000;
const MAX_SHELL_CHARS: usize = 400;

/// 命令历史业务入口。
#[derive(Debug, Default)]
pub struct CommandHistoryService;

impl CommandHistoryService {
    /// 创建命令历史服务。
    pub fn new() -> Self {
        Self
    }

    /// 搜索和列出命令历史。
    pub fn list_history(
        &self,
        storage: &CommandSqliteStore,
        request: CommandHistoryListRequest,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        let query = request
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());
        let pane_id = request
            .pane_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let remote_host_id = request
            .remote_host_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let session_id = request
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let limit = request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

        storage.list_command_history_filtered(&CommandHistoryListFilter {
            limit,
            pane_id,
            query: query.as_deref(),
            remote_host_id,
            session_id,
            source: request.source,
            target: request.target,
        })
    }

    /// 按命令前缀列出历史，仅用于 inline suggestion 的按键查询路径。
    pub fn list_history_by_command_prefix(
        &self,
        storage: &CommandSqliteStore,
        target: CommandHistoryTarget,
        remote_host_id: Option<&str>,
        command_prefix: &str,
        limit: usize,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        storage.list_command_history_by_command_prefix(
            target,
            remote_host_id
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            command_prefix,
            limit.clamp(1, MAX_LIMIT),
        )
    }

    /// 返回有界最近历史，供候选菜单在内存中做词级匹配。
    pub fn list_recent_history_for_suggestions(
        &self,
        storage: &CommandSqliteStore,
        target: CommandHistoryTarget,
        remote_host_id: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        storage.list_recent_command_history_for_suggestions(
            target,
            remote_host_id
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            limit.clamp(1, MAX_SUGGESTION_SCAN_LIMIT),
        )
    }

    /// 记录一条命令历史。
    pub fn record_command(
        &self,
        storage: &CommandSqliteStore,
        request: CommandHistoryRecordRequest,
    ) -> AppResult<CommandHistoryRecordResult> {
        if request.record == Some(false) {
            return Ok(skipped("当前会话已禁用命令历史记录"));
        }

        let command = normalize_command(request.command)?;
        if let Some(reason) = sensitive_command_skip_reason(&command) {
            return Ok(skipped(reason));
        }

        let entry = CommandHistoryWrite {
            id: Uuid::new_v4().to_string(),
            command,
            source: request.source,
            target: request.target,
            session_id: normalize_optional_text("session id", request.session_id, MAX_ID_CHARS)?,
            pane_id: normalize_optional_text("pane id", request.pane_id, MAX_ID_CHARS)?,
            tab_id: normalize_optional_text("tab id", request.tab_id, MAX_ID_CHARS)?,
            profile_id: normalize_optional_text("profile id", request.profile_id, MAX_ID_CHARS)?,
            remote_host_id: normalize_optional_text(
                "SSH 主机 id",
                request.remote_host_id,
                MAX_ID_CHARS,
            )?,
            cwd: normalize_optional_text("工作目录", request.cwd, MAX_PATH_CHARS)?,
            shell: normalize_optional_text("shell", request.shell, MAX_SHELL_CHARS)?,
        };

        let entry = storage.insert_command_history(&entry)?;
        Ok(CommandHistoryRecordResult {
            recorded: true,
            entry: Some(entry),
            skip_reason: None,
        })
    }

    /// 删除一条命令历史。
    pub fn delete_history(&self, storage: &CommandSqliteStore, entry_id: &str) -> AppResult<bool> {
        let entry_id = normalize_required_text("命令历史 ID", entry_id.to_owned(), MAX_ID_CHARS)?;
        storage.delete_command_history(&entry_id)
    }

    /// 清空所有命令历史。
    pub fn clear_history(&self, storage: &CommandSqliteStore) -> AppResult<usize> {
        storage.clear_command_history()
    }

    /// 按终端上下文清理历史；空范围保留全局清空兼容行为。
    pub fn clear_history_scoped(
        &self,
        storage: &CommandSqliteStore,
        request: CommandHistoryClearRequest,
    ) -> AppResult<usize> {
        let pane_id = normalize_optional_text("pane id", request.pane_id, MAX_ID_CHARS)?;
        let remote_host_id =
            normalize_optional_text("SSH 主机 id", request.remote_host_id, MAX_ID_CHARS)?;
        let session_id = normalize_optional_text("session id", request.session_id, MAX_ID_CHARS)?;
        storage.clear_command_history_filtered(&CommandHistoryClearFilter {
            target: request.target,
            pane_id: pane_id.as_deref(),
            remote_host_id: remote_host_id.as_deref(),
            session_id: session_id.as_deref(),
        })
    }
}

fn normalize_command(command: String) -> AppResult<String> {
    let command = command.replace("\r\n", "\n").replace('\r', "\n");
    let command = normalize_required_text("命令", command, MAX_COMMAND_CHARS)?;
    Ok(command)
}

fn normalize_required_text(field: &str, value: String, max_chars: usize) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(value)
}

fn normalize_optional_text(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(Some(value))
}

fn ensure_max_chars(field: &str, value: &str, max_chars: usize) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{field}不能超过 {max_chars} 个字符"
        )));
    }
    Ok(())
}

fn sensitive_command_skip_reason(command: &str) -> Option<&'static str> {
    let lower = command.to_ascii_lowercase();
    let sensitive_markers = [
        "password",
        "passwd",
        "api_key",
        "apikey",
        "access_token",
        "auth_token",
        "secret",
        "private_key",
        "authorization:",
        "bearer ",
        "-----begin",
        "ssh-rsa ",
        "id_rsa",
        "id_ed25519",
    ];

    if sensitive_markers
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return Some("命令疑似包含密钥、密码或 token，已跳过历史记录");
    }

    if lower.trim_start().starts_with("export ")
        && ["key=", "token=", "secret=", "password="]
            .iter()
            .any(|marker| lower.contains(marker))
    {
        return Some("导出敏感环境变量的命令已跳过历史记录");
    }

    None
}

fn skipped(reason: impl Into<String>) -> CommandHistoryRecordResult {
    CommandHistoryRecordResult {
        recorded: false,
        entry: None,
        skip_reason: Some(reason.into()),
    }
}
