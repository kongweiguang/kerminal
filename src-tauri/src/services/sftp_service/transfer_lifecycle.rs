//! SFTP transfer lifecycle facade methods.
//!
//! @author kongweiguang

use super::transfer::TransferSpeedTracker;
use super::*;
use tokio::sync::Notify;

impl SftpService {
    /// 创建可管理传输任务。
    pub fn enqueue_transfer(
        &self,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(paths, request, None)
    }

    /// 创建可管理传输任务，并向当前窗口推送状态更新。
    pub fn enqueue_transfer_for_window(
        &self,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(paths, request, Some(TransferEventEmitter::new(window)))
    }

    /// 普通入队与显式 retry 汇入同一创建边界，便于继承锁定的目标与超时参数。
    fn enqueue_transfer_with_events(
        &self,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_recovery(paths, request, event_emitter, None)
    }

    /// 注册和继承断点在同一 registry 锁内完成，重复 retry 不能创建两个后继任务。
    pub(super) fn enqueue_transfer_with_recovery(
        &self,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        event_emitter: Option<TransferEventEmitter>,
        predecessor: Option<String>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let request = normalize_managed_transfer_request(request)?;
        let mut idle_timeout_seconds = resolve_transfer_idle_timeout(
            request.idle_timeout_seconds,
            settings.idle_timeout_seconds,
        )?;
        let mut settings = settings
            .for_bulk_transfer_target(&endpoint)
            .with_idle_timeout_seconds(idle_timeout_seconds);
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());
        let mut transfers = self.transfers()?;
        let predecessor = predecessor.or_else(|| {
            transfers
                .values()
                .filter(|task| {
                    let s = &task.summary;
                    s.retryable
                        && request
                            .idle_timeout_seconds
                            .is_none_or(|value| value == s.idle_timeout_seconds)
                        && s.successor_id
                            .as_ref()
                            .and_then(|id| transfers.get(id))
                            .is_none_or(|successor| {
                                !super::transfer_registry::is_completed_transfer_status(
                                    successor.summary.status,
                                )
                            })
                        && matches!(
                            s.status,
                            SftpTransferStatus::Failed | SftpTransferStatus::Canceled
                        )
                        && s.host_id == request.host_id
                        && s.local_path == request.local_path
                        && s.remote_path == request.remote_path
                        && s.direction == request.direction
                        && s.kind == request.kind
                        && s.conflict_policy == Some(request.conflict_policy)
                        && s.view_scope == request.view_scope
                })
                .max_by_key(|task| task.summary.updated_at)
                .map(|task| task.summary.id.clone())
        });
        if let Some(successor) = predecessor
            .as_ref()
            .and_then(|id| transfers.get(id))
            .and_then(|task| task.summary.successor_id.as_ref())
            .and_then(|id| transfers.get(id))
        {
            return Ok(successor.summary.clone());
        }
        if let Some(original) = predecessor.as_ref().and_then(|id| transfers.get(id)) {
            // 兼容旧 enqueue 同参数继续传输时保留原任务阈值；全局配置后来变化也不改断点语义。
            idle_timeout_seconds = original.summary.idle_timeout_seconds;
            settings = settings.with_idle_timeout_seconds(idle_timeout_seconds);
        }
        let recovery = predecessor
            .as_ref()
            .and_then(|id| transfers.get(id))
            .map(|task| task.recovery.clone())
            .unwrap_or_else(new_recovery_checkpoints);
        // 人工后继任务只继承客户端确认过的连续偏移，绝不能从 partial 物理长度猜进度。
        let (confirmed_bytes, resumable) = {
            let checkpoints = recovery
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("SFTP recovery checkpoint"))?;
            (checkpoints.confirmed_bytes(), checkpoints.has_resumable())
        };
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
            remote_path: request.remote_path.clone(),
            local_path: request.local_path.clone(),
            direction: request.direction,
            kind: request.kind,
            conflict_policy: Some(request.conflict_policy),
            status: SftpTransferStatus::Queued,
            bytes_transferred: confirmed_bytes,
            speed_bytes_per_second: 0,
            total_bytes: initial_total_bytes(&request),
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: managed_transfer_operation(request.direction),
            source: managed_transfer_source(&endpoint, &request),
            target: managed_transfer_target(&endpoint, &request),
            transport_mode: SftpTransferTransportMode::SingleHostSftp,
            phase: Some("queued".to_owned()),
            current_item: None,
            idle_timeout_seconds,
            failure_kind: None,
            last_progress_at: None,
            recovery_attempt: 0,
            retryable: false,
            resumable,
            successor_id: None,
        };

        if let Some(original) = predecessor.as_ref().and_then(|id| transfers.get_mut(id)) {
            original.summary.successor_id = Some(id.clone());
        }
        let mut speed = TransferSpeedTracker::new(unix_timestamp_millis());
        speed.reset(confirmed_bytes, unix_timestamp_millis());
        transfers.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
                cancel_notify: cancel_notify.clone(),
                recovery: recovery.clone(),
                speed,
            },
        );
        drop(transfers);
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_transfer_task(
            id,
            endpoint,
            request,
            settings,
            cancel_requested,
            cancel_notify,
            recovery,
            event_emitter,
        );
        Ok(summary)
    }

    /// 创建远程复制或跨主机传输任务。
    pub fn enqueue_remote_copy(
        &self,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(paths, request, None)
    }

    /// 创建远程复制或跨主机传输任务，并向当前窗口推送状态更新。
    pub fn enqueue_remote_copy_for_window(
        &self,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_remote_copy_with_events(
        &self,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let source_endpoint = self.resolve_endpoint(paths, &request.source_host_id)?;
        let target_endpoint = self.resolve_endpoint(paths, &request.target_host_id)?;
        let request = normalize_remote_copy_request(request)?;
        let idle_timeout_seconds = resolve_transfer_idle_timeout(
            request.idle_timeout_seconds,
            settings.idle_timeout_seconds,
        )?;
        let settings = settings
            .for_bulk_transfer_target(&source_endpoint)
            .for_bulk_transfer_target(&target_endpoint)
            .with_idle_timeout_seconds(idle_timeout_seconds);
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());
        let recovery = new_recovery_checkpoints();
        let transport_mode = if should_stage_remote_copy(&request, settings) {
            SftpTransferTransportMode::LocalStage
        } else {
            SftpTransferTransportMode::ClientBridge
        };
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.target_host_id.clone(),
            view_scope: request.view_scope.clone(),
            remote_path: request.target_remote_path.clone(),
            local_path: remote_copy_source_label(&request),
            direction: SftpTransferDirection::Upload,
            kind: request.kind,
            conflict_policy: Some(request.conflict_policy),
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            speed_bytes_per_second: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: SftpTransferOperation::RemoteCopy,
            source: remote_transfer_endpoint(
                &source_endpoint.host,
                request.source_remote_path.clone(),
            ),
            target: remote_transfer_endpoint(
                &target_endpoint.host,
                request.target_remote_path.clone(),
            ),
            transport_mode,
            phase: Some("queued".to_owned()),
            current_item: None,
            idle_timeout_seconds,
            failure_kind: None,
            last_progress_at: None,
            recovery_attempt: 0,
            retryable: false,
            resumable: false,
            successor_id: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
                cancel_notify: cancel_notify.clone(),
                recovery: recovery.clone(),
                speed: TransferSpeedTracker::new(unix_timestamp_millis()),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_remote_copy_task(RemoteCopyTaskInput {
            transfer_id: id,
            source_endpoint,
            target_endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            cancel_notify,
            recovery,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建远程条目下载为本地 ZIP 的归档任务。
    pub fn enqueue_archive_download(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(paths, request, None)
    }

    /// 创建远程条目下载为本地 ZIP 的归档任务，并向当前窗口推送状态更新。
    pub fn enqueue_archive_download_for_window(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_download_with_events(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let request = normalize_archive_download_request(request)?;
        let settings = settings.for_bulk_transfer_target(&endpoint);
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());
        let recovery = new_recovery_checkpoints();
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
            remote_path: request.source_remote_path.clone(),
            local_path: request.target_local_path.clone(),
            direction: SftpTransferDirection::Download,
            kind: request.kind,
            conflict_policy: Some(request.conflict_policy),
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            speed_bytes_per_second: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: SftpTransferOperation::ArchiveDownload,
            source: remote_transfer_endpoint(&endpoint.host, request.source_remote_path.clone()),
            target: local_transfer_endpoint(request.target_local_path.clone()),
            transport_mode: SftpTransferTransportMode::SingleHostSftp,
            phase: Some("queued".to_owned()),
            current_item: None,
            idle_timeout_seconds: settings.idle_timeout_seconds as u16,
            failure_kind: None,
            last_progress_at: None,
            recovery_attempt: 0,
            retryable: false,
            resumable: false,
            successor_id: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
                cancel_notify: cancel_notify.clone(),
                recovery: recovery.clone(),
                speed: TransferSpeedTracker::new(unix_timestamp_millis()),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_archive_download_task(ArchiveDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            cancel_notify,
            recovery,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建本地条目压缩为远程 ZIP 的归档上传任务。
    pub fn enqueue_archive_upload(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(paths, request, None)
    }

    /// 创建本地条目压缩为远程 ZIP 的归档上传任务，并向当前窗口推送状态更新。
    pub fn enqueue_archive_upload_for_window(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_upload_with_events(
        &self,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let request = normalize_archive_upload_request(request)?;
        let settings = settings.for_bulk_transfer_target(&endpoint);
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());
        let recovery = new_recovery_checkpoints();
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
            remote_path: request.target_remote_path.clone(),
            local_path: request.source_local_path.clone(),
            direction: SftpTransferDirection::Upload,
            kind: SftpTransferKind::File,
            conflict_policy: Some(request.conflict_policy),
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            speed_bytes_per_second: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: SftpTransferOperation::ArchiveUpload,
            source: local_transfer_endpoint(request.source_local_path.clone()),
            target: remote_transfer_endpoint(&endpoint.host, request.target_remote_path.clone()),
            transport_mode: SftpTransferTransportMode::SingleHostSftp,
            phase: Some("queued".to_owned()),
            current_item: None,
            idle_timeout_seconds: settings.idle_timeout_seconds as u16,
            failure_kind: None,
            last_progress_at: None,
            recovery_attempt: 0,
            retryable: false,
            resumable: false,
            successor_id: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
                cancel_notify: cancel_notify.clone(),
                recovery: recovery.clone(),
                speed: TransferSpeedTracker::new(unix_timestamp_millis()),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_archive_upload_task(ArchiveUploadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            cancel_notify,
            recovery,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建远程条目下载到本地文件剪贴板的任务。
    pub fn enqueue_clipboard_download(
        &self,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(paths, request, None)
    }

    /// 创建远程条目下载到本地文件剪贴板的任务，并向当前窗口推送状态更新。
    pub fn enqueue_clipboard_download_for_window(
        &self,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_clipboard_download_with_events(
        &self,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        ensure_local_file_clipboard_supported()?;
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let request = normalize_clipboard_download_request(request)?;
        let settings = settings.for_bulk_transfer_target(&endpoint);
        let target_local_path = reserve_clipboard_download_target_path(&request)?;
        let target_local_path_string = target_local_path.to_string_lossy().into_owned();
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());
        let recovery = new_recovery_checkpoints();
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
            remote_path: request.source_remote_path.clone(),
            local_path: target_local_path_string.clone(),
            direction: SftpTransferDirection::Download,
            kind: request.kind,
            conflict_policy: None,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            speed_bytes_per_second: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: SftpTransferOperation::ClipboardDownload,
            source: remote_transfer_endpoint(&endpoint.host, request.source_remote_path.clone()),
            target: local_transfer_endpoint(target_local_path_string.clone()),
            transport_mode: SftpTransferTransportMode::SingleHostSftp,
            phase: Some("queued".to_owned()),
            current_item: None,
            idle_timeout_seconds: settings.idle_timeout_seconds as u16,
            failure_kind: None,
            last_progress_at: None,
            recovery_attempt: 0,
            retryable: false,
            resumable: false,
            successor_id: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
                cancel_notify: cancel_notify.clone(),
                recovery: recovery.clone(),
                speed: TransferSpeedTracker::new(unix_timestamp_millis()),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_clipboard_download_task(ClipboardDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            target_local_path,
            settings,
            cancel_requested,
            cancel_notify,
            recovery,
            copy_to_clipboard: true,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }
}

/// 固化单个传输的无进度保护，并拒绝不安全的 MCP/IPC 覆盖值。
///
/// 队列会把最终值写入摘要，重试始终沿用摘要而不是读取可能已变化的全局设置；这使恢复
/// 行为可预期，也避免调用方借超大数值长期占用并发槽。
fn resolve_transfer_idle_timeout(requested: Option<u16>, configured: u64) -> AppResult<u16> {
    use crate::models::settings::{MAX_SFTP_IDLE_TIMEOUT_SECONDS, MIN_SFTP_IDLE_TIMEOUT_SECONDS};

    let seconds = requested.unwrap_or_else(|| configured.min(u64::from(u16::MAX)) as u16);
    if !(MIN_SFTP_IDLE_TIMEOUT_SECONDS..=MAX_SFTP_IDLE_TIMEOUT_SECONDS).contains(&seconds) {
        return Err(AppError::InvalidInput(format!(
            "idleTimeoutSeconds 必须在 {MIN_SFTP_IDLE_TIMEOUT_SECONDS}-{MAX_SFTP_IDLE_TIMEOUT_SECONDS} 秒之间。"
        )));
    }
    Ok(seconds)
}
