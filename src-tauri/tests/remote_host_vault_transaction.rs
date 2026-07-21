//! 远程主机与 vault 事务边界集成测试。
//!
//! @author kongweiguang

use std::{fs, thread, time::Duration};

use kerminal_lib::{
    models::remote_host::{
        RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostCredentialStatus,
        RemoteHostUpdateRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn corrupt_vault_is_never_replaced_by_empty_snapshot_after_host_create_failure() {
    let (home, state) = test_state();
    let paths = KerminalPaths::from_home_dir(home.path());
    let corrupt_source = "this is not valid vault toml\n";
    fs::create_dir_all(&paths.secrets).expect("create secrets");
    fs::write(paths.vault_file(), corrupt_source).expect("seed corrupt vault");

    let error = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "corrupt vault host".to_owned(),
            host: "corrupt-vault.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("must-not-persist".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect_err("corrupt vault must fail closed");

    assert!(error.to_string().contains("vault"));
    assert_eq!(
        fs::read_to_string(paths.vault_file()).expect("read corrupt vault after failure"),
        corrupt_source
    );
}

#[test]
fn agent_host_write_does_not_require_parsing_unused_vault_key() {
    let (home, state) = test_state();
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.secrets).expect("create secrets");
    fs::write(paths.vault_key_file(), "not valid key toml\n").expect("seed corrupt key");
    fs::write(paths.vault_file(), "not valid vault toml\n").expect("seed corrupt vault");

    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "agent host".to_owned(),
            host: "agent.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create agent host without reading key");

    assert_eq!(host.credential_status, RemoteHostCredentialStatus::Agent);
    assert_eq!(
        fs::read_to_string(paths.vault_key_file()).expect("read untouched key"),
        "not valid key toml\n"
    );
    assert_eq!(
        fs::read_to_string(paths.vault_file()).expect("read untouched vault"),
        "not valid vault toml\n"
    );
}

#[test]
fn corrupt_vault_error_is_not_misreported_as_missing_key() {
    let (home, state) = test_state();
    let paths = KerminalPaths::from_home_dir(home.path());
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "vault diagnostic host".to_owned(),
            host: "vault-diagnostic.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("synthetic-test-secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create password host");
    fs::write(paths.vault_file(), "not valid vault toml\n").expect("corrupt vault");

    let error = state
        .remote_hosts()
        .reveal_host_credential(&host.id)
        .expect_err("corrupt vault must be reported");
    let message = error.to_string();

    assert!(message.contains("vault TOML parse failed"));
    assert!(!message.contains("key is missing"));
}

#[test]
fn concurrent_delete_cannot_be_undone_by_update_from_stale_metadata() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "delete update race".to_owned(),
            host: "race.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create race host");
    let host_id = host.id.clone();
    let update_service = state.remote_hosts().clone();
    // 大量标签扩大“旧实现事务外读取 existing”与写入之间的窗口，使竞态可重复。
    let tags = (0..50_000)
        .map(|index| format!("race-tag-{index}"))
        .collect();
    let update = thread::spawn(move || {
        update_service.update_host(RemoteHostUpdateRequest {
            id: host.id,
            group_id: None,
            name: "updated after delete".to_owned(),
            host: host.host,
            port: host.port,
            username: host.username,
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags,
            production: false,
            ssh_options: host.ssh_options,
            sort_order: host.sort_order,
        })
    });
    thread::sleep(Duration::from_millis(25));

    assert!(state
        .remote_hosts()
        .delete_host(&host_id)
        .expect("delete host"));
    let _update_result = update.join().expect("join update");

    assert!(state
        .remote_hosts()
        .host_by_id(&host_id)
        .expect("read host after race")
        .is_none());
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
