//! 远程主机服务集成测试。
//!
//! @author kongweiguang

use std::{
    fs,
    sync::{Arc, Barrier},
    thread,
};

use kerminal_lib::{
    error::AppError,
    models::remote_host::{
        build_vault_secret_ref, RemoteHostAuthType, RemoteHostCreateRequest,
        RemoteHostCredentialRevealStatus, RemoteHostCredentialStatus, RemoteHostGroupCreateRequest,
        RemoteHostGroupUpdateRequest, RemoteHostProtocol, RemoteHostUpdateRequest,
        SshJumpHostOptions, SshOptions, SshProxyProtocol, SshTunnelKind, SshTunnelOptions,
    },
    paths::KerminalPaths,
    state::AppState,
    storage::file_store::FileStore,
};
use tempfile::{tempdir, TempDir};

#[path = "remote_host_service/group_and_protocol.rs"]
mod group_and_protocol;

#[test]
fn initialization_starts_without_remote_host_groups() {
    let (_home, state) = test_state();

    let tree = state.remote_hosts().list_tree().expect("list host tree");

    assert!(tree.is_empty());
}

#[test]
fn concurrent_group_creates_do_not_lose_updates() {
    const WORKERS: usize = 8;
    let (_home, state) = test_state();
    let service = state.remote_hosts().clone();
    let barrier = Arc::new(Barrier::new(WORKERS));
    let workers = (0..WORKERS)
        .map(|index| {
            let service = service.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                service
                    .create_group(RemoteHostGroupCreateRequest {
                        name: format!("并发分组-{index}"),
                    })
                    .expect("create group")
            })
        })
        .collect::<Vec<_>>();

    let mut created = workers
        .into_iter()
        .map(|worker| worker.join().expect("join group worker"))
        .collect::<Vec<_>>();
    created.sort_by_key(|group| group.sort_order);
    let persisted = service.list_groups().expect("list persisted groups");

    assert_eq!(created.len(), WORKERS);
    assert_eq!(persisted.len(), WORKERS);
    assert_eq!(
        created
            .iter()
            .map(|group| group.sort_order)
            .collect::<Vec<_>>(),
        (1..=WORKERS)
            .map(|index| (index as i64) * 10)
            .collect::<Vec<_>>()
    );
    for group in created {
        assert!(persisted.iter().any(|candidate| candidate.id == group.id));
    }
}

#[test]
fn create_host_persists_tags_private_key_path_and_production_flag() {
    let (_home, state) = test_state();
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "实验室".to_owned(),
        })
        .expect("create group");

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: Some(group.id.clone()),
            name: "armbian x2".to_owned(),
            host: "192.168.1.253".to_owned(),
            port: 22,
            username: "root".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Key,
            credential_ref: Some("/home/root/.ssh/armbian".to_owned()),
            credential_secret: None,
            tags: vec![" lab ".to_owned(), "LAB".to_owned(), "arm".to_owned()],
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create host");

    assert_eq!(host.group_id.as_deref(), Some(group.id.as_str()));
    assert_eq!(host.host, "192.168.1.253");
    assert_eq!(host.port, 22);
    assert_eq!(host.auth_type, RemoteHostAuthType::Key);
    assert_eq!(
        host.credential_ref.as_deref(),
        Some("/home/root/.ssh/armbian")
    );
    assert_eq!(host.tags, vec!["lab", "arm"]);
    assert!(!host.production);

    let tree = state.remote_hosts().list_tree().expect("list host tree");
    let lab = tree
        .iter()
        .find(|candidate| candidate.id == group.id)
        .expect("find lab group");
    assert_eq!(lab.hosts.len(), 1);
}

#[test]
fn create_sftp_host_persists_v2_protocol_and_vault_boundary() {
    let (home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "upload only".to_owned(),
            host: "files.internal".to_owned(),
            port: 22,
            username: "upload".to_owned(),
            protocol: RemoteHostProtocol::Sftp,
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("fixture-password".to_owned()),
            tags: vec!["files".to_owned()],
            production: true,
            ssh_options: Default::default(),
        })
        .expect("create SFTP host");

    assert_eq!(host.protocol, RemoteHostProtocol::Sftp);
    assert!(host.credential_secret.is_none());
    let config_root = KerminalPaths::from_home_dir(home.path()).root;
    let source = fs::read_to_string(config_root.join("hosts").join(format!("{}.toml", host.id)))
        .expect("read SFTP host config");
    assert!(source.contains("schema_version = 2"));
    assert!(source.contains("protocol = \"sftp\""));
    assert!(!source.contains("fixture-password"));
}

