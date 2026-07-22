//! SFTP 传输规则测试入口。

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use russh::{client::Handler as _, keys::PublicKey};
use russh_sftp::protocol::StatusCode;
use tokio::fs;

use crate::{
    error::{AppError, AppResult},
    models::{
        settings::SftpPerformanceSettings,
        sftp::{
            SftpLocalPathInfo, SftpRemoteCopyRequest, SftpTransferConflictPolicy, SftpTransferKind,
            SftpTransferStatus, SftpTransferSummary,
        },
    },
};

/// 返回预览字节数的默认值。
pub fn default_preview_bytes() -> usize {
    super::DEFAULT_PREVIEW_BYTES
}

/// 返回预览字节数的下限。
pub fn min_preview_bytes() -> usize {
    super::MIN_PREVIEW_BYTES
}

/// 返回预览字节数的上限。
pub fn max_preview_bytes() -> usize {
    super::MAX_PREVIEW_BYTES
}

/// 归一化远程文件预览的最大字节数。
pub fn normalize_preview_bytes(max_bytes: Option<usize>) -> usize {
    super::transfer_paths::normalize_preview_bytes(max_bytes)
}

/// 校验 chmod 的八进制权限文本。
pub fn validate_chmod_mode(mode: &str) -> AppResult<u32> {
    super::transfer_paths::validate_chmod_mode(mode)
}

/// 归一化远程路径文本。
pub fn normalize_remote_path(path: &str) -> AppResult<String> {
    super::transfer_paths::normalize_remote_path(path)
}

/// 校验并归一化本地路径文本。
pub fn validate_local_path(path: &str) -> AppResult<String> {
    super::transfer_paths::validate_local_path(path)
}

/// 归一化远程复制请求。
pub fn normalize_remote_copy_request(
    request: SftpRemoteCopyRequest,
) -> AppResult<SftpRemoteCopyRequest> {
    super::transfer_paths::normalize_remote_copy_request(request)
}

/// 按剪贴板本地路径规则分类文件和目录。
pub fn classify_clipboard_local_paths(paths: Vec<PathBuf>) -> AppResult<Vec<SftpLocalPathInfo>> {
    super::transfer_paths::classify_clipboard_local_paths(paths)
}

/// 当前平台是否支持系统级文件列表剪贴板。
pub fn system_file_clipboard_supports_native_file_list() -> bool {
    super::transfer_paths::system_file_clipboard_support().supports_native_file_list()
}

/// 校验当前平台是否支持系统级文件列表剪贴板。
pub fn ensure_local_file_clipboard_supported() -> AppResult<()> {
    super::transfer_paths::ensure_local_file_clipboard_supported()
}

/// 读取系统级文件列表剪贴板。
pub fn read_local_file_clipboard() -> AppResult<Vec<SftpLocalPathInfo>> {
    super::transfer_paths::read_local_file_clipboard()
}

/// 为剪贴板下载保留目标路径。
pub fn reserve_clipboard_download_target_path_in(
    target_root: &Path,
    request: &crate::models::sftp::SftpClipboardDownloadRequest,
) -> AppResult<PathBuf> {
    super::transfer_paths::reserve_clipboard_download_target_path_in(target_root, request)
}

/// 为远端 shell 删除命令做单引号转义。
pub fn shell_single_quote(value: &str) -> String {
    super::backend::shell_single_quote(value)
}

/// 校验远端目录 shell 删除路径的安全边界。
pub fn validate_remote_directory_shell_delete_path(path: &str) -> AppResult<()> {
    super::backend::validate_remote_directory_shell_delete_path(path)
}

/// 判断远端复制是否需要落本地临时文件兜底。
pub fn should_stage_remote_copy(request: &SftpRemoteCopyRequest, global_transfers: usize) -> bool {
    let settings = super::backend::SftpRuntimeSettings {
        global_transfers,
        ..super::backend::SftpRuntimeSettings::default()
    };
    super::runtime_tasks::should_stage_remote_copy(request, settings)
}

