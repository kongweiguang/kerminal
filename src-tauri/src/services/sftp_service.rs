//! SFTP 文件工具服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::Window;
use uuid::Uuid;

use russh_sftp::protocol::{Status, StatusCode};

use crate::{
    error::{AppError, AppResult},
    models::sftp::{
        SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpChmodRequest,
        SftpClassifyLocalPathsRequest, SftpClipboardDownloadRequest, SftpDeleteRequest,
        SftpDirectoryListing, SftpFilePreview, SftpHostKeyTrustSummary, SftpListDirectoryRequest,
        SftpLocalPathInfo, SftpManagedTransferRequest, SftpPathRequest, SftpPathStat,
        SftpPreviewRequest, SftpReadTextFileRequest, SftpReadTextFileResponse,
        SftpRemoteCopyRequest, SftpRenameRequest, SftpTransferCancelRequest, SftpTransferDirection,
        SftpTransferKind, SftpTransferOperation, SftpTransferRequest, SftpTransferScopeRequest,
        SftpTransferStatus, SftpTransferSummary, SftpTransferTransportMode,
        SftpTrustHostKeyRequest, SftpWriteTextFileRequest, SftpWriteTextFileResponse,
    },
    paths::KerminalPaths,
    services::{
        external_launch::{is_external_target_id, ExternalSessionMaterializer},
        ssh_runtime::{auth_broker::SshAuthBroker, ManagedSshSessionManager},
    },
};

mod archive;
mod backend;
mod native_ssh;

mod remote_text;
mod runtime_tasks;
mod transfer;
mod transfer_io;
mod transfer_lifecycle;
mod transfer_paths;
mod transfer_registry;

use self::archive::{
    zip_local_path_to_file, zip_local_path_to_file_with_conflict, zip_safe_entry_name,
};

use self::backend::{
    load_sftp_runtime_settings, resolve_endpoint_with_auth_broker, resolve_host,
    resolve_transient_endpoint, RusshSftpBackend, SftpBackend, SftpEndpoint, SftpRuntimeSettings,
};
use self::native_ssh::trust_native_host_key;
use self::runtime_tasks::{
    should_stage_remote_copy, ArchiveDownloadTaskInput, ArchiveUploadTaskInput,
    ClipboardDownloadTaskInput, RemoteCopyTaskInput,
};

use self::transfer_paths::{
    classify_local_paths, ensure_local_file_clipboard_supported, initial_total_bytes,
    is_remote_descendant_path, local_path_file_name, local_transfer_endpoint,
    managed_transfer_operation, managed_transfer_source, managed_transfer_target,
    normalize_archive_download_request, normalize_archive_upload_request,
    normalize_clipboard_download_request, normalize_managed_transfer_request,
    normalize_non_root_remote_path, normalize_preview_bytes, normalize_remote_copy_request,
    normalize_remote_path, normalize_text_file_bytes, read_local_file_clipboard,
    remote_copy_source_label, remote_path_file_name, remote_transfer_endpoint,
    reserve_clipboard_download_target_path, validate_chmod_mode, validate_text_encoding,
    write_local_file_clipboard,
};

use self::transfer::{
    ProgressReader, ProgressWriter, TransferEventEmitter, TransferLimiter, TransferProgress,
    TransferTask,
};

const DEFAULT_PREVIEW_BYTES: usize = 16 * 1024;
const MIN_PREVIEW_BYTES: usize = 256;
const MAX_PREVIEW_BYTES: usize = 128 * 1024;
const DEFAULT_TEXT_FILE_BYTES: usize = 2 * 1024 * 1024;
const MIN_TEXT_FILE_BYTES: usize = 1024;
const MAX_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

/// SFTP 文件工具业务入口。
pub struct SftpService {
    auth_broker: Option<SshAuthBroker>,
    backend: Arc<dyn SftpBackend>,
    external_targets: Option<ExternalSessionMaterializer>,
    transfers: Arc<Mutex<HashMap<String, TransferTask>>>,
    transfer_limiter: Arc<TransferLimiter>,
}

impl fmt::Debug for SftpService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SftpService")
            .field("backend", &"<native-russh-sftp>")
            .field("transfers", &"<transfer-registry>")
            .finish()
    }
}

