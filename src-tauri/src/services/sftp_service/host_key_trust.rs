//! 显式 SSH 主机密钥信任探测；只完成握手并写入 known_hosts，不认证或打开 SFTP。
//!
//! @author kongweiguang

use std::{path::Path, sync::Arc, time::Duration};

use russh::{
    client,
    keys::{self, PublicKey},
};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::RemoteHost,
    services::ssh_runtime::policy::known_hosts_revokes_key,
};

use super::backend::SftpRuntimeSettings;

#[derive(Debug)]
struct HostKeyTrustHandler {
    host: String,
    port: u16,
    known_hosts_path: std::path::PathBuf,
}

impl client::Handler for HostKeyTrustHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        if known_hosts_revokes_key(key, &self.known_hosts_path) {
            return Ok(false);
        }
        match keys::known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            key,
            &self.known_hosts_path,
        ) {
            Ok(true) => Ok(true),
            Ok(false) => Ok(keys::known_hosts::learn_known_hosts_path(
                &self.host,
                self.port,
                key,
                &self.known_hosts_path,
            )
            .is_ok()),
            Err(_) => Ok(false),
        }
    }
}

pub(super) async fn trust_host_key_without_authentication(
    host: &RemoteHost,
    known_hosts_path: &Path,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    let handler = HostKeyTrustHandler {
        host: host.host.clone(),
        port: host.port,
        known_hosts_path: known_hosts_path.to_path_buf(),
    };
    let timeout = Duration::from_secs(settings.timeout_seconds.max(1));
    let ssh = tokio::time::timeout(
        timeout,
        client::connect(
            Arc::new(client::Config::default()),
            (host.host.as_str(), host.port),
            handler,
        ),
    )
    .await
    .map_err(|_| AppError::Sftp(format!("SSH 主机密钥探测超时（{} 秒）", timeout.as_secs())))?
    .map_err(|error| AppError::Sftp(format!("SSH 主机密钥探测失败: {error}")))?;
    let _ = ssh
        .disconnect(russh::Disconnect::ByApplication, "host key trusted", "")
        .await;
    Ok(())
}
