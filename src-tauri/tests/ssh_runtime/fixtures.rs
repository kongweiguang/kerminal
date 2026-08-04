//! SSH runtime 集成测试夹具和 fake backend。
//!
//! @author kongweiguang

use super::*;

pub(super) fn sample_key() -> SshSessionKey {
    SshSessionKey::new(SshSessionPeer::target(
        "host-1",
        "example.com",
        22,
        "deploy",
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ref_id: "credential:ssh-host:host-1:target:password".to_owned(),
        },
    ))
    .with_known_hosts_profile("workspace-known-hosts")
}

pub(super) fn loopback_session_key(port: u16) -> SshSessionKey {
    SshSessionKey::new(SshSessionPeer::target(
        "loopback-shell",
        "127.0.0.1",
        port,
        LOOPBACK_USER,
        SshAuthIdentity::SessionOnly {
            prompt_id: "loopback-shell-password".to_owned(),
        },
    ))
    .with_known_hosts_profile("workspace-known-hosts")
}

pub(super) fn sample_runtime_host() -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: None,
        name: "Example".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some("super-secret-password".to_owned()),
        credential_status: Default::default(),
        tags: Vec::new(),
        ssh_options: Default::default(),
        sort_order: 0,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    }
}

pub(super) fn sample_native_route_material() -> NativeSshRouteMaterial {
    NativeSshRouteMaterial {
        target: NativeSshHopMaterial {
            role: ResolvedSshHopRole::Target,
            host: "example.com".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            auth: NativeSshAuthMaterial::Password {
                value: "route-secret-password".to_owned(),
                source: ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: "target-password".to_owned(),
                },
            },
        },
        jumps: vec![NativeSshHopMaterial {
            role: ResolvedSshHopRole::Jump { index: 0 },
            host: "jump.example.com".to_owned(),
            port: 2222,
            username: "jump".to_owned(),
            auth: NativeSshAuthMaterial::PrivateKeyPem {
                content: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n".to_owned(),
                passphrase: Some(ResolvedSshSecretValue {
                    value: "passphrase-secret".to_owned(),
                    source: ResolvedSshCredentialSource::SessionOnly {
                        prompt_id: "jump-passphrase".to_owned(),
                    },
                }),
                source: ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: "jump-key".to_owned(),
                },
            },
        }],
    }
}

pub(super) fn loopback_runtime_host(port: u16) -> RemoteHost {
    RemoteHost {
        id: "loopback-shell".to_owned(),
        group_id: None,
        name: "Loopback Shell".to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: LOOPBACK_USER.to_owned(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some(LOOPBACK_PASSWORD.to_owned()),
        credential_status: Default::default(),
        tags: Vec::new(),
        ssh_options: Default::default(),
        sort_order: 0,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    }
}

#[derive(Default)]
pub(super) struct FakeBackend {
    state: Arc<FakeBackendState>,
}

#[derive(Default)]
pub(super) struct FakeBackendState {
    channel_error: Mutex<Option<String>>,
    channels: AtomicUsize,
    connect_error: Mutex<Option<String>>,
    connects: AtomicUsize,
    disconnects: AtomicUsize,
    exec_active: AtomicUsize,
    exec_enabled: AtomicUsize,
    exec_max_active: AtomicUsize,
    exec_release: Notify,
    exec_started: Notify,
    shell_closes: AtomicUsize,
    shell_enabled: AtomicUsize,
    shell_events: Mutex<VecDeque<SshRuntimeShellEvent>>,
    shell_last_request: Mutex<Option<SshRuntimeShellRequest>>,
    shell_opens: AtomicUsize,
    shell_resizes: AtomicUsize,
    shell_writes: Mutex<Vec<Vec<u8>>>,
    sftp_enabled: AtomicUsize,
    sftp_opens: AtomicUsize,
    streaming_exec_enabled: AtomicUsize,
    streaming_execs: AtomicUsize,
    streaming_stdin: Mutex<Vec<u8>>,
    transient_channel_open_error: Mutex<Option<String>>,
    transient_channel_open_failures: AtomicUsize,
}

impl FakeBackend {
    pub(super) fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    pub(super) fn disconnect_count(&self) -> usize {
        self.state.disconnects.load(Ordering::SeqCst)
    }

    pub(super) fn fail_channel(&self, message: &str) {
        *self.state.channel_error.lock().expect("channel error lock") = Some(message.to_owned());
    }

    pub(super) fn fail_next_channel_opens(&self, count: usize, message: &str) {
        *self
            .state
            .transient_channel_open_error
            .lock()
            .expect("transient channel open error lock") = Some(message.to_owned());
        self.state
            .transient_channel_open_failures
            .store(count, Ordering::SeqCst);
    }

    pub(super) fn clear_channel_failure(&self) {
        *self.state.channel_error.lock().expect("channel error lock") = None;
    }

    pub(super) fn fail_connect(&self, message: &str) {
        *self.state.connect_error.lock().expect("connect error lock") = Some(message.to_owned());
    }

    pub(super) fn enable_exec(&self) {
        self.state.exec_enabled.store(1, Ordering::SeqCst);
    }

    pub(super) fn enable_shell(&self) {
        self.state.shell_enabled.store(1, Ordering::SeqCst);
        self.state
            .shell_events
            .lock()
            .expect("shell events lock")
            .push_back(SshRuntimeShellEvent::Data(b"fake-shell-ready".to_vec()));
    }

    pub(super) fn enable_sftp(&self) {
        self.state.sftp_enabled.store(1, Ordering::SeqCst);
    }

    pub(super) fn enable_streaming_exec(&self) {
        self.state.streaming_exec_enabled.store(1, Ordering::SeqCst);
    }

    pub(super) async fn wait_for_exec_start(&self) {
        self.state.exec_started.notified().await;
    }

    pub(super) fn release_one_exec(&self) {
        self.state.exec_release.notify_one();
    }

    pub(super) fn max_active_exec(&self) -> usize {
        self.state.exec_max_active.load(Ordering::SeqCst)
    }

    pub(super) fn shell_close_count(&self) -> usize {
        self.state.shell_closes.load(Ordering::SeqCst)
    }

    pub(super) fn shell_last_request(&self) -> Option<SshRuntimeShellRequest> {
        self.state
            .shell_last_request
            .lock()
            .expect("shell request lock")
            .clone()
    }

    pub(super) fn shell_open_count(&self) -> usize {
        self.state.shell_opens.load(Ordering::SeqCst)
    }

    pub(super) fn shell_resize_count(&self) -> usize {
        self.state.shell_resizes.load(Ordering::SeqCst)
    }

    pub(super) fn shell_write_count(&self) -> usize {
        self.state
            .shell_writes
            .lock()
            .expect("shell writes lock")
            .len()
    }

    pub(super) fn sftp_open_count(&self) -> usize {
        self.state.sftp_opens.load(Ordering::SeqCst)
    }

    pub(super) fn streaming_exec_count(&self) -> usize {
        self.state.streaming_execs.load(Ordering::SeqCst)
    }

    pub(super) fn streaming_stdin(&self) -> Vec<u8> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin lock")
            .clone()
    }
}