impl Default for SftpService {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpService {
    /// 创建 SFTP 服务。
    pub fn new() -> Self {
        Self::with_backend(Arc::new(RusshSftpBackend::default()))
    }

    /// 测试未保存的 SFTP 主机能否完成认证、打开 subsystem 并访问初始目录。
    pub async fn test_connection(
        &self,
        paths: &KerminalPaths,
        host: &crate::models::remote_host::RemoteHost,
    ) -> AppResult<()> {
        let endpoint = resolve_transient_endpoint(paths, host)?;
        let settings = load_sftp_runtime_settings(paths)?;
        let path = if host
            .ssh_options
            .transfer
            .remote_start_directory
            .trim()
            .is_empty()
        {
            "/".to_owned()
        } else {
            normalize_remote_path(&host.ssh_options.transfer.remote_start_directory)?
        };
        self.backend
            .list_directory(endpoint, path, settings)
            .await
            .map(|_| ())
    }

    /// 创建接入受管 SSH 运行时的 SFTP 服务。
    pub fn with_ssh_runtime(
        managed_runtime: ManagedSshSessionManager,
        auth_broker: SshAuthBroker,
        external_targets: ExternalSessionMaterializer,
    ) -> Self {
        Self::with_backend_auth_broker_and_external_targets(
            Arc::new(RusshSftpBackend::with_managed_runtime(managed_runtime)),
            Some(auth_broker),
            Some(external_targets),
        )
    }

    fn with_backend(backend: Arc<dyn SftpBackend>) -> Self {
        Self::with_backend_and_auth_broker(backend, None)
    }

    fn with_backend_and_auth_broker(
        backend: Arc<dyn SftpBackend>,
        auth_broker: Option<SshAuthBroker>,
    ) -> Self {
        Self::with_backend_auth_broker_and_external_targets(backend, auth_broker, None)
    }

    fn with_backend_auth_broker_and_external_targets(
        backend: Arc<dyn SftpBackend>,
        auth_broker: Option<SshAuthBroker>,
        external_targets: Option<ExternalSessionMaterializer>,
    ) -> Self {
        Self {
            auth_broker,
            backend,
            external_targets,
            transfers: Arc::new(Mutex::new(HashMap::new())),
            transfer_limiter: Arc::new(TransferLimiter::default()),
        }
    }

