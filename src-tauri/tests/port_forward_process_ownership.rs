//! 端口转发进程所有权回归测试。
//!
//! @author kongweiguang

mod support;

use std::{net::TcpListener, sync::Arc};

use kerminal_lib::{
    models::{
        port_forward::{PortForwardCreateRequest, PortForwardKind},
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
    },
    paths::KerminalPaths,
    services::{
        port_forward_service::PortForwardService, ssh_command_plan::CleanupPathOwner,
        ssh_runtime::ManagedSshSessionManager,
    },
    state::AppState,
};
use support::managed_ssh_runtime::FakeManagedSshRuntime;
use tempfile::tempdir;

#[test]
fn cleanup_path_owner_removes_openssh_identity_on_drop() {
    let directory = tempdir().unwrap();
    let identity = directory.path().join("identity-owned.key");
    std::fs::write(&identity, "private-key-test-fixture").unwrap();
    {
        let owner = CleanupPathOwner::new(vec![identity.clone()]);
        assert_eq!(owner.paths(), std::slice::from_ref(&identity));
        assert!(identity.exists());
    }
    assert!(!identity.exists());
}

#[test]
fn dropping_service_releases_all_managed_forward_channels() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let host_id = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create saved password host")
        .id;
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));

    {
        let service = PortForwardService::with_ssh_runtime(
            manager.clone(),
            state.ssh_auth_broker().clone(),
            state.external_session_materializer().clone(),
        );
        service
            .create_with_context(
                state.storage(),
                state.remote_hosts(),
                state.paths(),
                PortForwardCreateRequest {
                    bind_host: Some("127.0.0.1".to_owned()),
                    host_id,
                    kind: PortForwardKind::Local,
                    name: Some("drop-owned tunnel".to_owned()),
                    source_port: unused_local_port(),
                    target_host: Some("127.0.0.1".to_owned()),
                    target_port: Some(5432),
                    ..Default::default()
                },
            )
            .expect("create managed local forward");
        assert_eq!(manager.snapshot().unwrap().active_channels, 1);
    }

    assert_eq!(
        manager
            .snapshot()
            .expect("snapshot after service drop")
            .active_channels,
        0
    );
}

fn unused_local_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("bind unused local port")
        .local_addr()
        .expect("read unused local port")
        .port()
}
