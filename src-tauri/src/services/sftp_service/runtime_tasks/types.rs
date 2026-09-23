//! Inputs shared by queued SFTP runtime tasks.
//! @author kongweiguang

use super::*;

#[derive(Debug)]
pub(in crate::services::sftp_service) struct RemoteCopyTaskInput {
    pub(in crate::services::sftp_service) transfer_id: String,
    pub(in crate::services::sftp_service) source_endpoint: SftpEndpoint,
    pub(in crate::services::sftp_service) target_endpoint: SftpEndpoint,
    pub(in crate::services::sftp_service) request: SftpRemoteCopyRequest,
    pub(in crate::services::sftp_service) temp_root: PathBuf,
    pub(in crate::services::sftp_service) settings: SftpRuntimeSettings,
    pub(in crate::services::sftp_service) cancel_requested: Arc<AtomicBool>,
    pub(in crate::services::sftp_service) cancel_notify: Arc<Notify>,
    pub(in crate::services::sftp_service) recovery: RecoveryCheckpointHolder,
    pub(in crate::services::sftp_service) event_emitter: Option<TransferEventEmitter>,
}

#[derive(Debug)]
pub(in crate::services::sftp_service) struct ArchiveDownloadTaskInput {
    pub(in crate::services::sftp_service) transfer_id: String,
    pub(in crate::services::sftp_service) endpoint: SftpEndpoint,
    pub(in crate::services::sftp_service) request: SftpArchiveDownloadRequest,
    pub(in crate::services::sftp_service) temp_root: PathBuf,
    pub(in crate::services::sftp_service) settings: SftpRuntimeSettings,
    pub(in crate::services::sftp_service) cancel_requested: Arc<AtomicBool>,
    pub(in crate::services::sftp_service) cancel_notify: Arc<Notify>,
    pub(in crate::services::sftp_service) recovery: RecoveryCheckpointHolder,
    pub(in crate::services::sftp_service) event_emitter: Option<TransferEventEmitter>,
}

#[derive(Debug)]
pub(in crate::services::sftp_service) struct ArchiveUploadTaskInput {
    pub(in crate::services::sftp_service) transfer_id: String,
    pub(in crate::services::sftp_service) endpoint: SftpEndpoint,
    pub(in crate::services::sftp_service) request: SftpArchiveUploadRequest,
    pub(in crate::services::sftp_service) temp_root: PathBuf,
    pub(in crate::services::sftp_service) settings: SftpRuntimeSettings,
    pub(in crate::services::sftp_service) cancel_requested: Arc<AtomicBool>,
    pub(in crate::services::sftp_service) cancel_notify: Arc<Notify>,
    pub(in crate::services::sftp_service) recovery: RecoveryCheckpointHolder,
    pub(in crate::services::sftp_service) event_emitter: Option<TransferEventEmitter>,
}

#[derive(Debug)]
pub(in crate::services::sftp_service) struct ClipboardDownloadTaskInput {
    pub(in crate::services::sftp_service) transfer_id: String,
    pub(in crate::services::sftp_service) endpoint: SftpEndpoint,
    pub(in crate::services::sftp_service) request: SftpClipboardDownloadRequest,
    pub(in crate::services::sftp_service) target_local_path: PathBuf,
    pub(in crate::services::sftp_service) settings: SftpRuntimeSettings,
    pub(in crate::services::sftp_service) cancel_requested: Arc<AtomicBool>,
    pub(in crate::services::sftp_service) cancel_notify: Arc<Notify>,
    pub(in crate::services::sftp_service) recovery: RecoveryCheckpointHolder,
    pub(in crate::services::sftp_service) copy_to_clipboard: bool,
    pub(in crate::services::sftp_service) event_emitter: Option<TransferEventEmitter>,
}