    /// 列出远程目录。
    pub async fn list_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpListDirectoryRequest,
    ) -> AppResult<SftpDirectoryListing> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_remote_path(&request.path)?;
        self.backend.list_directory(endpoint, path, settings).await
    }

    /// 创建远程目录。
    pub async fn create_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .create_directory(endpoint, path, settings)
            .await?;
        Ok(true)
    }

    /// 预览远程文本文件。
    pub async fn preview_file(
        &self,
        paths: &KerminalPaths,
        request: SftpPreviewRequest,
    ) -> AppResult<SftpFilePreview> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_preview_bytes(request.max_bytes);
        self.backend
            .preview_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 读取远程文本文件供编辑器打开。
    pub async fn read_text_file(
        &self,
        paths: &KerminalPaths,
        request: SftpReadTextFileRequest,
    ) -> AppResult<SftpReadTextFileResponse> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_text_file_bytes(request.max_bytes);
        self.backend
            .read_text_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 写入远程文本文件，并在默认情况下检查打开时的 revision。
    pub async fn write_text_file(
        &self,
        paths: &KerminalPaths,
        request: SftpWriteTextFileRequest,
    ) -> AppResult<SftpWriteTextFileResponse> {
        validate_text_encoding(&request.encoding)?;
        if !request.create && !request.overwrite_on_conflict && request.expected_revision.is_none()
        {
            return Err(AppError::InvalidInput(
                "保存远程文件必须提供 expectedRevision，避免静默覆盖远端修改".to_owned(),
            ));
        }

        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .write_text_file(endpoint, path, request, settings)
            .await
    }

    /// 读取远程路径状态，供文件树和保存冲突检查复用。
    pub async fn stat_path(
        &self,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<SftpPathStat> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend.stat_path(endpoint, path, settings).await
    }

    /// 删除远程文件或目录。
    pub async fn delete(
        &self,
        paths: &KerminalPaths,
        request: SftpDeleteRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .delete(endpoint, path, request.directory, settings)
            .await?;
        Ok(true)
    }

    /// 重命名远程路径。
    pub async fn rename(
        &self,
        paths: &KerminalPaths,
        request: SftpRenameRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let from_path = normalize_non_root_remote_path(&request.from_path)?;
        let to_path = normalize_non_root_remote_path(&request.to_path)?;
        self.backend
            .rename(endpoint, from_path, to_path, settings)
            .await?;
        Ok(true)
    }

    /// 修改远程路径权限。
    pub async fn chmod(&self, paths: &KerminalPaths, request: SftpChmodRequest) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let mode = validate_chmod_mode(&request.mode)?;
        self.backend.chmod(endpoint, path, mode, settings).await?;
        Ok(true)
    }

    /// 上传本地文件到远程路径。
    pub async fn upload(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 递归上传本地目录到远程路径。
    pub async fn upload_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 下载远程文件到本地路径。
    pub async fn download(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 递归下载远程目录到本地路径。
    pub async fn download_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 分类本地拖放路径，供前端决定加入文件还是目录上传队列。
    pub fn classify_local_paths(
        &self,
        request: SftpClassifyLocalPathsRequest,
    ) -> AppResult<Vec<SftpLocalPathInfo>> {
        classify_local_paths(request)
    }

    /// 读取系统文件剪贴板中的本地文件或目录路径。
    pub fn read_local_file_clipboard(&self) -> AppResult<Vec<SftpLocalPathInfo>> {
        read_local_file_clipboard()
    }

    /// 显式信任远程 SSH 主机密钥。
    pub async fn trust_host_key(
        &self,
        paths: &KerminalPaths,
        request: SftpTrustHostKeyRequest,
    ) -> AppResult<SftpHostKeyTrustSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let host = if is_external_target_id(&request.host_id) {
            let target = self
                .external_targets
                .as_ref()
                .ok_or_else(|| {
                    AppError::NotFound(format!("外部 SSH 临时目标不存在: {}", request.host_id))
                })?
                .resolve_target(&request.host_id)?
                .ok_or_else(|| {
                    AppError::NotFound(format!("外部 SSH 临时目标不存在: {}", request.host_id))
                })?;
            target.host
        } else {
            resolve_host(paths, &request.host_id)?
        };
        let known_hosts_path = paths.root.join("known_hosts");
        trust_native_host_key(&host, &known_hosts_path, settings).await?;
        Ok(SftpHostKeyTrustSummary {
            host_id: host.id,
            host: host.host,
            port: host.port,
            known_hosts_path: known_hosts_path.to_string_lossy().into_owned(),
        })
    }

    fn transfers(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, TransferTask>>> {
        self.transfers
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("sftp transfers"))
    }

    fn resolve_endpoint(&self, paths: &KerminalPaths, host_id: &str) -> AppResult<SftpEndpoint> {
        resolve_endpoint_with_auth_broker(
            paths,
            host_id,
            self.auth_broker.as_ref(),
            self.external_targets.as_ref(),
        )
    }
}

fn is_already_exists_error(error: &russh_sftp::client::error::Error) -> bool {
    match error {
        russh_sftp::client::error::Error::Status(status) => {
            is_already_exists_status(status.status_code, &status.error_message)
        }
        _ => false,
    }
}

fn is_ambiguous_sftp_failure(error: &russh_sftp::client::error::Error) -> bool {
    matches!(
        error,
        russh_sftp::client::error::Error::Status(Status {
            status_code: StatusCode::Failure,
            ..
        })
    ) && !is_already_exists_error(error)
}

fn is_no_such_file_error(error: &russh_sftp::client::error::Error) -> bool {
    matches!(
        error,
        russh_sftp::client::error::Error::Status(Status {
            status_code: StatusCode::NoSuchFile,
            ..
        })
    )
}

fn is_already_exists_status(status_code: StatusCode, error_message: &str) -> bool {
    matches!(status_code, StatusCode::Failure) && already_exists_message(error_message)
}

fn already_exists_message(error_message: &str) -> bool {
    let message = error_message.to_lowercase();
    message.contains("file exists") || message.contains("already exists")
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_timestamp_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

/// SFTP 传输规则的窄测试入口。
#[doc(hidden)]
pub mod rules;
