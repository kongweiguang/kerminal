//! SFTP native 后端、连接认证和端点解析。
//!
//! @author kongweiguang

mod browser_transport;
mod contract;
mod endpoint;
mod errors;
mod settings;
mod target_label;

use std::{
    collections::HashMap,
    fmt,
    future::Future,
    path::Path,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use russh_sftp::{
    client::{Config as NativeSftpConfig, SftpSession},
    protocol::{FileAttributes, FileType},
};
use tokio::{
    io::AsyncReadExt,
    sync::Mutex as AsyncMutex,
    time::{sleep, timeout},
};

pub(super) use contract::SftpBackend;
pub(super) use endpoint::{
    resolve_endpoint_with_auth_broker, resolve_host, resolve_transient_endpoint, SftpEndpoint,
};
pub(super) use errors::{io_sftp_error, native_sftp_error};
pub(super) use settings::{load_sftp_runtime_settings, SftpRuntimeSettings};

use browser_transport::{
    is_recoverable_browser_sftp_error, list_directory_with_browser_transport,
    SftpBrowserTransportManager,
};

use self::{settings::SftpManagedSessionLane, target_label::sftp_host_label};
use crate::{
    error::{AppError, AppResult},
    models::sftp::{
        SftpDirectoryListing, SftpEntry, SftpFilePreview, SftpManagedTransferRequest, SftpPathStat,
        SftpReadTextFileResponse, SftpRemoteCopyRequest, SftpTransferDirection, SftpTransferKind,
        SftpWriteTextFileRequest, SftpWriteTextFileResponse,
    },
    services::{
        ssh_credential_resolver::NativeSshRouteMaterial,
        ssh_runtime::{
            facade::{SshRuntimeFacade, SshRuntimeTargetContext},
            native_backend::NativeSshRuntimeBackend,
            policy::{is_external_runtime_target_id, runtime_host_key_policy_for_host_id},
            session_key::ssh_session_key_for_route,
            ManagedSshSessionManager, ManagedSshSftpChannel, SshRuntimeConnectRequest,
        },
    },
};

use super::remote_text::{
    read_remote_text_file, sftp_entry_from_native, sftp_entry_kind_rank, stat_remote_path,
    write_remote_text_file,
};
use super::transfer_io::{
    copy_remote_directory_between_sessions, copy_remote_file_between_sessions, download_directory,
    download_file, upload_directory, upload_file,
};
use super::transfer_paths::parent_remote_path;
use super::TransferProgress;

const SFTP_BROWSER_TRANSPORT_IDLE_TTL: Duration = Duration::from_secs(30);
const EXTERNAL_DIRECTORY_LIST_CACHE_TTL: Duration = Duration::from_millis(1500);

pub(super) struct RusshSftpBackend {
    managed_runtime: ManagedSshSessionManager,
    browser_transports: SftpBrowserTransportManager,
    external_directory_list_gate: ExternalDirectoryListGate,
}

impl fmt::Debug for RusshSftpBackend {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RusshSftpBackend")
            .field("managed_runtime", &"native")
            .finish_non_exhaustive()
    }
}

#[derive(Default)]
struct ExternalDirectoryListGate {
    cache: StdMutex<HashMap<String, ExternalDirectoryListCacheEntry>>,
}

struct ExternalDirectoryListCacheEntry {
    listing: SftpDirectoryListing,
    stored_at: Instant,
}

impl RusshSftpBackend {
    pub(super) fn with_managed_runtime(managed_runtime: ManagedSshSessionManager) -> Self {
        Self {
            managed_runtime,
            browser_transports: SftpBrowserTransportManager::default(),
            external_directory_list_gate: ExternalDirectoryListGate::default(),
        }
    }

    fn managed_runtime(&self) -> Option<&ManagedSshSessionManager> {
        Some(&self.managed_runtime)
    }

