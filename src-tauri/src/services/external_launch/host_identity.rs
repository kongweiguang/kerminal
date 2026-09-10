//! 外部启动 SSH 主机身份探测与显式信任。
//!
//! @author kongweiguang

use std::{
    path::Path,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use russh::{
    client,
    keys::{self, HashAlg, PublicKey},
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    services::ssh_runtime::policy::known_hosts_revokes_key,
};

use super::materializer::ExternalMaterializedTarget;

const HOST_KEY_PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const KNOWN_HOSTS_IO_TIMEOUT: Duration = Duration::from_secs(2);
const KNOWN_HOSTS_QUEUE_TIMEOUT: Duration = Duration::from_millis(500);
const KNOWN_HOSTS_WORKER_CAPACITY: usize = 4;
const EXTERNAL_SSH_MAX_JUMP_HOSTS: usize = 8;
const MAX_KNOWN_HOSTS_BYTES: u64 = 4 * 1024 * 1024;
static KNOWN_HOSTS_WORKERS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(KNOWN_HOSTS_WORKER_CAPACITY)));
static KNOWN_HOSTS_MUTATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 外部目标当前 known_hosts 状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalHostKeyStatus {
    Known,
    Unknown,
    Changed,
}

/// 前端确认所需的脱敏主机身份信息。
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalHostKeyInspection {
    pub algorithm: String,
    pub fingerprint: String,
    pub host: String,
    pub launch_id: String,
    pub port: u16,
    pub status: ExternalHostKeyStatus,
}

impl std::fmt::Debug for ExternalHostKeyInspection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ExternalHostKeyInspection")
            .field("algorithm", &self.algorithm)
            .field("fingerprint", &self.fingerprint)
            .field("host", &"<redacted>")
            .field(
                "request_hash",
                &super::redaction::opaque_id_hash(&self.launch_id),
            )
            .field("port", &self.port)
            .field("status", &self.status)
            .finish()
    }
}

/// 探测 materialized external target 的服务端公钥，不进行认证或执行远程命令。
pub async fn inspect_external_host_key(
    paths: &KerminalPaths,
    target: &ExternalMaterializedTarget,
) -> AppResult<ExternalHostKeyInspection> {
    if !target.host.ssh_options.jump_hosts.is_empty() {
        return inspect_preprovisioned_route_bounded(paths, target).await;
    }
    let key = probe_server_key(&target.host.host, target.host.port).await?;
    inspect_known_hosts_bounded(
        target.launch_id.clone(),
        target.host.host.clone(),
        target.host.port,
        key,
        paths.root.join("known_hosts"),
    )
    .await
}

/// 在不执行认证的前提下探测服务端公钥；调用方必须在得到公钥后独立完成信任分类。
pub(crate) async fn probe_server_key(host: &str, port: u16) -> AppResult<PublicKey> {
    let captured = Arc::new(Mutex::new(None));
    let handler = HostKeyProbeHandler {
        captured: Arc::clone(&captured),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(HOST_KEY_PROBE_TIMEOUT),
        ..Default::default()
    });
    let connect = client::connect(config, (host, port), handler);
    // check_server_key 会在捕获第一把 key 后拒绝握手；这里故意忽略握手错误，
    // 只要捕获到 key 就可以进入后续的 known_hosts 分类，避免探测承担认证副作用。
    let _ = tokio::time::timeout(HOST_KEY_PROBE_TIMEOUT, connect)
        .await
        .map_err(|_| AppError::SshCommand("SSH 主机指纹探测超时".to_owned()))?;
    let captured_key = captured
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("external host key probe"))?
        .clone();
    captured_key.ok_or_else(|| AppError::SshCommand("SSH 服务端未提供可核验的主机密钥".to_owned()))
}

/// 在受限 blocking worker 中读取并分类 known_hosts，防止文件 I/O 阻塞 Tauri executor。
pub(crate) async fn classify_server_key_bounded(
    host: String,
    port: u16,
    key: PublicKey,
    known_hosts_path: std::path::PathBuf,
) -> AppResult<ExternalHostKeyStatus> {
    run_known_hosts_worker(move || {
        validate_known_hosts_file(&known_hosts_path)?;
        Ok(classify_key_status(&host, port, &key, &known_hosts_path))
    })
    .await
}

