#![allow(unused_imports)]
pub use async_trait::async_trait;
pub use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        remote_host::{
            RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest,
            SshJumpHostOptions, SshOptions,
        },
        terminal::{SshTerminalCreateRequest, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        external_launch::{
            ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
            ExternalSessionMaterializer,
        },
        ssh_runtime::{
            auth_broker::SshAuthBroker, ManagedSshSessionManager, SshAuthIdentity, SshChannelKind,
            SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeShellEvent, SshRuntimeShellRequest, SshRuntimeShellSession, SshSessionKey,
        },
        ssh_terminal_service::{
            rules::{
                cleanup_temporary_identity_files, resolve_terminal_launch,
                temporary_identity_directory, try_open_managed_shell,
            },
            SshTerminalService,
        },
        terminal_manager::TerminalManager,
    },
    state::AppState,
};
pub use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
pub use tempfile::{tempdir, TempDir};

pub const TEST_PRIVATE_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nkerminal-test-private-key\n-----END OPENSSH PRIVATE KEY-----\n";
pub const TEST_PASSWORD: &str = "s3cr3t-ssh-password";
pub const EXTERNAL_PASSWORD: &str = "external-terminal-password-secret";
pub const JUMP_PASSWORD: &str = "jump-password-secret";
pub const TARGET_PASSWORD: &str = "target-password-secret";

pub fn create_test_remote_host(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
) -> String {
    create_test_remote_host_with_options(state, auth_type, credential_ref, SshOptions::default())
}

pub fn create_test_remote_host_with_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret: None,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create test host")
        .id
}

pub fn create_test_remote_host_with_secret(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> String {
    create_test_remote_host_with_secret_and_options(
        state,
        auth_type,
        credential_ref,
        credential_secret,
        SshOptions::default(),
    )
}

pub fn remove_host_secret_ref_for_prompt_only_fixture(paths: &KerminalPaths, host_id: &str) {
    let path = paths.root.join("hosts").join(format!("{host_id}.toml"));
    let content = fs::read_to_string(&path).expect("read host fixture toml");
    let without_secret_ref = content
        .lines()
        .filter(|line| !line.trim_start().starts_with("secret_ref"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{without_secret_ref}\n")).expect("write prompt-only host fixture");
}

pub fn create_test_remote_host_with_secret_and_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create test host")
        .id
}

pub fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

pub fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        predicate(),
        "condition was not satisfied within {timeout:?}"
    );
}

#[derive(Default)]
pub struct FakeShellRuntime {
    state: Arc<FakeShellRuntimeState>,
}

#[derive(Default)]
pub struct FakeShellRuntimeState {
    closes: AtomicUsize,
    connects: AtomicUsize,
    events: Mutex<VecDeque<SshRuntimeShellEvent>>,
    last_keepalive_seconds: Mutex<Option<u64>>,
    last_key: Mutex<Option<SshSessionKey>>,
    opens: AtomicUsize,
    writes: Mutex<Vec<Vec<u8>>>,
}

impl FakeShellRuntime {
    pub fn push_event(&self, event: SshRuntimeShellEvent) {
        self.state
            .events
            .lock()
            .expect("events lock")
            .push_back(event);
    }

    pub fn close_count(&self) -> usize {
        self.state.closes.load(Ordering::SeqCst)
    }

    pub fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    pub fn last_key(&self) -> Option<SshSessionKey> {
        self.state.last_key.lock().expect("last key").clone()
    }

    pub fn last_keepalive_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_keepalive_seconds
            .lock()
            .expect("last keepalive seconds")
    }

    pub fn shell_open_count(&self) -> usize {
        self.state.opens.load(Ordering::SeqCst)
    }

    pub fn write_count(&self) -> usize {
        self.state.writes.lock().expect("writes lock").len()
    }

    pub fn written_inputs(&self) -> Vec<Vec<u8>> {
        self.state.writes.lock().expect("writes lock").clone()
    }
}

impl SshRuntimeBackend for FakeShellRuntime {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        *self.state.last_key.lock().expect("last key") = Some(request.key().clone());
        *self
            .state
            .last_keepalive_seconds
            .lock()
            .expect("last keepalive seconds") = request.native_keepalive_seconds();
        Ok(Arc::new(FakeShellConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeShellConnection {
    state: Arc<FakeShellRuntimeState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeShellConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        Ok(format!("fake-{kind:?}-channel"))
    }

    fn supports_shell(&self) -> bool {
        true
    }

    async fn open_shell(
        &self,
        _request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        self.state.opens.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeShellSession {
            state: Arc::clone(&self.state),
        }))
    }

    fn disconnect(&self, _reason: &str) {}
}

struct FakeShellSession {
    state: Arc<FakeShellRuntimeState>,
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
        loop {
            if let Some(event) = self.state.events.lock().expect("events lock").pop_front() {
                return Ok(event);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.state.writes.lock().expect("writes lock").push(data);
        Ok(())
    }

    async fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
        Ok(())
    }

    async fn close(&self) -> AppResult<()> {
        self.state.closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

pub fn queued_launch_id(outcome: ExternalLaunchAcceptOutcome) -> String {
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

pub fn queue_putty_password_launch(
    intake: &ExternalLaunchIntake,
    username: Option<&str>,
) -> String {
    let destination = match username {
        Some(username) => format!("{username}@example.internal"),
        None => "example.internal".to_owned(),
    };
    queued_launch_id(
        intake
            .accept_args(
                vec![
                    "putty.exe".to_owned(),
                    "-ssh".to_owned(),
                    destination,
                    "-P".to_owned(),
                    "2202".to_owned(),
                    "-pw".to_owned(),
                    EXTERNAL_PASSWORD.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue putty launch"),
    )
}
