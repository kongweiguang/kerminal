//! SSH route plan 纯模型测试。
//!
//! @author kongweiguang

use std::{fs, path::PathBuf};

use kerminal_lib::{
    error::AppError,
    models::remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions, SshOptions},
    paths::KerminalPaths,
    services::ssh_route_plan::{
        build_ssh_route_plan, materialize_openssh_route_plan, SshRouteAuthMethod, SshRouteAuthPlan,
        SshRouteKeyMaterial, SshRouteKeyMaterialSummary,
    },
};
use tempfile::tempdir;

const TARGET_PASSWORD: &str = "target-password-secret";
const JUMP_PASSWORD: &str = "jump-password-secret";
const INLINE_PRIVATE_KEY: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-content-secret\n-----END OPENSSH PRIVATE KEY-----";

#[test]
fn builds_password_key_agent_jump_auth_plans() {
    let mut host = remote_host(RemoteHostAuthType::Agent, None, None);
    host.ssh_options.jump_hosts = vec![
        jump_host(
            "password-jump",
            "bastion-password.example.test",
            "jump-password",
            RemoteHostAuthType::Password,
            None,
            Some(JUMP_PASSWORD),
        ),
        jump_host(
            "key-jump",
            "bastion-key.example.test",
            "jump-key",
            RemoteHostAuthType::Key,
            Some("/keys/bastion_ed25519"),
            None,
        ),
        jump_host(
            "agent-jump",
            "bastion-agent.example.test",
            "jump-agent",
            RemoteHostAuthType::Agent,
            None,
            None,
        ),
    ];

    let plan = build_ssh_route_plan(&host).expect("build route plan");

    assert_eq!(plan.jumps.len(), 3);
    assert_eq!(plan.jumps[0].id, "jump-0");
    assert_eq!(plan.jumps[0].auth.method(), SshRouteAuthMethod::Password);
    assert_eq!(plan.jumps[1].auth.method(), SshRouteAuthMethod::Key);
    assert_eq!(plan.jumps[2].auth.method(), SshRouteAuthMethod::Agent);
    assert_eq!(plan.target.auth.method(), SshRouteAuthMethod::Agent);
    assert_eq!(plan.secret_plan.entries.len(), 1);
    assert_eq!(plan.secret_plan.entries[0].hop_id, "jump-0");
    assert_eq!(
        plan.known_hosts
            .iter()
            .map(|entry| entry.hop_id.as_str())
            .collect::<Vec<_>>(),
        vec!["jump-0", "jump-1", "jump-2", "target"]
    );

    match &plan.jumps[1].auth {
        SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::Path(path),
        } => assert_eq!(path, &PathBuf::from("/keys/bastion_ed25519")),
        other => panic!("expected key path auth, got {other:?}"),
    }
}

#[test]
fn builds_target_auth_variants() {
    let password_plan = build_ssh_route_plan(&remote_host(
        RemoteHostAuthType::Password,
        None,
        Some(TARGET_PASSWORD),
    ))
    .expect("build password target plan");
    assert_eq!(
        password_plan.target.auth.method(),
        SshRouteAuthMethod::Password
    );
    assert_eq!(password_plan.secret_plan.entries.len(), 1);
    assert_eq!(
        password_plan.secret_plan.entries[0]
            .response
            .expose_secret(),
        TARGET_PASSWORD
    );

    let key_path_plan = build_ssh_route_plan(&remote_host(
        RemoteHostAuthType::Key,
        Some("C:/Users/test/.ssh/id_ed25519"),
        None,
    ))
    .expect("build key path target plan");
    assert_eq!(key_path_plan.target.auth.method(), SshRouteAuthMethod::Key);
    assert_eq!(
        key_path_plan.summary().target.auth.key_material,
        Some(SshRouteKeyMaterialSummary::Path)
    );

    let inline_key_plan = build_ssh_route_plan(&remote_host(
        RemoteHostAuthType::Key,
        None,
        Some(INLINE_PRIVATE_KEY),
    ))
    .expect("build inline key target plan");
    assert_eq!(
        inline_key_plan.summary().target.auth.key_material,
        Some(SshRouteKeyMaterialSummary::InlinePrivateKey)
    );
    match &inline_key_plan.target.auth {
        SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::InlinePrivateKey { content },
        } => assert!(content.expose_secret().ends_with('\n')),
        other => panic!("expected inline key auth, got {other:?}"),
    }

    let agent_plan = build_ssh_route_plan(&remote_host(RemoteHostAuthType::Agent, None, None))
        .expect("build agent target plan");
    assert_eq!(agent_plan.target.auth.method(), SshRouteAuthMethod::Agent);
    assert!(agent_plan.secret_plan.entries.is_empty());
}

#[test]
fn expands_home_relative_key_paths_in_route_plan() {
    let plan = build_ssh_route_plan(&remote_host(
        RemoteHostAuthType::Key,
        Some("~/.ssh/id_ed25519"),
        None,
    ))
    .expect("build key path target plan");
    let expected_identity = dirs::home_dir()
        .expect("current user home")
        .join(".ssh")
        .join("id_ed25519");

    match &plan.target.auth {
        SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::Path(path),
        } => assert_eq!(path, &expected_identity),
        other => panic!("expected key path auth, got {other:?}"),
    }
}