/// 在一次受限 known_hosts 操作中复核当前 key，并且只为 unknown 状态追加记录。
pub(crate) async fn trust_server_key_bounded(
    host: String,
    port: u16,
    key: PublicKey,
    known_hosts_path: std::path::PathBuf,
) -> AppResult<ExternalHostKeyStatus> {
    run_known_hosts_worker(move || {
        let _mutation_guard = KNOWN_HOSTS_MUTATION_LOCK
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("known_hosts mutation"))?;
        validate_known_hosts_file(&known_hosts_path)?;
        match classify_key_status(&host, port, &key, &known_hosts_path) {
            ExternalHostKeyStatus::Known => Ok(ExternalHostKeyStatus::Known),
            ExternalHostKeyStatus::Changed => Err(AppError::SshCommand(
                "SSH 主机密钥已变化，必须先人工核验并清理冲突 known_hosts".to_owned(),
            )),
            ExternalHostKeyStatus::Unknown => {
                keys::known_hosts::learn_known_hosts_path(&host, port, &key, &known_hosts_path)
                    .map_err(|_| AppError::SshCommand("写入 known_hosts 失败".to_owned()))?;
                Ok(ExternalHostKeyStatus::Known)
            }
        }
    })
    .await
}

/// 仅在二次探测到的 fingerprint 与用户确认值一致时写入 known_hosts。
pub async fn trust_external_host_key(
    paths: &KerminalPaths,
    target: &ExternalMaterializedTarget,
    expected_fingerprint: &str,
) -> AppResult<ExternalHostKeyInspection> {
    if !target.host.ssh_options.jump_hosts.is_empty() {
        let inspection = inspect_preprovisioned_route_bounded(paths, target).await?;
        if inspection.fingerprint != expected_fingerprint.trim() {
            return Err(AppError::InvalidInput(
                "预置 SSH 主机指纹与确认值不一致，已拒绝连接".to_owned(),
            ));
        }
        return Ok(inspection);
    }
    let key = probe_server_key(&target.host.host, target.host.port).await?;
    let known_hosts_path = paths.root.join("known_hosts");
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    if fingerprint != expected_fingerprint.trim() {
        return Err(AppError::InvalidInput(
            "SSH 主机指纹在确认期间发生变化，已拒绝信任".to_owned(),
        ));
    }
    trust_known_hosts_bounded(
        target.launch_id.clone(),
        target.host.host.clone(),
        target.host.port,
        key,
        known_hosts_path,
    )
    .await
}

async fn inspect_known_hosts_bounded(
    launch_id: String,
    host: String,
    port: u16,
    key: PublicKey,
    known_hosts_path: std::path::PathBuf,
) -> AppResult<ExternalHostKeyInspection> {
    run_known_hosts_worker(move || {
        validate_known_hosts_file(&known_hosts_path)?;
        Ok(inspection_for_key(
            &launch_id,
            &host,
            port,
            &key,
            &known_hosts_path,
        ))
    })
    .await
}

async fn trust_known_hosts_bounded(
    launch_id: String,
    host: String,
    port: u16,
    key: PublicKey,
    known_hosts_path: std::path::PathBuf,
) -> AppResult<ExternalHostKeyInspection> {
    run_known_hosts_worker(move || {
        let _mutation_guard = KNOWN_HOSTS_MUTATION_LOCK
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("known_hosts mutation"))?;
        validate_known_hosts_file(&known_hosts_path)?;
        let inspection = inspection_for_key(&launch_id, &host, port, &key, &known_hosts_path);
        match inspection.status {
            ExternalHostKeyStatus::Known => Ok(inspection),
            ExternalHostKeyStatus::Changed => Err(AppError::SshCommand(
                "SSH 主机密钥已变化，必须先人工核验并清理冲突 known_hosts".to_owned(),
            )),
            ExternalHostKeyStatus::Unknown => {
                keys::known_hosts::learn_known_hosts_path(&host, port, &key, &known_hosts_path)
                    .map_err(|_| AppError::SshCommand("写入 known_hosts 失败".to_owned()))?;
                Ok(ExternalHostKeyInspection {
                    status: ExternalHostKeyStatus::Known,
                    ..inspection
                })
            }
        }
    })
    .await
}

async fn run_known_hosts_worker<T, F>(worker: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    let permit = tokio::time::timeout(
        KNOWN_HOSTS_QUEUE_TIMEOUT,
        KNOWN_HOSTS_WORKERS.clone().acquire_owned(),
    )
    .await
    .map_err(|_| AppError::SshCommand("known_hosts worker 繁忙，请稍后重试".to_owned()))?
    .map_err(|_| AppError::SshCommand("known_hosts worker 已关闭".to_owned()))?;
    let task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        worker()
    });
    tokio::time::timeout(KNOWN_HOSTS_IO_TIMEOUT, task)
        .await
        .map_err(|_| AppError::SshCommand("known_hosts 操作超时".to_owned()))?
        .map_err(|error| AppError::SshCommand(format!("known_hosts worker 失败: {error}")))?
}

fn validate_known_hosts_file(path: &Path) -> AppResult<()> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(AppError::SshCommand("无法检查 known_hosts".to_owned())),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::SshCommand(
            "known_hosts 必须是普通非符号链接文件".to_owned(),
        ));
    }
    if metadata.len() > MAX_KNOWN_HOSTS_BYTES {
        return Err(AppError::SshCommand(
            "known_hosts 超过 4 MiB 安全上限".to_owned(),
        ));
    }
    Ok(())
}

