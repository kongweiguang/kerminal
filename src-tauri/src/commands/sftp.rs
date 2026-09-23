//! SFTP 文件工具 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::sftp::{
        SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpChmodRequest,
        SftpClassifyLocalPathsRequest, SftpClipboardDownloadRequest, SftpDeleteRequest,
        SftpDirectoryListing, SftpFilePreview, SftpHostKeyTrustSummary, SftpListDirectoryRequest,
        SftpLocalPathInfo, SftpManagedTransferRequest, SftpPathRequest, SftpPathStat,
        SftpPreviewRequest, SftpReadTextFileRequest, SftpReadTextFileResponse,
        SftpRemoteCopyRequest, SftpRenameRequest, SftpTransferCancelRequest, SftpTransferRequest,
        SftpTransferRetryRequest, SftpTransferScopeRequest, SftpTransferSummary,
        SftpTrustHostKeyRequest, SftpWriteTextFileRequest, SftpWriteTextFileResponse,
    },
    state::AppState,
};
use tauri::{State, Window};

/// 列出当前 SSH 主机的远程目录。
#[tauri::command]
pub async fn sftp_list_directory(
    state: State<'_, AppState>,
    request: SftpListDirectoryRequest,
) -> Result<SftpDirectoryListing, String> {
    state
        .sftp()
        .list_directory(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 创建远程目录。
#[tauri::command]
pub async fn sftp_create_directory(
    state: State<'_, AppState>,
    request: SftpPathRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .create_directory(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 预览远程文本文件。
#[tauri::command]
pub async fn sftp_preview_file(
    state: State<'_, AppState>,
    request: SftpPreviewRequest,
) -> Result<SftpFilePreview, String> {
    state
        .sftp()
        .preview_file(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取远程文本文件供编辑器打开。
#[tauri::command]
pub async fn sftp_read_text_file(
    state: State<'_, AppState>,
    request: SftpReadTextFileRequest,
) -> Result<SftpReadTextFileResponse, String> {
    state
        .sftp()
        .read_text_file(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 写入远程文本文件并同步到服务器。
#[tauri::command]
pub async fn sftp_write_text_file(
    state: State<'_, AppState>,
    request: SftpWriteTextFileRequest,
) -> Result<SftpWriteTextFileResponse, String> {
    state
        .sftp()
        .write_text_file(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取远程路径状态。
#[tauri::command]
pub async fn sftp_stat_path(
    state: State<'_, AppState>,
    request: SftpPathRequest,
) -> Result<SftpPathStat, String> {
    state
        .sftp()
        .stat_path(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 删除远程文件或目录。
#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    request: SftpDeleteRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .delete(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 重命名远程路径。
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    request: SftpRenameRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .rename(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 修改远程路径权限。
#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    request: SftpChmodRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .chmod(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 上传本地文件到远程路径。
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    request: SftpTransferRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .upload(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 递归上传本地目录到远程路径。
#[tauri::command]
pub async fn sftp_upload_directory(
    state: State<'_, AppState>,
    request: SftpTransferRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .upload_directory(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 下载远程文件到本地路径。
#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    request: SftpTransferRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .download(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 递归下载远程目录到本地路径。
#[tauri::command]
pub async fn sftp_download_directory(
    state: State<'_, AppState>,
    request: SftpTransferRequest,
) -> Result<bool, String> {
    state
        .sftp()
        .download_directory(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 创建可管理的上传/下载任务。
#[tauri::command]
pub fn sftp_enqueue_transfer(
    state: State<'_, AppState>,
    request: SftpManagedTransferRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .enqueue_transfer_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 创建远程复制或跨主机传输任务。
#[tauri::command]
pub fn sftp_enqueue_remote_copy(
    state: State<'_, AppState>,
    request: SftpRemoteCopyRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .enqueue_remote_copy_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 创建远程条目下载为 ZIP 的归档任务。
#[tauri::command]
pub fn sftp_enqueue_archive_download(
    state: State<'_, AppState>,
    request: SftpArchiveDownloadRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .enqueue_archive_download_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 创建本地条目压缩为 ZIP 后上传的归档任务。
#[tauri::command]
pub fn sftp_enqueue_archive_upload(
    state: State<'_, AppState>,
    request: SftpArchiveUploadRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .enqueue_archive_upload_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 创建远程条目下载到本地文件剪贴板的任务。
#[tauri::command]
pub fn sftp_enqueue_clipboard_download(
    state: State<'_, AppState>,
    request: SftpClipboardDownloadRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .enqueue_clipboard_download_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 列出当前 SFTP 传输队列。
#[tauri::command]
pub fn sftp_list_transfers(
    state: State<'_, AppState>,
    request: Option<SftpTransferScopeRequest>,
) -> Result<Vec<SftpTransferSummary>, String> {
    state
        .sftp()
        .list_transfers_for_scope(request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 请求取消 SFTP 传输任务。
#[tauri::command]
pub fn sftp_cancel_transfer(
    state: State<'_, AppState>,
    request: SftpTransferCancelRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .cancel_transfer_for_window(request, window)
        .map_err(|error| error.to_string())
}

/// 继续一个可恢复的 SFTP 传输，并复用核心服务的事件链与断点幂等语义。
///
/// Command 只负责把 Tauri Window 和输入边界交给服务层；重试是否安全、是否已经存在
/// 后继任务以及如何校验断点都由 SFTP 核心统一决定，避免 UI 与 MCP 各自实现一套恢复规则。
#[tauri::command]
pub fn sftp_retry_transfer(
    state: State<'_, AppState>,
    request: SftpTransferRetryRequest,
    window: Window,
) -> Result<SftpTransferSummary, String> {
    state
        .sftp()
        .retry_transfer_for_window(state.paths(), request, window)
        .map_err(|error| error.to_string())
}

/// 清理已经结束的 SFTP 传输任务。
#[tauri::command]
pub fn sftp_clear_completed_transfers(
    state: State<'_, AppState>,
    request: Option<SftpTransferScopeRequest>,
) -> Result<Vec<SftpTransferSummary>, String> {
    state
        .sftp()
        .clear_completed_transfers_for_scope(request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 分类本地拖放路径，区分文件和目录。
#[tauri::command]
pub fn sftp_classify_local_paths(
    state: State<'_, AppState>,
    request: SftpClassifyLocalPathsRequest,
) -> Result<Vec<SftpLocalPathInfo>, String> {
    state
        .sftp()
        .classify_local_paths(request)
        .map_err(|error| error.to_string())
}

/// 读取系统文件剪贴板中的本地文件或目录路径。
#[tauri::command]
pub fn sftp_read_local_file_clipboard(
    state: State<'_, AppState>,
) -> Result<Vec<SftpLocalPathInfo>, String> {
    state
        .sftp()
        .read_local_file_clipboard()
        .map_err(|error| error.to_string())
}

/// 显式信任远程主机的 SSH host key。
#[tauri::command]
pub async fn sftp_trust_host_key(
    state: State<'_, AppState>,
    request: SftpTrustHostKeyRequest,
) -> Result<SftpHostKeyTrustSummary, String> {
    state
        .sftp()
        .trust_host_key(state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}
