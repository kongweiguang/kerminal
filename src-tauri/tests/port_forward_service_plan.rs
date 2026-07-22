//! SSH 端口转发命令计划集成测试。
//!
//! @author kongweiguang

use std::path::PathBuf;

use kerminal_lib::{
    error::AppError,
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardKind, PortForwardProxyProtocol,
            PortForwardRemoteAccessScope,
        },
        remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
    },
    paths::KerminalPaths,
    services::{port_forward_service::plan::build_forward_plan, ssh_command_plan::cleanup_paths},
};
use tempfile::tempdir;

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    match auth_type {
        RemoteHostAuthType::Agent => remote_host_with_credentials(auth_type, None, None),
        RemoteHostAuthType::Password => remote_host_with_credentials(
            auth_type,
            None,
            Some("correct horse battery staple".to_owned()),
        ),
        RemoteHostAuthType::Key => {
            remote_host_with_credentials(auth_type, Some("C:/keys/dev.key".to_owned()), None)
        }
    }
}

fn remote_host_with_credentials(
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret,
        credential_status: Default::default(),
        tags: vec!["dev".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

fn request(kind: PortForwardKind) -> PortForwardCreateRequest {
    PortForwardCreateRequest {
        host_id: "host-1".to_owned(),
        name: Some("test tunnel".to_owned()),
        kind,
        bind_host: Some("127.0.0.1".to_owned()),
        source_port: 15432,
        target_host: Some("127.0.0.1".to_owned()),
        target_port: Some(5432),
        ..Default::default()
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
        port: 2200,
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

fn host_with_jump(auth_type: RemoteHostAuthType, jump: SshJumpHostOptions) -> RemoteHost {
    let mut host = remote_host(auth_type);
    host.ssh_options.jump_hosts = vec![jump];
    host
}

#[test]
fn build_local_forward_plan_uses_parameterized_openssh_args() {
    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        None,
        &request(PortForwardKind::Local),
    )
    .expect("build plan");

    assert_eq!(plan.executable, "ssh");
    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2222"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-L", "127.0.0.1:15432:127.0.0.1:5432"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "ExitOnForwardFailure=yes"]));
    assert!(plan.args.contains(&"-a".to_owned()));
    assert!(plan
        .args
        .contains(&"PreferredAuthentications=publickey".to_owned()));
    assert_eq!(
        plan.args.last().map(String::as_str),
        Some("deploy@dev.internal")
    );
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
    assert!(plan.command_preview.contains("-L"));
}

#[test]
fn build_remote_forward_plan_preserves_non_loopback_bind() {
    let mut request = request(PortForwardKind::Remote);
    request.bind_host = Some("0.0.0.0".to_owned());
    request.source_port = 18080;
    request.target_host = Some("10.0.0.5".to_owned());
    request.target_port = Some(3000);

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build remote plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-R", "0.0.0.0:18080:10.0.0.5:3000"]));
    assert_eq!(plan.remote_bind_host.as_deref(), Some("0.0.0.0"));
    assert_eq!(
        plan.remote_access_scope,
        Some(PortForwardRemoteAccessScope::AllInterfaces)
    );
}

#[test]
fn build_remote_forward_plan_preserves_custom_private_bind() {
    let mut request = request(PortForwardKind::Remote);
    request.remote_bind_host = Some("192.168.1.20".to_owned());
    request.source_port = 18090;
    request.target_host = Some("10.0.0.5".to_owned());
    request.target_port = Some(3000);

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build custom bind remote plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-R", "192.168.1.20:18090:10.0.0.5:3000"]));
    assert_eq!(plan.remote_bind_host.as_deref(), Some("192.168.1.20"));
    assert_eq!(
        plan.remote_access_scope,
        Some(PortForwardRemoteAccessScope::PrivateNetwork)
    );
}

