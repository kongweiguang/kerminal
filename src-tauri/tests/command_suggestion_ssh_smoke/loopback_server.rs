// @author kongweiguang

use super::*;

pub(super) struct LoopbackProviderServer {
    pub(super) addr: SocketAddr,
    pub(super) counters: Arc<LoopbackProviderCounters>,
    pub(super) host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackProviderServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug, Default)]
pub(super) struct LoopbackProviderCounters {
    pub(super) connections: AtomicUsize,
    pub(super) exec_requests: AtomicUsize,
    pub(super) sftp_subsystems: AtomicUsize,
}

#[derive(Clone, Debug)]
pub(super) struct LoopbackProviderProfile {
    pub(super) generated_command_count: usize,
    pub(super) generated_git_branch_count: usize,
    pub(super) response_delay: Duration,
}

impl Default for LoopbackProviderProfile {
    fn default() -> Self {
        Self {
            generated_command_count: 0,
            generated_git_branch_count: 0,
            response_delay: Duration::ZERO,
        }
    }
}

impl LoopbackProviderProfile {
    fn command_stdout(&self) -> String {
        let mut commands = ["cat", "echo", "git", "kubectl", "ls"]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        commands.extend((0..self.generated_command_count).map(|index| format!("cmd{index:04}")));
        format!("{}\n", commands.join("\n"))
    }

    fn git_stdout(&self) -> String {
        let mut lines = vec![
            "repo\t/srv/repo".to_owned(),
            "branch\tfeature/local-loopback".to_owned(),
            "remoteBranch\torigin/feature/remote-loopback".to_owned(),
            "tag\tv1.2.3".to_owned(),
            "remote\torigin".to_owned(),
        ];
        lines.extend(
            (0..self.generated_git_branch_count)
                .map(|index| format!("branch\tfeature/slow-{index:04}")),
        );
        format!("{}\n", lines.join("\n"))
    }

    fn history_stdout(&self) -> String {
        [
            "git status --short",
            "kubectl get pods -n prod",
            ": 1760000000:0;deploy --dry-run --target staging",
            "export API_TOKEN=secret-value",
            "deploy --force",
            "deploy --dry-run --target staging",
        ]
        .join("\n")
    }
}

#[derive(Clone)]
struct LoopbackSshProviderServer {
    counters: Arc<LoopbackProviderCounters>,
    profile: LoopbackProviderProfile,
    root: PathBuf,
}

struct LoopbackSshProviderSession {
    channels: HashMap<ChannelId, Channel<Msg>>,
    counters: Arc<LoopbackProviderCounters>,
    exec_command: Option<String>,
    profile: LoopbackProviderProfile,
    root: PathBuf,
    script: Vec<u8>,
}

impl russh::server::Server for LoopbackSshProviderServer {
    type Handler = LoopbackSshProviderSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        self.counters.connections.fetch_add(1, Ordering::SeqCst);
        LoopbackSshProviderSession {
            channels: HashMap::new(),
            counters: Arc::clone(&self.counters),
            exec_command: None,
            profile: self.profile.clone(),
            root: self.root.clone(),
            script: Vec::new(),
        }
    }
}

impl russh::server::Handler for LoopbackSshProviderSession {
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
        channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
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
            self.counters.exec_requests.fetch_add(1, Ordering::SeqCst);
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
        if self.exec_command.is_some() {
            if !self.profile.response_delay.is_zero() {
                sleep(self.profile.response_delay).await;
            }
            let script = String::from_utf8_lossy(&self.script);
            let stdout = if script.contains("git for-each-ref") {
                self.profile.git_stdout()
            } else if script.contains(".bash_history") || script.contains(".zsh_history") {
                self.profile.history_stdout()
            } else {
                self.profile.command_stdout()
            };
            for chunk in stdout.as_bytes().chunks(16 * 1024) {
                session.data(channel, chunk.to_vec())?;
            }
            session.exit_status_request(channel, 0)?;
        }
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }
        let Some(channel) = self.channels.remove(&channel_id) else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };
        self.counters.sftp_subsystems.fetch_add(1, Ordering::SeqCst);
        session.channel_success(channel_id)?;
        russh_sftp::server::run(
            channel.into_stream(),
            LoopbackSftpFs::new(self.root.clone(), self.profile.clone()),
        )
        .await;
        Ok(())
    }
}