#[test]
fn preserves_two_jump_mixed_auth_order() {
    let mut host = remote_host(RemoteHostAuthType::Password, None, Some(TARGET_PASSWORD));
    host.ssh_options.jump_hosts = vec![
        jump_host(
            "first",
            "first-bastion.example.test",
            "first-user",
            RemoteHostAuthType::Key,
            Some("/keys/first"),
            None,
        ),
        jump_host(
            "second",
            "second-bastion.example.test",
            "second-user",
            RemoteHostAuthType::Password,
            None,
            Some(JUMP_PASSWORD),
        ),
    ];

    let plan = build_ssh_route_plan(&host).expect("build two jump route plan");

    assert_eq!(
        plan.jumps
            .iter()
            .map(|hop| (hop.id.as_str(), hop.host.as_str(), hop.auth.method()))
            .collect::<Vec<_>>(),
        vec![
            (
                "jump-0",
                "first-bastion.example.test",
                SshRouteAuthMethod::Key,
            ),
            (
                "jump-1",
                "second-bastion.example.test",
                SshRouteAuthMethod::Password,
            ),
        ]
    );
    assert_eq!(
        plan.secret_plan
            .entries
            .iter()
            .map(|entry| entry.hop_id.as_str())
            .collect::<Vec<_>>(),
        vec!["jump-1", "target"]
    );
    assert_eq!(
        plan.known_hosts
            .iter()
            .map(|entry| (entry.hop_id.as_str(), entry.host.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("jump-0", "first-bastion.example.test"),
            ("jump-1", "second-bastion.example.test"),
            ("target", "target.example.test"),
        ]
    );
}

#[test]
fn rejects_missing_password_or_key_material_with_clear_error() {
    assert_invalid_message(
        build_ssh_route_plan(&remote_host(RemoteHostAuthType::Password, None, None))
            .expect_err("missing target password should fail"),
        "target `target` 使用密码认证但缺少 credentialSecret",
    );
    assert_invalid_message(
        build_ssh_route_plan(&remote_host(RemoteHostAuthType::Key, None, None))
            .expect_err("missing target key should fail"),
        "target `target` 使用私钥认证但缺少私钥路径或内联私钥内容",
    );

    let mut password_jump_host = remote_host(RemoteHostAuthType::Agent, None, None);
    password_jump_host.ssh_options.jump_hosts = vec![jump_host(
        "password-jump",
        "bastion.example.test",
        "jump",
        RemoteHostAuthType::Password,
        None,
        None,
    )];
    assert_invalid_message(
        build_ssh_route_plan(&password_jump_host).expect_err("missing jump password should fail"),
        "jump-0 `password-jump` 使用密码认证但缺少 credentialSecret",
    );

    let mut key_jump_host = remote_host(RemoteHostAuthType::Agent, None, None);
    key_jump_host.ssh_options.jump_hosts = vec![jump_host(
        "key-jump",
        "bastion.example.test",
        "jump",
        RemoteHostAuthType::Key,
        None,
        None,
    )];
    assert_invalid_message(
        build_ssh_route_plan(&key_jump_host).expect_err("missing jump key should fail"),
        "jump-0 `key-jump` 使用私钥认证但缺少私钥路径或内联私钥内容",
    );
}

#[test]
fn debug_and_summary_redact_passwords_and_private_keys() {
    let mut host = remote_host(RemoteHostAuthType::Password, None, Some(TARGET_PASSWORD));
    host.ssh_options.jump_hosts = vec![jump_host(
        "inline-key-jump",
        "bastion.example.test",
        "jump",
        RemoteHostAuthType::Key,
        None,
        Some(INLINE_PRIVATE_KEY),
    )];

    let plan = build_ssh_route_plan(&host).expect("build route plan with secrets");
    let debug_text = format!("{plan:?}");
    let summary_text = format!("{:?}", plan.summary());

    assert!(!debug_text.contains(TARGET_PASSWORD));
    assert!(!debug_text.contains("private-key-content-secret"));
    assert!(!summary_text.contains(TARGET_PASSWORD));
    assert!(!summary_text.contains("private-key-content-secret"));
    assert!(debug_text.contains("<redacted>"));
    assert_eq!(plan.summary().secret_entry_count, 1);

    let redact_values = plan.redact_values();
    assert!(redact_values.contains(&TARGET_PASSWORD));
    assert!(redact_values
        .iter()
        .any(|value| value.contains("private-key-content-secret")));
}

#[test]
fn openssh_temp_config_redacts_secrets_and_tracks_cleanup_paths() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let mut host = remote_host(RemoteHostAuthType::Password, None, Some(TARGET_PASSWORD));
    host.ssh_options.jump_hosts = vec![jump_host(
        "inline-key-jump",
        "bastion.example.test",
        "jump",
        RemoteHostAuthType::Key,
        None,
        Some(INLINE_PRIVATE_KEY),
    )];
    let route = build_ssh_route_plan(&host).expect("build route plan");

    let open_ssh = materialize_openssh_route_plan(&route, &paths, paths.root.join("known_hosts"))
        .expect("materialize openssh route");
    let config = fs::read_to_string(&open_ssh.config_path).expect("read temp config");
    let debug_text = format!("{open_ssh:?}");

    assert_eq!(open_ssh.target_alias, "kerminal-target");
    assert!(open_ssh.cleanup_paths.contains(&open_ssh.config_path));
    assert!(open_ssh.cleanup_paths.iter().any(|path| path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".key"))));
    assert!(open_ssh
        .args
        .windows(2)
        .any(|pair| pair[0] == "-F"
            && std::path::Path::new(&pair[1]) == open_ssh.config_path.as_path()));
    assert_eq!(
        open_ssh.args.last().map(String::as_str),
        Some("kerminal-target")
    );

    for text in [&config, &debug_text, &open_ssh.args.join(" ")] {
        assert!(!text.contains(TARGET_PASSWORD));
        assert!(!text.contains("private-key-content-secret"));
    }
    assert!(config.contains("IdentityFile "));
    assert_eq!(open_ssh.secret_input_plan.entries.len(), 1);
    assert_eq!(
        open_ssh.secret_input_plan.entries[0].response,
        TARGET_PASSWORD
    );

    let inline_key_path = open_ssh
        .cleanup_paths
        .iter()
        .find(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(".key"))
        })
        .expect("inline key cleanup path");
    assert!(fs::read_to_string(inline_key_path)
        .expect("read inline key")
        .contains("private-key-content-secret"));

    cleanup_paths(&open_ssh.cleanup_paths);
}

