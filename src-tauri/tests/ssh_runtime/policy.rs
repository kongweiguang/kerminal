//! SSH runtime 策略与错误分类集成测试。

use super::fixtures::*;
use super::*;

#[test]
fn session_key_summary_does_not_include_secret_material() {
    let key = sample_key()
        .with_jump(SshSessionPeer::jump(
            "jump.internal",
            2222,
            "bastion",
            SshAuthIdentity::SessionOnly {
                prompt_id: "jump-password-prompt".to_owned(),
            },
        ))
        .with_runtime_flag("native-shell")
        .with_runtime_flag("native-shell");

    let debug = format!("{key:?}");
    assert!(!debug.contains("super-secret-password"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert_eq!(key.runtime_flags, vec!["native-shell"]);

    let summary = key.summary();
    assert_eq!(summary.target, "deploy@example.com:22");
    assert_eq!(summary.jumps, vec!["bastion@jump.internal:2222"]);
}

#[test]
fn connect_request_debug_redacts_runtime_host_material() {
    let request = SshRuntimeConnectRequest::native(
        sample_key(),
        sample_runtime_host(),
        "C:/Users/example/.kerminal/known_hosts".into(),
        30,
    )
    .with_keepalive_seconds(20);

    let debug = format!("{request:?}");

    assert!(debug.contains("example.com"));
    assert_eq!(request.native_keepalive_seconds(), Some(20));
    assert!(!debug.contains("super-secret-password"));
    assert!(!debug.contains("C:/Users/example"));
    assert!(!debug.contains(".kerminal"));
}

#[test]
fn connect_request_debug_redacts_native_route_material() {
    let request = SshRuntimeConnectRequest::native(
        sample_key(),
        sample_runtime_host(),
        "C:/Users/example/.kerminal/known_hosts".into(),
        30,
    )
    .with_native_route_material(sample_native_route_material());

    let debug = format!("{request:?}");

    assert!(debug.contains("route_material"));
    assert!(debug.contains("<runtime-material>"));
    assert!(!debug.contains("route-secret-password"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert!(!debug.contains("passphrase-secret"));
}

#[test]
fn runtime_facade_context_captures_native_target_without_exposing_secret_material() {
    let request = SshRuntimeConnectRequest::native(
        sample_key(),
        sample_runtime_host(),
        "C:/Users/example/.kerminal/known_hosts".into(),
        45,
    )
    .with_host_key_policy(SshRuntimeHostKeyPolicy::TrustUnknown)
    .with_keepalive_seconds(15);

    let context =
        SshRuntimeTargetContext::new(request).with_lane(SshRuntimeSessionLane::BulkTransfer);
    let target = context.target();

    assert_eq!(context.lane(), SshRuntimeSessionLane::BulkTransfer);
    assert_eq!(target.host_id, "host-1");
    assert_eq!(target.host, "example.com");
    assert_eq!(target.port, 22);
    assert_eq!(target.username, "deploy");
    assert_eq!(target.target_label, "deploy@example.com:22");
    assert_eq!(target.auth_type, Some(RemoteHostAuthType::Password));
    assert_eq!(target.connect_timeout_seconds, Some(45));
    assert_eq!(target.keepalive_seconds, Some(15));
    assert_eq!(
        target.host_key_policy,
        SshRuntimeHostKeyPolicy::TrustUnknown
    );
    assert!(target.known_hosts_path.is_some());

    let debug = format!("{context:?}");
    assert!(debug.contains("SshRuntimeTargetContext"));
    assert!(!debug.contains("super-secret-password"));
    assert!(!debug.contains("C:/Users/example"));
    assert!(!debug.contains(".kerminal"));
}

#[test]
fn runtime_facade_acquire_session_respects_lane_flags_and_fallback_target_label() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let facade = SshRuntimeFacade::new(manager);
    let interactive =
        SshRuntimeTargetContext::new(SshRuntimeConnectRequest::key_only(sample_key()));
    let capability = interactive
        .clone()
        .with_lane(SshRuntimeSessionLane::Capability);
    let bulk_transfer = interactive
        .clone()
        .with_lane(SshRuntimeSessionLane::BulkTransfer);

    let _interactive_session = facade
        .acquire_session(&interactive)
        .expect("interactive session");
    let _capability_session = facade
        .acquire_session(&capability)
        .expect("capability session");
    let _bulk_transfer_session = facade
        .acquire_session(&bulk_transfer)
        .expect("bulk transfer session");
    facade.record_legacy_fallback("exec", "backend unsupported", Some(&interactive));

    let snapshot = facade.snapshot().expect("snapshot");
    let mut runtime_flags = snapshot
        .sessions
        .iter()
        .map(|session| session.key.runtime_flags.clone())
        .collect::<Vec<_>>();
    runtime_flags.sort();

    assert_eq!(snapshot.active_sessions, 3);
    assert_eq!(
        runtime_flags,
        vec![
            Vec::<String>::new(),
            vec![MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG.to_owned()],
            vec![MANAGED_SSH_CAPABILITY_RUNTIME_FLAG.to_owned()],
        ]
    );
    assert_eq!(snapshot.recent_legacy_fallbacks.len(), 1);
    assert_eq!(snapshot.recent_legacy_fallbacks[0].capability, "exec");
    assert_eq!(
        snapshot.recent_legacy_fallbacks[0].target.as_deref(),
        Some("deploy@example.com:22")
    );
    assert_eq!(backend.connect_count(), 3);
}

#[test]
fn runtime_policy_centralizes_host_key_external_target_and_fallback_rules() {
    assert!(is_external_runtime_target_id("external:launch-1"));
    assert!(!is_external_runtime_target_id("saved-host-1"));
    assert_eq!(
        runtime_host_key_policy_for_host_id("external:launch-1"),
        SshRuntimeHostKeyPolicy::RequireKnown
    );
    assert_eq!(
        runtime_host_key_policy_for_host_id("saved-host-1"),
        SshRuntimeHostKeyPolicy::RequireKnown
    );
    let error = external_target_not_available_error("external:missing").to_string();
    assert!(error.contains("外部 SSH 临时目标不存在或已关闭: request_hash="));
    assert!(!error.contains("external:missing"));

    assert!(is_managed_runtime_unwired(&AppError::SshCommand(
        "managed SSH runtime backend is not wired yet".to_owned()
    )));
    assert!(is_capability_unsupported(
        &AppError::SshCommand(MANAGED_SSH_SHELL_UNSUPPORTED.to_owned()),
        SshRuntimeCapability::Shell
    ));
    assert!(is_capability_unsupported(
        &AppError::SshCommand(MANAGED_SSH_EXEC_UNSUPPORTED.to_owned()),
        SshRuntimeCapability::Exec
    ));
    assert!(is_capability_unsupported(
        &AppError::Sftp(format!(
            "受管 SSH SFTP channel 失败: {MANAGED_SSH_SFTP_UNSUPPORTED}"
        )),
        SshRuntimeCapability::Sftp
    ));
    assert!(!is_managed_runtime_unwired(&AppError::SshCommand(
        "authentication failed after managed SSH runtime backend is not wired yet".to_owned()
    )));
    assert!(!is_capability_unsupported(
        &AppError::SshCommand(format!(
            "authentication failed: {MANAGED_SSH_EXEC_UNSUPPORTED}"
        )),
        SshRuntimeCapability::Exec
    ));
    assert!(!is_capability_unsupported(
        &AppError::Sftp(format!("远端返回未知错误: {MANAGED_SSH_SFTP_UNSUPPORTED}")),
        SshRuntimeCapability::Sftp
    ));
}

#[test]
fn runtime_policy_rejects_openssh_revoked_key_even_when_normally_known() {
    use russh::keys::{Algorithm, PrivateKey};

    let temp = tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate host key")
        .public_key()
        .clone();
    std::fs::write(
        &known_hosts,
        format!(
            "known.example {}\n@revoked *.example {}\n",
            key.to_openssh().expect("encode known key"),
            key.to_openssh().expect("encode revoked key")
        ),
    )
    .expect("write known_hosts");

    assert!(known_hosts_revokes_key(&key, &known_hosts));
}

#[test]
fn runtime_policy_keeps_channel_open_retry_narrow() {
    assert!(is_retryable_channel_open_error(&AppError::SshCommand(
        "Failed to open channel (ConnectFailed)".to_owned()
    )));
    assert!(is_retryable_channel_open_error(&AppError::SshCommand(
        "channel open failed before command".to_owned()
    )));
    assert!(!is_retryable_channel_open_error(&AppError::Credential(
        "bad credentials".to_owned()
    )));
    assert!(!is_retryable_channel_open_error(&AppError::SshCommand(
        "remote command exited with code 127".to_owned()
    )));
}

#[tokio::test]
async fn runtime_facade_wraps_manager_capability_lane_for_shell_exec_and_sftp() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_exec();
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let facade = SshRuntimeFacade::new(manager.clone());
    let context = SshRuntimeTargetContext::new(SshRuntimeConnectRequest::key_only(sample_key()))
        .with_lane(SshRuntimeSessionLane::Capability);

    let shell = facade
        .open_shell(
            &context,
            SshRuntimeShellRequest::new("xterm-256color", 120, 32),
        )
        .await
        .expect("open shell through facade");
    let shell_request = backend.shell_last_request().expect("shell request");
    assert_eq!(shell_request.cols, 120);
    assert_eq!(shell_request.rows, 32);

    let sftp = facade
        .open_sftp(&context)
        .await
        .expect("open sftp through facade");
    assert_eq!(backend.sftp_open_count(), 1);

    let exec_task = tokio::spawn({
        let facade = facade.clone();
        let context = context.clone();
        async move {
            facade
                .execute_exec(
                    &context,
                    SshRuntimeExecRequest::new("printf facade\\n".to_owned(), 5, 1024),
                )
                .await
        }
    });
    backend.wait_for_exec_start().await;
    backend.release_one_exec();
    let output = exec_task
        .await
        .expect("exec task")
        .expect("exec through facade");

    assert_eq!(output.stdout, "printf facade\\n");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);

    drop(shell);
    drop(sftp);
    let snapshot = facade.snapshot().expect("facade snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(
        snapshot.sessions[0].key.runtime_flags,
        vec![MANAGED_SSH_CAPABILITY_RUNTIME_FLAG]
    );
}

#[test]
fn native_channel_error_classification_preserves_shared_shell_for_channel_scoped_failures() {
    for message in [
        "无法打开 direct-tcpip 到 127.0.0.1:80: connection refused by remote host",
        "direct-tcpip 数据转发失败 127.0.0.1:80: early eof",
        "managed SSH SFTP channel failed: channel closed",
        "远端拒绝执行非交互命令请求",
    ] {
        let error = AppError::SshCommand(message.to_owned());

        assert!(
            !should_clear_native_connection_after_channel_error(&error),
            "{message}"
        );
    }
}

#[test]
fn native_channel_error_classification_clears_on_transport_breakage() {
    for message in [
        "write failed: broken pipe",
        "connection reset by peer",
        "connection lost while opening channel",
        "connection aborted by local socket",
        "Channel send error",
    ] {
        let error = AppError::SshCommand(message.to_owned());

        assert!(
            should_clear_native_connection_after_channel_error(&error),
            "{message}"
        );
    }
}

#[test]
fn runtime_failure_classification_covers_user_actionable_classes() {
    for (message, expected_class) in [
        (
            "user canceled authentication prompt",
            SshRuntimeFailureClass::AuthCanceled,
        ),
        (
            "Permission denied (publickey,password).",
            SshRuntimeFailureClass::BadCredential,
        ),
        (
            "encrypted private key requires passphrase",
            SshRuntimeFailureClass::KeyPassphraseMissing,
        ),
        ("Unknown server key", SshRuntimeFailureClass::UnknownHostKey),
        (
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
            SshRuntimeFailureClass::HostKeyChanged,
        ),
        (
            "stdio forwarding failed through jump host",
            SshRuntimeFailureClass::JumpFailed,
        ),
        ("connection timed out", SshRuntimeFailureClass::Timeout),
        (
            "managed SSH runtime backend does not support SFTP channels yet",
            SshRuntimeFailureClass::ChannelUnsupported,
        ),
        (
            "load key /tmp/id_rsa: Permission denied",
            SshRuntimeFailureClass::PermissionDenied,
        ),
        (
            "remote command exit code 127",
            SshRuntimeFailureClass::RemoteExit,
        ),
        ("remote command cancelled", SshRuntimeFailureClass::Canceled),
        (
            "cleanup failed while closing SSH",
            SshRuntimeFailureClass::CleanupFailed,
        ),
    ] {
        let failure = classify_ssh_runtime_failure(message);

        assert_eq!(failure.class, expected_class, "{message}");
        assert!(
            !failure.user_message.contains("连接失败"),
            "{message}: {}",
            failure.user_message
        );
        assert!(
            !failure.next_action.trim().is_empty(),
            "{message}: {:?}",
            failure
        );
    }
}

#[test]
fn runtime_failure_classification_redacts_session_only_secret_refs() {
    let failure = classify_ssh_runtime_app_error(&AppError::SshCommand(
        "Permission denied (publickey,password) external-secret:launch-secret-123 password=hunter2"
            .to_owned(),
    ));

    assert_eq!(failure.class, SshRuntimeFailureClass::BadCredential);
    assert!(!failure.sanitized_detail.contains("launch-secret-123"));
    assert!(!failure.sanitized_detail.contains("hunter2"));
    assert!(failure
        .sanitized_detail
        .contains("external-secret:<redacted>"));
    assert!(failure.sanitized_detail.contains("password=<redacted>"));
}
