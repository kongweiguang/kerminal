//! 保存主机协议能力门禁集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::remote_host::{RemoteHost, RemoteHostAuthType, RemoteHostProtocol, SshOptions},
    services::remote_host_capability::{ensure_remote_host_capability, RemoteHostCapability},
};

#[test]
fn sftp_host_allows_files_and_rejects_shell_before_transport() {
    let host = host(RemoteHostProtocol::Sftp);

    ensure_remote_host_capability(&host, RemoteHostCapability::Sftp)
        .expect("SFTP host allows file capability");
    let error = ensure_remote_host_capability(&host, RemoteHostCapability::Shell)
        .expect_err("SFTP host must reject shell capability");

    assert!(error.to_string().contains("host_capability_not_supported"));
}

#[test]
fn ssh_host_keeps_file_and_shell_capabilities() {
    let host = host(RemoteHostProtocol::Ssh);

    ensure_remote_host_capability(&host, RemoteHostCapability::Sftp)
        .expect("SSH host keeps SFTP capability");
    ensure_remote_host_capability(&host, RemoteHostCapability::Shell)
        .expect("SSH host keeps shell capability");
}

fn host(protocol: RemoteHostProtocol) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: None,
        name: "host".to_owned(),
        host: "host.internal".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        protocol,
        auth_type: RemoteHostAuthType::Agent,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: Vec::new(),
        production: false,
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "1".to_owned(),
        updated_at: "1".to_owned(),
    }
}