#[test]
fn sftp_username_requirement_cannot_be_bypassed_with_unrelated_protocol_label() {
    let (_home, state) = test_state();
    let error = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "files only".to_owned(),
            host: "files.internal".to_owned(),
            port: 22,
            username: "".to_owned(),
            protocol: RemoteHostProtocol::Sftp,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["rdp".to_owned()],
            production: false,
            ssh_options: SshOptions::default(),
        })
        .expect_err("SFTP username must remain required");

    assert!(error.to_string().contains("用户名不能为空"));
}

#[test]
fn protocol_tags_are_plain_labels_and_do_not_override_explicit_protocol() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "remote desktop".to_owned(),
            host: "desktop.internal".to_owned(),
            port: 3389,
            username: "desktop-user".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["rdp".to_owned()],
            production: false,
            ssh_options: SshOptions::default(),
        })
        .expect("create RDP host");
    let reloaded = state
        .remote_hosts()
        .host_by_id(&host.id)
        .expect("reload RDP host")
        .expect("RDP host exists");

    assert_eq!(reloaded.protocol, RemoteHostProtocol::Ssh);
    assert!(reloaded.tags.iter().any(|tag| tag == "rdp"));
}

#[test]
fn create_request_rejects_missing_protocol_at_ipc_boundary() {
    let request = serde_json::json!({
        "name": "missing protocol",
        "host": "host.internal",
        "port": 22,
        "username": "deploy",
        "authType": "agent",
        "credentialRef": null
    });

    let error = serde_json::from_value::<RemoteHostCreateRequest>(request)
        .expect_err("protocol is required");
    assert!(error.to_string().contains("protocol"));

    let update = serde_json::json!({
        "id": "host-id",
        "name": "missing protocol",
        "host": "host.internal",
        "port": 22,
        "username": "deploy",
        "authType": "agent",
        "credentialRef": null,
        "sortOrder": 10
    });
    let error = serde_json::from_value::<RemoteHostUpdateRequest>(update)
        .expect_err("update protocol is required");
    assert!(error.to_string().contains("protocol"));
}

#[test]
fn update_host_rejects_protocol_change() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "ssh host".to_owned(),
            host: "ssh.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create SSH host");

    let error = state
        .remote_hosts()
        .update_host(RemoteHostUpdateRequest {
            id: host.id,
            group_id: host.group_id,
            name: host.name,
            host: host.host,
            port: host.port,
            username: host.username,
            protocol: RemoteHostProtocol::Sftp,
            auth_type: host.auth_type,
            credential_ref: host.credential_ref,
            credential_secret: None,
            tags: host.tags,
            production: host.production,
            ssh_options: host.ssh_options,
            sort_order: host.sort_order,
        })
        .expect_err("protocol change must fail");

    assert!(error.to_string().contains("不能直接更改协议"));
}

#[test]
fn create_password_host_writes_encrypted_vault_ref() {
    let (home, state) = test_state();

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "password host".to_owned(),
            host: "password.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("s3cr3t".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create password host");

    assert_eq!(host.credential_ref, None);
    assert_eq!(host.credential_secret, None);
    assert_eq!(
        host.secret_ref.as_deref(),
        Some(build_vault_secret_ref("ssh-host", &host.id, "target", "password").as_str())
    );
    assert_eq!(host.credential_status, RemoteHostCredentialStatus::Vault);

    let reloaded = state
        .remote_hosts()
        .host_by_id(&host.id)
        .expect("load host")
        .expect("host exists");
    assert_eq!(reloaded.credential_secret, None);
    assert_eq!(reloaded.secret_ref, host.secret_ref);
    assert_eq!(
        reloaded.credential_status,
        RemoteHostCredentialStatus::Vault
    );

    let config_root = KerminalPaths::from_home_dir(home.path()).root;
    let host_toml = fs::read_to_string(config_root.join("hosts").join(format!("{}.toml", host.id)))
        .expect("read public host toml");
    assert!(!host_toml.contains("credential_secret"));
    assert!(!host_toml.contains("credentialSecret"));
    assert!(!host_toml.contains("s3cr3t"));
    assert!(host_toml.contains("secret_ref"));

    assert!(!config_root
        .join("secrets")
        .join("hosts")
        .join(format!("{}.toml", host.id))
        .exists());

    let vault_toml = fs::read_to_string(config_root.join("secrets").join("vault.toml"))
        .expect("read vault toml");
    assert!(vault_toml.contains("credential:kerminal:ssh-host"));
    assert!(!vault_toml.contains("s3cr3t"));

    let manifest = FileStore::new(&config_root)
        .read_storage_manifest()
        .expect("read storage manifest");
    let change_set = manifest
        .last_applied_change_set_id
        .as_deref()
        .and_then(|id| manifest.change_set(id))
        .expect("host credential change set");
    assert!(change_set
        .touched_files
        .contains(&format!("hosts/{}.toml", host.id)));
    assert!(change_set
        .touched_files
        .contains(&"secrets/vault.toml".to_owned()));
}

