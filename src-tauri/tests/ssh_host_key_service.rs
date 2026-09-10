//! 已保存 SSH 主机 key 确认流程回归测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, SshJumpHostOptions,
        SshProxyProtocol,
    },
    models::terminal::{SshTerminalCreateRequest, TerminalOutputEvent},
    paths::KerminalPaths,
    services::{
        ssh_command_service::SshCommandService,
        ssh_host_key_service::{inspect_saved_host_key, trust_saved_host_key, SshHostKeyStatus},
    },
    state::AppState,
};
use russh::keys::{self, HashAlg, PrivateKey};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use tempfile::{tempdir, TempDir};
use tokio::runtime::Runtime;

mod support;

use support::ssh_terminal_smoke::{
    collect_until_output, LoopbackTerminalServer, COMMAND_MARKER, LOOPBACK_PASSWORD,
    LOOPBACK_READY_MARKER, LOOPBACK_USER,
};

/// 创建带密码凭据的保存主机，确保测试走真实仓储和 vault 写入链路。
fn create_saved_loopback_host(
    state: &AppState,
    server: &LoopbackTerminalServer,
    name: &str,
) -> RemoteHost {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: name.to_owned(),
            port: server.addr.port(),
            protocol: Default::default(),
            ssh_options: Default::default(),
            tags: vec!["host-key-test".to_owned()],
            username: LOOPBACK_USER.to_owned(),
        })
        .expect("create saved loopback host")
}

/// 创建隔离配置根的应用状态，避免测试读写开发者真实 known_hosts。
fn create_loopback_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create SSH host key test home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize SSH host key test state");
    (home, state)
}

/// 未登记 key 的终端连接必须拒绝，inspect 只能读取当前 key，不能隐式创建 known_hosts。
#[test]
fn unknown_saved_host_key_is_rejected_and_inspection_is_read_only() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_state();
    let host = create_saved_loopback_host(&state, &server, "unknown host key");
    let known_hosts = state.paths().root.join("known_hosts");

    assert!(!known_hosts.exists());
    let runtime = Runtime::new().expect("create host key test runtime");
    let inspection = runtime
        .block_on(inspect_saved_host_key(state.paths(), &host))
        .expect("inspect unknown saved host key");
    drop(runtime);

    assert_eq!(inspection.host_id, host.id);
    assert_eq!(inspection.host, "127.0.0.1");
    assert_eq!(inspection.port, server.addr.port());
    assert_eq!(inspection.status, SshHostKeyStatus::Unknown);
    assert!(inspection.fingerprint.starts_with("SHA256:"));
    assert!(!known_hosts.exists());

    let runtime = Runtime::new().expect("create SSH rejection runtime");
    let error = runtime
        .block_on(SshCommandService::new().execute_native(
            state.paths(),
            kerminal_lib::models::ssh_command::SshCommandRequest {
                host_id: host.id,
                command: "printf should-not-run".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        ))
        .expect_err("unknown saved host key must be rejected");
    assert!(matches!(error, AppError::SshCommand(_)));
    assert!(error.to_string().contains("Unknown server key"));
    assert!(!known_hosts.exists());
}

/// 只有确认 fingerprint 与二次探测一致时才写入 known_hosts，随后 managed shell 可直连。
#[test]
fn confirmed_saved_host_key_is_trusted_and_terminal_connects() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_state();
    let host = create_saved_loopback_host(&state, &server, "confirmed host key");
    let known_hosts = state.paths().root.join("known_hosts");

    let runtime = Runtime::new().expect("create host key trust runtime");
    let inspection = runtime
        .block_on(inspect_saved_host_key(state.paths(), &host))
        .expect("inspect saved host key before trust");
    let wrong = runtime.block_on(trust_saved_host_key(
        state.paths(),
        &host,
        "SHA256:not-the-server-key",
    ));
    drop(runtime);
    assert!(wrong.is_err());
    assert!(!known_hosts.exists());

    let runtime = Runtime::new().expect("create host key confirmation runtime");
    let trusted = runtime
        .block_on(trust_saved_host_key(
            state.paths(),
            &host,
            &inspection.fingerprint,
        ))
        .expect("trust saved host key");
    drop(runtime);
    assert_eq!(trusted.status, SshHostKeyStatus::Known);
    assert!(keys::known_hosts::check_known_hosts_path(
        &host.host,
        host.port,
        &server.host_key,
        &known_hosts,
    )
    .expect("check trusted known host"));

    let (sender, receiver) = mpsc::channel::<TerminalOutputEvent>();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: host.id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create terminal after host key trust");
    let mut output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for trusted terminal ready marker");
    let command = format!("echo {COMMAND_MARKER}\r");
    state
        .terminals()
        .write(&summary.id, &command)
        .expect("write trusted terminal command");
    output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        COMMAND_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("collect trusted terminal output");
    let _ = state.terminals().close(&summary.id);
    assert!(output.contains(COMMAND_MARKER));
}