#[test]
fn build_dynamic_forward_plan_does_not_require_target() {
    let mut request = request(PortForwardKind::Dynamic);
    request.bind_host = None;
    request.source_port = 1080;
    request.target_host = None;
    request.target_port = None;

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build dynamic plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-D", "127.0.0.1:1080"]));
    assert_eq!(plan.target_host, None);
    assert_eq!(plan.target_port, None);
    assert_eq!(plan.proxy_protocol, Some(PortForwardProxyProtocol::Socks5));
}

#[test]
fn build_remote_dynamic_socks_plan_uses_remote_dynamic() {
    let mut request = request(PortForwardKind::RemoteDynamic);
    request.remote_bind_host = Some("127.0.0.1".to_owned());
    request.source_port = 18081;
    request.target_host = None;
    request.target_port = None;
    request.proxy_protocol = Some(PortForwardProxyProtocol::Socks5);

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build socks network assist plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-R", "127.0.0.1:18081"]));
    assert_eq!(plan.proxy_url.as_deref(), Some("socks5h://127.0.0.1:18081"));
}

#[test]
fn build_remote_dynamic_socks_proxy_url_uses_client_reachable_host() {
    let mut request = request(PortForwardKind::RemoteDynamic);
    request.remote_bind_host = Some("0.0.0.0".to_owned());
    request.source_port = 18082;
    request.target_host = None;
    request.target_port = None;
    request.proxy_protocol = Some(PortForwardProxyProtocol::Socks5);

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build socks network assist plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-R", "0.0.0.0:18082"]));
    assert_eq!(plan.proxy_url.as_deref(), Some("socks5h://127.0.0.1:18082"));
}

#[test]
fn proxy_url_formats_ipv6_wildcard_as_loopback_literal() {
    let mut request = request(PortForwardKind::RemoteDynamic);
    request.remote_bind_host = Some("::".to_owned());
    request.source_port = 18083;
    request.target_host = None;
    request.target_port = None;
    request.proxy_protocol = Some(PortForwardProxyProtocol::Socks5);

    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect("build ipv6 wildcard network assist plan");

    assert_eq!(plan.proxy_url.as_deref(), Some("socks5h://[::1]:18083"));
}

#[test]
fn build_key_plan_materializes_inline_private_key_without_leaking_secret() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let private_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";

    let plan = build_forward_plan(
        &remote_host_with_credentials(RemoteHostAuthType::Key, None, Some(private_key.to_owned())),
        "ssh".to_owned(),
        Some(&paths),
        &request(PortForwardKind::Local),
    )
    .expect("build key plan");

    assert!(plan.args.iter().any(|arg| arg == "-i"));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "IdentitiesOnly=yes"]));
    assert!(!plan.args.iter().any(|arg| arg.contains(private_key)));
    assert_eq!(plan.cleanup_paths.len(), 1);
    assert!(plan.cleanup_paths[0].exists());
    cleanup_paths(&plan.cleanup_paths);
}

#[test]
fn build_key_plan_rejects_old_credential_ref_without_compatibility_fallback() {
    let host = remote_host_with_credentials(
        RemoteHostAuthType::Key,
        Some("credential:ssh/dev".to_owned()),
        None,
    );

    let error = build_forward_plan(
        &host,
        "ssh".to_owned(),
        None,
        &request(PortForwardKind::Local),
    )
    .expect_err("reject old SSH credential ref");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn build_key_path_plan_without_context_uses_identity_file() {
    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        None,
        &request(PortForwardKind::Local),
    )
    .expect("build key plan without credential context");

    assert!(plan.args.iter().any(|arg| arg == "-i"));
    assert!(plan.cleanup_paths.is_empty());
    assert!(plan.secret_input_plan.is_none());
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
    assert!(!plan.command_preview.contains("credential:ssh"));
}

#[test]
fn build_agent_plan_does_not_enable_agent_forwarding() {
    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        None,
        &request(PortForwardKind::Local),
    )
    .expect("build agent plan");

    assert!(plan.args.contains(&"-a".to_owned()));
    assert!(!plan.args.contains(&"-A".to_owned()));
    assert!(plan
        .args
        .contains(&"PreferredAuthentications=publickey".to_owned()));
}

