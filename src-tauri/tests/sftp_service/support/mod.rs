//! SFTP integration test support.
//!
//! @author kongweiguang

pub(crate) mod loopback;

use kerminal_lib::{
    models::remote_host::{RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, SshOptions},
    paths::KerminalPaths,
    state::AppState,
    storage::config_file_store::ConfigFileStore,
};
use tempfile::{tempdir, TempDir};
use uuid::Uuid;

pub(crate) fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub(crate) fn create_password_remote_host(state: &AppState, name: &str, port: u16) -> String {
    create_password_remote_host_with_options(state, name, port, SshOptions::default())
}

pub(crate) fn create_password_remote_host_without_credentials(
    state: &AppState,
    name: &str,
    port: u16,
) -> String {
    let host = RemoteHost {
        id: Uuid::new_v4().to_string(),
        group_id: None,
        name: name.to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: vec!["loopback".to_owned()],
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    };
    ConfigFileStore::new(state.paths().root.clone())
        .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
        .expect("write loopback remote host without credentials");
    host.id
}

pub(crate) fn create_password_remote_host_with_options(
    state: &AppState,
    name: &str,
    port: u16,
    ssh_options: SshOptions,
) -> String {
    create_password_remote_host_with_credentials(state, name, port, "deploy", "secret", ssh_options)
}

pub(crate) fn create_password_remote_host_with_credentials(
    state: &AppState,
    name: &str,
    port: u16,
    username: &str,
    password: &str,
    ssh_options: SshOptions,
) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(password.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: name.to_owned(),
            port,
            ssh_options,
            tags: vec!["loopback".to_owned()],
            username: username.to_owned(),
            protocol: Default::default(),
        })
        .expect("create loopback remote host")
        .id
}
