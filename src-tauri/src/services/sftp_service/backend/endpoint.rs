//! @author kongweiguang

use std::{fmt, path::PathBuf};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::RemoteHost,
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        external_launch::ExternalSessionMaterializer,
        remote_host_capability::{ensure_remote_host_capability, RemoteHostCapability},
        ssh_credential_resolver::{ResolvedSshRouteAuth, SshCredentialResolver},
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            policy::{external_target_not_available_error, is_external_runtime_target_id},
        },
    },
    storage::config_file_store::ConfigFileStore,
};

use super::errors::config_file_error;

#[derive(Clone)]
pub(crate) struct SftpEndpoint {
    pub(crate) host: RemoteHost,
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
            .field("known_hosts_path", &"<workspace-known-hosts>")
            .field("route_auth", &self.route_auth.summary)
            .finish()
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
            return Ok(SftpEndpoint {
                host: target.host,
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
    Ok(SftpEndpoint {
        host,
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
    Ok(SftpEndpoint {
        host: resolved.host,
        known_hosts_path: paths.root.join("known_hosts"),
        route_auth: resolved.auth,
    })
}
