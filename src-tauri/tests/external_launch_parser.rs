//! External SSH launch parser tests.
//!
//! @author kongweiguang

use serde_json::Value;

use kerminal_lib::services::external_launch::{
    ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchParserRegistry,
    ExternalLaunchSourceTool, ExternalSshLaunchRequest,
};

const CASES_JSON: &[&str] = &[
    include_str!("fixtures/external_launch/cases.json"),
    include_str!("fixtures/external_launch/cases-putty.json"),
    include_str!("fixtures/external_launch/cases-mobaxterm.json"),
    include_str!("fixtures/external_launch/cases-xshell.json"),
    include_str!("fixtures/external_launch/cases-securecrt.json"),
    include_str!("fixtures/external_launch/cases-openssh.json"),
    include_str!("fixtures/external_launch/cases-kerminal-native.json"),
    include_str!("fixtures/external_launch/cases-sftp-client.json"),
];

include!("external_launch_parser/cases.rs");
include!("external_launch_parser/assertions.rs");

#[test]
fn parses_generic_sftp_url_as_transfer_intent_without_leaking_password() {
    const PASSWORD: &str = "KERM_SFTP_URL_PASSWORD_DO_NOT_LOG";
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "kerminal.exe".to_owned(),
            format!("sftp://deploy:{PASSWORD}@[2001:db8::7]:2222/releases/包/"),
        ]))
        .expect("parse generic SFTP URL");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::SftpClient);
    assert_eq!(request.target.host, "2001:db8::7");
    assert_eq!(request.target.port, 2222);
    assert_eq!(request.target.username.as_deref(), Some("deploy"));
    assert!(matches!(
        request.intent,
        kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer {
            ref remote_path,
            selected_entry: None,
            ..
        } if remote_path.as_deref() == Some("/releases/包/")
    ));
    assert!(!format!("{request:?}").contains(PASSWORD));
    assert!(!format!("{request:?}").contains("/releases/包/"));
    assert!(request
        .diagnostics
        .argv_redacted
        .iter()
        .all(|argument| !argument.contains(PASSWORD)));
}

#[test]
fn parses_sftp_url_with_literal_wrapper_quotes_from_vendor_launchers() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "kerminal.exe".to_owned(),
            "  \"sftp://ops@example.internal/releases/\"  ".to_owned(),
        ]))
        .expect("parse quoted vendor SFTP URL");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::SftpClient);
    assert_eq!(request.target.host, "example.internal");
    assert_eq!(request.target.username.as_deref(), Some("ops"));
}

#[test]
fn parses_bastion_sftp_url_without_trailing_slash_as_root() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "kerminal.exe".to_owned(),
            "sftp://ops:session-token@example.internal:2222".to_owned(),
        ]))
        .expect("parse bastion SFTP URL without trailing slash");

    assert!(matches!(
        request.intent,
        kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer {
            ref remote_path,
            selected_entry: None,
            ..
        } if remote_path.as_deref() == Some("/")
    ));
}

#[test]
fn sftp_file_url_opens_parent_and_selects_file() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::SftpClient,
            vec![
                "kerminal.exe".to_owned(),
                "sftp://ops@example.internal/var/log/app.log".to_owned(),
            ],
        ))
        .expect("parse SFTP file URL");

    assert!(matches!(
        request.intent,
        kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer {
            ref remote_path,
            ref selected_entry,
            ..
        } if remote_path.as_deref() == Some("/var/log/")
            && selected_entry.as_deref() == Some("app.log")
    ));
}

#[test]
fn winscp_overrides_url_credentials_and_rejects_automation_options() {
    const PASSWORD: &str = "KERM_WINSCP_PASSWORD_DO_NOT_LOG";
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::SftpClient,
            vec![
                "kerminal.exe".to_owned(),
                "sftp://url-user:url-password@example.internal/incoming/".to_owned(),
                "/username=override-user".to_owned(),
                format!("/password={PASSWORD}"),
                "/hostkey=ssh-ed25519 255 SHA256:fixture".to_owned(),
            ],
        ))
        .expect("parse WinSCP-compatible SFTP args");

    assert_eq!(request.target.username.as_deref(), Some("override-user"));
    assert_eq!(request.diagnostics.parser, "winscp-sftp-url");
    assert!(!format!("{request:?}").contains(PASSWORD));

    for unsafe_option in ["/script=batch.txt", "/rawsettings=ProxyMethod=3"] {
        let error = ExternalLaunchParserRegistry::new()
            .parse(&ExternalLaunchParseInput::direct_argv(
                ExternalLaunchSourceTool::SftpClient,
                vec![
                    "kerminal.exe".to_owned(),
                    "sftp://ops@example.internal/".to_owned(),
                    unsafe_option.to_owned(),
                ],
            ))
            .expect_err("unsafe WinSCP option must fail closed");
        assert!(error.to_string().contains("unsupported or unsafe"));
    }
}

#[test]
fn filezilla_logontype_is_accepted_but_site_and_non_sftp_are_rejected() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::SftpClient,
            vec![
                "kerminal.exe".to_owned(),
                "--logontype".to_owned(),
                "ask".to_owned(),
                "sftp://ops@example.internal/home/ops/".to_owned(),
            ],
        ))
        .expect("parse FileZilla-compatible SFTP args");
    assert_eq!(request.diagnostics.parser, "filezilla-sftp-url");

    for argv in [
        vec!["kerminal.exe", "--site", "fixture-site"],
        vec!["kerminal.exe", "ftp://ops@example.internal/"],
    ] {
        let error = ExternalLaunchParserRegistry::new()
            .parse(&ExternalLaunchParseInput::direct_argv(
                ExternalLaunchSourceTool::SftpClient,
                argv.into_iter().map(str::to_owned).collect(),
            ))
            .expect_err("unsupported FileZilla input must fail closed");
        assert!(error.to_string().contains("SFTP") || error.to_string().contains("unsupported"));
    }
}

#[test]
fn native_external_sftp_flags_and_protocol_are_sftp_intents() {
    for argv in [
        vec![
            "kerminal.exe",
            "--external-sftp",
            "--host",
            "native.internal",
            "--port",
            "2200",
            "--user",
            "ops",
            "--remote-path",
            "/srv/releases/",
        ],
        vec![
            "kerminal.exe",
            "kerminal://sftp?host=native.internal&port=2200&user=ops&path=%2Fsrv%2Freleases%2F",
        ],
    ] {
        let request = ExternalLaunchParserRegistry::new()
            .parse(&ExternalLaunchParseInput::inferred_direct_argv(
                argv.into_iter().map(str::to_owned).collect(),
            ))
            .expect("parse native external SFTP request");
        assert_eq!(
            request.source.tool,
            ExternalLaunchSourceTool::KerminalNative
        );
        assert!(matches!(
            request.intent,
            kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer { .. }
        ));
    }
}