struct LoopbackSftpFs {
    handles: HashMap<String, LoopbackSftpHandle>,
    next_handle: u64,
    profile: LoopbackProviderProfile,
    root: PathBuf,
}

enum LoopbackSftpHandle {
    Directory {
        consumed: bool,
        entries: Vec<ProtocolFile>,
    },
}

impl LoopbackSftpFs {
    fn new(root: PathBuf, profile: LoopbackProviderProfile) -> Self {
        Self {
            handles: HashMap::new(),
            next_handle: 0,
            profile,
            root,
        }
    }

    fn next_handle(&mut self, prefix: &str) -> String {
        self.next_handle = self.next_handle.saturating_add(1);
        format!("{prefix}-{}", self.next_handle)
    }

    fn resolve_path(&self, remote_path: &str) -> Result<PathBuf, StatusCode> {
        let mut local_path = self.root.clone();
        let normalized = remote_path.replace('\\', "/");
        for segment in normalized.split('/') {
            match segment {
                "" | "." => {}
                ".." => return Err(StatusCode::PermissionDenied),
                value => local_path.push(value),
            }
        }
        Ok(local_path)
    }

    async fn attrs_for_path(&self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let local_path = self.resolve_path(&path)?;
        let metadata = async_fs::metadata(local_path)
            .await
            .map_err(Self::io_status)?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&metadata),
        })
    }

    fn io_status(error: io::Error) -> StatusCode {
        match error.kind() {
            io::ErrorKind::NotFound => StatusCode::NoSuchFile,
            io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
            _ => StatusCode::Failure,
        }
    }

    fn ok(id: u32) -> Status {
        Status {
            error_message: "Ok".to_owned(),
            id,
            language_tag: "en-US".to_owned(),
            status_code: StatusCode::Ok,
        }
    }
}

impl russh_sftp::server::Handler for LoopbackSftpFs {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        if self.handles.remove(&handle).is_none() {
            return Err(StatusCode::NoSuchFile);
        }
        Ok(Self::ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.attrs_for_path(id, path).await
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        if !self.profile.response_delay.is_zero() {
            sleep(self.profile.response_delay).await;
        }
        let local_path = self.resolve_path(&path)?;
        let mut entries = async_fs::read_dir(local_path)
            .await
            .map_err(Self::io_status)?;
        let mut files = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(Self::io_status)? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = entry.metadata().await.map_err(Self::io_status)?;
            files.push(ProtocolFile::new(name, FileAttributes::from(&metadata)));
        }
        files.sort_by(|left, right| left.filename.cmp(&right.filename));

        let handle = self.next_handle("dir");
        self.handles.insert(
            handle.clone(),
            LoopbackSftpHandle::Directory {
                consumed: false,
                entries: files,
            },
        );
        Ok(Handle { handle, id })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(LoopbackSftpHandle::Directory { consumed, entries }) =
            self.handles.get_mut(&handle)
        else {
            return Err(StatusCode::NoSuchFile);
        };
        if *consumed {
            return Err(StatusCode::Eof);
        }
        *consumed = true;
        Ok(Name {
            files: entries.clone(),
            id,
        })
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name {
            files: vec![ProtocolFile::dummy(path)],
            id,
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.attrs_for_path(id, path).await
    }
}

pub(super) async fn start_loopback_provider_server(root: PathBuf) -> LoopbackProviderServer {
    start_loopback_provider_server_with_profile(root, LoopbackProviderProfile::default()).await
}

pub(super) async fn start_loopback_provider_server_with_profile(
    root: PathBuf,
    profile: LoopbackProviderProfile,
) -> LoopbackProviderServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback provider server");
    let addr = listener.local_addr().expect("loopback provider address");
    let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback host key");
    let host_key = private_key.public_key().clone();
    let counters = Arc::new(LoopbackProviderCounters::default());
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![private_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let server_counters = Arc::clone(&counters);
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshProviderServer {
            counters: server_counters,
            profile,
            root,
        };
        let _ = server.run_on_socket(Arc::new(config), &listener).await;
    });

    LoopbackProviderServer {
        addr,
        counters,
        host_key,
        task,
    }
}