    fn cached_external_directory_listing(
        &self,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> AppResult<Option<SftpDirectoryListing>> {
        let key = external_directory_list_cache_key(endpoint, path);
        let mut cache = self
            .external_directory_list_gate
            .cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external SFTP directory list cache"))?;
        if let Some(entry) = cache.get(&key) {
            if entry.stored_at.elapsed() <= EXTERNAL_DIRECTORY_LIST_CACHE_TTL {
                return Ok(Some(entry.listing.clone()));
            }
        }
        cache.remove(&key);
        Ok(None)
    }

    fn remember_external_directory_listing(
        &self,
        endpoint: &SftpEndpoint,
        path: &str,
        listing: &SftpDirectoryListing,
    ) -> AppResult<()> {
        let key = external_directory_list_cache_key(endpoint, path);
        let mut cache = self
            .external_directory_list_gate
            .cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external SFTP directory list cache"))?;
        cache.insert(
            key,
            ExternalDirectoryListCacheEntry {
                listing: listing.clone(),
                stored_at: Instant::now(),
            },
        );
        Ok(())
    }

    fn forget_external_directory_listing(
        &self,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> AppResult<()> {
        if !is_external_runtime_target_id(&endpoint.host.id) {
            return Ok(());
        }
        let key = external_directory_list_cache_key(endpoint, path);
        let mut cache = self
            .external_directory_list_gate
            .cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external SFTP directory list cache"))?;
        cache.remove(&key);
        Ok(())
    }

    fn forget_external_directory_parent(
        &self,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> AppResult<()> {
        if let Some(parent_path) = parent_remote_path(path) {
            self.forget_external_directory_listing(endpoint, &parent_path)?;
        }
        Ok(())
    }

    async fn list_external_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        if let Some(listing) = self.cached_external_directory_listing(&endpoint, &path)? {
            log_external_sftp_event("list.cache.hit", &endpoint, Some(&path), None);
            return Ok(listing);
        }
        let listing = self
            .list_directory_uncached(endpoint.clone(), path.clone(), settings)
            .await?;
        self.remember_external_directory_listing(&endpoint, &path, &listing)?;
        Ok(listing)
    }

    async fn list_directory_uncached(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        list_directory_with_browser_transport(
            &self.browser_transports,
            &endpoint,
            path,
            settings,
            self.managed_runtime(),
        )
        .await
    }
}

impl Default for RusshSftpBackend {
    fn default() -> Self {
        Self::with_managed_runtime(ManagedSshSessionManager::with_backend(Arc::new(
            NativeSshRuntimeBackend::new(),
        )))
    }
}

#[async_trait]
impl SftpBackend for RusshSftpBackend {
    async fn list_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        if is_external_runtime_target_id(&endpoint.host.id) {
            return self.list_external_directory(endpoint, path, settings).await;
        }
        self.list_directory_uncached(endpoint, path, settings).await
    }

    async fn create_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        session
            .sftp
            .create_dir(path.clone())
            .await
            .map_err(native_sftp_error)?;
        self.forget_external_directory_parent(&endpoint, &path)?;
        Ok(())
    }

    async fn preview_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpFilePreview> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        let file = session
            .sftp
            .open(path.clone())
            .await
            .map_err(native_sftp_error)?;
        let read_limit = max_bytes.saturating_add(1);
        let mut bytes = Vec::with_capacity(read_limit);
        let mut reader = file.take(read_limit as u64);
        reader
            .read_to_end(&mut bytes)
            .await
            .map_err(io_sftp_error)?;
        let truncated = bytes.len() > max_bytes;
        let visible_bytes = if truncated {
            &bytes[..max_bytes]
        } else {
            bytes.as_slice()
        };

