//! 连接命令运行时规则集成测试。
//!
//! @author kongweiguang

#[cfg(target_os = "windows")]
use kerminal_lib::commands::connection::process::{
    run_bounded_process, shutdown_detached_clients, supervise_detached_client,
};
use kerminal_lib::{
    commands::connection::process::{cleanup_stale_artifacts, TemporaryArtifact},
    commands::connection::rules::{
        build_rdp_file_content, encrypted_rdp_password, format_rdp_full_address,
        remote_host_from_create_request, saved_rdp_password, test_tcp_endpoint,
    },
    models::{
        connection::{ConnectionTestRequest, RdpOpenRequest},
        remote_host::{
            build_vault_secret_ref, RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest,
            SshOptions,
        },
    },
    paths::KerminalPaths,
    services::encrypted_vault_service::EncryptedVaultService,
    state::AppState,
};
#[cfg(target_os = "windows")]
use std::process::Command;
use std::time::Duration;
use tempfile::tempdir;
use tokio::net::TcpListener;

#[test]
fn temporary_rdp_artifact_is_removed_on_drop() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("connection-owned.rdp");
    {
        let artifact = TemporaryArtifact::create(path.clone(), b"full address:s:test:3389")
            .expect("create temporary artifact");
        assert_eq!(artifact.path(), path);
        assert!(path.exists());
    }
    assert!(!path.exists());
}

#[test]
fn connection_test_wire_accepts_flat_key_passphrase_without_debug_leak() {
    let request: ConnectionTestRequest = serde_json::from_value(serde_json::json!({
        "mode": "ssh",
        "host": {
            "name": "key host",
            "host": "key.internal",
            "port": 22,
            "username": "deploy",
            "protocol": "ssh",
            "authType": "key",
            "credentialRef": "/home/deploy/.ssh/id_ed25519",
            "keyPassphraseSecret": "wire-key-passphrase",
            "tags": [],
            "sshOptions": SshOptions::default()
        }
    }))
    .expect("deserialize connection test request");

    let ConnectionTestRequest::Ssh { host } = &request else {
        panic!("expected SSH connection test request");
    };
    assert_eq!(
        host.key_passphrase_secret.as_deref(),
        Some("wire-key-passphrase")
    );
    assert!(!format!("{request:?}").contains("wire-key-passphrase"));
}

#[test]
fn stale_cleanup_removes_only_managed_rdp_artifacts() {
    let directory = tempdir().unwrap();
    let managed = directory.path().join("connection-stale.rdp");
    let unrelated = directory.path().join("user.rdp");
    std::fs::write(&managed, "managed").unwrap();
    std::fs::write(&unrelated, "user").unwrap();

    let removed =
        cleanup_stale_artifacts(directory.path(), "connection-", ".rdp", Duration::ZERO).unwrap();

    assert_eq!(removed, 1);
    assert!(!managed.exists());
    assert!(unrelated.exists());
}

#[cfg(target_os = "windows")]
#[test]
fn bounded_platform_process_is_killed_on_timeout_without_leaking_secret() {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 30",
    ]);
    let started = std::time::Instant::now();
    let error = run_bounded_process(
        &mut command,
        b"secret-must-not-appear",
        Duration::from_millis(100),
        "平台命令",
    )
    .expect_err("long-running process must time out");

    let message = error.to_string();
    assert!(message.contains("平台命令超时"));
    assert!(!message.contains("secret-must-not-appear"));
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[cfg(target_os = "windows")]
#[test]
fn detached_rdp_client_can_be_cancelled_and_joins_before_returning() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("connection-cancel.rdp");
    let artifact = TemporaryArtifact::create(path.clone(), b"rdp").unwrap();
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ])
        .spawn()
        .unwrap();
    supervise_detached_client(child, artifact, Duration::from_secs(30)).unwrap();

    let started = std::time::Instant::now();
    assert_eq!(shutdown_detached_clients().unwrap(), 1);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(!path.exists());
}

