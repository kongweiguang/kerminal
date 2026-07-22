//! SFTP native SSH 连接链和跳板机适配。
//!
//! @author kongweiguang

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use russh::{
    client,
    keys::{
        self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
    },
};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
    services::{
        ssh_identity_file::resolve_identity_file_path, ssh_runtime::policy::known_hosts_revokes_key,
    },
};

use super::backend::{SftpAuthMaterial, SftpEndpoint, SftpPrivateKey, SftpRuntimeSettings};

pub(super) struct NativeSftpSshConnection {
    jumps: Vec<client::Handle<NativeClientHandler>>,
    target: client::Handle<NativeClientHandler>,
}

impl NativeSftpSshConnection {
    pub(super) fn target(&self) -> &client::Handle<NativeClientHandler> {
        &self.target
    }

    pub(super) async fn disconnect(self, reason: &str) {
        let _ = self
            .target
            .disconnect(russh::Disconnect::ByApplication, reason, "")
            .await;
        for jump in self.jumps.into_iter().rev() {
            let _ = jump
                .disconnect(russh::Disconnect::ByApplication, reason, "")
                .await;
        }
    }
}

#[derive(Debug)]
pub(super) struct NativeClientHandler {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) known_hosts_path: PathBuf,
    pub(super) host_key_policy: HostKeyPolicy,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum HostKeyPolicy {
    RequireKnown,
    TrustUnknown,
}

struct NativeSftpHopExecution {
    auth: SftpAuthMaterial,
    host: String,
    host_key_policy: HostKeyPolicy,
    known_hosts_path: PathBuf,
    label: String,
    port: u16,
    username: String,
}

impl client::Handler for NativeClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        if known_hosts_revokes_key(server_public_key, &self.known_hosts_path) {
            return Ok(false);
        }
        match keys::known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        ) {
            Ok(true) => Ok(true),
            Ok(false) => match self.host_key_policy {
                HostKeyPolicy::RequireKnown => Ok(false),
                HostKeyPolicy::TrustUnknown => Ok(keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    &self.known_hosts_path,
                )
                .is_ok()),
            },
            Err(_) => Ok(false),
        }
    }
}

pub(super) async fn connect_native_ssh_chain(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
) -> AppResult<NativeSftpSshConnection> {
    let target = build_native_target_execution(endpoint)?;
    let jumps = build_native_jump_executions(endpoint)?;
    if jumps.is_empty() {
        let mut target_ssh = connect_native_ssh_hop(&target, settings).await?;
        authenticate_native_sftp(&mut target_ssh, &target).await?;
        return Ok(NativeSftpSshConnection {
            jumps: Vec::new(),
            target: target_ssh,
        });
    }

    let mut jump_handles = Vec::with_capacity(jumps.len());
    let mut upstream = connect_native_ssh_hop(&jumps[0], settings).await?;
    authenticate_native_sftp(&mut upstream, &jumps[0]).await?;

    for jump in jumps.iter().skip(1) {
        let mut next = connect_native_ssh_through_direct_tcpip(&upstream, jump, settings).await?;
        authenticate_native_sftp(&mut next, jump).await?;
        jump_handles.push(upstream);
        upstream = next;
    }

    let mut target_ssh =
        connect_native_ssh_through_direct_tcpip(&upstream, &target, settings).await?;
    authenticate_native_sftp(&mut target_ssh, &target).await?;
    jump_handles.push(upstream);

    Ok(NativeSftpSshConnection {
        jumps: jump_handles,
        target: target_ssh,
    })
}

pub(super) async fn trust_native_host_key(
    host: &RemoteHost,
    known_hosts_path: &Path,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    let ssh = connect_native_ssh(
        host,
        known_hosts_path.to_path_buf(),
        HostKeyPolicy::TrustUnknown,
        settings,
    )
    .await?;
    let _ = ssh
        .disconnect(russh::Disconnect::ByApplication, "host key trusted", "")
        .await;
    Ok(())
}

async fn connect_native_ssh(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    host_key_policy: HostKeyPolicy,
    settings: SftpRuntimeSettings,
) -> AppResult<client::Handle<NativeClientHandler>> {
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeClientHandler {
        host: host.host.clone(),
        port: host.port,
        known_hosts_path,
        host_key_policy,
    };
    let timeout = Duration::from_secs(settings.timeout_seconds.max(1));
    match tokio::time::timeout(
        timeout,
        client::connect(Arc::new(config), (host.host.as_str(), host.port), handler),
    )
    .await
    {
        Ok(result) => result.map_err(native_ssh_error),
        Err(_) => Err(AppError::Sftp(format!(
            "SSH 连接超时（{} 秒）: {}@{}:{}",
            timeout.as_secs(),
            host.username,
            host.host,
            host.port
        ))),
    }
}