/// 当前服务端 key 与已有记录冲突时返回 changed，错误确认不能覆盖旧记录。
#[test]
fn changed_saved_host_key_is_rejected_without_overwrite() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_state();
    let host = create_saved_loopback_host(&state, &server, "changed host key");
    let known_hosts = state.paths().root.join("known_hosts");
    let old_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate conflicting host key");
    keys::known_hosts::learn_known_hosts_path(
        &host.host,
        host.port,
        old_key.public_key(),
        &known_hosts,
    )
    .expect("write conflicting known host");
    let known_hosts_before = std::fs::read(&known_hosts).expect("read conflicting known host");

    let runtime = Runtime::new().expect("create changed key runtime");
    let inspection = runtime
        .block_on(inspect_saved_host_key(state.paths(), &host))
        .expect("inspect changed saved host key");
    assert_eq!(inspection.status, SshHostKeyStatus::Changed);
    let trust = runtime.block_on(trust_saved_host_key(
        state.paths(),
        &host,
        &inspection.fingerprint,
    ));
    drop(runtime);
    assert!(trust.is_err());
    let known_hosts_after = std::fs::read(&known_hosts).expect("read known host after rejection");
    assert_eq!(known_hosts_after, known_hosts_before);
    let records = keys::known_hosts::known_host_keys_path(&host.host, host.port, &known_hosts)
        .expect("parse conflicting known host");
    assert_eq!(records.len(), 1);
    assert_eq!(&records[0].1, old_key.public_key());
}

/// revoked 记录即使与当前 key 匹配也必须映射为 changed，不能降级为已知。
#[test]
fn revoked_saved_host_key_is_reported_as_changed() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_state();
    let host = create_saved_loopback_host(&state, &server, "revoked host key");
    let known_hosts = state.paths().root.join("known_hosts");
    keys::known_hosts::learn_known_hosts_path(
        &host.host,
        host.port,
        &server.host_key,
        &known_hosts,
    )
    .expect("write known host before revoke");
    append_revoked_key(&known_hosts, &server.host_key);

    let runtime = Runtime::new().expect("create revoked key runtime");
    let inspection = runtime
        .block_on(inspect_saved_host_key(state.paths(), &host))
        .expect("inspect revoked saved host key");
    drop(runtime);

    assert_eq!(inspection.status, SshHostKeyStatus::Changed);
}

/// 空确认值和非直连路由都必须在网络探测前失败，避免旁路实际 SSH 路由。
#[test]
fn saved_host_key_confirmation_rejects_empty_and_unsupported_routes() {
    let server = LoopbackTerminalServer::start();
    let (_home, state) = create_loopback_state();
    let host = create_saved_loopback_host(&state, &server, "route validation");
    let runtime = Runtime::new().expect("create route validation runtime");

    let empty_fingerprint = runtime.block_on(trust_saved_host_key(state.paths(), &host, "  "));
    assert!(matches!(empty_fingerprint, Err(AppError::InvalidInput(_))));

    let mut jump_host = host.clone();
    jump_host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "test jump".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: 22,
        username: LOOPBACK_USER.to_owned(),
        auth_type: RemoteHostAuthType::Agent,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
    });
    let jump_error = runtime.block_on(inspect_saved_host_key(state.paths(), &jump_host));
    assert!(matches!(jump_error, Err(AppError::SshCommand(_))));

    let mut proxy_host = host;
    proxy_host.ssh_options.proxy.protocol = SshProxyProtocol::Socks5;
    let proxy_error = runtime.block_on(inspect_saved_host_key(state.paths(), &proxy_host));
    drop(runtime);
    assert!(matches!(proxy_error, Err(AppError::SshCommand(_))));
}

/// 在隔离 known_hosts 中追加 OpenSSH revoked marker，复现策略层的撤销语义。
fn append_revoked_key(path: &std::path::Path, key: &russh::keys::PublicKey) {
    use std::io::Write;

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open known host for revoked marker");
    writeln!(
        file,
        "@revoked * {}",
        key.to_openssh().expect("encode revoked key")
    )
    .expect("append revoked marker");
}

/// 为原生桌面验收启动一个隔离配置根中的 saved host，并等待主任务用 stop 文件结束。
#[test]
#[ignore = "由主任务以 --ignored --nocapture 启动，配合真实 Tauri desktop 验收"]
fn ssh_host_key_desktop_smoke() {
    let root = std::env::var_os("KERMINAL_HOST_KEY_SMOKE_ROOT")
        .map(std::path::PathBuf::from)
        .expect("KERMINAL_HOST_KEY_SMOKE_ROOT is required");
    std::fs::create_dir_all(&root).expect("create host key smoke root");
    let stop_path = std::env::var_os("KERMINAL_HOST_KEY_SMOKE_STOP")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join("STOP"));
    let server = LoopbackTerminalServer::start();
    let state = AppState::initialize_with_paths(KerminalPaths::from_root(&root))
        .expect("initialize isolated desktop smoke state");
    let host = create_saved_loopback_host(&state, &server, "Desktop host key smoke");
    assert!(
        !state.paths().root.join("known_hosts").exists(),
        "desktop smoke must start without pre-trusted known_hosts"
    );
    let fingerprint = server.host_key.fingerprint(HashAlg::Sha256);
    println!(
        "SSH_HOST_KEY_SMOKE_READY hostId={} host={} port={} fingerprint={} root={} stop={}",
        host.id,
        host.host,
        host.port,
        fingerprint,
        root.display(),
        stop_path.display()
    );

    let deadline = Instant::now() + Duration::from_secs(15 * 60);
    while Instant::now() < deadline && !stop_path.exists() {
        std::thread::sleep(Duration::from_millis(250));
    }
    drop(state);
    drop(server);
    assert!(
        stop_path.exists() || Instant::now() >= deadline,
        "desktop smoke ended without stop marker or deadline"
    );
}
