use std::{sync::Arc, time::Duration};

use russh::{
    client,
    keys::{self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg},
};

use crate::{
    error::{AppError, AppResult},
    services::ssh_command_service::native::{
        NativeCommandClientHandler, NativeHostKeyPolicy, NativeRemoteForwardRegistry,
        NativeSshAuthMaterial, NativeSshHopExecution, NativeSshPrivateKey,
    },
};

pub(super) async fn connect_native_ssh(
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        known_hosts_path: hop.known_hosts_path.clone(),
        port: hop.port,
        remote_forwards,
    };
    let timeout = Duration::from_secs(timeout_seconds.max(1));
    log_native_ssh_event("connect.start", hop, timeout.as_secs(), None);
    match tokio::time::timeout(
        timeout,
        client::connect(Arc::new(config), (hop.host.as_str(), hop.port), handler),
    )
    .await
    {
        Ok(result) => match result {
            Ok(handle) => {
                log_native_ssh_event("connect.ok", hop, timeout.as_secs(), None);
                Ok(handle)
            }
            Err(error) => {
                log_native_ssh_event(
                    "connect.failed",
                    hop,
                    timeout.as_secs(),
                    Some(&error.to_string()),
                );
                Err(native_ssh_error(error))
            }
        },
        Err(_) => {
            log_native_ssh_event("connect.timeout", hop, timeout.as_secs(), None);
            Err(AppError::SshCommand(format!(
                "SSH 连接超时（{} 秒）: {}",
                timeout.as_secs(),
                native_ssh_hop_label(hop)
            )))
        }
    }
}

pub(super) fn exec_cancelled_error() -> AppError {
    AppError::SshCommand("远程命令已取消".to_owned())
}

pub(super) async fn connect_native_ssh_through_direct_tcpip(
    upstream: &client::Handle<NativeCommandClientHandler>,
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let timeout = Duration::from_secs(timeout_seconds.max(1));
    let channel = match tokio::time::timeout(
        timeout,
        upstream.channel_open_direct_tcpip(hop.host.clone(), u32::from(hop.port), "127.0.0.1", 0),
    )
    .await
    {
        Ok(result) => result.map_err(|error| {
            AppError::SshCommand(format!(
                "无法通过跳板打开 direct-tcpip 到 {}@{}:{}: {error}",
                hop.username, hop.host, hop.port
            ))
        })?,
        Err(_) => {
            return Err(AppError::SshCommand(format!(
                "通过跳板打开 direct-tcpip 超时（{} 秒）: {}@{}:{}",
                timeout.as_secs(),
                hop.username,
                hop.host,
                hop.port
            )));
        }
    };
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        known_hosts_path: hop.known_hosts_path.clone(),
        port: hop.port,
        remote_forwards,
    };
    match tokio::time::timeout(
        timeout,
        client::connect_stream(Arc::new(config), channel.into_stream(), handler),
    )
    .await
    {
        Ok(result) => result.map_err(native_ssh_error),
        Err(_) => Err(AppError::SshCommand(format!(
            "SSH 跳板链路连接超时（{} 秒）: {}@{}:{}",
            timeout.as_secs(),
            hop.username,
            hop.host,
            hop.port
        ))),
    }
}

pub(super) async fn authenticate_native_ssh(
    ssh: &mut client::Handle<NativeCommandClientHandler>,
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
) -> AppResult<()> {
    let username = hop.username.clone();
    let timeout = Duration::from_secs(timeout_seconds.max(1));
    log_native_ssh_event("auth.start", hop, timeout.as_secs(), None);
    let authenticated = match tokio::time::timeout(timeout, async {
        match &hop.auth {
            NativeSshAuthMaterial::Password(password) => ssh
                .authenticate_password(username, password.clone())
                .await
                .map_err(native_ssh_error)
                .map(|result| result.success()),
            NativeSshAuthMaterial::PrivateKey(private_key) => {
                let key = load_native_private_key(private_key)?;
                let hash = ssh
                    .best_supported_rsa_hash()
                    .await
                    .map_err(native_ssh_error)?
                    .flatten();
                ssh.authenticate_publickey(
                    username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(native_ssh_error)
                .map(|result| result.success())
            }
            NativeSshAuthMaterial::Agent => authenticate_with_agent(ssh, username).await,
        }
    })
    .await
    {
        Ok(result) => result?,
        Err(_) => {
            log_native_ssh_event("auth.timeout", hop, timeout.as_secs(), None);
            return Err(AppError::SshCommand(format!(
                "SSH 认证超时（{} 秒）: {}",
                timeout.as_secs(),
                native_ssh_hop_label(hop)
            )));
        }
    };

    if authenticated {
        log_native_ssh_event("auth.ok", hop, timeout.as_secs(), None);
        Ok(())
    } else {
        log_native_ssh_event("auth.failed", hop, timeout.as_secs(), None);
        Err(AppError::SshCommand(format!(
            "SSH 认证失败: {}",
            native_ssh_hop_label(hop)
        )))
    }
}

fn log_native_ssh_event(
    event: &'static str,
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    error: Option<&str>,
) {
    match error {
        Some(error) => tauri_plugin_log::log::warn!(
            target: "ssh.native",
            "event={} target={} timeout_seconds={} error={}",
            event,
            native_ssh_hop_label(hop),
            timeout_seconds,
            error
        ),
        None => tauri_plugin_log::log::info!(
            target: "ssh.native",
            "event={} target={} timeout_seconds={}",
            event,
            native_ssh_hop_label(hop),
            timeout_seconds
        ),
    }
}

fn native_ssh_hop_label(hop: &NativeSshHopExecution) -> String {
    format!(
        "{}@{}:{}",
        redacted_native_ssh_username(&hop.username),
        hop.host,
        hop.port
    )
}

fn redacted_native_ssh_username(username: &str) -> String {
    if username
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
    {
        "b64>><redacted>".to_owned()
    } else {
        username.to_owned()
    }
}

async fn authenticate_with_agent(
    ssh: &mut client::Handle<NativeCommandClientHandler>,
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
            .map_err(|error| AppError::SshCommand(format!("SSH agent 认证失败: {error}")))?;
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
                AppError::SshCommand(format!(
                    "SSH agent 连接失败: OpenSSH agent ({OPENSSH_AGENT_PIPE}) {openssh_error}; Pageant {pageant_error}"
                ))
            }),
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    Err(AppError::SshCommand(
        "当前平台不支持 SSH agent 认证，请改用密码或私钥凭据".to_owned(),
    ))
}

fn load_native_private_key(private_key: &NativeSshPrivateKey) -> AppResult<PrivateKey> {
    match private_key {
        NativeSshPrivateKey::Path { path, passphrase } => {
            load_secret_key(path, passphrase.as_deref()).map_err(key_error)
        }
        NativeSshPrivateKey::Pem {
            content,
            passphrase,
        } => keys::decode_secret_key(content, passphrase.as_deref()).map_err(key_error),
    }
}

pub(super) fn native_ssh_error(error: russh::Error) -> AppError {
    AppError::SshCommand(error.to_string())
}

fn key_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH 私钥解析失败: {error}"))
}

fn agent_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH agent 连接失败: {error}"))
}
