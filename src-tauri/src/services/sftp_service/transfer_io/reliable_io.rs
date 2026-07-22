//! 可靠传输的 partial、resume、冲突与提交语义。

use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
};

use russh_sftp::{
    client::{fs::File as SftpFile, SftpSession},
    protocol::OpenFlags,
};
use tokio::{fs, io::AsyncSeekExt};

use crate::{
    error::{AppError, AppResult},
    models::sftp::SftpTransferConflictPolicy,
};

use super::{
    io_sftp_error, is_already_exists_error, is_ambiguous_sftp_failure, is_no_such_file_error,
    join_remote_path, native_sftp_error, remote_parent_path,
};

const RELIABLE_PARTIAL_SUFFIX: &str = ".kerminal-part";
pub(in crate::services::sftp_service) const DOWNLOAD_READ_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::services::sftp_service) enum ReliableWriteDecision {
    SkipExistingFinal,
    ChooseRenamedFinal,
    Fresh,
    Resume { offset: u64 },
    CommitExistingPartial,
    RestartPartial,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::services::sftp_service) enum ReliableSizeConfirmation {
    Verified,
    Mismatch { expected: u64, actual: u64 },
}

pub(in crate::services::sftp_service) struct PreparedLocalReliableWriteTarget {
    pub(in crate::services::sftp_service) final_path: PathBuf,
    pub(in crate::services::sftp_service) partial_path: PathBuf,
    pub(in crate::services::sftp_service) offset: u64,
    pub(in crate::services::sftp_service) file: fs::File,
}

pub(in crate::services::sftp_service) struct PreparedRemoteReliableWriteTarget {
    pub(in crate::services::sftp_service) final_path: String,
    pub(in crate::services::sftp_service) partial_path: String,
    pub(in crate::services::sftp_service) offset: u64,
    pub(in crate::services::sftp_service) file: SftpFile,
}

pub(in crate::services::sftp_service) fn reliable_partial_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() { "file" } else { trimmed };
    format!("{name}{RELIABLE_PARTIAL_SUFFIX}")
}

pub(in crate::services::sftp_service) fn reliable_remote_partial_path(final_path: &str) -> String {
    let trimmed = final_path.trim().trim_end_matches('/');
    let name = trimmed.rsplit('/').next().unwrap_or("file");
    join_remote_path(
        &remote_parent_path(final_path),
        &reliable_partial_file_name(name),
    )
}

pub(in crate::services::sftp_service) fn reliable_local_partial_path(final_path: &Path) -> PathBuf {
    let name = final_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let partial_name = reliable_partial_file_name(name);
    final_path
        .parent()
        .map(|parent| parent.join(&partial_name))
        .unwrap_or_else(|| PathBuf::from(partial_name))
}

pub(in crate::services::sftp_service) fn plan_reliable_write(
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
    partial_bytes: Option<u64>,
) -> ReliableWriteDecision {
    if final_exists {
        match conflict_policy {
            SftpTransferConflictPolicy::Skip => return ReliableWriteDecision::SkipExistingFinal,
            SftpTransferConflictPolicy::Rename => {
                return ReliableWriteDecision::ChooseRenamedFinal;
            }
            SftpTransferConflictPolicy::Overwrite => {}
        }
    }

    match partial_bytes {
        None | Some(0) if source_bytes > 0 => ReliableWriteDecision::Fresh,
        None => ReliableWriteDecision::Fresh,
        Some(partial_bytes) if partial_bytes < source_bytes => ReliableWriteDecision::Resume {
            offset: partial_bytes,
        },
        Some(partial_bytes) if partial_bytes == source_bytes => {
            ReliableWriteDecision::CommitExistingPartial
        }
        Some(_) => ReliableWriteDecision::RestartPartial,
    }
}

pub(in crate::services::sftp_service) fn confirm_reliable_write_size(
    expected: u64,
    actual: u64,
) -> ReliableSizeConfirmation {
    if expected == actual {
        ReliableSizeConfirmation::Verified
    } else {
        ReliableSizeConfirmation::Mismatch { expected, actual }
    }
}

