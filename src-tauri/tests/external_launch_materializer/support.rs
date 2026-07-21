// @author kongweiguang

#![allow(unused_imports)]
pub use std::sync::{Arc, Mutex};

pub use async_trait::async_trait;
pub use kerminal_lib::{
    error::AppResult,
    models::{
        docker::DockerContainerListRequest,
        port_forward::{PortForwardCreateRequest, PortForwardKind},
        remote_host::RemoteHostAuthType,
        server_info::ServerInfoRequest,
        ssh_command::SshCommandRequest,
        target::{ContainerRuntime, RemoteTargetRef},
        tmux::{TmuxProbeRequest, TmuxTargetRef},
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::DockerHostService,
        external_launch::{
            external_target_id, external_target_safety_for_saved_hosts,
            ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
            ExternalMaterializeOutcome, ExternalSessionMaterializer, ExternalTargetSafety,
        },
        mcp_tool_executor_service::{McpToolExecutionContext, McpToolExecutionStatus},
        port_forward_service::PortForwardService,
        remote_host_service::RemoteHostService,
        server_info_service::ServerInfoService,
        ssh_command_service::SshCommandService,
        ssh_runtime::{
            auth_broker::SshAuthBroker, ManagedSshSessionManager, SshAuthIdentity, SshChannelKind,
            SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeExecRawOutput, SshRuntimeExecRequest, SshSessionKey,
        },
        tmux_service::TmuxService,
    },
    state::AppState,
    storage::config_file_store::ConfigFileStore,
};
pub use serde_json::json;
pub use tempfile::{tempdir, TempDir};
pub const PASSWORD_SECRET: &str = "KERM_EXTERNAL_MATERIALIZER_PASSWORD_DO_NOT_USE";
pub const PASSPHRASE_SECRET: &str = "KERM_EXTERNAL_MATERIALIZER_PASSPHRASE_DO_NOT_USE";
pub fn assert_hashed_launch_id(message: &str, raw_launch_id: &str) {
    assert!(!message.contains(raw_launch_id));
    let hash = message
        .split_once("request_hash=")
        .map(|(_, suffix)| suffix.split_whitespace().next().unwrap_or(suffix))
        .expect("error should contain request_hash");
    assert_eq!(hash.len(), 12, "request hash must stay bounded and opaque");
    assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

pub struct MaterializerFixture {
    pub _home: TempDir,
    pub paths: KerminalPaths,
    pub intake: ExternalLaunchIntake,
    pub auth_broker: SshAuthBroker,
    pub materializer: ExternalSessionMaterializer,
}

pub fn materialize_and_ack(
    fixture: &MaterializerFixture,
    launch_id: &str,
) -> kerminal_lib::services::external_launch::ExternalMaterializedTarget {
    let target = fixture
        .materializer
        .materialize(&fixture.paths, launch_id, None)
        .expect("materialize external launch");
    fixture
        .intake
        .secret_broker()
        .ack_launch(launch_id)
        .expect("ack external secret");
    target
}

pub fn ssh_command_service_with_backend(
    fixture: &MaterializerFixture,
    backend: Arc<RecordingExecBackend>,
) -> SshCommandService {
    SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(backend),
        fixture.auth_broker.clone(),
        fixture.materializer.clone(),
    )
}

pub fn empty_remote_hosts(paths: &KerminalPaths) -> RemoteHostService {
    RemoteHostService::new(ConfigFileStore::new(paths.root.clone()))
}

pub fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        agent_sessions: state.agent_sessions(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        diagnostics: state.diagnostics(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        paths: state.paths(),
        port_forwards: state.port_forwards(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        settings: state.settings(),
        sftp: state.sftp(),
        ssh_commands,
        ssh_runtime: state.ssh_runtime(),
        storage: state.storage(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

pub fn materializer_fixture() -> MaterializerFixture {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("ensure kerminal dirs");
    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    MaterializerFixture {
        _home: home,
        paths,
        intake,
        auth_broker,
        materializer,
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
                    PASSWORD_SECRET.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue putty launch"),
    )
}

pub fn queue_kerminal_native_key_passphrase_launch(intake: &ExternalLaunchIntake) -> String {
    let envelope = json!({
        "host": "key.example.internal",
        "port": 2203,
        "username": "deploy",
        "identityFile": "C:\\Users\\alice\\.ssh\\id_ed25519",
        "keyPassphrase": PASSPHRASE_SECRET,
    })
    .to_string();
    queued_launch_id(
        intake
            .accept_args(
                vec![
                    "kerminal.exe".to_owned(),
                    "--external-ssh-json".to_owned(),
                    envelope,
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue native key passphrase launch"),
    )
}

pub fn queued_launch_id(outcome: ExternalLaunchAcceptOutcome) -> String {
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued launch, got {other:?}"),
    }
}

#[derive(Default)]
pub struct RecordingExecBackend {
    last_key: Mutex<Option<SshSessionKey>>,
    scripts: Arc<Mutex<Vec<String>>>,
}

impl RecordingExecBackend {
    pub fn last_key(&self) -> Option<SshSessionKey> {
        self.last_key.lock().expect("last key").clone()
    }

    pub fn scripts(&self) -> Vec<String> {
        self.scripts.lock().expect("scripts").clone()
    }
}

impl SshRuntimeBackend for RecordingExecBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        *self.last_key.lock().expect("last key") = Some(request.key().clone());
        Ok(Arc::new(RecordingExecConnection {
            scripts: Arc::clone(&self.scripts),
        }))
    }
}

pub struct RecordingExecConnection {
    scripts: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl SshRuntimeConnection for RecordingExecConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        Ok(format!("recording-{}", kind.as_str()))
    }

    fn supports_exec(&self) -> bool {
        true
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        self.scripts
            .lock()
            .expect("scripts")
            .push(request.script.clone());
        let stdout = if request.script.contains("/proc/meminfo") {
            b"hostname=external-host\nos=Linux\n".to_vec()
        } else if request.script.contains("'tmux' '-V'") {
            b"tmux 3.4\n".to_vec()
        } else if request.script.contains(" ps") && request.script.contains("--format") {
            br#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api","Status":"Up 2 minutes","State":"running","Ports":""}
"#
            .to_vec()
        } else if request.script.contains(" inspect --format") {
            Vec::new()
        } else {
            format!("external-exec: {}", request.script).into_bytes()
        };
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stderr: Vec::new(),
            stdout,
        })
    }

    fn disconnect(&self, _reason: &str) {}
}
