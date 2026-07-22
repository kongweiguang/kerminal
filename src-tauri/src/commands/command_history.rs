//! 命令历史 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::command_history::{
        CommandHistoryClearRequest, CommandHistoryEntry, CommandHistoryListRequest,
        CommandHistoryRecordRequest, CommandHistoryRecordResult,
    },
    state::AppState,
};
use tauri::State;

/// 搜索和列出命令历史。
#[tauri::command]
pub fn command_history_list(
    state: State<'_, AppState>,
    request: Option<CommandHistoryListRequest>,
) -> Result<Vec<CommandHistoryEntry>, String> {
    state
        .command_history()
        .list_history(state.command_store(), request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 记录一条命令历史。
#[tauri::command]
pub fn command_history_record(
    state: State<'_, AppState>,
    request: CommandHistoryRecordRequest,
) -> Result<CommandHistoryRecordResult, String> {
    state
        .command_history()
        .record_command(state.command_store(), request)
        .map_err(|error| error.to_string())
}

/// 删除一条命令历史。
#[tauri::command]
pub fn command_history_delete(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<bool, String> {
    state
        .command_history()
        .delete_history(state.command_store(), &entry_id)
        .map_err(|error| error.to_string())
}

/// 按指定终端上下文清空命令历史；缺省请求兼容旧版全局清空。
#[tauri::command]
pub fn command_history_clear(
    state: State<'_, AppState>,
    request: Option<CommandHistoryClearRequest>,
) -> Result<usize, String> {
    state
        .command_history()
        .clear_history_scoped(state.command_store(), request.unwrap_or_default())
        .map_err(|error| error.to_string())
}
