use super::fixtures::*;

#[test]
fn create_forward_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .port_forwards()
        .create(
            state.storage(),
            state.remote_hosts(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: "missing-host".to_owned(),
                kind: PortForwardKind::Local,
                name: Some("missing".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn create_forward_missing_external_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .port_forwards()
        .create(
            state.storage(),
            state.remote_hosts(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: "external:missing-launch".to_owned(),
                kind: PortForwardKind::Local,
                name: Some("missing external".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(80),
                ..Default::default()
            },
        )
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}

#[test]
fn create_local_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host_id.clone(),
                kind: PortForwardKind::Local,
                name: Some("managed local tunnel".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("create managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.backend, "native-russh");
    assert_eq!(runtime.tunnel_kind, "local");
    assert_eq!(runtime.cleanup_status, "active");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::DirectTcpIp.as_str())
    );
    assert_eq!(
        runtime.managed_tunnel_id.as_deref(),
        Some("fake-managed-forward")
    );
    assert!(runtime
        .managed_session_id
        .as_deref()
        .is_some_and(|session_id| !session_id.is_empty()));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.local_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_local_forward_request(),
        Some(SshRuntimeLocalForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            5432
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::DirectTcpIp),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed local forward"));
    let stopped = service
        .get(state.storage(), &summary.id)
        .expect("read stopped summary")
        .expect("stopped summary");
    assert_eq!(stopped.status, PortForwardStatus::Exited);
    assert_eq!(stopped.pid, None);
    assert_eq!(
        stopped
            .runtime
            .as_ref()
            .expect("stopped runtime diagnostics")
            .cleanup_status,
        "stopped"
    );
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_external_local_forward_uses_interactive_runtime_lane() {
    let (_home, state) = test_state();
    let launch_id = queue_putty_external_password_launch(&state, 2222);
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending external launch");
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
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: target.host_id,
                kind: PortForwardKind::Local,
                name: Some("external managed local tunnel".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(80),
                ..Default::default()
            },
        )
        .expect("create external managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.local_forward_count(), 1);
    assert_eq!(
        backend.last_local_forward_request(),
        Some(SshRuntimeLocalForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            80
        ))
    );
    let key = backend.last_key().expect("runtime key");
    assert!(key
        .runtime_flags
        .is_empty(), "external port forward should use the same interactive managed runtime lane as the terminal");
    let snapshot = manager.snapshot().expect("managed snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].key.runtime_flags, key.runtime_flags);

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop external managed local forward"));
}

#[test]
fn create_remote_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("managed remote tunnel".to_owned()),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("create managed remote forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.backend, "native-russh");
    assert_eq!(runtime.tunnel_kind, "remote");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::ForwardListener.as_str())
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.remote_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_remote_forward_request(),
        Some(SshRuntimeRemoteForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            5432
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::ForwardListener),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed remote forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_http_network_assist_is_rejected() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(backend);
    let service = PortForwardService::with_ssh_runtime(
        manager,
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let error = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("removed HTTP network assist".to_owned()),
                origin: PortForwardOrigin::NetworkAssist,
                proxy_protocol: Some(PortForwardProxyProtocol::Http),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect_err("HTTP network assist should be rejected");

    assert!(error.to_string().contains("HTTP 网络助手已移除"));
}

#[test]
fn create_remote_dynamic_socks5_prefers_managed_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::RemoteDynamic,
                name: Some("managed remote SOCKS".to_owned()),
                origin: PortForwardOrigin::NetworkAssist,
                proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create managed host network assist socks forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.tunnel_kind, "remoteDynamic");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::ForwardListener.as_str())
    );
    assert_eq!(summary.origin, PortForwardOrigin::NetworkAssist);
    assert_eq!(
        summary.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(summary.target_host, None);
    assert_eq!(summary.target_port, None);
    assert_eq!(
        summary.proxy_url,
        Some(format!("socks5h://127.0.0.1:{source_port}"))
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.remote_dynamic_forward_count(), 1);
    assert_eq!(backend.remote_forward_count(), 0);
    assert_eq!(backend.local_forward_count(), 0);
    assert_eq!(backend.dynamic_forward_count(), 0);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_remote_dynamic_forward_request(),
        Some(SshRuntimeRemoteDynamicForwardRequest::new(
            "127.0.0.1",
            source_port
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::ForwardListener),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed host network assist socks forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_dynamic_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host_id.clone(),
                kind: PortForwardKind::Dynamic,
                name: Some("managed socks tunnel".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create managed dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.tunnel_kind, "dynamic");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::DirectTcpIp.as_str())
    );
    assert_eq!(
        summary.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.dynamic_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_dynamic_forward_request(),
        Some(SshRuntimeDynamicForwardRequest::new(
            "127.0.0.1",
            source_port
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::DirectTcpIp),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed dynamic forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}