async fn connect_native_ssh_hop(
    hop: &NativeSftpHopExecution,
    settings: SftpRuntimeSettings,
) -> AppResult<client::Handle<NativeClientHandler>> {
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeClientHandler {
        host: hop.host.clone(),
        port: hop.port,
        known_hosts_path: hop.known_hosts_path.clone(),
        host_key_policy: hop.host_key_policy,
    };
    let timeout = Duration::from_secs(settings.timeout_seconds.max(1));
    match tokio::time::timeout(
        timeout,
        client::connect(Arc::new(config), (hop.host.as_str(), hop.port), handler),
    )
    .await
    {
        Ok(result) => result.map_err(|error| native_ssh_hop_error("连接", hop, error)),
        Err(_) => Err(AppError::Sftp(format!(
            "SSH 连接超时（{} 秒）: {}",
            timeout.as_secs(),
            hop_connection_label(hop)
        ))),
    }
}

async fn connect_native_ssh_through_direct_tcpip(
    upstream: &client::Handle<NativeClientHandler>,
    hop: &NativeSftpHopExecution,
    settings: SftpRuntimeSettings,
) -> AppResult<client::Handle<NativeClientHandler>> {
    let timeout = Duration::from_secs(settings.timeout_seconds.max(1));
    let channel = match tokio::time::timeout(
        timeout,
        upstream.channel_open_direct_tcpip(hop.host.clone(), u32::from(hop.port), "127.0.0.1", 0),
    )
    .await
    {
        Ok(result) => result.map_err(|error| {
            AppError::Sftp(format!(
                "无法通过跳板打开 direct-tcpip 到 {}: {error}",
                hop_connection_label(hop)
            ))
        })?,
        Err(_) => {
            return Err(AppError::Sftp(format!(
                "通过跳板打开 direct-tcpip 超时（{} 秒）: {}",
                timeout.as_secs(),
                hop_connection_label(hop)
            )));
        }
    };
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeClientHandler {
        host: hop.host.clone(),
        port: hop.port,
        known_hosts_path: hop.known_hosts_path.clone(),
        host_key_policy: hop.host_key_policy,
    };
    match tokio::time::timeout(
        timeout,
        client::connect_stream(Arc::new(config), channel.into_stream(), handler),
    )
    .await
    {
        Ok(result) => result.map_err(|error| native_ssh_hop_error("连接", hop, error)),
        Err(_) => Err(AppError::Sftp(format!(
            "SSH 跳板链路连接超时（{} 秒）: {}",
            timeout.as_secs(),
            hop_connection_label(hop)
        ))),
    }
}

fn build_native_target_execution(endpoint: &SftpEndpoint) -> AppResult<NativeSftpHopExecution> {
    Ok(NativeSftpHopExecution {
        auth: endpoint.auth.clone(),
        host: required_native_text(&endpoint.host.host, "目标主机 host")?,
        host_key_policy: host_key_policy_for_endpoint(endpoint),
        known_hosts_path: endpoint.known_hosts_path.clone(),
        label: "目标主机".to_owned(),
        port: required_native_port(endpoint.host.port, "目标主机 port")?,
        username: required_native_text(&endpoint.host.username, "目标主机 username")?,
    })
}

fn build_native_jump_executions(endpoint: &SftpEndpoint) -> AppResult<Vec<NativeSftpHopExecution>> {
    endpoint
        .host
        .ssh_options
        .jump_hosts
        .iter()
        .enumerate()
        .map(|(index, jump)| {
            build_native_jump_execution(index, jump, endpoint.known_hosts_path.clone())
        })
        .collect()
}

fn build_native_jump_execution(
    index: usize,
    jump: &SshJumpHostOptions,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSftpHopExecution> {
    let label = format!("跳板主机 jump-{index}");
    Ok(NativeSftpHopExecution {
        auth: resolve_native_jump_auth_material(jump, &label)?,
        host: required_native_text(&jump.host, &format!("{label} host"))?,
        host_key_policy: HostKeyPolicy::RequireKnown,
        known_hosts_path,
        label: label.clone(),
        port: required_native_port(jump.port, &format!("{label} port"))?,
        username: required_native_text(&jump.username, &format!("{label} username"))?,
    })
}

fn host_key_policy_for_endpoint(endpoint: &SftpEndpoint) -> HostKeyPolicy {
    let _ = endpoint;
    // SFTP 与 terminal/exec 共用 fail-closed 主机身份策略；首次信任只能走显式确认入口。
    HostKeyPolicy::RequireKnown
}

fn resolve_native_jump_auth_material(
    jump: &SshJumpHostOptions,
    label: &str,
) -> AppResult<SftpAuthMaterial> {
    match jump.auth_type {
        RemoteHostAuthType::Agent => Ok(SftpAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_jump_credential_secret(
                jump,
                &format!("{label} 密码认证需要已保存 SSH 密码"),
            )?;
            Ok(SftpAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_jump_credential_secret(jump) {
                return Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Pem {
                    content: secret.to_owned(),
                    passphrase: normalized_jump_key_passphrase_secret(jump).map(ToOwned::to_owned),
                }));
            }
            let credential_ref = required_jump_credential_ref(jump, label)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(format!(
                    "{label} 不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                )));
            }
            Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Path {
                path: resolve_identity_file_path(credential_ref)?,
                passphrase: normalized_jump_key_passphrase_secret(jump).map(ToOwned::to_owned),
            }))
        }
    }
}

