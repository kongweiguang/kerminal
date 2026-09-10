//! 已保存 SSH 主机的服务端 key 探测与显式信任。
//!
//! @author kongweiguang

use std::path::PathBuf;

use russh::keys::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, SshProxyProtocol},
    paths::KerminalPaths,
    services::{
        external_launch::host_identity::{
            classify_server_key_bounded, probe_server_key, trust_server_key_bounded,
            ExternalHostKeyStatus,
        },
        remote_host_capability::{ensure_remote_host_capability, RemoteHostCapability},
    },
};

/// saved-host 主机身份状态，使用稳定的小写值传给前端。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SshHostKeyStatus {
    Known,
    Unknown,
    Changed,
}

/// 前端确认弹层使用的脱敏 SSH 主机身份信息。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyInspection {
    pub algorithm: String,
    pub fingerprint: String,
    pub host: String,
    pub host_id: String,
    pub port: u16,
    pub status: SshHostKeyStatus,
}

/// 探测已保存主机的当前服务端 key，不解析凭据也不写入 known_hosts。
pub async fn inspect_saved_host_key(
    paths: &KerminalPaths,
    host: &RemoteHost,
) -> AppResult<SshHostKeyInspection> {
    ensure_probeable_saved_host(host)?;
    let key = probe_server_key(&host.host, host.port).await?;
    let status = classify_server_key_bounded(
        host.host.clone(),
        host.port,
        key.clone(),
        known_hosts_path(paths),
    )
    .await?;
    Ok(inspection_from_key(host, &key, status))
}

/// 二次探测已保存主机并校验 fingerprint 后才允许追加 known_hosts 记录。
pub async fn trust_saved_host_key(
    paths: &KerminalPaths,
    host: &RemoteHost,
    expected_fingerprint: &str,
) -> AppResult<SshHostKeyInspection> {
    ensure_probeable_saved_host(host)?;
    let expected_fingerprint = expected_fingerprint.trim();
    if expected_fingerprint.is_empty() {
        return Err(AppError::InvalidInput(
            "SSH 主机确认 fingerprint 不能为空".to_owned(),
        ));
    }

    let key = probe_server_key(&host.host, host.port).await?;
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    if fingerprint != expected_fingerprint {
        return Err(AppError::InvalidInput(
            "SSH 主机指纹在确认期间发生变化，已拒绝信任".to_owned(),
        ));
    }

    let status = trust_server_key_bounded(
        host.host.clone(),
        host.port,
        key.clone(),
        known_hosts_path(paths),
    )
    .await?;
    Ok(inspection_from_key(host, &key, status))
}

/// 只允许 shell 能力的已保存主机进入该 IPC，并拒绝绕过跳板链的直连探测。
fn ensure_probeable_saved_host(host: &RemoteHost) -> AppResult<()> {
    ensure_remote_host_capability(host, RemoteHostCapability::Shell)?;
    if !host.ssh_options.jump_hosts.is_empty() {
        return Err(AppError::SshCommand(
            "SSH 跳板链的主机指纹探测不支持绕过跳板，请先完成每一跳与目标的受控信任".to_owned(),
        ));
    }
    if host.ssh_options.proxy.protocol != SshProxyProtocol::None {
        return Err(AppError::SshCommand(
            "SSH 代理路径的主机指纹探测暂不支持直连旁路，请通过实际代理完成受控信任".to_owned(),
        ));
    }
    Ok(())
}

/// 从统一路径集合取得 known_hosts 路径，避免前端提供任意文件路径。
fn known_hosts_path(paths: &KerminalPaths) -> PathBuf {
    paths.root.join("known_hosts")
}

/// 将共用 host_identity 分类映射到 saved-host IPC DTO 的状态枚举。
fn map_status(status: ExternalHostKeyStatus) -> SshHostKeyStatus {
    match status {
        ExternalHostKeyStatus::Known => SshHostKeyStatus::Known,
        ExternalHostKeyStatus::Unknown => SshHostKeyStatus::Unknown,
        ExternalHostKeyStatus::Changed => SshHostKeyStatus::Changed,
    }
}

/// 构造不包含凭据的 DTO；服务端 key 的算法和 fingerprint 是唯一身份依据。
fn inspection_from_key(
    host: &RemoteHost,
    key: &PublicKey,
    status: ExternalHostKeyStatus,
) -> SshHostKeyInspection {
    SshHostKeyInspection {
        algorithm: key.algorithm().to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        host: host.host.clone(),
        host_id: host.id.clone(),
        port: host.port,
        status: map_status(status),
    }
}