        Ok(SftpFilePreview {
            host_id: endpoint.host.id,
            path,
            content: String::from_utf8_lossy(visible_bytes).into_owned(),
            bytes_read: visible_bytes.len(),
            max_bytes,
            truncated,
            encoding: "utf-8-lossy".to_owned(),
        })
    }

    async fn read_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpReadTextFileResponse> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        read_remote_text_file(&session.sftp, endpoint.host.id, path, max_bytes).await
    }

    async fn write_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        request: SftpWriteTextFileRequest,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpWriteTextFileResponse> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        let host_id = endpoint.host.id.clone();
        let response =
            write_remote_text_file(&session.sftp, host_id, path.clone(), request).await?;
        self.forget_external_directory_parent(&endpoint, &path)?;
        Ok(response)
    }

    async fn stat_path(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpPathStat> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        stat_remote_path(&session.sftp, endpoint.host.id, path).await
    }

    async fn delete(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        directory: bool,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        if directory {
            let session = connect_native_sftp(
                &endpoint,
                settings,
                self.managed_runtime(),
                SftpManagedSessionLane::Browser,
            )
            .await?;
            remove_remote_directory_with_sftp(&session.sftp, &path).await?;
            self.forget_external_directory_parent(&endpoint, &path)?;
            self.forget_external_directory_listing(&endpoint, &path)?;
            return Ok(());
        }

        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        session
            .sftp
            .remove_file(path.clone())
            .await
            .map_err(native_sftp_error)?;
        self.forget_external_directory_parent(&endpoint, &path)?;
        Ok(())
    }

    async fn rename(
        &self,
        endpoint: SftpEndpoint,
        from_path: String,
        to_path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        session
            .sftp
            .rename(from_path.clone(), to_path.clone())
            .await
            .map_err(native_sftp_error)?;
        self.forget_external_directory_parent(&endpoint, &from_path)?;
        self.forget_external_directory_parent(&endpoint, &to_path)?;
        self.forget_external_directory_listing(&endpoint, &from_path)?;
        Ok(())
    }

    async fn chmod(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        mode: u32,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Browser,
        )
        .await?;
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(mode);
        session
            .sftp
            .set_metadata(path.clone(), attrs)
            .await
            .map_err(native_sftp_error)?;
        self.forget_external_directory_parent(&endpoint, &path)?;
        Ok(())
    }

    async fn transfer(
        &self,
        endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        progress.ensure_not_cancelled()?;
        let settings = settings.for_bulk_transfer_target(&endpoint);
        let remote_path = request.remote_path.clone();
        let remote_directory_may_change =
            matches!(&request.direction, SftpTransferDirection::Upload);
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::BulkTransfer,
        )
        .await?;
        let result = match (request.direction, request.kind) {
            (SftpTransferDirection::Upload, SftpTransferKind::File) => {
                upload_file(
                    &session.sftp,
                    Path::new(&request.local_path),
                    &request.remote_path,
                    &progress,
                    settings,
                    request.conflict_policy,
                    true,
                )
                .await
            }
            (SftpTransferDirection::Upload, SftpTransferKind::Directory) => {
                upload_directory(
                    &session.sftp,
                    Path::new(&request.local_path),
                    &request.remote_path,
                    &progress,
                    settings,
                    request.conflict_policy,
                )
                .await
            }
            (SftpTransferDirection::Download, SftpTransferKind::File) => {
                download_file(
                    &session.sftp,
                    &request.remote_path,
                    Path::new(&request.local_path),
                    &progress,
                    settings,
                    request.conflict_policy,
                    true,
                )
                .await
            }
            (SftpTransferDirection::Download, SftpTransferKind::Directory) => {
                download_directory(
                    &session.sftp,
                    &request.remote_path,
                    Path::new(&request.local_path),
                    &progress,
                    settings,
                    request.conflict_policy,
                )
                .await
            }
        };
        result?;
        if remote_directory_may_change {
            self.forget_external_directory_parent(&endpoint, &remote_path)?;
            self.forget_external_directory_listing(&endpoint, &remote_path)?;
        }
        Ok(())
    }

    async fn remote_copy(
        &self,
        source_endpoint: SftpEndpoint,
        target_endpoint: SftpEndpoint,
        request: SftpRemoteCopyRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        progress.ensure_not_cancelled()?;
        let target_remote_path = request.target_remote_path.clone();
        let settings = settings
            .for_bulk_transfer_target(&source_endpoint)
            .for_bulk_transfer_target(&target_endpoint);
        let source_session = connect_native_sftp(
            &source_endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::BulkTransfer,
        )
        .await?;
        let result = if request.source_host_id == request.target_host_id {
            match request.kind {
                SftpTransferKind::File => {
                    copy_remote_file_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &source_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                        request.conflict_policy,
                        true,
                    )
                    .await
                }
                SftpTransferKind::Directory => {
                    copy_remote_directory_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &source_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                        request.conflict_policy,
                    )
                    .await
                }
            }
        } else {
            let target_session = connect_native_sftp(
                &target_endpoint,
                settings,
                self.managed_runtime(),
                SftpManagedSessionLane::BulkTransfer,
            )
            .await?;
            match request.kind {
                SftpTransferKind::File => {
                    copy_remote_file_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &target_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                        request.conflict_policy,
                        true,
                    )
                    .await
                }
                SftpTransferKind::Directory => {
                    copy_remote_directory_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &target_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                        request.conflict_policy,
                    )
                    .await
                }
            }
        };
        result?;
        self.forget_external_directory_parent(&target_endpoint, &target_remote_path)?;
        self.forget_external_directory_listing(&target_endpoint, &target_remote_path)?;
        Ok(())
    }
}

