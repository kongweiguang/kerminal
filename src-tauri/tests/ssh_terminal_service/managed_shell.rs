use super::support::*;

#[test]
fn create_session_prefers_managed_shell_runtime_for_default_ssh_terminal() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed terminal ready".to_vec(),
    ));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal");

    assert_eq!(summary.pid, None);
    assert!(summary.shell.starts_with("ssh:"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed terminal ready"));

    terminals
        .write(&summary.id, "whoami\r")
        .expect("write shell");
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    terminals.close(&summary.id).expect("close shell");
    wait_until(Duration::from_secs(2), || backend.close_count() == 1);
}

#[test]
fn managed_shell_uses_configured_keepalive_and_default_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.keepalive_seconds = 17;
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
        ssh_options,
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed terminal ready".to_vec(),
    ));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            |_| true,
        )
        .expect("create managed ssh terminal with configured keepalive and cwd");

    assert_eq!(summary.cwd.as_deref(), Some("/srv/app"));
    assert_eq!(backend.last_keepalive_seconds(), Some(17));
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/srv/app' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn managed_shell_prompt_required_returns_recoverable_prompt_plan() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    remove_host_secret_ref_for_prompt_only_fixture(state.paths(), &host_id);
    let backend = Arc::new(FakeShellRuntime::default());
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let request = SshTerminalCreateRequest {
        host_id: host_id.clone(),
        cwd: None,
        remote_command: None,
        cols: 80,
        rows: 24,
    };

    let error = try_open_managed_shell(
        &service,
        state.remote_hosts(),
        state.paths(),
        request.clone(),
    )
    .expect_err("prompt-only terminal should return a recoverable prompt plan");

    assert_eq!(backend.connect_count(), 0);
    let snapshot = managed_runtime.snapshot().expect("runtime snapshot");
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let AppError::SshAuthPromptRequired {
        message,
        prompt_plan,
    } = error
    else {
        panic!("expected SshAuthPromptRequired");
    };
    assert!(message.contains("deploy@dev.internal:22"));
    let prompts = prompt_plan
        .get("prompts")
        .and_then(|value| value.as_array())
        .expect("prompt plan prompts");
    assert_eq!(prompts.len(), 1);
    let prompt = prompts.first().expect("target prompt");
    assert_eq!(
        prompt.get("promptId").and_then(|value| value.as_str()),
        Some("ssh-auth:target:deploy@dev.internal:22:password")
    );
    assert_eq!(
        prompt.get("role").and_then(|value| value.as_str()),
        Some("target")
    );
    assert_eq!(
        prompt.get("secretKind").and_then(|value| value.as_str()),
        Some("password")
    );
    assert_eq!(
        prompt.get("username").and_then(|value| value.as_str()),
        Some("deploy")
    );
    assert_eq!(
        prompt.get("host").and_then(|value| value.as_str()),
        Some("dev.internal")
    );
    assert_eq!(
        prompt.get("port").and_then(|value| value.as_u64()),
        Some(22)
    );
}

#[test]
fn create_session_uses_managed_shell_for_remote_cwd_without_legacy_fallback() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed cwd terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/srv/app's data".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal with cwd");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd.as_deref(), Some("/srv/app's data"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/srv/app'\\''s data' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed cwd terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_uses_managed_shell_for_remote_command_without_legacy_fallback() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed command terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: Some("uptime".to_owned()),
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal with remote command");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd, None);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(backend.written_inputs(), vec![b"exec uptime\r".to_vec()]);
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed command terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_uses_managed_shell_for_jump_host_remote_cwd_without_legacy_fallback() {
    let (_home, state) = test_state();
    let ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "password-jump".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2022,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: Some(JUMP_PASSWORD.to_owned()),
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TARGET_PASSWORD.to_owned()),
        ssh_options,
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed jump cwd terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/dev".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal through jump host with cwd");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd.as_deref(), Some("/dev"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let key = backend.last_key().expect("managed runtime key");
    assert_eq!(key.target.host, "dev.internal");
    assert_eq!(key.target.username, "deploy");
    assert_eq!(key.jumps.len(), 1);
    assert_eq!(key.jumps[0].host, "bastion.internal");
    assert_eq!(key.jumps[0].port, 2022);
    assert_eq!(key.jumps[0].username, "jump");
    assert!(!format!("{key:?}").contains(JUMP_PASSWORD));
    assert!(!format!("{key:?}").contains(TARGET_PASSWORD));
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed jump cwd terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_prefers_managed_shell_for_materialized_external_password_target() {
    let (_home, state) = test_state();
    let launch_id = queue_putty_password_launch(state.external_launch_intake(), Some("deploy"));
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("drain pending launch");
    assert_eq!(pending.len(), 1);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");

    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"external managed terminal ready".to_vec(),
    ));
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id: target.host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed external ssh terminal");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.target_ref.as_deref(), Some(target.host_id.as_str()));
    assert!(summary.shell.contains("example.internal"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let key = backend.last_key().expect("managed runtime key");
    assert_eq!(key.target.host_id.as_deref(), Some(target.host_id.as_str()));
    assert_eq!(key.target.host, "example.internal");
    assert_eq!(key.target.username, "deploy");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id == "ssh-auth:target:deploy@example.internal:2202:password"
    ));
    assert!(!format!("{key:?}").contains(EXTERNAL_PASSWORD));

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed external terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("external managed terminal ready"));
    assert!(!output.data.contains(EXTERNAL_PASSWORD));

    terminals
        .write(&summary.id, "whoami\r")
        .expect("write external shell");
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    terminals.close(&summary.id).expect("close external shell");
    wait_until(Duration::from_secs(2), || backend.close_count() == 1);
}
