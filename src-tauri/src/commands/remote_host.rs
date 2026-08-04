//! 远程主机 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::remote_host::{
        RemoteHost, RemoteHostCreateInput, RemoteHostCredentialReveal, RemoteHostGroup,
        RemoteHostGroupCreateRequest, RemoteHostGroupUpdateRequest, RemoteHostGroupWithHosts,
        RemoteHostUpdateInput,
    },
    state::AppState,
};
use tauri::State;

/// 列出远程主机分组。
#[tauri::command]
pub fn remote_host_group_list(state: State<'_, AppState>) -> Result<Vec<RemoteHostGroup>, String> {
    state
        .remote_hosts()
        .list_groups()
        .map_err(|error| error.to_string())
}

/// 列出远程主机树。
#[tauri::command]
pub fn remote_host_tree(
    state: State<'_, AppState>,
) -> Result<Vec<RemoteHostGroupWithHosts>, String> {
    state
        .remote_hosts()
        .list_tree()
        .map_err(|error| error.to_string())
}

/// 创建远程主机分组。
#[tauri::command]
pub fn remote_host_group_create(
    state: State<'_, AppState>,
    request: RemoteHostGroupCreateRequest,
) -> Result<RemoteHostGroup, String> {
    state
        .remote_hosts()
        .create_group(request)
        .map_err(|error| error.to_string())
}

/// 更新远程主机分组。
#[tauri::command]
pub fn remote_host_group_update(
    state: State<'_, AppState>,
    request: RemoteHostGroupUpdateRequest,
) -> Result<RemoteHostGroup, String> {
    state
        .remote_hosts()
        .update_group(request)
        .map_err(|error| error.to_string())
}

/// 删除远程主机分组。
#[tauri::command]
pub fn remote_host_group_delete(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<bool, String> {
    state
        .remote_hosts()
        .delete_group(&group_id)
        .map_err(|error| error.to_string())
}

/// 创建远程主机。
#[tauri::command]
pub fn remote_host_create(
    state: State<'_, AppState>,
    request: RemoteHostCreateInput,
) -> Result<RemoteHost, String> {
    state
        .remote_hosts()
        .create_host_with_input(request)
        .map_err(|error| error.to_string())
}

/// 更新远程主机。
#[tauri::command]
pub fn remote_host_update(
    state: State<'_, AppState>,
    request: RemoteHostUpdateInput,
) -> Result<RemoteHost, String> {
    state
        .remote_hosts()
        .update_host_with_input(request)
        .map_err(|error| error.to_string())
}

/// 删除远程主机。
#[tauri::command]
pub fn remote_host_delete(state: State<'_, AppState>, host_id: String) -> Result<bool, String> {
    state
        .remote_hosts()
        .delete_host(&host_id)
        .map_err(|error| error.to_string())
}

/// 受控读取单个远程主机编辑所需的保存凭据。
#[tauri::command]
pub fn remote_host_reveal_credential(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<RemoteHostCredentialReveal, String> {
    state
        .remote_hosts()
        .reveal_host_credential(&host_id)
        .map_err(|error| error.to_string())
}