#[test]
fn build_password_plan_uses_secret_input_plan_without_batch_mode_or_password_leak() {
    let plan = build_forward_plan(
        &remote_host(RemoteHostAuthType::Password),
        "ssh".to_owned(),
        None,
        &request(PortForwardKind::Local),
    )
    .expect("build password plan");

    assert!(!plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(plan.secret_input_plan.is_some());
    assert!(!plan
        .args
        .iter()
        .any(|arg| arg.contains("correct horse battery staple")));
    assert!(!plan
        .command_preview
        .contains("correct horse battery staple"));
}

#[test]
fn build_jump_local_forward_plan_uses_openssh_route_config_alias() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let host = host_with_jump(
        RemoteHostAuthType::Agent,
        jump_host(
            "bastion",
            "bastion.internal",
            "jump",
            RemoteHostAuthType::Agent,
            None,
            None,
        ),
    );

    let plan = build_forward_plan(
        &host,
        "ssh".to_owned(),
        Some(&paths),
        &request(PortForwardKind::Local),
    )
    .expect("build jump local plan");

    let config_path = plan
        .args
        .windows(2)
        .find(|pair| pair[0] == "-F")
        .map(|pair| PathBuf::from(&pair[1]))
        .expect("temp ssh config path");
    assert_eq!(
        plan.args.last().map(String::as_str),
        Some("kerminal-target")
    );
    assert!(plan.args.contains(&"-N".to_owned()));
    assert!(plan.args.contains(&"-T".to_owned()));
    assert!(plan.args.contains(&"-a".to_owned()));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-L", "127.0.0.1:15432:127.0.0.1:5432"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "ExitOnForwardFailure=yes"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "ServerAliveInterval=30"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "ServerAliveCountMax=3"]));
    assert_eq!(plan.local_bind_host.as_deref(), Some("127.0.0.1"));
    assert_eq!(plan.target_host.as_deref(), Some("127.0.0.1"));
    assert_eq!(plan.target_port, Some(5432));
    assert!(plan.cleanup_paths.contains(&config_path));
    assert!(config_path.exists());
    assert!(plan.command_preview.contains("-F"));
    assert!(plan.command_preview.contains("kerminal-target"));
    assert!(!plan
        .args
        .iter()
        .any(|arg| arg == "-J" || arg.contains("ProxyJump")));

    cleanup_paths(&plan.cleanup_paths);
}

#[test]
fn build_jump_remote_and_dynamic_forward_plans_preserve_forward_args() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let host = host_with_jump(
        RemoteHostAuthType::Agent,
        jump_host(
            "bastion",
            "bastion.internal",
            "jump",
            RemoteHostAuthType::Agent,
            None,
            None,
        ),
    );
    let mut remote_request = request(PortForwardKind::Remote);
    remote_request.remote_bind_host = Some("0.0.0.0".to_owned());
    remote_request.source_port = 18080;
    remote_request.target_host = Some("10.0.0.5".to_owned());
    remote_request.target_port = Some(3000);
    let mut dynamic_request = request(PortForwardKind::Dynamic);
    dynamic_request.bind_host = None;
    dynamic_request.source_port = 1080;
    dynamic_request.target_host = None;
    dynamic_request.target_port = None;

    let remote_plan = build_forward_plan(&host, "ssh".to_owned(), Some(&paths), &remote_request)
        .expect("build remote jump plan");
    let dynamic_plan = build_forward_plan(&host, "ssh".to_owned(), Some(&paths), &dynamic_request)
        .expect("build dynamic jump plan");

    assert!(remote_plan
        .args
        .windows(2)
        .any(|pair| pair == ["-R", "0.0.0.0:18080:10.0.0.5:3000"]));
    assert_eq!(
        remote_plan.args.last().map(String::as_str),
        Some("kerminal-target")
    );
    assert!(dynamic_plan
        .args
        .windows(2)
        .any(|pair| pair == ["-D", "127.0.0.1:1080"]));
    assert_eq!(
        dynamic_plan.args.last().map(String::as_str),
        Some("kerminal-target")
    );

    cleanup_paths(&remote_plan.cleanup_paths);
    cleanup_paths(&dynamic_plan.cleanup_paths);
}