#[test]
fn create_rdp_password_host_writes_rdp_vault_ref() {
    let (home, state) = test_state();

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "office rdp".to_owned(),
            host: "rdp.internal".to_owned(),
            port: 3389,
            username: "administrator".to_owned(),
            protocol: RemoteHostProtocol::Rdp,
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("rdp-secret".to_owned()),
            tags: vec!["rdp".to_owned()],
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create rdp host");

    assert_eq!(
        host.secret_ref.as_deref(),
        Some(build_vault_secret_ref("rdp-host", &host.id, "target", "password").as_str())
    );
    assert_eq!(host.credential_status, RemoteHostCredentialStatus::Vault);

    let config_root = KerminalPaths::from_home_dir(home.path()).root;
    let vault_toml = fs::read_to_string(config_root.join("secrets").join("vault.toml"))
        .expect("read vault toml");
    assert!(vault_toml.contains("credential:kerminal:rdp-host"));
    assert!(!vault_toml.contains("rdp-secret"));
}

#[test]
fn update_ssh_host_keeps_explicit_protocol_and_vault_ref_when_tags_change() {
    let (_home, state) = test_state();

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "ssh password host".to_owned(),
            host: "rdp.internal".to_owned(),
            port: 22,
            username: "administrator".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("ssh-secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create ssh password host");
    assert_eq!(
        host.secret_ref.as_deref(),
        Some(build_vault_secret_ref("ssh-host", &host.id, "target", "password").as_str())
    );

    let updated = state
        .remote_hosts()
        .update_host(RemoteHostUpdateRequest {
            id: host.id.clone(),
            group_id: None,
            name: "office rdp".to_owned(),
            host: "rdp.internal".to_owned(),
            port: 3389,
            username: "administrator".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["rdp".to_owned()],
            production: false,
            ssh_options: Default::default(),
            sort_order: host.sort_order,
        })
        .expect("ordinary RDP tag must not switch an existing SSH host protocol");

    assert_eq!(updated.protocol, RemoteHostProtocol::Ssh);
    assert_eq!(updated.secret_ref, host.secret_ref);
}

#[test]
fn reveal_password_host_credential_returns_vault_secret_without_exposing_tree() {
    let (_home, state) = test_state();

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "password host".to_owned(),
            host: "password.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("edit-form-secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create password host");

    let reveal = state
        .remote_hosts()
        .reveal_host_credential(&host.id)
        .expect("reveal saved credential");

    assert_eq!(reveal.host_id, host.id);
    assert_eq!(reveal.auth_type, RemoteHostAuthType::Password);
    assert_eq!(reveal.status, RemoteHostCredentialRevealStatus::Available);
    assert_eq!(
        reveal.credential_secret.as_deref(),
        Some("edit-form-secret")
    );
    assert_eq!(reveal.message, None);

    let tree = state.remote_hosts().list_tree().expect("list host tree");
    let listed_host = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|item| item.id == host.id)
        .unwrap();
    assert_eq!(listed_host.credential_secret, None);
    assert_eq!(listed_host.secret_ref, host.secret_ref);
    assert_eq!(
        listed_host.credential_status,
        RemoteHostCredentialStatus::Vault
    );
}

#[test]
fn reveal_non_secret_host_credentials_returns_status_without_secret() {
    let (_home, state) = test_state();

    let key_host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "key path host".to_owned(),
            host: "key.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Key,
            credential_ref: Some("/home/deploy/.ssh/id_ed25519".to_owned()),
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create key path host");
    let agent_host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "agent host".to_owned(),
            host: "agent.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: RemoteHostProtocol::Ssh,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create agent host");

    let key_reveal = state
        .remote_hosts()
        .reveal_host_credential(&key_host.id)
        .expect("reveal key status");
    let agent_reveal = state
        .remote_hosts()
        .reveal_host_credential(&agent_host.id)
        .expect("reveal agent status");

    assert_eq!(
        key_reveal.status,
        RemoteHostCredentialRevealStatus::ConfigPath
    );
    assert_eq!(key_reveal.credential_secret, None);
    assert_eq!(agent_reveal.status, RemoteHostCredentialRevealStatus::Agent);
    assert_eq!(agent_reveal.credential_secret, None);
}

