// @author kongweiguang

pub fn connect_and_capture_loopback_output(
    state: &AppState,
    host_id: &str,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: host_id.to_owned(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .map_err(|error| error.to_string())?;

    let result = run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, config);
    let close_result = state
        .terminals()
        .close(&summary.id)
        .map_err(|error| error.to_string());
    let idle_result = wait_for_managed_runtime_idle(state, Duration::from_secs(5));

    match (result, close_result, idle_result) {
        (Err(error), _, _) => Err(error),
        (Ok(_), Err(error), _) => Err(error),
        (Ok(_), Ok(()), Err(error)) => Err(error),
        (Ok(output), Ok(()), Ok(())) => Ok(output),
    }
}

fn wait_for_managed_runtime_idle(state: &AppState, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = state
            .ssh_runtime()
            .snapshot()
            .map_err(|error| error.to_string())?;
        if snapshot.active_channels == 0 {
            state
                .ssh_runtime()
                .close_idle_sessions()
                .map_err(|error| error.to_string())?;
            thread::sleep(Duration::from_millis(150));
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "managed SSH runtime still has {} active channel(s) after close",
                snapshot.active_channels
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn open_ssh_client_available() -> bool {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .is_ok()
}

pub fn create_loopback_terminal_harness(server: &LoopbackTerminalServer) -> (TempDir, AppState) {
    let home = tempdir().expect("create temp loopback terminal home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize loopback app state");
    fs::create_dir_all(&state.paths().root).expect("create loopback app root");
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
    )
    .expect("trust loopback SSH host key");

    (home, state)
}

pub fn trust_loopback_host_key(
    paths: &KerminalPaths,
    host: &str,
    port: u16,
    host_key: &PublicKey,
) -> Result<(), keys::Error> {
    keys::known_hosts::learn_known_hosts_path(host, port, host_key, paths.root.join("known_hosts"))
}

#[derive(Debug)]
pub struct LoopbackTerminalServer {
    pub addr: SocketAddr,
    pub host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
    _runtime: Runtime,
}

impl LoopbackTerminalServer {
    pub fn start() -> Self {
        let runtime = Runtime::new().expect("create loopback SSH runtime");
        let (addr, host_key, task) = runtime.block_on(async {
            let listener = TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("bind loopback SSH terminal server");
            let addr = listener
                .local_addr()
                .expect("read loopback SSH terminal address");
            let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
                .expect("generate loopback SSH host key");
            let host_key = private_key.public_key().clone();
            let config = russh::server::Config {
                auth_rejection_time: Duration::from_millis(0),
                auth_rejection_time_initial: Some(Duration::from_millis(0)),
                keys: vec![private_key],
                maximum_packet_size: 65_535,
                ..Default::default()
            };
            let task = tokio::spawn(async move {
                let mut server = LoopbackInteractiveSshServer;
                let _ = server.run_on_socket(Arc::new(config), &listener).await;
            });
            (addr, host_key, task)
        });

        Self {
            addr,
            host_key,
            task,
            _runtime: runtime,
        }
    }
}

impl Drop for LoopbackTerminalServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug)]
pub struct LoopbackTerminalJumpServer {
    pub addr: SocketAddr,
    pub host_key: PublicKey,
    pub auth_attempts: Arc<AtomicUsize>,
    pub direct_tcpip_requests: Arc<AtomicUsize>,
    pub forwarded_tcpip_requests: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
    _runtime: Runtime,
}

impl LoopbackTerminalJumpServer {
    pub fn start(target_addr: SocketAddr) -> Self {
        Self::start_with_private_key_on_port(target_addr, 0, Self::generate_host_key())
    }

    pub fn generate_host_key() -> PrivateKey {
        PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
            .expect("generate loopback SSH jump host key")
    }

    pub fn start_with_private_key_on_port(
        target_addr: SocketAddr,
        bind_port: u16,
        private_key: PrivateKey,
    ) -> Self {
        let runtime = Runtime::new().expect("create loopback SSH jump runtime");
        let (addr, host_key, auth_attempts, direct_tcpip_requests, forwarded_tcpip_requests, task) =
            runtime.block_on(async {
                let listener = TcpListener::bind(("127.0.0.1", bind_port))
                    .await
                    .expect("bind loopback SSH jump server");
                let addr = listener
                    .local_addr()
                    .expect("read loopback SSH jump address");
                let host_key = private_key.public_key().clone();
                let auth_attempts = Arc::new(AtomicUsize::new(0));
                let direct_tcpip_requests = Arc::new(AtomicUsize::new(0));
                let forwarded_tcpip_requests = Arc::new(AtomicUsize::new(0));
                let config = russh::server::Config {
                    auth_rejection_time: Duration::from_millis(0),
                    auth_rejection_time_initial: Some(Duration::from_millis(0)),
                    keys: vec![private_key],
                    maximum_packet_size: 65_535,
                    ..Default::default()
                };
                let auths = Arc::clone(&auth_attempts);
                let requests = Arc::clone(&direct_tcpip_requests);
                let forwarded_requests = Arc::clone(&forwarded_tcpip_requests);
                let task = tokio::spawn(async move {
                    let mut server = LoopbackTerminalJumpServerState {
                        auth_attempts: auths,
                        direct_tcpip_requests: requests,
                        forwarded_tcpip_requests: forwarded_requests,
                        target_addr,
                    };
                    let _ = server.run_on_socket(Arc::new(config), &listener).await;
                });
                (
                    addr,
                    host_key,
                    auth_attempts,
                    direct_tcpip_requests,
                    forwarded_tcpip_requests,
                    task,
                )
            });

        Self {
            addr,
            host_key,
            auth_attempts,
            direct_tcpip_requests,
            forwarded_tcpip_requests,
            task,
            _runtime: runtime,
        }
    }
}