pub(in crate::services::sftp_service) async fn remote_create_conflict_confirmed(
    sftp: &SftpSession,
    remote_path: &str,
    error: &russh_sftp::client::error::Error,
    require_directory: bool,
) -> bool {
    if is_already_exists_error(error) {
        return true;
    }
    if !is_ambiguous_sftp_failure(error) {
        return false;
    }
    match sftp.metadata(remote_path.to_owned()).await {
        Ok(metadata) => !require_directory || metadata.is_dir(),
        Err(_) => false,
    }
}

async fn remote_path_exists(sftp: &SftpSession, remote_path: &str) -> AppResult<bool> {
    match sftp.metadata(remote_path.to_owned()).await {
        Ok(_) => Ok(true),
        Err(error) if is_no_such_file_error(&error) => Ok(false),
        Err(error) => Err(native_sftp_error(error)),
    }
}

pub(in crate::services::sftp_service) async fn prepare_remote_reliable_write_target(
    sftp: &SftpSession,
    remote_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
    source_bytes: u64,
) -> AppResult<Option<PreparedRemoteReliableWriteTarget>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            prepare_selected_remote_reliable_write_target(
                sftp,
                remote_path,
                conflict_policy,
                remote_path_exists(sftp, remote_path).await?,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Skip if remote_path_exists(sftp, remote_path).await? => {
            Ok(None)
        }
        SftpTransferConflictPolicy::Skip => {
            prepare_selected_remote_reliable_write_target(
                sftp,
                remote_path,
                conflict_policy,
                false,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in remote_conflict_candidates(remote_path).take(1000) {
                if remote_path_exists(sftp, &candidate).await? {
                    continue;
                }
                return prepare_selected_remote_reliable_write_target(
                    sftp,
                    &candidate,
                    conflict_policy,
                    false,
                    source_bytes,
                )
                .await;
            }
            Err(AppError::Sftp(format!(
                "无法为远程目标生成不冲突的文件名: {remote_path}"
            )))
        }
    }
}

async fn prepare_selected_remote_reliable_write_target(
    sftp: &SftpSession,
    final_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
) -> AppResult<Option<PreparedRemoteReliableWriteTarget>> {
    let partial_path = reliable_remote_partial_path(final_path);
    let partial_bytes = remote_partial_bytes(sftp, &partial_path).await?;
    match plan_reliable_write(conflict_policy, final_exists, source_bytes, partial_bytes) {
        ReliableWriteDecision::SkipExistingFinal => Ok(None),
        ReliableWriteDecision::ChooseRenamedFinal => Err(AppError::Sftp(format!(
            "无法为远程目标生成不冲突的文件名: {final_path}"
        ))),
        ReliableWriteDecision::Fresh | ReliableWriteDecision::RestartPartial => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, 0, true)
                .await
                .map(Some)
        }
        ReliableWriteDecision::Resume { offset } => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, offset, false)
                .await
                .map(Some)
        }
        ReliableWriteDecision::CommitExistingPartial => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, source_bytes, false)
                .await
                .map(Some)
        }
    }
}

async fn remote_partial_bytes(sftp: &SftpSession, partial_path: &str) -> AppResult<Option<u64>> {
    match sftp.metadata(partial_path.to_owned()).await {
        Ok(metadata) => Ok(metadata.size),
        Err(error) if is_no_such_file_error(&error) => Ok(None),
        Err(error) => Err(native_sftp_error(error)),
    }
}

async fn open_remote_reliable_partial_target(
    sftp: &SftpSession,
    final_path: &str,
    partial_path: String,
    offset: u64,
    truncate: bool,
) -> AppResult<PreparedRemoteReliableWriteTarget> {
    let flags = if truncate {
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
    } else {
        OpenFlags::CREATE | OpenFlags::WRITE
    };
    let mut file = sftp
        .open_with_flags(partial_path.clone(), flags)
        .await
        .map_err(native_sftp_error)?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(io_sftp_error)?;
    }
    Ok(PreparedRemoteReliableWriteTarget {
        final_path: final_path.to_owned(),
        partial_path,
        offset,
        file,
    })
}

