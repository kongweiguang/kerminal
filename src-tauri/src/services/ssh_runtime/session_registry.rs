//! @author kongweiguang

use super::*;

impl fmt::Debug for ManagedSshSessionManager {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSessionManager")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl Default for ManagedSshSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ManagedSshSessionManager {
    /// Creates a manager whose backend reports that Managed SSH is unavailable.
    pub fn new() -> Self {
        Self::with_backend(Arc::new(UnavailableSshRuntimeBackend))
    }

    pub fn with_backend<B>(backend: Arc<B>) -> Self
    where
        B: SshRuntimeBackend + 'static,
    {
        Self::with_backend_and_limits(backend, DEFAULT_MAX_CONCURRENT_EXEC_CHANNELS)
    }

    pub fn with_backend_and_limits<B>(backend: Arc<B>, max_concurrent_exec_channels: usize) -> Self
    where
        B: SshRuntimeBackend + 'static,
    {
        Self {
            inner: Arc::new(ManagedSshSessionManagerInner {
                backend,
                channel_open_semaphores: Mutex::new(HashMap::new()),
                exec_semaphores: Mutex::new(HashMap::new()),
                max_concurrent_exec_channels: max_concurrent_exec_channels.max(1),
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Acquire or create an authenticated session for the given key.
    pub fn acquire_session(&self, key: SshSessionKey) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(SshRuntimeConnectRequest::key_only(key))
    }

    /// Acquire or create an authenticated session with backend connection material.
    pub fn acquire_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        let key = request.key().clone();
        {
            let mut sessions = self.sessions()?;
            match sessions.get(&key).map(|entry| entry.state) {
                Some(ManagedSshSessionState::Failed) => {
                    if let Some(failed_entry) = sessions.remove(&key) {
                        evict_failed_session_entry(
                            &self.inner,
                            &key,
                            failed_entry,
                            "failed session evicted before reacquire",
                        );
                    }
                }
                Some(_) => {
                    let entry = sessions.get_mut(&key).expect("existing ready session");
                    entry.ref_count = entry.ref_count.saturating_add(1);
                    entry.last_used_at = unix_timestamp();
                    return Ok(self.handle_for(&key, entry));
                }
                None => {}
            }
        }

        let connection = self.inner.backend.connect(request)?;
        let mut sessions = self.sessions()?;
        match sessions.get(&key).map(|entry| entry.state) {
            Some(ManagedSshSessionState::Failed) => {
                if let Some(failed_entry) = sessions.remove(&key) {
                    evict_failed_session_entry(
                        &self.inner,
                        &key,
                        failed_entry,
                        "failed session evicted after reconnect race",
                    );
                }
            }
            Some(_) => {
                let entry = sessions.get_mut(&key).expect("existing ready session");
                entry.ref_count = entry.ref_count.saturating_add(1);
                entry.last_used_at = unix_timestamp();
                return Ok(self.handle_for(&key, entry));
            }
            None => {}
        }

        let now = unix_timestamp();
        let mut entry = ManagedSshSessionEntry {
            active_channels: 0,
            channel_counts: BTreeMap::new(),
            connection,
            created_at: now.clone(),
            last_error: None,
            last_used_at: now,
            opened_channels: 0,
            pending_exec_requests: 0,
            ref_count: 1,
            session_id: Uuid::new_v4().to_string(),
            state: ManagedSshSessionState::Ready,
        };
        let handle = self.handle_for(&key, &mut entry);
        sessions.insert(key, entry);
        Ok(handle)
    }

    /// Acquire a latency-isolated session for bulk transfer work.
    ///
    /// The auth material and target identity are still the same as the
    /// interactive session, but the runtime registry key carries a separate
    /// lane flag so large SFTP/container streams can use another SSH transport
    /// instead of competing with the user's interactive shell.
    pub fn acquire_bulk_transfer_session(
        &self,
        key: SshSessionKey,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_bulk_transfer_session_with_request(SshRuntimeConnectRequest::key_only(key))
    }

    pub fn acquire_bulk_transfer_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(
            request.with_runtime_flag(MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG),
        )
    }

    /// Acquire a tool/capability session for chains that cannot safely share
    /// the user's interactive shell transport, notably external bastion targets.
    pub fn acquire_capability_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(
            request.with_runtime_flag(MANAGED_SSH_CAPABILITY_RUNTIME_FLAG),
        )
    }

    /// Close idle sessions that are not currently referenced by a caller or channel.
    pub fn close_idle_sessions(&self) -> AppResult<usize> {
        let mut sessions = self.sessions()?;
        let idle_keys = sessions
            .iter()
            .filter_map(|(key, entry)| {
                if entry.ref_count == 0 && entry.active_channels == 0 {
                    Some(key.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let closed = idle_keys.len();
        for key in idle_keys {
            if let Some(entry) = sessions.remove(&key) {
                entry.connection.disconnect("idle session closed");
            }
            remove_channel_open_semaphore(&self.inner, &key);
            remove_exec_semaphore(&self.inner, &key);
        }
        Ok(closed)
    }

    /// Return a redacted runtime snapshot for diagnostics.
    pub fn snapshot(&self) -> AppResult<ManagedSshRuntimeSnapshot> {
        let sessions = self.sessions()?;
        let mut session_summaries = sessions
            .iter()
            .map(|(key, entry)| entry.snapshot(key, self.inner.max_concurrent_exec_channels))
            .collect::<Vec<_>>();
        session_summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));

        Ok(ManagedSshRuntimeSnapshot {
            active_channels: session_summaries
                .iter()
                .map(|session| session.active_channels)
                .sum(),
            active_sessions: session_summaries.len(),
            generated_at: unix_timestamp(),
            sessions: session_summaries,
        })
    }

    /// Number of sessions currently kept in the registry.
    pub fn active_session_count(&self) -> AppResult<usize> {
        Ok(self.sessions()?.len())
    }
}