#[test]
fn openssh_temp_config_builds_two_jump_proxycommand_chain() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let mut host = remote_host(RemoteHostAuthType::Agent, None, None);
    host.ssh_options.jump_hosts = vec![
        jump_host(
            "first",
            "first-bastion.example.test",
            "first-user",
            RemoteHostAuthType::Agent,
            None,
            None,
        ),
        jump_host(
            "second",
            "second-bastion.example.test",
            "second-user",
            RemoteHostAuthType::Password,
            None,
            Some(JUMP_PASSWORD),
        ),
    ];
    let route = build_ssh_route_plan(&host).expect("build route plan");

    let open_ssh = materialize_openssh_route_plan(&route, &paths, paths.root.join("known_hosts"))
        .expect("materialize openssh route");
    let config = fs::read_to_string(&open_ssh.config_path).expect("read temp config");
    let proxy_commands = config
        .lines()
        .filter(|line| line.contains("ProxyCommand"))
        .collect::<Vec<_>>();

    assert!(config.contains("Host kerminal-hop-0"));
    assert!(config.contains("HostName first-bastion.example.test"));
    assert!(config.contains("Host kerminal-hop-1"));
    assert!(config.contains("HostName second-bastion.example.test"));
    assert!(config.contains("Host kerminal-target"));
    assert_eq!(proxy_commands.len(), 2);
    assert!(proxy_commands[0].ends_with("kerminal-hop-0"));
    assert!(proxy_commands[1].ends_with("kerminal-hop-1"));
    assert!(config.contains("PreferredAuthentications password,keyboard-interactive"));
    assert!(config.contains("GlobalKnownHostsFile none"));

    cleanup_paths(&open_ssh.cleanup_paths);
}

fn remote_host(
    auth_type: RemoteHostAuthType,
    credential_ref: Option<&str>,
    credential_secret: Option<&str>,
) -> RemoteHost {
    RemoteHost {
        id: "target-id".to_owned(),
        group_id: None,
        name: "target".to_owned(),
        host: "target.example.test".to_owned(),
        port: 22,
        username: "target-user".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref: credential_ref.map(str::to_owned),
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: credential_secret.map(str::to_owned),
        credential_status: Default::default(),
        tags: Vec::new(),
        ssh_options: SshOptions::default(),
        sort_order: 0,
        created_at: "2026-06-23T00:00:00Z".to_owned(),
        updated_at: "2026-06-23T00:00:00Z".to_owned(),
    }
}

fn jump_host(
    name: &str,
    host: &str,
    username: &str,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<&str>,
    credential_secret: Option<&str>,
) -> SshJumpHostOptions {
    SshJumpHostOptions {
        name: name.to_owned(),
        host: host.to_owned(),
        port: 22,
        username: username.to_owned(),
        auth_type,
        credential_ref: credential_ref.map(str::to_owned),
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: credential_secret.map(str::to_owned),
        credential_status: Default::default(),
    }
}

fn assert_invalid_message(error: AppError, expected: &str) {
    match error {
        AppError::InvalidInput(message) => assert!(
            message.contains(expected),
            "expected `{message}` to contain `{expected}`"
        ),
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}
