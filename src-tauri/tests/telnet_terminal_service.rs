//! Telnet terminal service rule tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::remote_host::{RemoteHost, RemoteHostAuthType, SshOptions},
    services::telnet_terminal_service::rules::build_telnet_terminal_request,
};

fn remote_host(tags: Vec<String>) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "lab".to_owned(),
        host: "lab.internal".to_owned(),
        port: 2323,
        username: String::new(),
        protocol: Default::default(),
        auth_type: RemoteHostAuthType::Agent,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags,
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

#[test]
fn build_telnet_terminal_request_uses_parameterized_args() {
    let request = build_telnet_terminal_request(
        &remote_host(vec![" TELNET ".to_owned()]),
        "telnet".to_owned(),
        24,
        80,
    )
    .expect("build request");

    assert_eq!(request.shell.as_deref(), Some("telnet"));
    assert_eq!(request.args, vec!["lab.internal", "2323"]);
    assert_eq!(request.cwd, None);
    assert_eq!(request.rows, 24);
    assert_eq!(request.cols, 80);
    assert!(request.env.is_empty());
    assert!(request.cleanup_paths.is_empty());
}

#[test]
fn build_telnet_terminal_request_rejects_non_telnet_tag() {
    let error = build_telnet_terminal_request(
        &remote_host(vec!["ssh".to_owned()]),
        "telnet".to_owned(),
        24,
        80,
    )
    .expect_err("reject non telnet host");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn build_telnet_terminal_request_rejects_zero_size() {
    let error = build_telnet_terminal_request(
        &remote_host(vec!["telnet".to_owned()]),
        "telnet".to_owned(),
        0,
        80,
    )
    .expect_err("reject zero rows");

    assert!(matches!(error, AppError::InvalidInput(_)));
}
