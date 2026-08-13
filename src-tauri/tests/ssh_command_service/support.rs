//! SSH 命令集成测试共享支持。
//!
//! @author kongweiguang

use super::*;

#[derive(Debug)]
pub(super) struct LoopbackCommandServer {
    pub(super) addr: SocketAddr,
    pub(super) host_key: PublicKey,
    pub(super) task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackCommandServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug)]
pub(super) struct LoopbackJumpServer {
    pub(super) addr: SocketAddr,
    pub(super) direct_tcpip_requests: Arc<AtomicUsize>,
    pub(super) host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackJumpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone)]
struct LoopbackSshCommandServer;

#[derive(Default)]
struct LoopbackSshCommandSession {
    exec_command: Option<String>,
    script: Vec<u8>,
}

#[derive(Clone)]
struct LoopbackSshJumpServer {
    direct_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

struct LoopbackSshJumpSession {
    direct_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

impl russh::server::Server for LoopbackSshCommandServer {
    type Handler = LoopbackSshCommandSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackSshCommandSession::default()
    }
}

impl russh::server::Handler for LoopbackSshCommandSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "deploy" && password == "secret" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    /// 显式接受会话通道，使 loopback fixture 与 russh 0.62 的真实服务端握手语义一致。
    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if data == b"sh -s" {
            self.exec_command = Some(String::from_utf8_lossy(data).into_owned());
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.script.extend_from_slice(data);
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let script = String::from_utf8_lossy(&self.script);
        let stdout = format!(
            "exec={}\nscript={script}",
            self.exec_command.as_deref().unwrap_or("<none>")
        );
        session.data(channel, stdout.into_bytes())?;
        session.extended_data(channel, 1, b"loopback stderr\n".to_vec())?;
        session.exit_status_request(channel, 0)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

impl russh::server::Server for LoopbackSshJumpServer {
    type Handler = LoopbackSshJumpSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackSshJumpSession {
            direct_tcpip_requests: Arc::clone(&self.direct_tcpip_requests),
            target_addr: self.target_addr,
        }
    }
}

impl russh::server::Handler for LoopbackSshJumpSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "jump" && password == "jump-secret" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    /// 仅接受已验证的 jump 目标，避免测试代理意外转发到未登记地址。
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if host_to_connect != self.target_addr.ip().to_string()
            || port_to_connect != u32::from(self.target_addr.port())
        {
            drop(reply);
            return Ok(());
        }

        self.direct_tcpip_requests.fetch_add(1, Ordering::SeqCst);
        let target_addr = self.target_addr;
        // 先接受再代理，避免 russh 0.62 将未确认通道按丢弃处理。
        reply.accept().await;
        tokio::spawn(async move {
            if let Ok(mut target_stream) = tokio::net::TcpStream::connect(target_addr).await {
                let mut channel_stream = channel.into_stream();
                let _ = io::copy_bidirectional(&mut channel_stream, &mut target_stream).await;
            }
        });

        Ok(())
    }
}

pub(super) async fn start_loopback_command_server() -> LoopbackCommandServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback command server");
    let addr = listener.local_addr().expect("loopback command address");
    let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback command host key");
    let host_key = private_key.public_key().clone();
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![private_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshCommandServer;
        let _ = server.run_on_socket(Arc::new(config), &listener).await;
    });

    LoopbackCommandServer {
        addr,
        host_key,
        task,
    }
}

pub(super) async fn start_loopback_jump_server(target_addr: SocketAddr) -> LoopbackJumpServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback jump server");
    let addr = listener.local_addr().expect("loopback jump address");
    let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback jump host key");
    let host_key = private_key.public_key().clone();
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![private_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let direct_tcpip_requests = Arc::new(AtomicUsize::new(0));
    let counters = Arc::clone(&direct_tcpip_requests);
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshJumpServer {
            direct_tcpip_requests: counters,
            target_addr,
        };
        let _ = server.run_on_socket(Arc::new(config), &listener).await;
    });

    LoopbackJumpServer {
        addr,
        direct_tcpip_requests,
        host_key,
        task,
    }
}

#[derive(Default)]
pub(super) struct FakeRuntimeBackend {
    state: Arc<FakeRuntimeState>,
}

#[derive(Default)]
struct FakeRuntimeState {
    channels: AtomicUsize,
    connects: AtomicUsize,
    disconnects: AtomicUsize,
    exec_enabled: AtomicUsize,
    execs: AtomicUsize,
    last_exec_cancelled: Mutex<Option<bool>>,
    last_exec_max_output_bytes: Mutex<Option<usize>>,
    last_exec_script: Mutex<Option<String>>,
    last_exec_timeout_seconds: Mutex<Option<u64>>,
    last_channel_kind: Mutex<Option<SshChannelKind>>,
    last_key: Mutex<Option<SshSessionKey>>,
    last_streaming_exec_cancelled: Mutex<Option<bool>>,
    last_streaming_exec_command: Mutex<Option<String>>,
    last_streaming_exec_timeout_seconds: Mutex<Option<u64>>,
    streaming_exec_enabled: AtomicUsize,
    streaming_execs: AtomicUsize,
}

impl FakeRuntimeBackend {
    pub(super) fn channel_count(&self) -> usize {
        self.state.channels.load(Ordering::SeqCst)
    }

    pub(super) fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    pub(super) fn disconnect_count(&self) -> usize {
        self.state.disconnects.load(Ordering::SeqCst)
    }