impl SshRuntimeBackend for FakeBackend {
    fn connect(
        &self,
        _request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        if let Some(message) = self
            .state
            .connect_error
            .lock()
            .expect("connect error lock")
            .clone()
        {
            return Err(AppError::SshCommand(message));
        }
        Ok(Arc::new(FakeConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

pub(super) struct FakeConnection {
    state: Arc<FakeBackendState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        if let Some(message) = self.take_transient_channel_open_error() {
            return Err(AppError::SshCommand(message));
        }
        if let Some(message) = self
            .state
            .channel_error
            .lock()
            .expect("channel error lock")
            .clone()
        {
            return Err(AppError::SshCommand(message));
        }
        let channel_index = self.state.channels.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(format!("fake-channel-{}-{}", kind.as_str(), channel_index))
    }

    fn supports_shell(&self) -> bool {
        self.state.shell_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        if !self.supports_shell() {
            return Err(AppError::SshCommand("fake shell disabled".to_owned()));
        }
        if let Some(message) = self.take_transient_channel_open_error() {
            return Err(AppError::SshCommand(message));
        }
        self.state.shell_opens.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .shell_last_request
            .lock()
            .expect("shell request lock") = Some(request);
        Ok(Box::new(FakeShellSession {
            state: Arc::clone(&self.state),
        }))
    }

    fn supports_exec(&self) -> bool {
        self.state.exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        if let Some(message) = self.take_transient_channel_open_error() {
            return Err(AppError::SshCommand(message));
        }
        let active = self.state.exec_active.fetch_add(1, Ordering::SeqCst) + 1;
        update_max(&self.state.exec_max_active, active);
        self.state.exec_started.notify_one();
        self.state.exec_release.notified().await;
        self.state.exec_active.fetch_sub(1, Ordering::SeqCst);
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stdout: request.script.into_bytes(),
            stderr: Vec::new(),
        })
    }

    fn supports_streaming_exec(&self) -> bool {
        self.state.streaming_exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_streaming_exec(
        &self,
        _request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        if !self.supports_streaming_exec() {
            return Err(AppError::SshCommand(
                "fake streaming exec disabled".to_owned(),
            ));
        }
        if let Some(message) = self.take_transient_channel_open_error() {
            return Err(AppError::SshCommand(message));
        }
        self.state.streaming_execs.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeStreamingExecSession {
            state: Arc::clone(&self.state),
            stderr: Some(Cursor::new(Vec::new())),
            stdin_taken: false,
            stdout: Some(Cursor::new(b"streaming-output".to_vec())),
        }))
    }

