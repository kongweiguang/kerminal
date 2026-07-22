// @author kongweiguang

use std::time::Instant;

use super::fixtures::*;

#[test]
fn create_local_forward_with_native_runtime_proxies_bytes_over_direct_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip".to_owned()),
                source_port,
                target_host: Some(echo.addr.ip().to_string()),
                target_port: Some(echo.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local forward listener");
    client.write_all(payload).expect("write forward payload");
    let mut echoed = vec![0_u8; payload.len()];
    client.read_exact(&mut echoed).expect("read echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed local forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_local_forward_with_native_runtime_proxies_http_assets_over_direct_tcpip() {
    let http = HttpAssetServer::start(4);
    let ssh_server = LoopbackTerminalJumpServer::start(http.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback http forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip http assets".to_owned()),
                source_port,
                target_host: Some(http.addr.ip().to_string()),
                target_port: Some(http.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let paths = ["/", "/map.min.js", "/three.min.js", "/assets/index.css"];
    let clients = paths
        .into_iter()
        .map(|path| {
            thread::spawn(move || {
                let response = http_get_via_forward(source_port, path);
                assert!(
                    response.starts_with("HTTP/1.1 200 OK"),
                    "unexpected response for {path}: {response:?}"
                );
                assert!(
                    response.contains(&format!("asset:{path}:")),
                    "missing HTTP asset body for {path}: {response:?}"
                );
            })
        })
        .collect::<Vec<_>>();
    for client in clients {
        client.join().expect("HTTP asset client should finish");
    }

    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        4
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed local HTTP forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    http.join();
}

#[test]
fn local_forward_target_failure_keeps_cached_connection_alive() {
    let allowed_target = TcpListener::bind(("127.0.0.1", 0)).expect("bind allowed target marker");
    let allowed_addr = allowed_target
        .local_addr()
        .expect("read allowed target marker");
    let ssh_server = LoopbackTerminalJumpServer::start(allowed_addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback reconnect forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();
    let rejected_target_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip reconnect".to_owned()),
                source_port,
                target_host: Some(allowed_addr.ip().to_string()),
                target_port: Some(rejected_target_port),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    trigger_local_forward_attempt(source_port);
    wait_for_atomic_count(&ssh_server.auth_attempts, 1);
    let deadline = Instant::now() + Duration::from_secs(5);
    let failed_summary = loop {
        let summary = state
            .port_forwards()
            .list(state.storage())
            .expect("list native managed forwards")
            .into_iter()
            .find(|candidate| candidate.id == summary.id)
            .expect("failed forward summary");
        if summary
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.recent_failure.as_ref())
            .is_some()
        {
            break summary;
        }
        assert!(
            Instant::now() < deadline,
            "direct-tcpip failure should become observable"
        );
        thread::sleep(Duration::from_millis(20));
    };

    assert_eq!(failed_summary.status, PortForwardStatus::Running);
    let recent_failure = failed_summary
        .runtime
        .as_ref()
        .and_then(|runtime| runtime.recent_failure.as_deref())
        .expect("recent direct-tcpip failure");
    assert!(recent_failure.contains("direct-tcpip"));
    assert_eq!(failed_summary.last_error.as_deref(), Some(recent_failure));

    trigger_local_forward_attempt(source_port);
    thread::sleep(Duration::from_millis(200));

    assert_eq!(
        ssh_server
            .auth_attempts
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed reconnect forward"));
}

#[test]
fn create_dynamic_forward_with_native_runtime_proxies_socks5_over_direct_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback dynamic forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Dynamic,
                name: Some("native socks direct-tcpip".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create native managed dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-socks-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect dynamic forward listener");
    socks5_connect(&mut client, echo.addr);
    client.write_all(payload).expect("write socks payload");
    let mut echoed = vec![0_u8; payload.len()];
    client
        .read_exact(&mut echoed)
        .expect("read socks echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed dynamic forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_remote_forward_with_native_runtime_proxies_bytes_over_forwarded_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback remote forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host.id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("native forwarded-tcpip".to_owned()),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                target_host: Some(echo.addr.ip().to_string()),
                target_port: Some(echo.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed remote forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-remote-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect remote forward listener");
    client.write_all(payload).expect("write forward payload");
    let mut echoed = vec![0_u8; payload.len()];
    client.read_exact(&mut echoed).expect("read echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .forwarded_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed remote forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_remote_dynamic_socks5_with_native_runtime_proxies_bytes() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback remote dynamic forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host.id.clone(),
                kind: PortForwardKind::RemoteDynamic,
                name: Some("native remote dynamic socks".to_owned()),
                origin: PortForwardOrigin::User,
                proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create native managed remote dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    assert_eq!(summary.target_host, None);
    assert_eq!(summary.target_port, None);

    let payload = b"kerminal-managed-remote-dynamic-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect remote dynamic listener");
    socks5_connect(&mut client, echo.addr);
    client
        .write_all(payload)
        .expect("write remote dynamic payload");
    let mut echoed = vec![0_u8; payload.len()];
    client
        .read_exact(&mut echoed)
        .expect("read remote dynamic echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .forwarded_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed remote dynamic forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}
