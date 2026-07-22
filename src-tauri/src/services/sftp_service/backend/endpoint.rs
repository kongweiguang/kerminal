use std::{fmt, path::PathBuf};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, RemoteHostAuthType},
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        external_launch::ExternalSessionMaterializer,
        remote_host_capability::{ensure_remote_host_capability, RemoteHostCapability},
        ssh_credential_resolver::{ResolvedSshRouteAuth, SshCredentialResolver},
        ssh_identity_file::resolve_identity_file_path,
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            policy::{external_target_not_available_error, is_external_runtime_target_id},
            session_key::redacted_fingerprint_text,
        },
    },
    storage::config_file_store::ConfigFileStore,
};

use super::errors::config_file_error;

#[derive(Clone)]
pub(crate) struct SftpEndpoint {
    pub(crate) host: RemoteHost,
    pub(crate) auth: SftpAuthMaterial,
    pub(crate) known_hosts_path: PathBuf,
    pub(crate) route_auth: ResolvedSshRouteAuth,
}

impl fmt::Debug for SftpEndpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SftpEndpoint")
            .field("host_id", &self.host.id)
            .field("host", &self.host.host)
            .field("port", &self.host.port)
            .field("username", &self.host.username)
            .field("auth", &self.auth)
            .field("known_hosts_path", &"<workspace-known-hosts>")
            .field("route_auth", &self.route_auth.summary)
            .finish()
    }
}

#[derive(Clone)]
pub(crate) enum SftpAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(SftpPrivateKey),
}

impl fmt::Debug for SftpAuthMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent => formatter.write_str("Agent"),
            Self::Password(_) => formatter
                .debug_tuple("Password")
                .field(&"<redacted>")
                .finish(),
            Self::PrivateKey(private_key) => formatter
                .debug_tuple("PrivateKey")
                .field(private_key)
                .finish(),
        }
    }
}

#[derive(Clone)]
pub(crate) enum SftpPrivateKey {
    Path {
        path: PathBuf,
        passphrase: Option<String>,
    },
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

impl fmt::Debug for SftpPrivateKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Path { path, passphrase } => formatter
                .debug_struct("Path")
                .field(
                    "fingerprint",
                    &redacted_fingerprint_text(path.to_string_lossy().as_ref()),
                )
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .finish(),
            Self::Pem { passphrase, .. } => formatter
                .debug_struct("Pem")
                .field("content", &"<redacted>")
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .finish(),
        }
    }
}

pub(crate) fn resolve_endpoint_with_auth_broker(
    paths: &KerminalPaths,
    host_id: &str,
    auth_broker: Option<&SshAuthBroker>,
    external_targets: Option<&ExternalSessionMaterializer>,
) -> AppResult<SftpEndpoint> {
    if let Some(external_targets) = external_targets {
        if let Some(target) = external_targets.resolve_target(host_id)? {
            ensure_remote_host_capability(&target.host, RemoteHostCapability::Sftp)?;
            let auth = resolve_auth_material(&target.host)?;
            return Ok(SftpEndpoint {
                host: target.host,
                auth,
                known_hosts_path: paths.root.join("known_hosts"),
                route_auth: target.route_auth,
            });
        }
    }
    if is_external_runtime_target_id(host_id) {
        return Err(external_target_not_available_error(host_id));
    }
    let host = resolve_host(paths, host_id)?;
    let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
    let resolved_auth = resolver.resolve_host(&host)?;
    let resolved_auth = match auth_broker {
        Some(auth_broker) => match auth_broker.resolve_route_auth(&resolved_auth)? {
            SshAuthBrokerResolution::Ready { auth } => auth,
            SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                return Err(prompt_required_sftp_error(prompt_plan));
            }
        },
        None => resolved_auth,
    };
    let host = SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
    let auth = resolve_auth_material(&host)?;
    Ok(SftpEndpoint {
        host,
        auth,
        known_hosts_path: paths.root.join("known_hosts"),
        route_auth: resolved_auth,
    })
}

fn prompt_required_sftp_error(prompt_plan: SshAuthPromptPlan) -> AppError {
    let prompts = prompt_plan
        .prompts
        .iter()
        .map(|prompt| {
            format!(
                "{}@{}:{} {}",
                prompt.username,
                prompt.host,
                prompt.port,
                prompt.secret_kind.as_str()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    AppError::Credential(format!(
        "SSH authentication is required before SFTP can connect: {prompts}"
    ))
}

pub(crate) fn resolve_host(paths: &KerminalPaths, host_id: &str) -> AppResult<RemoteHost> {
    if is_external_runtime_target_id(host_id) {
        return Err(external_target_not_available_error(host_id));
    }
    let host = ConfigFileStore::new(paths.root.clone())
        .remote_host_by_id(host_id)
        .map_err(config_file_error)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))?;
    ensure_remote_host_capability(&host, RemoteHostCapability::Sftp)?;
    Ok(host)
}

pub(crate) fn resolve_transient_endpoint(
    paths: &KerminalPaths,
    host: &RemoteHost,
) -> AppResult<SftpEndpoint> {
    ensure_remote_host_capability(host, RemoteHostCapability::Sftp)?;
    let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
    let resolved = resolver.resolve_runtime_host(host)?;
    let auth = resolve_auth_material(&resolved.host)?;
    Ok(SftpEndpoint {
        host: resolved.host,
        auth,
        known_hosts_path: paths.root.join("known_hosts"),
        route_auth: resolved.auth,
    })
}

fn resolve_auth_material(host: &RemoteHost) -> AppResult<SftpAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(SftpAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_credential_secret(host, "密码认证需要已保存 SSH 密码")?;
            Ok(SftpAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_credential_secret(host) {
                return Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Pem {
                    content: secret.to_owned(),
                    passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
                }));
            }
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Path {
                path: resolve_identity_file_path(credential_ref)?,
                passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
            }))
        }
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::InvalidInput("密钥认证需要保存私钥路径或明文私钥内容".to_owned()))
}

fn required_credential_secret(host: &RemoteHost, message: &str) -> AppResult<String> {
    normalized_credential_secret(host)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalized_key_passphrase_secret(host: &RemoteHost) -> Option<&str> {
    host.key_passphrase_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}
