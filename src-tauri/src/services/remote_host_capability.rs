//! 保存主机协议的权威能力门禁。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::remote_host::RemoteHost,
};

/// 需要由保存主机协议授权的运行态能力。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteHostCapability {
    /// SFTP 浏览与文件传输。
    Sftp,
    /// SSH shell、exec、端口转发及其派生能力。
    Shell,
}

/// 在任何网络副作用发生前拒绝协议不允许的能力。
pub fn ensure_remote_host_capability(
    host: &RemoteHost,
    capability: RemoteHostCapability,
) -> AppResult<()> {
    let allowed = match capability {
        RemoteHostCapability::Sftp => host.protocol.supports_sftp(),
        RemoteHostCapability::Shell => host.protocol.supports_shell(),
    };
    if allowed {
        return Ok(());
    }

    let capability_label = match capability {
        RemoteHostCapability::Sftp => "SFTP 文件",
        RemoteHostCapability::Shell => "SSH shell",
    };
    Err(AppError::InvalidInput(format!(
        "host_capability_not_supported: {:?} 主机不支持 {capability_label} 能力",
        host.protocol
    )))
}