pub(in crate::services::sftp_service) async fn commit_remote_reliable_write_target(
    sftp: &SftpSession,
    final_path: &str,
    partial_path: &str,
    expected_bytes: u64,
) -> AppResult<()> {
    let actual_bytes = sftp
        .metadata(partial_path.to_owned())
        .await
        .map_err(native_sftp_error)?
        .size
        .unwrap_or(0);
    match confirm_reliable_write_size(expected_bytes, actual_bytes) {
        ReliableSizeConfirmation::Verified => {}
        ReliableSizeConfirmation::Mismatch { expected, actual } => {
            return Err(AppError::Sftp(format!(
                "可靠上传 size 确认失败: expected {expected} bytes, got {actual} bytes"
            )));
        }
    }

    match sftp
        .rename(partial_path.to_owned(), final_path.to_owned())
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if remote_create_conflict_confirmed(sftp, final_path, &error, false).await => {
            sftp.remove_file(final_path.to_owned())
                .await
                .map_err(native_sftp_error)?;
            sftp.rename(partial_path.to_owned(), final_path.to_owned())
                .await
                .map_err(native_sftp_error)
        }
        Err(error) => Err(native_sftp_error(error)),
    }
}

/// 写请求在服务端确认前失败时清理空 partial；已有内容的 partial 保留用于续传。
pub(in crate::services::sftp_service) async fn cleanup_empty_remote_partial(
    sftp: &SftpSession,
    partial_path: &str,
) -> bool {
    let is_empty = sftp
        .metadata(partial_path.to_owned())
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        == Some(0);
    if is_empty {
        return sftp.remove_file(partial_path.to_owned()).await.is_ok();
    }
    false
}

/// 首次并发写未落下任何字节时，以截断方式重新打开同一个 partial 供顺序重试。
pub(in crate::services::sftp_service) async fn restart_remote_reliable_write_target(
    sftp: &SftpSession,
    final_path: &str,
    partial_path: String,
) -> AppResult<PreparedRemoteReliableWriteTarget> {
    open_remote_reliable_partial_target(sftp, final_path, partial_path, 0, true).await
}

pub(in crate::services::sftp_service) async fn prepare_local_reliable_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    source_bytes: u64,
) -> AppResult<Option<PreparedLocalReliableWriteTarget>> {
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            prepare_selected_local_reliable_write_target(
                local_path,
                conflict_policy,
                fs::try_exists(local_path).await?,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Skip if fs::try_exists(local_path).await? => Ok(None),
        SftpTransferConflictPolicy::Skip => {
            prepare_selected_local_reliable_write_target(
                local_path,
                conflict_policy,
                false,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                if fs::try_exists(&candidate).await? {
                    continue;
                }
                return prepare_selected_local_reliable_write_target(
                    &candidate,
                    conflict_policy,
                    false,
                    source_bytes,
                )
                .await;
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的文件名: {}",
                local_path.display()
            )))
        }
    }
}

async fn prepare_selected_local_reliable_write_target(
    final_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
) -> AppResult<Option<PreparedLocalReliableWriteTarget>> {
    let partial_path = reliable_local_partial_path(final_path);
    let partial_bytes = local_partial_bytes(&partial_path).await?;
    match plan_reliable_write(conflict_policy, final_exists, source_bytes, partial_bytes) {
        ReliableWriteDecision::SkipExistingFinal => Ok(None),
        ReliableWriteDecision::ChooseRenamedFinal => Err(AppError::Sftp(format!(
            "无法为本地目标生成不冲突的文件名: {}",
            final_path.display()
        ))),
        ReliableWriteDecision::Fresh | ReliableWriteDecision::RestartPartial => {
            open_local_reliable_partial_target(final_path, partial_path, 0, true)
                .await
                .map(Some)
        }
        ReliableWriteDecision::Resume { offset } => {
            open_local_reliable_partial_target(final_path, partial_path, offset, false)
                .await
                .map(Some)
        }
        ReliableWriteDecision::CommitExistingPartial => {
            open_local_reliable_partial_target(final_path, partial_path, source_bytes, false)
                .await
                .map(Some)
        }
    }
}