fn remote_host_request(tags: Vec<String>) -> RemoteHostCreateRequest {
    RemoteHostCreateRequest {
        group_id: None,
        name: "telnet-dev".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: 23,
        username: String::new(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Agent,
        credential_ref: None,
        credential_secret: None,
        tags,
        ssh_options: SshOptions::default(),
    }
}

fn rdp_host(
    credential_secret: Option<&str>,
    credential_ref: Option<&str>,
    secret_ref: Option<&str>,
    auth_type: RemoteHostAuthType,
) -> RemoteHost {
    RemoteHost {
        id: "rdp-1".to_owned(),
        group_id: None,
        name: "office-rdp".to_owned(),
        host: "rdp.internal".to_owned(),
        port: 3389,
        username: "administrator".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref: credential_ref.map(str::to_owned),
        secret_ref: secret_ref.map(str::to_owned),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: credential_secret.map(str::to_owned),
        credential_status: Default::default(),
        tags: vec!["rdp".to_owned()],
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

#[test]
fn formats_ipv6_full_address_for_rdp_file() {
    assert_eq!(
        format_rdp_full_address("2001:db8::10", 3389),
        "[2001:db8::10]:3389"
    );
}

#[test]
fn builds_rdp_content_with_core_fields() {
    let content = build_rdp_file_content(
        &RdpOpenRequest {
            desktop_height: Some(900),
            desktop_width: Some(1440),
            fullscreen: false,
            host: "rdp.internal".to_string(),
            name: "prod".to_string(),
            note: None,
            password: None,
            port: 3390,
            username: Some("administrator".to_string()),
        },
        Some("encrypted"),
    );

    assert!(content.contains("full address:s:rdp.internal:3390"));
    assert!(content.contains("username:s:administrator"));
    assert!(content.contains("desktopwidth:i:1440"));
    assert!(content.contains("password 51:b:encrypted"));
    assert!(content.contains("prompt for credentials:i:0"));
}

#[cfg(target_os = "windows")]
#[test]
fn encrypted_rdp_password_accepts_shell_sensitive_characters() {
    let encrypted = encrypted_rdp_password(Some("pa'ss $word"))
        .expect("encrypt rdp password")
        .expect("encrypted blob");

    assert!(!encrypted.trim().is_empty());
}

#[cfg(not(target_os = "windows"))]
#[test]
fn encrypted_rdp_password_is_windows_only() {
    let encrypted = encrypted_rdp_password(Some("password")).expect("skip non-windows password");

    assert!(encrypted.is_none());
}

#[test]
fn saved_rdp_password_requires_secret_ref_even_with_plaintext_secret() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let host = rdp_host(
        Some("plain-rdp-secret"),
        Some("credential:rdp/saved/password"),
        None,
        RemoteHostAuthType::Password,
    );

    let error = saved_rdp_password(&state, &host).expect_err("reject old plaintext secret");

    assert!(error.to_string().contains("缺少已保存密码"));
}

#[test]
fn saved_rdp_password_reads_vault_secret_ref() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let secret_ref = build_vault_secret_ref("rdp-host", "rdp-1", "target", "password");
    let vault = EncryptedVaultService::new(state.paths().clone());
    vault
        .upsert_secret(
            &secret_ref,
            "rdp-host",
            secret_ref.as_bytes(),
            b"vault-rdp-secret",
        )
        .expect("write vault secret");
    let host = rdp_host(None, None, Some(&secret_ref), RemoteHostAuthType::Password);

    let password = saved_rdp_password(&state, &host).expect("resolve saved password");

    assert_eq!(password.as_deref(), Some("vault-rdp-secret"));
}

#[test]
fn saved_rdp_password_rejects_non_rdp_vault_secret_ref() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let secret_ref = build_vault_secret_ref("ssh-host", "rdp-1", "target", "password");
    let vault = EncryptedVaultService::new(state.paths().clone());
    vault
        .upsert_secret(
            &secret_ref,
            "ssh-host",
            secret_ref.as_bytes(),
            b"old-kind-rdp-secret",
        )
        .expect("write vault secret");
    let host = rdp_host(None, None, Some(&secret_ref), RemoteHostAuthType::Password);

    let error = saved_rdp_password(&state, &host).expect_err("reject old kind");

    assert!(error.to_string().contains("rdp-host"));
}

#[test]
fn saved_rdp_password_requires_latest_secret_ref() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let secret_ref = build_vault_secret_ref("rdp-host", "rdp-1", "target", "password");
    let vault = EncryptedVaultService::new(state.paths().clone());
    vault
        .upsert_secret(
            &secret_ref,
            "rdp-host",
            secret_ref.as_bytes(),
            b"old-field-rdp-secret",
        )
        .expect("write vault secret");
    let host = rdp_host(None, Some(&secret_ref), None, RemoteHostAuthType::Password);

    let error = saved_rdp_password(&state, &host).expect_err("missing latest secret_ref");

    assert!(error.to_string().contains("缺少已保存密码"));
}

#[tokio::test]
async fn tcp_connection_test_reaches_local_listener() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind local listener");
    let port = listener.local_addr().expect("listener address").port();
    let accepted = tokio::spawn(async move {
        let _ = listener.accept().await;
    });

    test_tcp_endpoint("Telnet", "127.0.0.1", port, 1)
        .await
        .expect("connect to local listener");
    accepted.await.expect("accept task finished");
}

#[test]
fn builds_telnet_test_host_without_username() {
    let host =
        remote_host_from_create_request("Telnet", remote_host_request(vec!["telnet".to_owned()]))
            .expect("valid telnet host");

    assert_eq!(host.host, "127.0.0.1");
    assert_eq!(host.port, 23);
    assert!(host.username.is_empty());
    assert_eq!(host.tags, vec!["telnet"]);
}