/// 返回普通 SFTP 性能设置归一化后的运行时参数。
pub fn normalized_sftp_runtime_settings(
    settings: SftpPerformanceSettings,
) -> (usize, usize, u32, u64) {
    let settings = super::backend::SftpRuntimeSettings::from(settings);
    (
        settings.host_transfers,
        settings.pipeline_depth,
        settings.packet_bytes,
        settings.timeout_seconds,
    )
}

/// 返回外部堡垒机 bulk transfer 使用的稳定运行时参数。
pub fn external_bulk_transfer_runtime_settings(
    settings: SftpPerformanceSettings,
) -> (usize, usize, u32, u64) {
    let settings = super::backend::SftpRuntimeSettings::from(settings).for_external_bulk_transfer();
    (
        settings.host_transfers,
        settings.pipeline_depth,
        settings.packet_bytes,
        settings.timeout_seconds,
    )
}

/// 把本地文件或目录写入 ZIP 文件。
pub fn zip_local_path_to_file(
    source_path: &Path,
    target_zip_path: &Path,
    root_name: &str,
    kind: SftpTransferKind,
    cancel_requested: Arc<AtomicBool>,
) -> AppResult<()> {
    super::archive::zip_local_path_to_file(
        source_path,
        target_zip_path,
        root_name,
        kind,
        cancel_requested,
    )
}

/// 按 native SFTP 的 known_hosts 策略校验主机公钥。
pub async fn check_native_host_key(
    host: &str,
    port: u16,
    known_hosts_path: PathBuf,
    trust_unknown: bool,
    server_public_key: &PublicKey,
) -> AppResult<bool> {
    let mut handler = super::native_ssh::NativeClientHandler {
        host: host.to_owned(),
        port,
        known_hosts_path,
        host_key_policy: if trust_unknown {
            super::native_ssh::HostKeyPolicy::TrustUnknown
        } else {
            super::native_ssh::HostKeyPolicy::RequireKnown
        },
    };
    handler
        .check_server_key(server_public_key)
        .await
        .map_err(|error| AppError::Sftp(format!("SFTP 主机密钥校验失败: {error}")))
}

/// 生成本地冲突重命名候选的文件名。
pub fn numbered_candidate_name(name: &str, index: usize) -> String {
    super::transfer_io::numbered_candidate_name(name, index)
}

/// 生成可靠传输 partial 文件名。
pub fn reliable_partial_file_name(name: &str) -> String {
    super::transfer_io::reliable_partial_file_name(name)
}

/// 生成可靠传输远端 partial 路径。
pub fn reliable_remote_partial_path(final_path: &str) -> String {
    super::transfer_io::reliable_remote_partial_path(final_path)
}

/// 生成可靠传输本地 partial 路径。
pub fn reliable_local_partial_path(final_path: &Path) -> PathBuf {
    super::transfer_io::reliable_local_partial_path(final_path)
}

/// 计算可靠传输写入计划，返回稳定测试标签和 resume offset。
pub fn reliable_write_decision(
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
    partial_bytes: Option<u64>,
) -> (&'static str, Option<u64>) {
    match super::transfer_io::plan_reliable_write(
        conflict_policy,
        final_exists,
        source_bytes,
        partial_bytes,
    ) {
        super::transfer_io::ReliableWriteDecision::SkipExistingFinal => {
            ("skip-existing-final", None)
        }
        super::transfer_io::ReliableWriteDecision::ChooseRenamedFinal => {
            ("choose-renamed-final", None)
        }
        super::transfer_io::ReliableWriteDecision::Fresh => ("fresh", None),
        super::transfer_io::ReliableWriteDecision::Resume { offset } => ("resume", Some(offset)),
        super::transfer_io::ReliableWriteDecision::CommitExistingPartial => {
            ("commit-existing-partial", None)
        }
        super::transfer_io::ReliableWriteDecision::RestartPartial => ("restart-partial", None),
    }
}