#[test]
fn build_jump_password_plan_uses_two_secret_entries_without_leaking_args() {
    const JUMP_PASSWORD: &str = "jump-password-secret";
    const TARGET_PASSWORD: &str = "target-password-secret";

    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let mut host = host_with_jump(
        RemoteHostAuthType::Password,
        jump_host(
            "password-jump",
            "bastion.internal",
            "jump",
            RemoteHostAuthType::Password,
            None,
            Some(JUMP_PASSWORD),
        ),
    );
    host.credential_secret = Some(TARGET_PASSWORD.to_owned());

    let plan = build_forward_plan(
        &host,
        "ssh".to_owned(),
        Some(&paths),
        &request(PortForwardKind::Local),
    )
    .expect("build password jump plan");

    let secret_plan = plan.secret_input_plan.as_ref().expect("secret plan");
    assert_eq!(
        secret_plan
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry.response.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("jump-0:password", JUMP_PASSWORD),
            ("target:password", TARGET_PASSWORD),
        ]
    );
    assert!(!plan
        .args
        .iter()
        .any(|arg| arg.contains(JUMP_PASSWORD) || arg.contains(TARGET_PASSWORD)));
    assert!(!plan.command_preview.contains(JUMP_PASSWORD));
    assert!(!plan.command_preview.contains(TARGET_PASSWORD));

    cleanup_paths(&plan.cleanup_paths);
}

#[test]
fn build_jump_plan_redacts_args_preview_config_and_debug() {
    const TARGET_PASSWORD: &str = "target-password-secret";
    const INLINE_PRIVATE_KEY: &str =
        "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-content-secret\n-----END OPENSSH PRIVATE KEY-----";

    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let mut host = host_with_jump(
        RemoteHostAuthType::Password,
        jump_host(
            "inline-key-jump",
            "bastion.internal",
            "jump",
            RemoteHostAuthType::Key,
            None,
            Some(INLINE_PRIVATE_KEY),
        ),
    );
    host.credential_secret = Some(TARGET_PASSWORD.to_owned());

    let plan = build_forward_plan(
        &host,
        "ssh".to_owned(),
        Some(&paths),
        &request(PortForwardKind::Local),
    )
    .expect("build redacted jump plan");
    let config_path = plan
        .cleanup_paths
        .iter()
        .find(|path| path.file_name().is_some_and(|name| name == "config"))
        .cloned()
        .or_else(|| {
            plan.args
                .windows(2)
                .find(|pair| pair[0] == "-F")
                .map(|pair| PathBuf::from(&pair[1]))
        })
        .expect("temp ssh config path");
    let config = std::fs::read_to_string(&config_path).expect("read temp config");
    let debug_text = format!("{plan:?}");
    let args_text = plan.args.join(" ");

    for text in [&args_text, &plan.command_preview, &config, &debug_text] {
        assert!(!text.contains(TARGET_PASSWORD));
        assert!(!text.contains("private-key-content-secret"));
    }
    assert!(plan.cleanup_paths.contains(&config_path));
    assert!(plan.cleanup_paths.iter().any(|path| path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".key"))));
    assert!(config.contains("IdentityFile "));

    cleanup_paths(&plan.cleanup_paths);
}

#[test]
fn build_forward_plan_rejects_invalid_ports_and_hosts() {
    let mut request = request(PortForwardKind::Local);
    request.source_port = 0;

    let error = build_forward_plan(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect_err("reject zero source port");
    assert!(matches!(error, AppError::InvalidInput(_)));

    request.source_port = 15432;
    request.target_host = Some("bad host".to_owned());
    let error = build_forward_plan(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        None,
        &request,
    )
    .expect_err("reject host whitespace");
    assert!(matches!(error, AppError::InvalidInput(_)));
}
