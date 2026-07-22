//! SFTP 目录浏览连接复用、空闲回收与一次重连。

use super::*;

pub(super) async fn list_directory_with_browser_transport(
    transports: &SftpBrowserTransportManager,
    endpoint: &SftpEndpoint,
    path: String,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<SftpDirectoryListing> {
    if is_external_runtime_target_id(&endpoint.host.id) {
        log_external_sftp_event("list.start", endpoint, Some(&path), None);
    }
    let entries = match transports
        .read_dir(endpoint, path.clone(), settings, managed_runtime)
        .await
    {
        Ok(entries) => {
            if is_external_runtime_target_id(&endpoint.host.id) {
                log_external_sftp_event("list.read.ok", endpoint, Some(&path), None);
            }
            entries
        }
        Err(sftp_error) if is_external_runtime_target_id(&endpoint.host.id) => {
            log_external_sftp_event(
                "list.read.failed",
                endpoint,
                Some(&path),
                Some(&sftp_error.to_string()),
            );
            if let Some(listing) =
                list_external_directory_with_shell(endpoint, &path, settings, managed_runtime)
                    .await?
            {
                return Ok(listing);
            }
            return Err(sftp_error);
        }
        Err(error) => return Err(error),
    };
    let mut entries = entries;
    entries.sort_by(|left, right| {
        sftp_entry_kind_rank(&left.kind)
            .cmp(&sftp_entry_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(SftpDirectoryListing {
        host_id: endpoint.host.id.clone(),
        parent_path: parent_remote_path(&path),
        path,
        entries,
    })
}

#[derive(Default)]
pub(super) struct SftpBrowserTransportManager {
    slots: StdMutex<HashMap<String, Arc<AsyncMutex<Option<SftpBrowserTransport>>>>>,
}

impl SftpBrowserTransportManager {
    async fn read_dir(
        &self,
        endpoint: &SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
        managed_runtime: Option<&ManagedSshSessionManager>,
    ) -> AppResult<Vec<SftpEntry>> {
        let key = browser_transport_key(endpoint, settings);
        let slot = self.slot(&key)?;
        let mut guard = slot.lock().await;
        let result = Self::read_dir_locked(
            &mut guard,
            endpoint,
            path.clone(),
            settings,
            managed_runtime,
        )
        .await;
        let result = match result {
            Ok(entries) => Ok(entries),
            Err(error) if is_recoverable_browser_sftp_error(&error) => {
                *guard = None;
                Self::read_dir_locked(&mut guard, endpoint, path, settings, managed_runtime).await
            }
            Err(error) => Err(error),
        };
        let should_schedule_idle_cleanup = guard.is_some();
        drop(guard);
        if should_schedule_idle_cleanup {
            Self::schedule_idle_cleanup(&slot);
        }
        result
    }

    fn slot(&self, key: &str) -> AppResult<Arc<AsyncMutex<Option<SftpBrowserTransport>>>> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("SFTP browser transports"))?;
        Ok(Arc::clone(
            slots
                .entry(key.to_owned())
                .or_insert_with(|| Arc::new(AsyncMutex::new(None))),
        ))
    }

    fn schedule_idle_cleanup(slot: &Arc<AsyncMutex<Option<SftpBrowserTransport>>>) {
        let slot = Arc::downgrade(slot);
        tokio::spawn(async move {
            sleep(SFTP_BROWSER_TRANSPORT_IDLE_TTL).await;
            let Some(slot) = slot.upgrade() else {
                return;
            };
            let mut transport = slot.lock().await;
            if transport
                .as_ref()
                .is_some_and(SftpBrowserTransport::is_idle_expired)
            {
                *transport = None;
            }
        });
    }

    async fn read_dir_locked(
        transport: &mut Option<SftpBrowserTransport>,
        endpoint: &SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
        managed_runtime: Option<&ManagedSshSessionManager>,
    ) -> AppResult<Vec<SftpEntry>> {
        if transport.is_none() {
            *transport =
                Some(SftpBrowserTransport::connect(endpoint, settings, managed_runtime).await?);
        }
        let active = transport
            .take()
            .expect("browser transport must exist after connect");
        let result = read_dir_with_browser_transport(active, endpoint, path, settings).await;
        match result {
            Ok((active, entries)) => {
                *transport = Some(active);
                Ok(entries)
            }
            Err((active, error)) => {
                *transport = Some(active);
                Err(error)
            }
        }
    }
}

struct SftpBrowserTransport {
    connection: NativeSftpConnection,
    _opened_at: Instant,
    last_used_at: Instant,
}

async fn read_dir_with_browser_transport(
    transport: SftpBrowserTransport,
    endpoint: &SftpEndpoint,
    path: String,
    settings: SftpRuntimeSettings,
) -> Result<(SftpBrowserTransport, Vec<SftpEntry>), (SftpBrowserTransport, AppError)> {
    let SftpBrowserTransport {
        connection,
        _opened_at,
        last_used_at,
    } = transport;
    let seconds = settings.timeout_seconds.max(1);
    let result = timeout(Duration::from_secs(seconds), connection.sftp.read_dir(path)).await;
    let transport = SftpBrowserTransport {
        connection,
        _opened_at,
        last_used_at,
    };
    let entries = match result {
        Ok(Ok(entries)) => entries,
        Ok(Err(error)) => return Err((transport, native_sftp_error(error))),
        Err(_) => {
            return Err((
                transport,
                AppError::Sftp(format!(
                    "SFTP read_dir 超时（{seconds} 秒）: {}",
                    sftp_host_label(&endpoint.host)
                )),
            ));
        }
    };
    let mut transport = transport;
    transport.mark_used();
    Ok((
        transport,
        entries
            .into_iter()
            .map(|entry| sftp_entry_from_native(&entry))
            .collect(),
    ))
}

impl SftpBrowserTransport {
    async fn connect(
        endpoint: &SftpEndpoint,
        settings: SftpRuntimeSettings,
        managed_runtime: Option<&ManagedSshSessionManager>,
    ) -> AppResult<Self> {
        let connection = with_sftp_timeout(
            "connect",
            endpoint,
            settings,
            connect_native_sftp(
                endpoint,
                settings,
                managed_runtime,
                SftpManagedSessionLane::Browser,
            ),
        )
        .await?;
        if is_external_runtime_target_id(&endpoint.host.id) {
            log_external_sftp_event("list.connect.ok", endpoint, None, None);
        }
        let now = Instant::now();
        Ok(Self {
            connection,
            _opened_at: now,
            last_used_at: now,
        })
    }

    fn mark_used(&mut self) {
        self.last_used_at = Instant::now();
    }

    fn is_idle_expired(&self) -> bool {
        self.last_used_at.elapsed() >= SFTP_BROWSER_TRANSPORT_IDLE_TTL
    }
}

fn browser_transport_key(endpoint: &SftpEndpoint, settings: SftpRuntimeSettings) -> String {
    format!(
        "{}\0{}:{}\0{:?}\0{}:{}:{}",
        endpoint.host.id,
        endpoint.host.host,
        endpoint.host.port,
        endpoint.route_auth.summary,
        settings.packet_bytes,
        settings.pipeline_depth,
        settings.timeout_seconds
    )
}

pub(super) fn is_recoverable_browser_sftp_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    [
        "broken pipe",
        "connection reset",
        "connection lost",
        "connection aborted",
        "connection closed",
        "closed by remote",
        "channel closed",
        "channel send error",
        "session closed",
        "subsystem closed",
        "send error",
        "eof",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}