    fn supports_sftp(&self) -> bool {
        self.state.sftp_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_sftp(&self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        if !self.supports_sftp() {
            return Err(AppError::SshCommand("fake sftp disabled".to_owned()));
        }
        if let Some(message) = self.take_transient_channel_open_error() {
            return Err(AppError::SshCommand(message));
        }
        self.state.sftp_opens.fetch_add(1, Ordering::SeqCst);
        let (client, _server) = tokio::io::duplex(64);
        Ok(Box::new(client))
    }

    fn disconnect(&self, _reason: &str) {
        self.state.disconnects.fetch_add(1, Ordering::SeqCst);
    }
}

impl FakeConnection {
    fn take_transient_channel_open_error(&self) -> Option<String> {
        let mut remaining = self
            .state
            .transient_channel_open_failures
            .load(Ordering::SeqCst);
        while remaining > 0 {
            match self.state.transient_channel_open_failures.compare_exchange(
                remaining,
                remaining - 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    return self
                        .state
                        .transient_channel_open_error
                        .lock()
                        .expect("transient channel open error lock")
                        .clone();
                }
                Err(next) => remaining = next,
            }
        }
        None
    }
}

pub(super) struct FakeStreamingExecSession {
    state: Arc<FakeBackendState>,
    stderr: Option<Cursor<Vec<u8>>>,
    stdin_taken: bool,
    stdout: Option<Cursor<Vec<u8>>>,
}

impl std::fmt::Debug for FakeStreamingExecSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FakeStreamingExecSession")
            .finish_non_exhaustive()
    }
}

impl SshRuntimeStreamingExecSession for FakeStreamingExecSession {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        if self.stdin_taken {
            return Err(AppError::SshCommand(
                "fake streaming stdin already taken".to_owned(),
            ));
        }
        self.stdin_taken = true;
        Ok(Box::new(FakeStreamingExecWriter {
            state: Arc::clone(&self.state),
        }))
    }

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stdout
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| AppError::SshCommand("fake stdout already taken".to_owned()))
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stderr
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| AppError::SshCommand("fake stderr already taken".to_owned()))
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        self.stdin_taken = true;
        Ok(())
    }

    fn wait(&mut self, _timeout: std::time::Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        Ok(SshRuntimeStreamingExecExit { exit_code: Some(0) })
    }

    fn kill(&mut self) -> AppResult<()> {
        Ok(())
    }
}

pub(super) struct FakeStreamingExecWriter {
    state: Arc<FakeBackendState>,
}

impl Write for FakeStreamingExecWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin lock")
            .extend_from_slice(input);
        Ok(input.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) struct FakeShellSession {
    state: Arc<FakeBackendState>,
}

impl std::fmt::Debug for FakeShellSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FakeShellSession")
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl SshRuntimeShellSession for FakeShellSession {
    async fn read_event(&self) -> AppResult<SshRuntimeShellEvent> {
        Ok(self
            .state
            .shell_events
            .lock()
            .expect("shell events lock")
            .pop_front()
            .unwrap_or(SshRuntimeShellEvent::Closed))
    }

    async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.state
            .shell_writes
            .lock()
            .expect("shell writes lock")
            .push(data);
        Ok(())
    }

    async fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
        self.state.shell_resizes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn close(&self) -> AppResult<()> {
        self.state.shell_closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

pub(super) async fn wait_for_pending_exec_requests(
    manager: &ManagedSshSessionManager,
    expected: u64,
) {
    for _ in 0..50 {
        let snapshot = manager.snapshot().expect("runtime snapshot");
        if snapshot
            .sessions
            .iter()
            .any(|session| session.pending_exec_requests == expected)
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let snapshot = manager.snapshot().expect("runtime snapshot");
    panic!("expected pending exec requests {expected}, got {snapshot:?}");
}

pub(super) async fn read_shell_until(shell: &ManagedSshShellSession, expected: &str) -> String {
    let mut output = String::new();
    for _ in 0..20 {
        let event = tokio::time::timeout(Duration::from_secs(2), shell.read_event())
            .await
            .expect("timed out waiting for shell event")
            .expect("read shell event");
        match event {
            SshRuntimeShellEvent::Data(data) | SshRuntimeShellEvent::ExtendedData { data, .. } => {
                output.push_str(&String::from_utf8_lossy(&data));
                if output.contains(expected) {
                    return output;
                }
            }
            SshRuntimeShellEvent::Eof | SshRuntimeShellEvent::Closed => {
                panic!("shell closed before {expected:?}: {output:?}");
            }
            SshRuntimeShellEvent::ExitSignal {
                error_message,
                signal_name,
            } => {
                panic!("shell exited by signal {signal_name}: {error_message}");
            }
            SshRuntimeShellEvent::ExitStatus(status) => {
                panic!("shell exited with status {status} before {expected:?}: {output:?}");
            }
        }
    }
    panic!("expected shell output to contain {expected:?}, got {output:?}");
}

pub(super) fn update_max(max: &AtomicUsize, candidate: usize) {
    let mut current = max.load(Ordering::SeqCst);
    while candidate > current {
        match max.compare_exchange(current, candidate, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return,
            Err(next) => current = next,
        }
    }
}
