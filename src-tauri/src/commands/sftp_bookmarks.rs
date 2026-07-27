//! SFTP 路径书签 Tauri Commands。
//!
//! @author kongweiguang

use tauri::State;

use crate::{
    models::sftp_bookmark::{SftpBookmark, SftpBookmarkListRequest, SftpBookmarkSetRequest},
    state::AppState,
};

/// 列出当前 SSH 主机或容器目标的路径书签。
#[tauri::command]
pub fn sftp_bookmark_list(
    state: State<'_, AppState>,
    request: SftpBookmarkListRequest,
) -> Result<Vec<SftpBookmark>, String> {
    state
        .storage()
        .list_sftp_bookmarks(request)
        .map_err(|error| error.to_string())
}

/// 原子设置当前远程路径是否被收藏，并返回该目标的最新书签。
#[tauri::command]
pub fn sftp_bookmark_set(
    state: State<'_, AppState>,
    request: SftpBookmarkSetRequest,
) -> Result<Vec<SftpBookmark>, String> {
    state
        .storage()
        .set_sftp_bookmark(request)
        .map_err(|error| error.to_string())
}