/// 对已获取的 server key 做纯 known_hosts 分类，供测试和其它受控入口复用。
#[doc(hidden)]
pub fn inspection_for_key(
    launch_id: &str,
    host: &str,
    port: u16,
    key: &PublicKey,
    known_hosts_path: &Path,
) -> ExternalHostKeyInspection {
    let status = classify_key_status(host, port, key, known_hosts_path);
    ExternalHostKeyInspection {
        algorithm: key.algorithm().to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        host: host.to_owned(),
        launch_id: launch_id.to_owned(),
        port,
        status,
    }
}

/// 以 host+port 为边界区分首次连接、匹配记录和同目标旧 key，避免把 changed 降级为 unknown。
fn classify_key_status(
    host: &str,
    port: u16,
    key: &PublicKey,
    known_hosts_path: &Path,
) -> ExternalHostKeyStatus {
    if known_hosts_revokes_key(key, known_hosts_path) {
        return ExternalHostKeyStatus::Changed;
    }
    match keys::known_hosts::known_host_keys_path(host, port, known_hosts_path) {
        Ok(records) if records.iter().any(|(_, recorded)| recorded == key) => {
            ExternalHostKeyStatus::Known
        }
        Ok(records) if !records.is_empty() => ExternalHostKeyStatus::Changed,
        Ok(_) => ExternalHostKeyStatus::Unknown,
        Err(_) => ExternalHostKeyStatus::Changed,
    }
}

async fn inspect_preprovisioned_route_bounded(
    paths: &KerminalPaths,
    target: &ExternalMaterializedTarget,
) -> AppResult<ExternalHostKeyInspection> {
    let launch_id = target.launch_id.clone();
    let host = target.host.host.clone();
    let port = target.host.port;
    let jumps = target
        .host
        .ssh_options
        .jump_hosts
        .iter()
        .map(|jump| (jump.host.clone(), jump.port))
        .collect::<Vec<_>>();
    let known_hosts_path = paths.root.join("known_hosts");
    run_known_hosts_worker(move || {
        inspection_for_preprovisioned_route(&launch_id, &host, port, &jumps, &known_hosts_path)
    })
    .await
}

/// 跳板链不能绕过代理直接探测最终目标；只有完整预置每一跳和目标公钥时才允许继续。
#[doc(hidden)]
pub fn inspection_for_preprovisioned_route(
    launch_id: &str,
    host: &str,
    port: u16,
    jumps: &[(String, u16)],
    known_hosts_path: &Path,
) -> AppResult<ExternalHostKeyInspection> {
    validate_known_hosts_file(known_hosts_path)?;
    if jumps.len() > EXTERNAL_SSH_MAX_JUMP_HOSTS {
        return Err(AppError::InvalidInput(
            "外部 SSH 跳板链超过 8 跳安全上限".to_owned(),
        ));
    }
    for (index, (jump_host, jump_port)) in jumps.iter().enumerate() {
        let keys = keys::known_hosts::known_host_keys_path(jump_host, *jump_port, known_hosts_path)
            .map_err(|_| AppError::SshCommand("无法解析预置 known_hosts".to_owned()))?;
        if keys.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "外部 SSH 跳板链第 {} 跳缺少预置主机密钥",
                index + 1
            )));
        }
        if keys
            .iter()
            .any(|(_, key)| known_hosts_revokes_key(key, known_hosts_path))
        {
            return Err(AppError::SshCommand(format!(
                "外部 SSH 跳板链第 {} 跳存在 revoked 主机密钥，已拒绝连接",
                index + 1
            )));
        }
    }
    let target_keys = keys::known_hosts::known_host_keys_path(host, port, known_hosts_path)
        .map_err(|_| AppError::SshCommand("无法解析预置 known_hosts".to_owned()))?;
    let Some((_, key)) = target_keys.first() else {
        return Err(AppError::InvalidInput(
            "外部 SSH 跳板链最终目标缺少预置主机密钥".to_owned(),
        ));
    };
    if target_keys
        .iter()
        .any(|(_, candidate)| known_hosts_revokes_key(candidate, known_hosts_path))
    {
        return Err(AppError::SshCommand(
            "预置 SSH 主机密钥已被 revoked，已拒绝连接".to_owned(),
        ));
    }
    Ok(ExternalHostKeyInspection {
        algorithm: key.algorithm().to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        host: host.to_owned(),
        launch_id: launch_id.to_owned(),
        port,
        status: ExternalHostKeyStatus::Known,
    })
}

struct HostKeyProbeHandler {
    captured: Arc<Mutex<Option<PublicKey>>>,
}

impl client::Handler for HostKeyProbeHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        if let Ok(mut captured) = self.captured.lock() {
            *captured = Some(server_public_key.clone());
        }
        // 探测阶段永远不继续认证；用户确认后由 trust 命令按同一 fingerprint 写入。
        Ok(false)
    }
}
