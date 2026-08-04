// @author kongweiguang

use super::fixtures::*;

#[test]
fn list_restores_persisted_forward_as_exited_after_restart() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "dev".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: 22,
            username: "tester".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            ssh_options: Default::default(),
        })
        .expect("create remote host");
    state
        .storage()
        .upsert_port_forward_summary(&PortForwardSummary {
            id: "forward-restart-1".to_owned(),
            host_id: host.id,
            host_name: host.name,
            name: "网络助手".to_owned(),
            kind: PortForwardKind::Remote,
            origin: PortForwardOrigin::NetworkAssist,
            bind_host: "127.0.0.1".to_owned(),
            local_bind_host: Some("127.0.0.1".to_owned()),
            remote_bind_host: Some("127.0.0.1".to_owned()),
            source_port: 18080,
            target_host: Some("127.0.0.1".to_owned()),
            target_port: Some(18081),
            local_endpoint: Some(PortForwardEndpoint {
                host: "127.0.0.1".to_owned(),
                label: Some("本机 HTTP CONNECT 代理".to_owned()),
                port: Some(18081),
            }),
            remote_endpoint: None,
            proxy_protocol: Some(PortForwardProxyProtocol::Http),
            remote_access_scope: None,
            proxy_url: Some("http://127.0.0.1:18080".to_owned()),
            proxy_apply_scope: PortForwardProxyApplyScope::FutureTerminals,
            command_preview: "ssh -R 127.0.0.1:18080:127.0.0.1:18081 tester@127.0.0.1".to_owned(),
            last_error: None,
            runtime: None,
            pid: Some(4242),
            status: PortForwardStatus::Running,
            created_at: "1710000000".to_owned(),
        })
        .expect("persist port forward summary");
    let state_file = paths
        .root
        .join("data")
        .join("port-forwards")
        .join("sessions.json");
    let state_json = fs::read_to_string(&state_file).expect("read port forward state file");
    assert!(
        state_json.contains("forward-restart-1"),
        "port forward state should be file-backed"
    );
    drop(state);

    let state = AppState::initialize_with_paths(paths).expect("reinitialize app state");
    let summaries = state
        .port_forwards()
        .list(state.storage())
        .expect("list restored forwards");

    assert_eq!(summaries.len(), 1);
    let restored = &summaries[0];
    assert_eq!(restored.id, "forward-restart-1");
    assert_eq!(restored.status, PortForwardStatus::Exited);
    assert_eq!(restored.pid, None);
    assert_eq!(
        restored.last_error.as_deref(),
        Some("应用重启后隧道不会自动重连。")
    );
    let runtime = restored
        .runtime
        .as_ref()
        .expect("restored runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::Restored);
    assert_eq!(runtime.backend, "restored");
    assert_eq!(runtime.tunnel_kind, "legacyHttp");
    assert_eq!(runtime.cleanup_status, "restoredAfterAppRestart");
    assert_eq!(
        runtime.recent_failure.as_deref(),
        Some("应用重启后隧道不会自动重连。")
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), "forward-restart-1")
        .expect("stop restored forward"));
    let summaries = state
        .port_forwards()
        .list(state.storage())
        .expect("list after stop");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].status, PortForwardStatus::Exited);

    assert!(state
        .port_forwards()
        .delete(state.storage(), "forward-restart-1")
        .expect("delete restored forward"));
    assert!(state
        .port_forwards()
        .list(state.storage())
        .expect("list after delete")
        .is_empty());
}
