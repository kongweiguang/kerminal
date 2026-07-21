//! Serial terminal service rule tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::remote_host::{RemoteHost, RemoteHostAuthType, SshOptions},
    services::serial_terminal_service::rules::build_plink_serial_terminal_request,
};

fn remote_host(host: &str, tags: Vec<String>) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "serial console".to_owned(),
        host: host.to_owned(),
        port: 1,
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
        production: false,
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

#[test]
fn build_plink_serial_terminal_request_uses_parameterized_args_from_tags() {
    let request = build_plink_serial_terminal_request(
        &remote_host(
            "COM1",
            vec![
                " serial ".to_owned(),
                "serial-port:COM9".to_owned(),
                "serial-baud:115200".to_owned(),
                "serial-data-bits:7".to_owned(),
                "serial-stop-bits:2".to_owned(),
                "serial-parity:even".to_owned(),
                "serial-flow:rtscts".to_owned(),
            ],
        ),
        "plink".to_owned(),
        24,
        80,
    )
    .expect("build request");

    assert_eq!(request.shell.as_deref(), Some("plink"));
    assert_eq!(
        request.args,
        vec!["-serial", "COM9", "-sercfg", "115200,7,e,2,R"]
    );
    assert_eq!(request.cwd, None);
    assert_eq!(request.rows, 24);
    assert_eq!(request.cols, 80);
    assert!(request.env.is_empty());
    assert!(request.cleanup_paths.is_empty());
}

#[test]
fn build_plink_serial_terminal_request_uses_default_config() {
    let request = build_plink_serial_terminal_request(
        &remote_host("COM3", vec!["serial".to_owned()]),
        "plink".to_owned(),
        30,
        100,
    )
    .expect("build request");

    assert_eq!(request.shell.as_deref(), Some("plink"));
    assert_eq!(
        request.args,
        vec!["-serial", "COM3", "-sercfg", "9600,8,n,1,N"]
    );
    assert_eq!(request.rows, 30);
    assert_eq!(request.cols, 100);
}

#[test]
fn build_plink_serial_terminal_request_rejects_invalid_baud() {
    let error = build_plink_serial_terminal_request(
        &remote_host(
            "COM3",
            vec!["serial".to_owned(), "serial-baud:42".to_owned()],
        ),
        "plink".to_owned(),
        24,
        80,
    )
    .expect_err("reject invalid baud");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn build_plink_serial_terminal_request_rejects_non_serial_tag() {
    let error = build_plink_serial_terminal_request(
        &remote_host("COM3", vec!["ssh".to_owned()]),
        "plink".to_owned(),
        24,
        80,
    )
    .expect_err("reject non serial host");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn build_plink_serial_terminal_request_rejects_zero_size() {
    let error = build_plink_serial_terminal_request(
        &remote_host("COM3", vec!["serial".to_owned()]),
        "plink".to_owned(),
        0,
        80,
    )
    .expect_err("reject zero rows");

    assert!(matches!(error, AppError::InvalidInput(_)));
}