    pub(super) fn last_channel_kind(&self) -> Option<SshChannelKind> {
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind")
    }

    pub(super) fn last_key(&self) -> Option<SshSessionKey> {
        self.state.last_key.lock().expect("last key").clone()
    }

    pub(super) fn enable_exec(&self) {
        self.state.exec_enabled.store(1, Ordering::SeqCst);
    }

    pub(super) fn enable_streaming_exec(&self) {
        self.state.streaming_exec_enabled.store(1, Ordering::SeqCst);
    }

    pub(super) fn exec_count(&self) -> usize {
        self.state.execs.load(Ordering::SeqCst)
    }

    pub(super) fn last_exec_script(&self) -> Option<String> {
        self.state
            .last_exec_script
            .lock()
            .expect("last exec script")
            .clone()
    }

    pub(super) fn last_exec_timeout_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_exec_timeout_seconds
            .lock()
            .expect("last exec timeout seconds")
    }

    pub(super) fn last_exec_max_output_bytes(&self) -> Option<usize> {
        *self
            .state
            .last_exec_max_output_bytes
            .lock()
            .expect("last exec max output bytes")
    }

    pub(super) fn last_exec_cancelled(&self) -> Option<bool> {
        *self
            .state
            .last_exec_cancelled
            .lock()
            .expect("last exec cancelled")
    }

    pub(super) fn streaming_exec_count(&self) -> usize {
        self.state.streaming_execs.load(Ordering::SeqCst)
    }

    pub(super) fn last_streaming_exec_command(&self) -> Option<String> {
        self.state
            .last_streaming_exec_command
            .lock()
            .expect("last streaming exec command")
            .clone()
    }

    pub(super) fn last_streaming_exec_timeout_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_streaming_exec_timeout_seconds
            .lock()
            .expect("last streaming exec timeout seconds")
    }

    pub(super) fn last_streaming_exec_cancelled(&self) -> Option<bool> {
        *self
            .state
            .last_streaming_exec_cancelled
            .lock()
            .expect("last streaming exec cancelled")
    }
}

impl SshRuntimeBackend for FakeRuntimeBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        *self.state.last_key.lock().expect("last key") = Some(request.key().clone());
        Ok(Arc::new(FakeRuntimeConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeRuntimeConnection {
    state: Arc<FakeRuntimeState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeRuntimeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        self.state.channels.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind") = Some(kind);
        Ok(format!("fake-runtime-{}", kind.as_str()))
    }

    fn supports_exec(&self) -> bool {
        self.state.exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        self.state.execs.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_exec_script
            .lock()
            .expect("last exec script") = Some(request.script);
        *self
            .state
            .last_exec_timeout_seconds
            .lock()
            .expect("last exec timeout seconds") = Some(request.timeout_seconds);
        *self
            .state
            .last_exec_max_output_bytes
            .lock()
            .expect("last exec max output bytes") = Some(request.max_output_bytes);
        *self
            .state
            .last_exec_cancelled
            .lock()
            .expect("last exec cancelled") = Some(request.cancel_token.is_cancelled());
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stdout: "managed-stream-output".repeat(20).into_bytes(),
            stderr: b"stderr".to_vec(),
        })
    }

    fn supports_streaming_exec(&self) -> bool {
        self.state.streaming_exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        self.state.streaming_execs.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_streaming_exec_command
            .lock()
            .expect("last streaming exec command") = Some(request.command);
        *self
            .state
            .last_streaming_exec_timeout_seconds
            .lock()
            .expect("last streaming exec timeout seconds") = Some(request.timeout_seconds);
        *self
            .state
            .last_streaming_exec_cancelled
            .lock()
            .expect("last streaming exec cancelled") = Some(request.cancel_token.is_cancelled());
        Ok(Box::new(FakeStreamingExecSession))
    }

    fn disconnect(&self, _reason: &str) {
        self.state.disconnects.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
struct FakeStreamingExecSession;

impl SshRuntimeStreamingExecSession for FakeStreamingExecSession {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        Ok(())
    }

    fn wait(&mut self, _timeout: Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        Ok(SshRuntimeStreamingExecExit { exit_code: Some(0) })
    }

    fn kill(&mut self) -> AppResult<()> {
        Ok(())
    }
}

pub(super) fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref: (auth_type == RemoteHostAuthType::Key)
            .then(|| "/home/deploy/.ssh/id_ed25519".to_owned()),
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: vec!["dev".to_owned()],
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

pub(super) fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub(super) fn create_saved_password_remote_host(
    state: &AppState,
    mut host: RemoteHost,
) -> RemoteHost {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: host.auth_type,
            credential_ref: host.credential_ref.take(),
            credential_secret: host.credential_secret.take(),
            group_id: None,
            host: host.host,
            name: host.name,
            port: host.port,
            ssh_options: host.ssh_options,
            tags: host.tags,
            username: host.username,
            protocol: Default::default(),
        })
        .expect("create saved password host")
}

pub(super) fn create_password_remote_host_without_credentials(
    state: &AppState,
    port: u16,
) -> RemoteHost {
    let host = RemoteHost {
        id: Uuid::new_v4().to_string(),
        group_id: None,
        name: "loopback".to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: vec!["loopback".to_owned()],
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    };
    ConfigFileStore::new(state.paths().root.clone())
        .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
        .expect("write loopback remote host without credentials");
    host
}