#[test]
fn create_host_persists_ssh_options() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.proxy.protocol = SshProxyProtocol::Socks5;
    ssh_options.proxy.host = Some("proxy.internal".to_owned());
    ssh_options.proxy.port = Some(1080);
    ssh_options.proxy.username = Some("proxy-user".to_owned());
    ssh_options.tunnels.push(SshTunnelOptions {
        name: "db".to_owned(),
        kind: SshTunnelKind::Local,
        bind_host: "127.0.0.1".to_owned(),
        bind_port: Some(15432),
        target_host: "db.internal".to_owned(),
        target_port: Some(5432),
    });
    ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "bastion".to_owned(),
        host: "bastion.internal".to_owned(),
        port: 22,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Key,
        credential_ref: Some("/home/ops/.ssh/bastion".to_owned()),
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
    });
    ssh_options.terminal.connect_timeout_seconds = 45;
    ssh_options.terminal.keepalive_seconds = 30;
    ssh_options.terminal.startup_command = "cd /srv/app".to_owned();
    ssh_options.transfer.remote_start_directory = "/srv/app".to_owned();

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "prod-like ssh".to_owned(),
            host: "app.internal".to_owned(),
            port: 2222,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Key,
            credential_ref: Some("/home/deploy/.ssh/id_ed25519".to_owned()),
            credential_secret: None,
            tags: vec!["app".to_owned()],
            production: false,
            ssh_options: ssh_options.clone(),
        })
        .expect("create host with ssh options");

    let mut expected_options = ssh_options.clone();
    expected_options.proxy.credential_ref = None;
    assert_eq!(host.ssh_options, expected_options);

    let reloaded = state
        .remote_hosts()
        .host_by_id(&host.id)
        .expect("load host")
        .expect("host exists");
    assert_eq!(reloaded.ssh_options, expected_options);
}

#[test]
fn update_key_host_saves_inline_private_key_into_vault() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "key host".to_owned(),
            host: "key.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Key,
            credential_ref: Some("/home/deploy/.ssh/id_ed25519".to_owned()),
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create key host");

    let updated = state
        .remote_hosts()
        .update_host(RemoteHostUpdateRequest {
            id: host.id,
            group_id: None,
            name: "key host".to_owned(),
            host: "key.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Key,
            credential_ref: None,
            credential_secret: Some("-----BEGIN OPENSSH PRIVATE KEY-----\n...\n".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: host.sort_order,
        })
        .expect("update key host");

    assert_eq!(updated.credential_ref, None);
    assert_eq!(updated.credential_secret, None);
    assert_eq!(
        updated.secret_ref.as_deref(),
        Some(build_vault_secret_ref("ssh-host", &updated.id, "target", "private-key").as_str())
    );
    assert_eq!(updated.credential_status, RemoteHostCredentialStatus::Vault);
}

#[test]
fn update_group_and_host_persist_changes() {
    let (_home, state) = test_state();
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "旧分组".to_owned(),
        })
        .expect("create group");
    let updated_group = state
        .remote_hosts()
        .update_group(RemoteHostGroupUpdateRequest {
            id: group.id.clone(),
            name: "开发服务器".to_owned(),
            sort_order: group.sort_order,
        })
        .expect("update group");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: Some(updated_group.id.clone()),
            name: "dev".to_owned(),
            host: "dev.internal".to_owned(),
            port: 22,
            username: "ubuntu".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["dev".to_owned()],
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create host");

    let updated_host = state
        .remote_hosts()
        .update_host(RemoteHostUpdateRequest {
            id: host.id,
            group_id: Some(updated_group.id),
            name: "dev api".to_owned(),
            host: "api.dev.internal".to_owned(),
            port: 2222,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("updated-password".to_owned()),
            tags: vec!["dev".to_owned(), "api".to_owned()],
            production: true,
            ssh_options: Default::default(),
            sort_order: host.sort_order,
        })
        .expect("update host");

    assert_eq!(updated_group.name, "开发服务器");
    assert_eq!(updated_host.name, "dev api");
    assert_eq!(updated_host.port, 2222);
    assert_eq!(updated_host.username, "deploy");
    assert_eq!(updated_host.auth_type, RemoteHostAuthType::Password);
    assert_eq!(updated_host.credential_secret, None);
    assert_eq!(
        updated_host.credential_status,
        RemoteHostCredentialStatus::Vault
    );
    assert_eq!(
        updated_host.secret_ref.as_deref(),
        Some(build_vault_secret_ref("ssh-host", &updated_host.id, "target", "password").as_str())
    );
    assert!(updated_host.production);
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
