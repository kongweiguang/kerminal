//! SFTP download data path.
//! @author kongweiguang

use super::*;

pub(in crate::services::sftp_service) async fn download_directory(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    // 目录重试会重新枚举文件；总字节数从本轮完整枚举重建，避免同 ID 恢复后翻倍。
    progress.set_total_bytes(0);
    let Some(local_root) =
        prepare_task_local_directory_root(remote_path, local_path, conflict_policy, progress)
            .await?
    else {
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

/// 下载完成仍核对远端源完整摘要，成功提交前保持本地 partial。
pub(in crate::services::sftp_service) async fn download_file(
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
    let remote_metadata = remote_file.metadata().await.map_err(native_sftp_error)?;
    let remote_size = remote_metadata.size.unwrap_or(0);
    let source_identity = remote_source_fingerprint(&mut remote_file, &remote_metadata).await?;
    let checkpoint_key = recovery_key(remote_path, &local_path.to_string_lossy());
    let Some(mut local_target) = prepare_local_reliable_write_target_for_source(
        local_path,
        conflict_policy,
        &source_identity,
        Some(&progress.recovery_checkpoints()),
        &checkpoint_key,
    )
    .await?
    else {
        credit_skipped_or_committed(progress, &checkpoint_key, remote_size, set_total)?;
        return Ok(());
    };
    if local_target.offset > 0 {
        remote_file
            .seek(SeekFrom::Start(local_target.offset))
            .await
            .map_err(io_sftp_error)?;
        // 完整前缀会重新验证，但验证不是新的传输字节，不能重复累加。
        if set_total {
            progress.set_confirmed_bytes(local_target.offset);
        }
    }
    let checkpoints = progress.recovery_checkpoints();
    progress.mark_phase("verifying", None);
    remote_file
        .seek(SeekFrom::Start(0))
        .await
        .map_err(io_sftp_error)?;
    let mut hasher = hash_prefix(&mut remote_file, local_target.offset, progress).await?;
    if local_target.offset > 0 {
        let mut partial = fs::File::open(&local_target.partial_path).await?;
        let target_hash = hash_prefix(&mut partial, local_target.offset, progress).await?;
        verify_digest(
            &checkpoints,
            &checkpoint_key,
            local_target.offset,
            &hasher,
            &target_hash,
        )?;
    }
    progress.mark_phase(
        "transferring",
        Some(local_target.final_path.to_string_lossy().into_owned()),
    );
    copy_confirmed(
        &mut remote_file,
        &mut local_target.file,
        local_target.offset,
        &mut hasher,
        &checkpoints,
        &checkpoint_key,
        progress,
        false,
        &mut false,
    )
    .await?;
    local_target.file.sync_all().await?;
    let final_metadata = remote_file.metadata().await.map_err(native_sftp_error)?;
    if final_metadata.size != remote_metadata.size || final_metadata.mtime != remote_metadata.mtime
    {
        return Err(AppError::Sftp(
            "提交前远端源文件身份已变化，保留 partial".into(),
        ));
    }
    remote_file
        .seek(SeekFrom::Start(0))
        .await
        .map_err(io_sftp_error)?;
    if sha256_hex_digest(&hash_prefix(&mut remote_file, remote_size, progress).await?)
        != sha256_hex_digest(&hasher)
    {
        return Err(AppError::Sftp(
            "提交前远端源文件内容已变化，保留 partial".into(),
        ));
    }
    drop(local_target.file);
    remote_file.shutdown().await.map_err(io_sftp_error)?;
    progress.ensure_not_cancelled()?;
    progress.mark_phase(
        "committing",
        Some(local_target.final_path.to_string_lossy().into_owned()),
    );
    progress.note_network_wait("commitResponse");
    commit_local_reliable_write_target(
        &local_target.final_path,
        &local_target.partial_path,
        remote_size,
    )
    .await?;
    progress.clear_network_wait();
    checkpoints
        .lock()
        .map_err(|_| AppError::Sftp("checkpoint 锁定失败".into()))?
        .mark_committed(&checkpoint_key);
    Ok(())
}
