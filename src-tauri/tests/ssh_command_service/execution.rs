//! SSH 命令执行与托管运行时集成测试。

use super::support::*;
use super::*;

#[tokio::test]
async fn native_command_executes_against_loopback_ssh_server() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);

    let output = SshCommandService::new()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf ready".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf ready\n");
    assert_eq!(output.stderr, "loopback stderr\n");
    assert!(!output.stdout_truncated);
    assert!(!output.stderr_truncated);
}

#[tokio::test]
async fn native_command_uses_session_only_password_from_auth_broker() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let host = create_password_remote_host_without_credentials(&state, server.addr.port());
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

    let output = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf session-only".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command with session-only password");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf session-only\n");

    let first_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("first runtime snapshot");
    assert_eq!(first_snapshot.active_sessions, 1);
    assert_eq!(first_snapshot.sessions[0].ref_count, 0);
    assert_eq!(first_snapshot.sessions[0].opened_channels, 1);

    let second_output = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf session-only-again".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute second native command on managed session");

    assert!(second_output.success);
    assert!(second_output.stdout.contains("printf session-only-again\n"));
    let second_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("second runtime snapshot");
    assert_eq!(second_snapshot.active_sessions, 1);
    assert!(second_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        second_snapshot.sessions[0].session_id,
        first_snapshot.sessions[0].session_id
    );
    assert_eq!(second_snapshot.sessions[0].opened_channels, 2);
    assert_eq!(
        second_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(
        state
            .ssh_runtime()
            .close_idle_sessions()
            .expect("close idle"),
        1
    );
}

#[tokio::test]
async fn native_command_fallback_honors_pre_cancelled_token() {
    let (_home, state) = test_state();
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = 9;
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let error = SshCommandService::new()
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id,
                command: "printf should-not-run".to_owned(),
                timeout_seconds: Some(30),
                max_output_bytes: Some(1024),
            },
            cancel_token,
        )
        .await
        .expect_err("pre-cancelled native fallback should not connect");

    assert!(matches!(error, AppError::SshCommand(_)));
    assert_eq!(error.to_string(), "SSH 远程命令执行失败: 远程命令已取消");
}

#[tokio::test]
async fn native_command_opens_managed_exec_channel_with_redacted_session_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let host = create_password_remote_host_without_credentials(&state, server.addr.port());
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
    let backend = Arc::new(FakeRuntimeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let output = service
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-exec".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command with managed exec lease");

    assert!(output.success);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(backend.disconnect_count(), 0);
    assert_eq!(manager.active_session_count().expect("active sessions"), 1);
    assert_eq!(backend.last_channel_kind(), None);
    let key = backend.last_key().expect("runtime key");
    assert_eq!(key.target.host, "127.0.0.1");
    assert!(key.runtime_flags.is_empty());
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id.starts_with("ssh-auth:target:deploy@127.0.0.1:")
    ));
    let debug = format!("{key:?}");
    assert!(!debug.contains("secret"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(backend.disconnect_count(), 1);
}

#[tokio::test]
async fn native_command_uses_managed_exec_stream_when_backend_supports_exec() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();

    let output = service
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-stream".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(8),
            },
            cancel_token,
        )
        .await
        .expect("execute through managed exec stream");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout_bytes, 256);
    assert!(output.stdout.starts_with("managed-stream-output"));
    assert!(output.stdout_truncated);
    assert_eq!(output.stderr, "stderr");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_exec_script(),
        Some("printf managed-stream\n".to_owned())
    );
    assert_eq!(backend.last_exec_timeout_seconds(), Some(5));
    assert_eq!(backend.last_exec_max_output_bytes(), Some(256));
    assert_eq!(backend.last_exec_cancelled(), Some(false));
    assert!(manager
        .snapshot()
        .expect("managed exec stream snapshot")
        .recent_legacy_fallbacks
        .is_empty());
}

#[tokio::test]
async fn native_command_managed_exec_honors_pre_cancelled_token() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager,
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let error = service
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-cancel".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
            cancel_token,
        )
        .await
        .expect_err("pre-cancelled managed exec should stop before backend exec");

    assert!(matches!(error, AppError::SshCommand(_)));
    assert_eq!(error.to_string(), "SSH 远程命令执行失败: 远程命令已取消");
    assert_eq!(backend.connect_count(), 0);
    assert_eq!(backend.exec_count(), 0);
}

#[tokio::test]
async fn open_managed_streaming_exec_passes_timeout_and_cancel_token_to_runtime() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let session = service
        .open_managed_streaming_exec(
            state.paths(),
            &host.id,
            "tail -f /var/log/app.log".to_owned(),
            42,
            cancel_token,
        )
        .await
        .expect("open managed streaming exec")
        .expect("managed streaming exec supported");

    assert!(!session.session_id().is_empty());
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.streaming_exec_count(), 1);
    assert_eq!(
        backend.last_streaming_exec_command(),
        Some("tail -f /var/log/app.log".to_owned())
    );
    assert_eq!(backend.last_streaming_exec_timeout_seconds(), Some(42));
    assert_eq!(backend.last_streaming_exec_cancelled(), Some(true));
    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.sessions[0].active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );
    drop(session);
    assert_eq!(manager.active_session_count().expect("active sessions"), 1);
}

#[tokio::test]
async fn external_native_command_exec_uses_interactive_runtime_lane() {
    let (_home, state) = test_state();
    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                "2222".to_owned(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(manager, auth_broker, materializer);

    let output = service
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf external-managed".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute external managed command");

    assert!(output.success);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    let key = backend.last_key().expect("runtime key");
    assert!(key
        .runtime_flags
        .is_empty(), "external command exec should use the same interactive managed runtime lane as the terminal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id.starts_with("ssh-auth:target:deploy@127.0.0.1:2222:")
    ));
}