impl Drop for LoopbackTerminalJumpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct LoopbackTerminalJumpServerState {
    auth_attempts: Arc<AtomicUsize>,
    direct_tcpip_requests: Arc<AtomicUsize>,
    forwarded_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

struct LoopbackTerminalJumpSession {
    auth_attempts: Arc<AtomicUsize>,
    direct_tcpip_requests: Arc<AtomicUsize>,
    forwarded_tcpip_requests: Arc<AtomicUsize>,
    remote_forward_shutdowns: HashMap<(String, u32), tokio::sync::oneshot::Sender<()>>,
    target_addr: SocketAddr,
}

impl russh::server::Server for LoopbackTerminalJumpServerState {
    type Handler = LoopbackTerminalJumpSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackTerminalJumpSession {
            auth_attempts: Arc::clone(&self.auth_attempts),
            direct_tcpip_requests: Arc::clone(&self.direct_tcpip_requests),
            forwarded_tcpip_requests: Arc::clone(&self.forwarded_tcpip_requests),
            remote_forward_shutdowns: HashMap::new(),
            target_addr: self.target_addr,
        }
    }
}

impl russh::server::Handler for LoopbackTerminalJumpSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.auth_attempts.fetch_add(1, Ordering::SeqCst);
        if user == LOOPBACK_JUMP_USER && password == LOOPBACK_JUMP_PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    /// 显式确认并校验转发目标，确保 jump fixture 不会为未登记目标建立代理。
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
            // 丢弃 handle 会拒绝异常目标，并且不会为其建立代理连接。
            drop(reply);
            return Ok(());
        }

        self.direct_tcpip_requests.fetch_add(1, Ordering::SeqCst);
        let target_addr = self.target_addr;
        // 先确认通道，避免 russh 0.62 在代理启动前将其按未确认请求丢弃。
        reply.accept().await;
        tokio::spawn(async move {
            if let Ok(mut target_stream) = tokio::net::TcpStream::connect(target_addr).await {
                let mut channel_stream = channel.into_stream();
                let _ =
                    tokio::io::copy_bidirectional(&mut channel_stream, &mut target_stream).await;
            }
        });

        Ok(())
    }

    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let listener = match TcpListener::bind((address, *port as u16)).await {
            Ok(listener) => listener,
            Err(_) => return Ok(false),
        };
        let local_addr = match listener.local_addr() {
            Ok(addr) => addr,
            Err(_) => return Ok(false),
        };
        if *port == 0 {
            *port = u32::from(local_addr.port());
        }

        let bind_address = address.to_owned();
        let bind_port = *port;
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
        let handle = session.handle();
        let forwarded_requests = Arc::clone(&self.forwarded_tcpip_requests);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        return;
                    }
                    accepted = listener.accept() => {
                        let Ok((mut inbound, peer_addr)) = accepted else {
                            return;
                        };
                        let handle = handle.clone();
                        let bind_address = bind_address.clone();
                        let forwarded_requests = Arc::clone(&forwarded_requests);
                        tokio::spawn(async move {
                            if let Ok(channel) = handle
                                .channel_open_forwarded_tcpip(
                                    bind_address,
                                    bind_port,
                                    peer_addr.ip().to_string(),
                                    u32::from(peer_addr.port()),
                                )
                                .await
                            {
                                forwarded_requests.fetch_add(1, Ordering::SeqCst);
                                let mut channel_stream = channel.into_stream();
                                let _ = tokio::io::copy_bidirectional(
                                    &mut inbound,
                                    &mut channel_stream,
                                )
                                .await;
                            }
                        });
                    }
                }
            }
        });

        self.remote_forward_shutdowns
            .insert((address.to_owned(), *port), shutdown_tx);
        Ok(true)
    }

    async fn cancel_tcpip_forward(
        &mut self,
        address: &str,
        port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        if let Some(shutdown) = self
            .remote_forward_shutdowns
            .remove(&(address.to_owned(), port))
        {
            let _ = shutdown.send(());
            return Ok(true);
        }
        Ok(false)
    }
}
