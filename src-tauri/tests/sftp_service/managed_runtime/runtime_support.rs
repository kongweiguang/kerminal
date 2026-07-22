use super::*;

pub fn collect_terminal_output_until(
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
) -> String {
    let mut output = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let event = receiver
            .recv_timeout(remaining)
            .expect("wait for terminal output");
        if event.kind != TerminalOutputKind::Data {
            continue;
        }
        output.push_str(&event.data);
        if output.contains(expected) {
            return output;
        }
    }
    panic!("timed out waiting for {expected:?}, got {output:?}");
}

pub fn queue_putty_loopback_password_launch(state: &AppState, port: u16) -> String {
    match state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                port.to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue putty loopback launch")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ExternalClientFixture {
    SecureCrt,
    Xshell,
    MobaXterm,
}

impl ExternalClientFixture {
    pub fn all() -> [Self; 3] {
        [Self::SecureCrt, Self::Xshell, Self::MobaXterm]
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::SecureCrt => "SecureCRT",
            Self::Xshell => "Xshell",
            Self::MobaXterm => "MobaXterm",
        }
    }

    pub fn source_tool(self) -> kerminal_lib::services::external_launch::ExternalLaunchSourceTool {
        match self {
            Self::SecureCrt => {
                kerminal_lib::services::external_launch::ExternalLaunchSourceTool::Securecrt
            }
            Self::Xshell => {
                kerminal_lib::services::external_launch::ExternalLaunchSourceTool::Xshell
            }
            Self::MobaXterm => {
                kerminal_lib::services::external_launch::ExternalLaunchSourceTool::Mobaxterm
            }
        }
    }
}

pub fn queue_external_client_loopback_password_launch(
    state: &AppState,
    client: ExternalClientFixture,
    port: u16,
) -> String {
    let port = port.to_string();
    let args = match client {
        ExternalClientFixture::SecureCrt => vec![
            "SecureCRT.exe".to_owned(),
            "/SSH2".to_owned(),
            "127.0.0.1".to_owned(),
            "/L".to_owned(),
            "deploy".to_owned(),
            "/P".to_owned(),
            port,
            "/PASSWORD".to_owned(),
            "secret".to_owned(),
        ],
        ExternalClientFixture::Xshell => vec![
            "Xshell.exe".to_owned(),
            "-url".to_owned(),
            format!("ssh://deploy:secret@127.0.0.1:{port}"),
            "-newtab".to_owned(),
            "deploy@127.0.0.1".to_owned(),
        ],
        ExternalClientFixture::MobaXterm => vec![
            "MobaXterm.exe".to_owned(),
            "-newtab".to_owned(),
            "-remotehost".to_owned(),
            "127.0.0.1".to_owned(),
            "-username".to_owned(),
            "deploy".to_owned(),
            "-port".to_owned(),
            port,
            "-password".to_owned(),
            "secret".to_owned(),
        ],
    };
    match state
        .external_launch_intake()
        .accept_args(args, None, ExternalLaunchEntrypoint::DirectArgv)
        .expect("queue external client loopback launch")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch for {client:?}, got {other:?}"),
    }
}

#[tokio::test]
async fn unsupported_managed_sftp_fallback_does_not_record_lease_only_channel() {
    let server_root = tempdir().expect("server root");
    fs::write(server_root.path().join("legacy-fallback.txt"), b"fallback")
        .await
        .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        )
        .await
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let fake_runtime = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(fake_runtime.clone());
    let service = SftpService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id,
                path: "/".to_owned(),
            },
        )
        .await
        .expect("fall back to legacy SFTP when managed backend lacks SFTP");

    assert!(listing
        .entries
        .iter()
        .any(|entry| { entry.name == "legacy-fallback.txt" && entry.kind == SftpEntryKind::File }));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "legacy fallback performs the actual SSH/SFTP authentication once"
    );
    assert_eq!(fake_runtime.connect_count(), 1);
    assert_eq!(
        fake_runtime.channel_count(),
        0,
        "unsupported managed SFTP must not leave a diagnostics-only SFTP channel lease"
    );
    assert_eq!(fake_runtime.last_channel_kind(), None);

    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.recent_legacy_fallbacks.len(), 1);
    assert_eq!(snapshot.recent_legacy_fallbacks[0].capability, "sftp");
    assert_eq!(
        snapshot.recent_legacy_fallbacks[0].reason,
        "managed-sftp-unsupported"
    );
    assert_eq!(snapshot.recent_legacy_fallbacks[0].count, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        None,
        "fallback diagnostics must not claim that a managed SFTP channel opened"
    );
    assert_eq!(manager.close_idle_sessions().expect("close idle"), 1);
}
