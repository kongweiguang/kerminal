//! SFTP 会话级传输 I/O helper。
//!
//! @author kongweiguang

use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
};

use russh_sftp::{
    client::{fs::File as SftpFile, SftpSession},
    protocol::FileType,
};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWrite, AsyncWriteExt},
};

use crate::{
    error::{AppError, AppResult},
    models::sftp::SftpTransferConflictPolicy,
};

use super::{
    backend::{io_sftp_error, native_sftp_error, SftpRuntimeSettings},
    is_already_exists_error, is_ambiguous_sftp_failure, is_no_such_file_error,
    transfer_paths::join_remote_path,
    CancellationReader, ProgressWriter, TransferProgress,
};

enum RemoteReadFallback {
    File(String),
    Directory(String),
}

mod reliable_io;
pub(super) use reliable_io::*;

pub(super) async fn upload_directory(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let total = calculate_local_directory_bytes(local_path).await?;
    progress.set_total_bytes(total);
    let Some(remote_root) =
        prepare_remote_directory_root(sftp, remote_path, conflict_policy).await?
    else {
        progress.add_bytes(total);
        return Ok(());
    };
    let mut stack = vec![(local_path.to_path_buf(), remote_root)];
    while let Some((local_dir, remote_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        if let Err(error) = sftp.create_dir(remote_dir.clone()).await {
            if !remote_create_conflict_confirmed(sftp, &remote_dir, &error, true).await {
                return Err(native_sftp_error(error));
            }
        }
        let mut entries = fs::read_dir(&local_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            progress.ensure_not_cancelled()?;
            let metadata = entry.metadata().await?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let remote_child = join_remote_path(&remote_dir, &name);
            if metadata.is_dir() {
                stack.push((entry.path(), remote_child));
            } else if metadata.is_file() {
                upload_file(
                    sftp,
                    &entry.path(),
                    &remote_child,
                    progress,
                    settings,
                    conflict_policy,
                    false,
                )
                .await?;
            }
        }
    }
    Ok(())
}

pub(super) async fn upload_file(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    let metadata = fs::metadata(local_path).await?;
    if set_total {
        progress.set_total_bytes(metadata.len());
    }
    let mut local_file = fs::File::open(local_path).await?;
    let Some(mut remote_target) =
        prepare_remote_reliable_write_target(sftp, remote_path, conflict_policy, metadata.len())
            .await?
    else {
        progress.add_bytes(metadata.len());
        return Ok(());
    };
    if remote_target.offset > 0 {
        local_file
            .seek(SeekFrom::Start(remote_target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(remote_target.offset);
    }
    let first_write = write_remote_file_batches(
        &mut remote_target.file,
        &mut local_file,
        progress,
        settings,
        settings.pipeline_depth,
    )
    .await;
    if let Err(first_error) = first_write {
        let _ = remote_target.file.shutdown().await;
        let empty_partial_removed =
            cleanup_empty_remote_partial(sftp, &remote_target.partial_path).await;
        if remote_target.offset == 0 && settings.pipeline_depth > 1 && empty_partial_removed {
            local_file
                .seek(SeekFrom::Start(0))
                .await
                .map_err(io_sftp_error)?;
            remote_target = restart_remote_reliable_write_target(
                sftp,
                &remote_target.final_path,
                remote_target.partial_path,
            )
            .await?;
            if let Err(retry_error) = write_remote_file_batches(
                &mut remote_target.file,
                &mut local_file,
                progress,
                settings,
                1,
            )
            .await
            {
                let _ = remote_target.file.shutdown().await;
                cleanup_empty_remote_partial(sftp, &remote_target.partial_path).await;
                return Err(AppError::Sftp(format!(
                    "远端文件写入失败（并发写与顺序重试均失败）: {}; retry: {}",
                    native_sftp_error(first_error),
                    native_sftp_error(retry_error)
                )));
            }
        } else {
            return Err(AppError::Sftp(format!(
                "远端文件写入失败: {}",
                native_sftp_error(first_error)
            )));
        }
    }
    remote_target
        .file
        .shutdown()
        .await
        .map_err(|error| AppError::Sftp(format!("远端文件关闭失败: {}", io_sftp_error(error))))?;
    commit_remote_reliable_write_target(
        sftp,
        &remote_target.final_path,
        &remote_target.partial_path,
        metadata.len(),
    )
    .await
}

async fn write_remote_file_batches(
    remote_file: &mut SftpFile,
    local_file: &mut fs::File,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    pipeline_depth: usize,
) -> Result<(), russh_sftp::client::error::Error> {
    let confirmed_batch_bytes = u64::from(settings.packet_bytes)
        .saturating_mul(pipeline_depth as u64)
        .max(1);
    loop {
        let mut batch = (&mut *local_file).take(confirmed_batch_bytes);
        let mut reader = CancellationReader::new(&mut batch, progress.clone());
        let confirmed_bytes = remote_file
            .write_all_pipelined(&mut reader, pipeline_depth)
            .await?;
        if confirmed_bytes == 0 {
            return Ok(());
        }
        progress.add_bytes(confirmed_bytes);
        if confirmed_bytes < confirmed_batch_bytes {
            return Ok(());
        }
    }
}

pub(super) async fn download_directory(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let Some(local_root) = prepare_local_directory_root(local_path, conflict_policy).await? else {
        return Ok(());
    };
    let mut stack = vec![(remote_path.to_owned(), local_root)];
    while let Some((remote_dir, local_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        fs::create_dir_all(&local_dir).await?;
        let entries = sftp
            .read_dir(remote_dir.clone())
            .await
            .map_err(native_sftp_error)?;
        for entry in entries {
            progress.ensure_not_cancelled()?;
            let name = entry.file_name();
            let remote_child = entry.path();
            let local_child = local_dir.join(&name);
            match entry.file_type() {
                FileType::Dir => stack.push((remote_child, local_child)),
                FileType::File | FileType::Symlink => {
                    if let Some(size) = entry.metadata().size {
                        progress.add_total_bytes(size);
                    }
                    download_file(
                        sftp,
                        &remote_child,
                        &local_child,
                        progress,
                        settings,
                        conflict_policy,
                        false,
                    )
                    .await?;
                }
                FileType::Other => {}
            }
        }
    }
    Ok(())
}

pub(super) async fn download_file(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    if set_total {
        if let Some(directory_path) = resolve_file_request_directory(sftp, remote_path).await {
            return Box::pin(download_directory(
                sftp,
                &directory_path,
                local_path,
                progress,
                settings,
                conflict_policy,
            ))
            .await;
        }
    }
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut remote_file = match sftp.open(remote_path).await {
        Ok(remote_file) => remote_file,
        Err(open_error) => {
            let Some(fallback) = resolve_remote_read_fallback(sftp, remote_path).await else {
                return Err(native_sftp_error(open_error));
            };
            match fallback {
                RemoteReadFallback::Directory(directory_path) => {
                    return Box::pin(download_directory(
                        sftp,
                        &directory_path,
                        local_path,
                        progress,
                        settings,
                        conflict_policy,
                    ))
                    .await;
                }
                RemoteReadFallback::File(file_path) => {
                    sftp.open(file_path).await.map_err(native_sftp_error)?
                }
            }
        }
    };
    if set_total {
        if let Ok(metadata) = remote_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let remote_size = remote_file
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let Some(mut local_target) =
        prepare_local_reliable_write_target(local_path, conflict_policy, remote_size).await?
    else {
        progress.add_bytes(remote_size);
        return Ok(());
    };
    if local_target.offset > 0 {
        remote_file
            .seek(SeekFrom::Start(local_target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(local_target.offset);
    }
    {
        let mut writer = ProgressWriter::new(&mut local_target.file, progress.clone());
        stream_remote_file_to_writer(&mut remote_file, &mut writer, progress).await?;
        writer.flush().await.map_err(io_sftp_error)?;
    }
    local_target.file.flush().await.map_err(io_sftp_error)?;
    local_target.file.shutdown().await.map_err(io_sftp_error)?;
    let final_path = local_target.final_path.clone();
    let partial_path = local_target.partial_path.clone();
    drop(local_target.file);
    remote_file.shutdown().await.map_err(io_sftp_error)?;
    commit_local_reliable_write_target(&final_path, &partial_path, remote_size).await
}

async fn resolve_remote_read_fallback(
    sftp: &SftpSession,
    remote_path: &str,
) -> Option<RemoteReadFallback> {
    if let Some(directory_path) = resolve_remote_directory_path(sftp, remote_path).await {
        return Some(RemoteReadFallback::Directory(directory_path));
    }

    let target_path = resolve_remote_link_target_path(sftp, remote_path).await?;
    if let Some(directory_path) = resolve_remote_directory_path(sftp, &target_path).await {
        return Some(RemoteReadFallback::Directory(directory_path));
    }
    Some(RemoteReadFallback::File(target_path))
}

/// 顶层文件请求先用 STAT 识别目录，兼容允许 OPEN 目录句柄的 SFTP 服务端。
async fn resolve_file_request_directory(sftp: &SftpSession, remote_path: &str) -> Option<String> {
    let metadata = sftp.metadata(remote_path.to_owned()).await.ok()?;
    if !metadata.is_dir() {
        return None;
    }

    resolve_remote_directory_path(sftp, remote_path)
        .await
        .or_else(|| Some(remote_path.to_owned()))
}

async fn resolve_remote_directory_path(sftp: &SftpSession, remote_path: &str) -> Option<String> {
    if sftp.read_dir(remote_path.to_owned()).await.is_ok() {
        return Some(remote_path.to_owned());
    }

    if let Some(target_path) = resolve_remote_link_target_path(sftp, remote_path).await {
        if sftp.read_dir(target_path.clone()).await.is_ok() {
            return Some(target_path);
        }
    }

    let metadata = sftp.metadata(remote_path.to_owned()).await.ok()?;
    if !metadata.is_dir() {
        return None;
    }

    let canonical_path =
        normalize_remote_fallback_path(&sftp.canonicalize(remote_path).await.ok()?);
    if canonical_path != normalize_remote_fallback_path(remote_path)
        && sftp.read_dir(canonical_path.clone()).await.is_ok()
    {
        return Some(canonical_path);
    }

    None
}

async fn resolve_remote_link_target_path(sftp: &SftpSession, remote_path: &str) -> Option<String> {
    let target = sftp.read_link(remote_path.to_owned()).await.ok()?;
    resolve_remote_link_target(remote_path, &target)
}

fn resolve_remote_link_target(link_path: &str, target: &str) -> Option<String> {
    let target = normalize_remote_fallback_path(target);
    if target.is_empty() {
        return None;
    }
    if target.starts_with('/') {
        return Some(target);
    }
    Some(join_remote_path(&remote_parent_path(link_path), &target))
}

fn remote_parent_path(path: &str) -> String {
    let path = normalize_remote_fallback_path(path);
    let path = path.trim_end_matches('/');
    match path.rfind('/') {
        Some(0) | None => "/".to_owned(),
        Some(index) => path[..index].to_owned(),
    }
}

fn normalize_remote_fallback_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

pub(super) async fn copy_remote_directory_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let Some(target_root) =
        prepare_remote_directory_root(target_sftp, target_remote_path, conflict_policy).await?
    else {
        return Ok(());
    };
    let mut stack = vec![(source_remote_path.to_owned(), target_root)];
    while let Some((source_dir, target_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        ensure_remote_directory(target_sftp, &target_dir).await?;
        let entries = source_sftp
            .read_dir(source_dir.clone())
            .await
            .map_err(native_sftp_error)?;
        for entry in entries {
            progress.ensure_not_cancelled()?;
            let name = entry.file_name();
            let source_child = entry.path();
            let target_child = join_remote_path(&target_dir, &name);
            match entry.file_type() {
                FileType::Dir => stack.push((source_child, target_child)),
                FileType::File | FileType::Symlink => {
                    if let Some(size) = entry.metadata().size {
                        progress.add_total_bytes(size);
                    }
                    copy_remote_file_between_sessions(
                        source_sftp,
                        &source_child,
                        target_sftp,
                        &target_child,
                        progress,
                        settings,
                        conflict_policy,
                        false,
                    )
                    .await?;
                }
                FileType::Other => {}
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn copy_remote_file_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    if set_total {
        if let Some(directory_path) =
            resolve_file_request_directory(source_sftp, source_remote_path).await
        {
            return Box::pin(copy_remote_directory_between_sessions(
                source_sftp,
                &directory_path,
                target_sftp,
                target_remote_path,
                progress,
                settings,
                conflict_policy,
            ))
            .await;
        }
    }
    let mut source_file = match source_sftp.open(source_remote_path).await {
        Ok(source_file) => source_file,
        Err(open_error) => {
            let Some(fallback) =
                resolve_remote_read_fallback(source_sftp, source_remote_path).await
            else {
                return Err(native_sftp_error(open_error));
            };
            match fallback {
                RemoteReadFallback::Directory(directory_path) => {
                    return Box::pin(copy_remote_directory_between_sessions(
                        source_sftp,
                        &directory_path,
                        target_sftp,
                        target_remote_path,
                        progress,
                        settings,
                        conflict_policy,
                    ))
                    .await;
                }
                RemoteReadFallback::File(file_path) => source_sftp
                    .open(file_path)
                    .await
                    .map_err(native_sftp_error)?,
            }
        }
    };
    if set_total {
        if let Ok(metadata) = source_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let source_size = source_file
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let Some(mut target) = prepare_remote_reliable_write_target(
        target_sftp,
        target_remote_path,
        conflict_policy,
        source_size,
    )
    .await?
    else {
        progress.add_bytes(source_size);
        return Ok(());
    };
    if target.offset > 0 {
        source_file
            .seek(SeekFrom::Start(target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(target.offset);
    }
    {
        let mut writer = ProgressWriter::new(&mut target.file, progress.clone());
        let _ = settings;
        stream_remote_file_to_writer(&mut source_file, &mut writer, progress).await?;
        writer.flush().await.map_err(io_sftp_error)?;
    }
    target.file.shutdown().await.map_err(io_sftp_error)?;
    source_file.shutdown().await.map_err(io_sftp_error)?;
    commit_remote_reliable_write_target(
        target_sftp,
        &target.final_path,
        &target.partial_path,
        source_size,
    )
    .await
}

async fn stream_remote_file_to_writer<W>(
    remote_file: &mut SftpFile,
    writer: &mut W,
    progress: &TransferProgress,
) -> AppResult<u64>
where
    W: AsyncWrite + Unpin,
{
    let mut total = 0_u64;
    let mut buffer = vec![0_u8; DOWNLOAD_READ_CHUNK_BYTES];
    loop {
        progress.ensure_not_cancelled()?;
        let read = remote_file.read(&mut buffer).await.map_err(io_sftp_error)?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .await
            .map_err(io_sftp_error)?;
        total = total.saturating_add(read as u64);
    }
    Ok(total)
}

async fn ensure_remote_directory(sftp: &SftpSession, remote_path: &str) -> AppResult<()> {
    if let Err(error) = sftp.create_dir(remote_path.to_owned()).await {
        if !remote_create_conflict_confirmed(sftp, remote_path, &error, true).await {
            return Err(native_sftp_error(error));
        }
    }
    Ok(())
}

async fn prepare_remote_directory_root(
    sftp: &SftpSession,
    remote_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<String>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            ensure_remote_directory(sftp, remote_path).await?;
            Ok(Some(remote_path.to_owned()))
        }
        SftpTransferConflictPolicy::Skip => match sftp.create_dir(remote_path.to_owned()).await {
            Ok(()) => Ok(Some(remote_path.to_owned())),
            Err(error) => {
                if remote_create_conflict_confirmed(sftp, remote_path, &error, true).await {
                    Ok(None)
                } else {
                    Err(native_sftp_error(error))
                }
            }
        },
        SftpTransferConflictPolicy::Rename => {
            for candidate in remote_conflict_candidates(remote_path).take(1000) {
                match sftp.create_dir(candidate.clone()).await {
                    Ok(()) => return Ok(Some(candidate)),
                    Err(error) => {
                        if remote_create_conflict_confirmed(sftp, &candidate, &error, true).await {
                            continue;
                        }
                        return Err(native_sftp_error(error));
                    }
                }
            }
            Err(AppError::Sftp(format!(
                "无法为远程目标生成不冲突的目录名: {remote_path}"
            )))
        }
    }
}

pub(super) async fn prepare_local_directory_root(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<PathBuf>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            fs::create_dir_all(local_path).await?;
            Ok(Some(local_path.to_path_buf()))
        }
        SftpTransferConflictPolicy::Skip if fs::try_exists(local_path).await? => Ok(None),
        SftpTransferConflictPolicy::Skip => {
            fs::create_dir_all(local_path).await?;
            Ok(Some(local_path.to_path_buf()))
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                match fs::create_dir(&candidate).await {
                    Ok(()) => return Ok(Some(candidate)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的目录名: {}",
                local_path.display()
            )))
        }
    }
}