/// 判断可靠传输提交前的 size 确认是否通过。
pub fn reliable_size_confirmed(expected: u64, actual: u64) -> bool {
    matches!(
        super::transfer_io::confirm_reliable_write_size(expected, actual),
        super::transfer_io::ReliableSizeConfirmation::Verified
    )
}

/// 构造 SFTP status 错误并判断是否是明确的 already-exists 冲突。
pub fn sftp_status_error_is_already_exists(status_code: StatusCode, error_message: &str) -> bool {
    let error = russh_sftp::client::error::Error::Status(super::Status {
        id: 0,
        status_code,
        error_message: error_message.to_owned(),
        language_tag: String::new(),
    });
    super::is_already_exists_error(&error)
}

/// 准备本地可靠写入目标，返回 final/partial 路径和 partial 文件句柄。
pub async fn prepare_local_reliable_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    source_bytes: u64,
) -> AppResult<Option<(PathBuf, PathBuf, u64, fs::File)>> {
    super::transfer_io::prepare_local_reliable_write_target(
        local_path,
        conflict_policy,
        source_bytes,
    )
    .await
    .map(|target| {
        target.map(|target| {
            (
                target.final_path,
                target.partial_path,
                target.offset,
                target.file,
            )
        })
    })
}

/// 提交本地可靠写入目标。
pub async fn commit_local_reliable_write_target(
    final_path: &Path,
    partial_path: &Path,
    expected_bytes: u64,
) -> AppResult<()> {
    super::transfer_io::commit_local_reliable_write_target(final_path, partial_path, expected_bytes)
        .await
}

/// 按传输冲突策略准备本地文件写入目标。
pub async fn open_local_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    skipped_bytes: u64,
) -> AppResult<Option<fs::File>> {
    super::transfer_io::open_local_write_target(local_path, conflict_policy, skipped_bytes).await
}

/// 按传输冲突策略准备本地目录写入根路径。
pub async fn prepare_local_directory_root(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<PathBuf>> {
    super::transfer_io::prepare_local_directory_root(local_path, conflict_policy).await
}

/// 判断传输摘要是否属于指定视图 scope。
pub fn transfer_matches_scope(summary: &SftpTransferSummary, view_scope: Option<&str>) -> bool {
    super::transfer_registry::transfer_matches_scope(summary, view_scope)
}

/// 判断 clear-completed 后是否应保留传输摘要。
pub fn retain_after_clear_completed(
    summary: &SftpTransferSummary,
    view_scope: Option<&str>,
) -> bool {
    !transfer_matches_scope(summary, view_scope)
        || !matches!(
            summary.status,
            SftpTransferStatus::Succeeded
                | SftpTransferStatus::Failed
                | SftpTransferStatus::Canceled
        )
}

/// 返回内存中保留的最近完成传输数量上限。
pub fn completed_transfer_retention_limit() -> usize {
    super::transfer_registry::RECENT_COMPLETED_TRANSFER_LIMIT
}

/// 返回完成传输按时间保留的秒数。
pub fn completed_transfer_retention_seconds() -> u64 {
    super::transfer_registry::RECENT_COMPLETED_TRANSFER_SECONDS
}

/// 返回会被 retention policy 裁剪的完成传输 id，供策略测试复用。
pub fn pruned_completed_transfer_ids(summaries: &[SftpTransferSummary], now: u64) -> Vec<String> {
    let mut ids = super::transfer_registry::completed_transfer_prune_ids(summaries.iter(), now)
        .into_iter()
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

/// 生成取消标记，供归档规则测试和运行时调用者复用。
pub fn new_cancel_flag(cancelled: bool) -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(cancelled))
}

/// 读取取消标记的当前状态。
pub fn is_cancelled(cancel_requested: &Arc<AtomicBool>) -> bool {
    cancel_requested.load(Ordering::SeqCst)
}