async fn authenticate_native_sftp(
    ssh: &mut client::Handle<NativeClientHandler>,
    hop: &NativeSftpHopExecution,
) -> AppResult<()> {
    let username = hop.username.clone();
    let authenticated = match &hop.auth {
        SftpAuthMaterial::Password(password) => ssh
            .authenticate_password(username, password.clone())
            .await
            .map_err(native_ssh_error)?
            .success(),
        SftpAuthMaterial::PrivateKey(private_key) => {
            let key = load_private_key(private_key)?;
            let hash = ssh
                .best_supported_rsa_hash()
                .await
                .map_err(native_ssh_error)?
                .flatten();
            ssh.authenticate_publickey(username, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(native_ssh_error)?
                .success()
        }
        SftpAuthMaterial::Agent => authenticate_with_agent(ssh, username).await?,
    };

    if authenticated {
        Ok(())
    } else {
        Err(AppError::Sftp(format!(
            "SSH 认证失败: {}",
            hop_connection_label(hop)
        )))
    }
}

async fn authenticate_with_agent(
    ssh: &mut client::Handle<NativeClientHandler>,
    username: String,
) -> AppResult<bool> {
    let mut agent = connect_agent().await?;
    let identities = agent.request_identities().await.map_err(agent_error)?;
    for identity in identities {
        let key = match &identity {
            AgentIdentity::PublicKey { key, .. } => key.clone(),
            AgentIdentity::Certificate { .. } => identity.public_key().into_owned(),
        };
        let hash = ssh
            .best_supported_rsa_hash()
            .await
            .map_err(native_ssh_error)?
            .flatten();
        let result = ssh
            .authenticate_publickey_with(username.clone(), key, hash, &mut agent)
            .await
            .map_err(|error| AppError::Sftp(format!("SSH agent 认证失败: {error}")))?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    keys::agent::client::AgentClient::connect_env()
        .await
        .map(|client| client.dynamic())
        .map_err(agent_error)
}

#[cfg(windows)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    match keys::agent::client::AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
        Ok(client) => Ok(client.dynamic()),
        Err(openssh_error) => keys::agent::client::AgentClient::connect_pageant()
            .await
            .map(|client| client.dynamic())
            .map_err(|pageant_error| {
                AppError::Sftp(format!(
                    "SSH agent 连接失败: OpenSSH agent ({OPENSSH_AGENT_PIPE}) {openssh_error}; Pageant {pageant_error}"
                ))
            }),
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    Err(AppError::Sftp(
        "当前平台不支持 SSH agent 认证，请改用密码或私钥凭据".to_owned(),
    ))
}

fn load_private_key(private_key: &SftpPrivateKey) -> AppResult<PrivateKey> {
    match private_key {
        SftpPrivateKey::Path { path, passphrase } => {
            load_secret_key(path, passphrase.as_deref()).map_err(key_error)
        }
        SftpPrivateKey::Pem {
            content,
            passphrase,
        } => keys::decode_secret_key(content, passphrase.as_deref()).map_err(key_error),
    }
}

fn required_native_text(value: &str, field: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        Err(AppError::InvalidInput(format!("{field} 不能为空")))
    } else {
        Ok(normalized.to_owned())
    }
}

fn required_native_port(port: u16, field: &str) -> AppResult<u16> {
    if port == 0 {
        Err(AppError::InvalidInput(format!("{field} 必须大于 0")))
    } else {
        Ok(port)
    }
}

fn required_jump_credential_ref<'a>(
    jump: &'a SshJumpHostOptions,
    label: &str,
) -> AppResult<&'a str> {
    jump.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!("{label} 密钥认证需要保存私钥路径或明文私钥内容"))
        })
}

fn required_jump_credential_secret(jump: &SshJumpHostOptions, message: &str) -> AppResult<String> {
    normalized_jump_credential_secret(jump)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_jump_credential_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalized_jump_key_passphrase_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.key_passphrase_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn hop_connection_label(hop: &NativeSftpHopExecution) -> String {
    format!("{} {}@{}:{}", hop.label, hop.username, hop.host, hop.port)
}

fn native_ssh_error(error: russh::Error) -> AppError {
    AppError::Sftp(format!("SSH 连接失败: {error}"))
}

fn native_ssh_hop_error(
    action: &str,
    hop: &NativeSftpHopExecution,
    error: russh::Error,
) -> AppError {
    AppError::Sftp(format!(
        "SSH {action}失败（{}）: {error}",
        hop_connection_label(hop)
    ))
}

fn key_error(error: keys::Error) -> AppError {
    AppError::Sftp(format!("SSH 私钥加载失败: {error}"))
}

fn agent_error(error: keys::Error) -> AppError {
    AppError::Sftp(format!("SSH agent 连接失败: {error}"))
}
