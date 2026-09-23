//! SFTP 恢复测试的临时状态、主机和故障服务器构造器。
//!
//! 这些 fixture 只监听本机随机端口，并使用每次测试生成的 host key；它们不读取
//! Kerminal 用户目录、vault 或外部主机，因此可以安全地验证真实 russh/SFTP 通道。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

pub(crate) mod server;

/// 创建完全隔离的应用状态，使恢复测试不会触碰用户的配置或凭据。
pub(crate) fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create isolated Kerminal test home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize isolated app state");
    (home, state)
}

/// 在临时配置中登记 loopback 密码主机；密码只存在于该测试临时目录的配置范围内。
pub(crate) fn create_loopback_host(state: &AppState, name: &str, port: u16) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: name.to_owned(),
            port,
            ssh_options: Default::default(),
            tags: vec!["sftp-recovery-test".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create temporary loopback host")
        .id
}