async fn local_partial_bytes(partial_path: &Path) -> AppResult<Option<u64>> {
    match fs::metadata(partial_path).await {
        Ok(metadata) => Ok(Some(metadata.len())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

async fn open_local_reliable_partial_target(
    final_path: &Path,
    partial_path: PathBuf,
    offset: u64,
    truncate: bool,
) -> AppResult<PreparedLocalReliableWriteTarget> {
    if let Some(parent) = partial_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(truncate)
        .open(&partial_path)
        .await?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset)).await?;
    }
    Ok(PreparedLocalReliableWriteTarget {
        final_path: final_path.to_path_buf(),
        partial_path,
        offset,
        file,
    })
}

pub(in crate::services::sftp_service) async fn commit_local_reliable_write_target(
    final_path: &Path,
    partial_path: &Path,
    expected_bytes: u64,
) -> AppResult<()> {
    let actual_bytes = fs::metadata(partial_path).await?.len();
    match confirm_reliable_write_size(expected_bytes, actual_bytes) {
        ReliableSizeConfirmation::Verified => {}
        ReliableSizeConfirmation::Mismatch { expected, actual } => {
            return Err(AppError::Sftp(format!(
                "可靠下载 size 确认失败: expected {expected} bytes, got {actual} bytes"
            )));
        }
    }

    match fs::rename(partial_path, final_path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            fs::remove_file(final_path).await?;
            fs::rename(partial_path, final_path).await?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

pub(in crate::services::sftp_service) async fn open_local_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    skipped_bytes: u64,
) -> AppResult<Option<fs::File>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => fs::File::create(local_path)
            .await
            .map(Some)
            .map_err(Into::into),
        SftpTransferConflictPolicy::Skip => {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(local_path)
                .await
            {
                Ok(file) => Ok(Some(file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let _ = skipped_bytes;
                    Ok(None)
                }
                Err(error) => Err(error.into()),
            }
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                match fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(candidate)
                    .await
                {
                    Ok(file) => return Ok(Some(file)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的文件名: {}",
                local_path.display()
            )))
        }
    }
}

pub(in crate::services::sftp_service) fn remote_conflict_candidates(
    remote_path: &str,
) -> impl Iterator<Item = String> + '_ {
    std::iter::once(remote_path.to_owned()).chain((1..).map(move |index| {
        let parent = remote_parent_path(remote_path);
        let name = remote_path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(remote_path);
        join_remote_path(&parent, &numbered_candidate_name(name, index))
    }))
}

pub(in crate::services::sftp_service) fn local_conflict_candidates(
    local_path: &Path,
) -> impl Iterator<Item = PathBuf> + '_ {
    std::iter::once(local_path.to_path_buf()).chain((1..).map(move |index| {
        let name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file");
        let candidate_name = numbered_candidate_name(name, index);
        local_path
            .parent()
            .map(|parent| parent.join(&candidate_name))
            .unwrap_or_else(|| PathBuf::from(candidate_name))
    }))
}

pub(in crate::services::sftp_service) fn numbered_candidate_name(
    name: &str,
    index: usize,
) -> String {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() { "file" } else { trimmed };
    let Some(dot_index) = name.rfind('.') else {
        return format!("{name} ({index})");
    };
    if dot_index == 0 {
        return format!("{name} ({index})");
    }
    let (stem, extension) = name.split_at(dot_index);
    format!("{stem} ({index}){extension}")
}

pub(in crate::services::sftp_service) async fn calculate_local_directory_bytes(
    path: &Path,
) -> AppResult<u64> {
    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let metadata = entry.metadata().await?;
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}
