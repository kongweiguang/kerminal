//! 远程主机私钥口令安全持久化集成测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::remote_host::{
        build_vault_secret_ref, RemoteHost, RemoteHostAuthType, RemoteHostCreateInput,
        RemoteHostCreateRequest, RemoteHostProtocol, RemoteHostUpdateInput,
        RemoteHostUpdateRequest,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        ssh_credential_resolver::{ResolvedSshAuthMaterial, SshCredentialResolver},
    },
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn key_passphrase_is_encrypted_revealed_replaced_preserved_and_cleared() {
    let (home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host_with_input(RemoteHostCreateInput {
            request: key_host_create_request(),
            clear_key_passphrase: false,
            key_passphrase_secret: Some(" key passphrase ".to_owned()),
        })
        .expect("create encrypted key host");
    let passphrase_ref = build_vault_secret_ref("ssh-host", &host.id, "target", "key-passphrase");

    assert_eq!(
        host.key_passphrase_ref.as_deref(),
        Some(passphrase_ref.as_str())
    );
    assert_eq!(host.key_passphrase_secret, None);
    let resolved = SshCredentialResolver::new(EncryptedVaultService::new(
        KerminalPaths::from_home_dir(home.path()),
    ))
    .resolve_host(&host)
    .expect("resolve saved key passphrase for SSH runtimes");
    let ResolvedSshAuthMaterial::PrivateKeyPath { passphrase, .. } = resolved.target.material
    else {
        panic!("expected private key path material");
    };
    assert_eq!(
        passphrase.map(|value| value.value).as_deref(),
        Some(" key passphrase ")
    );
    let reveal = state
        .remote_hosts()
        .reveal_host_credential(&host.id)
        .expect("reveal key passphrase");
    assert_eq!(
        reveal.key_passphrase_secret.as_deref(),
        Some(" key passphrase ")
    );

    let config_root = KerminalPaths::from_home_dir(home.path()).root;
    let host_toml = fs::read_to_string(config_root.join("hosts").join(format!("{}.toml", host.id)))
        .expect("read key host toml");
    assert!(host_toml.contains("key_passphrase_ref"));
    assert!(!host_toml.contains("key_passphrase_secret"));
    assert!(!host_toml.contains(" key passphrase "));
    let vault_toml = fs::read_to_string(config_root.join("secrets").join("vault.toml"))
        .expect("read key passphrase vault");
    assert!(vault_toml.contains(&passphrase_ref));
    assert!(!vault_toml.contains(" key passphrase "));

    let preserved = state
        .remote_hosts()
        .update_host_with_input(RemoteHostUpdateInput {
            request: update_request_from_host(&host),
            clear_key_passphrase: false,
            key_passphrase_secret: None,
        })
        .expect("preserve key passphrase");
    assert_eq!(
        preserved.key_passphrase_ref.as_deref(),
        Some(passphrase_ref.as_str())
    );

    let replaced = state
        .remote_hosts()
        .update_host_with_input(RemoteHostUpdateInput {
            request: update_request_from_host(&preserved),
            clear_key_passphrase: false,
            key_passphrase_secret: Some("   ".to_owned()),
        })
        .expect("replace key passphrase");
    let reveal = state
        .remote_hosts()
        .reveal_host_credential(&replaced.id)
        .expect("reveal whitespace-only replacement passphrase");
    assert_eq!(reveal.key_passphrase_secret.as_deref(), Some("   "));

    let cleared = state
        .remote_hosts()
        .update_host_with_input(RemoteHostUpdateInput {
            request: update_request_from_host(&replaced),
            clear_key_passphrase: true,
            key_passphrase_secret: None,
        })
        .expect("clear key passphrase");
    assert_eq!(cleared.key_passphrase_ref, None);
    assert_eq!(
        EncryptedVaultService::new(KerminalPaths::from_home_dir(home.path()))
            .entry_by_id(&passphrase_ref)
            .expect("read passphrase entry"),
        None
    );
}

#[test]
fn key_passphrase_rejects_non_key_auth_and_conflicting_clear_intent() {
    let (_home, state) = test_state();
    let mut password_request = key_host_create_request();
    password_request.name = "password host".to_owned();
    password_request.host = "password.internal".to_owned();
    password_request.auth_type = RemoteHostAuthType::Password;
    password_request.credential_ref = None;
    password_request.credential_secret = Some("password".to_owned());
    let password_error = state
        .remote_hosts()
        .create_host_with_input(RemoteHostCreateInput {
            request: password_request,
            clear_key_passphrase: false,
            key_passphrase_secret: Some("unexpected passphrase".to_owned()),
        })
        .expect_err("password auth must reject key passphrase");
    assert!(password_error.to_string().contains("只有私钥认证"));

    let key_host = state
        .remote_hosts()
        .create_host(key_host_create_request())
        .expect("create key host");
    let conflict_error = state
        .remote_hosts()
        .update_host_with_input(RemoteHostUpdateInput {
            request: update_request_from_host(&key_host),
            clear_key_passphrase: true,
            key_passphrase_secret: Some("replacement".to_owned()),
        })
        .expect_err("replace and clear must conflict");
    assert!(conflict_error.to_string().contains("同时替换和清空"));
}

fn key_host_create_request() -> RemoteHostCreateRequest {
    RemoteHostCreateRequest {
        group_id: None,
        name: "key host".to_owned(),
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
    }
}

fn update_request_from_host(host: &RemoteHost) -> RemoteHostUpdateRequest {
    RemoteHostUpdateRequest {
        id: host.id.clone(),
        group_id: host.group_id.clone(),
        name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        protocol: host.protocol,
        auth_type: host.auth_type,
        credential_ref: host.credential_ref.clone(),
        credential_secret: None,
        tags: host.tags.clone(),
        production: host.production,
        ssh_options: host.ssh_options.clone(),
        sort_order: host.sort_order,
    }
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