/// SFTP-only 主机不能依赖远端 shell；后序遍历保证目录在子项删除后再移除。
async fn remove_remote_directory_with_sftp(sftp: &SftpSession, root: &str) -> AppResult<()> {
    let mut stack = vec![(root.to_owned(), false)];
    while let Some((path, visited)) = stack.pop() {
        if visited {
            sftp.remove_dir(path).await.map_err(native_sftp_error)?;
            continue;
        }

        let entries = sftp
            .read_dir(path.clone())
            .await
            .map_err(native_sftp_error)?;
        stack.push((path, true));
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = entry.path();
            if entry.file_type() == FileType::Dir {
                stack.push((child, false));
            } else {
                sftp.remove_file(child).await.map_err(native_sftp_error)?;
            }
        }
    }
    Ok(())
}

fn external_directory_list_cache_key(endpoint: &SftpEndpoint, path: &str) -> String {
    format!("{}\0{}", endpoint.host.id, path)
}

async fn with_sftp_timeout<T>(
    operation: &'static str,
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
    future: impl Future<Output = AppResult<T>>,
) -> AppResult<T> {
    let seconds = settings.timeout_seconds.max(1);
    match timeout(Duration::from_secs(seconds), future).await {
        Ok(result) => result,
        Err(_) => Err(AppError::Sftp(format!(
            "SFTP {operation} 超时（{seconds} 秒）: {}",
            sftp_host_label(&endpoint.host)
        ))),
    }
}

fn log_external_sftp_event(
    event: &'static str,
    endpoint: &SftpEndpoint,
    path: Option<&str>,
    error: Option<&str>,
) {
    if !is_external_runtime_target_id(&endpoint.host.id) {
        return;
    }
    match error {
        Some(_) => tauri_plugin_log::log::warn!(
            target: "sftp.external",
            "event={} target={} path_present={} failed=true",
            event,
            sftp_host_label(&endpoint.host),
            path.is_some_and(|value| !value.trim().is_empty())
        ),
        None => tauri_plugin_log::log::info!(
            target: "sftp.external",
            "event={} target={} path_present={}",
            event,
            sftp_host_label(&endpoint.host),
            path.is_some_and(|value| !value.trim().is_empty())
        ),
    }
}

struct NativeSftpConnection {
    sftp: SftpSession,
    _managed_sftp: ManagedSshSftpChannel,
}

async fn connect_native_sftp(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
    managed_lane: SftpManagedSessionLane,
) -> AppResult<NativeSftpConnection> {
    connect_managed_sftp(endpoint, settings, managed_runtime, managed_lane).await
}

async fn connect_managed_sftp(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
    managed_lane: SftpManagedSessionLane,
) -> AppResult<NativeSftpConnection> {
    let managed_runtime =
        managed_runtime.ok_or_else(|| AppError::Sftp("Managed SSH runtime 未配置".to_owned()))?;
    let key = ssh_session_key_for_route(
        &endpoint.host,
        &endpoint.route_auth,
        &endpoint.known_hosts_path,
    )
    .map_err(managed_sftp_error)?;
    let request = SshRuntimeConnectRequest::native(
        key,
        endpoint.host.clone(),
        endpoint.known_hosts_path.clone(),
        settings.timeout_seconds,
    )
    .with_host_key_policy(runtime_host_key_policy_for_host_id(&endpoint.host.id))
    .with_native_route_material(NativeSshRouteMaterial::from_resolved_auth(
        &endpoint.route_auth,
    )?);
    let facade = SshRuntimeFacade::new(managed_runtime.clone());
    let context = SshRuntimeTargetContext::new(request)
        .with_lane(managed_lane.runtime_lane())
        .with_target_label(sftp_host_label(&endpoint.host));
    let mut channel = facade
        .open_sftp(&context)
        .await
        .map_err(managed_sftp_error)?;
    let stream = channel.take_stream()?;
    let sftp = match SftpSession::new_with_config(
        stream,
        NativeSftpConfig {
            max_packet_len: settings.packet_bytes,
            max_concurrent_writes: settings.pipeline_depth,
            request_timeout_secs: settings.timeout_seconds,
        },
    )
    .await
    {
        Ok(sftp) => sftp,
        Err(error) => {
            let error = native_sftp_error(error);
            if is_recoverable_browser_sftp_error(&error) {
                drop(channel);
                let _ = managed_runtime.close_idle_sessions();
            }
            return Err(error);
        }
    };
    Ok(NativeSftpConnection {
        sftp,
        _managed_sftp: channel,
    })
}

fn managed_sftp_error(error: AppError) -> AppError {
    AppError::Sftp(format!("受管 SSH SFTP channel 失败: {error}"))
}
