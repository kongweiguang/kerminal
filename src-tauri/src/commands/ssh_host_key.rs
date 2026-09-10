//! 已保存 SSH 主机 key 确认的 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    error::AppError,
    services::ssh_host_key_service::{
        inspect_saved_host_key, trust_saved_host_key, SshHostKeyInspection,
    },
    state::AppState,
};
use tauri::State;

/// 读取已保存 SSH 主机的实时 fingerprint；该 command 只探测，不修改 known_hosts。
#[tauri::command]
pub async fn ssh_host_key_inspect(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<SshHostKeyInspection, String> {
    let host = resolve_saved_ssh_host(&state, &host_id).map_err(|error| error.to_string())?;
    inspect_saved_host_key(state.paths(), &host)
        .await
        .map_err(|error| error.to_string())
}

/// 二次探测并核对用户确认的 fingerprint，再把当前 key 写入该应用的 known_hosts。
#[tauri::command]
pub async fn ssh_host_key_trust(
    state: State<'_, AppState>,
    host_id: String,
    expected_fingerprint: String,
) -> Result<SshHostKeyInspection, String> {
    let host = resolve_saved_ssh_host(&state, &host_id).map_err(|error| error.to_string())?;
    trust_saved_host_key(state.paths(), &host, &expected_fingerprint)
        .await
        .map_err(|error| error.to_string())
}

/// 只从保存仓储解析主机 ID，防止 host/port/path 等网络目标由 WebView 直接注入。
fn resolve_saved_ssh_host(
    state: &AppState,
    host_id: &str,
) -> Result<crate::models::remote_host::RemoteHost, AppError> {
    let host_id = host_id.trim();
    if host_id.is_empty() {
        return Err(AppError::InvalidInput("SSH 主机 ID 不能为空".to_owned()));
    }
    state.remote_hosts().require_host(host_id)
}
