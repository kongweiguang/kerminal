//! 远程主机业务服务。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

mod credential_persistence;
mod normalization;
mod ssh_options;

use credential_persistence::{
    password_required_message, persist_secret_ref, reusable_secret_ref_for_kind,
    SecretPersistenceInput,
};
use normalization::{normalize_host, normalize_port, normalize_tags};
use ssh_options::normalize_ssh_options;

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostCredentialReveal,
        RemoteHostCredentialRevealStatus, RemoteHostCredentialStatus, RemoteHostGroup,
        RemoteHostGroupCreateRequest, RemoteHostGroupUpdateRequest, RemoteHostGroupWithHosts,
        RemoteHostProtocol, RemoteHostUpdateRequest, SshJumpHostOptions, SshOptions,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::{EncryptedVaultService, VaultUnitOfWork},
        ssh_credential_resolver::{ResolvedSshAuthMaterial, SshCredentialResolver},
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

/// 远程主机业务入口。
#[derive(Debug, Clone)]
pub struct RemoteHostService {
    config: ConfigFileStore,
}

impl RemoteHostService {
    /// 创建远程主机服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self { config }
    }

    /// 列出远程主机分组。
    pub fn list_groups(&self) -> AppResult<Vec<RemoteHostGroup>> {
        self.config
            .list_remote_host_groups()
            .map_err(config_file_error)
    }

    /// 列出远程主机树。
    pub fn list_tree(&self) -> AppResult<Vec<RemoteHostGroupWithHosts>> {
        self.config
            .list_remote_host_tree()
            .map_err(config_file_error)
    }

    /// 根据 id 读取远程主机。返回的 runtime model 已合并 secrets。
    pub fn host_by_id(&self, host_id: &str) -> AppResult<Option<RemoteHost>> {
        self.config
            .remote_host_by_id(host_id)
            .map_err(config_file_error)
    }

    /// 根据 id 读取远程主机，缺失时报 NotFound。
    pub fn require_host(&self, host_id: &str) -> AppResult<RemoteHost> {
        self.host_by_id(host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
    }

    /// 创建远程主机分组。
    pub fn create_group(
        &self,
        request: RemoteHostGroupCreateRequest,
    ) -> AppResult<RemoteHostGroup> {
        let timestamp = timestamp_now();
        let group = RemoteHostGroup {
            id: Uuid::new_v4().to_string(),
            name: normalize_required_text("分组名称", request.name)?,
            // 最终排序值由仓储在同锁 read-modify-write 中分配。
            sort_order: 0,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        self.config
            .append_remote_host_group(group)
            .map_err(config_file_error)
    }

    /// 更新远程主机分组。
    pub fn update_group(
        &self,
        request: RemoteHostGroupUpdateRequest,
    ) -> AppResult<RemoteHostGroup> {
        let id = normalize_required_text("分组 ID", request.id)?;
        let mut groups = self.list_groups()?;
        let Some(group) = groups.iter_mut().find(|group| group.id == id) else {
            return Err(AppError::NotFound(format!("远程主机分组不存在: {id}")));
        };
        group.name = normalize_required_text("分组名称", request.name)?;
        group.sort_order = request.sort_order;
        group.updated_at = timestamp_now();
        let updated = group.clone();

        self.config
            .apply_remote_host_change_set(Some(&groups), &[], &[])
            .map_err(config_file_error)?;
        Ok(updated)
    }

    /// 删除远程主机分组；分组内主机会移动到未分组。
    pub fn delete_group(&self, group_id: &str) -> AppResult<bool> {
        let group_id = normalize_required_text("分组 ID", group_id.to_owned())?;
        let mut groups = self.list_groups()?;
        let before_len = groups.len();
        groups.retain(|group| group.id != group_id);
        if groups.len() == before_len {
            return Ok(false);
        }

        let timestamp = timestamp_now();
        let mut hosts_to_write = self
            .config
            .list_remote_hosts()
            .map_err(config_file_error)?
            .into_iter()
            .filter(|host| host.group_id.as_deref() == Some(group_id.as_str()))
            .collect::<Vec<_>>();
        for host in &mut hosts_to_write {
            host.group_id = None;
            host.updated_at = timestamp.clone();
        }

        self.config
            .apply_remote_host_change_set(Some(&groups), &hosts_to_write, &[])
            .map_err(config_file_error)?;
        Ok(true)
    }

    /// 创建远程主机配置。
    pub fn create_host(&self, request: RemoteHostCreateRequest) -> AppResult<RemoteHost> {
        let tags = normalize_tags(request.tags);
        let protocol = request.protocol;
        let group_id = normalize_optional_text(request.group_id);
        ensure_group_exists(self, group_id.as_deref())?;
        let sort_order = self
            .config
            .next_remote_host_sort_order(group_id.as_deref())
            .map_err(config_file_error)?;
        let id = Uuid::new_v4().to_string();
        let credential = normalize_ssh_credential(
            request.auth_type,
            request.credential_ref,
            request.credential_secret,
        )?;
        let timestamp = timestamp_now();
        let host = RemoteHost {
            id,
            group_id,
            name: normalize_required_text("主机名称", request.name)?,
            host: normalize_host(request.host)?,
            port: normalize_port(request.port)?,
            username: normalize_username(protocol, request.username)?,
            protocol,
            auth_type: request.auth_type,
            credential_ref: credential.credential_ref,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: credential.credential_secret,
            credential_status: Default::default(),
            tags,
            production: request.production,
            ssh_options: normalize_protocol_ssh_options(protocol, request.ssh_options)?,
            sort_order,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        let vault = self.vault_service();
        vault.run_unit_of_work("remote-host-create", |unit, transaction| {
            let host = self.persist_host_credentials(&vault, unit, host, None)?;
            self.config
                .stage_remote_host_write(transaction, &host)
                .map_err(config_file_error)?;
            Ok(host)
        })
    }

    /// 更新远程主机配置。
    pub fn update_host(&self, request: RemoteHostUpdateRequest) -> AppResult<RemoteHost> {
        let tags = normalize_tags(request.tags);
        let protocol = request.protocol;
        let group_id = normalize_optional_text(request.group_id);
        ensure_group_exists(self, group_id.as_deref())?;
        let id = normalize_required_text("主机 ID", request.id)?;
        let credential = normalize_ssh_credential(
            request.auth_type,
            request.credential_ref,
            request.credential_secret,
        )?;
        let name = normalize_required_text("主机名称", request.name)?;
        let host_address = normalize_host(request.host)?;
        let port = normalize_port(request.port)?;
        let username = normalize_username(protocol, request.username)?;
        let ssh_options = normalize_protocol_ssh_options(protocol, request.ssh_options)?;
        let vault = self.vault_service();
        vault.run_unit_of_work("remote-host-update", |unit, transaction| {
            // existing 必须在同一锁内读取，避免并发删除后被旧快照重新创建。
            let existing = self
                .config
                .remote_host_by_id_in_transaction(transaction, &id)
                .map_err(config_file_error)?
                .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {id}")))?;
            if protocol != existing.protocol {
                return Err(AppError::InvalidInput(
                    "已保存主机不能直接更改协议；请复制为新的连接".to_owned(),
                ));
            }
            let host = RemoteHost {
                id: id.clone(),
                group_id,
                name,
                host: host_address,
                port,
                username,
                protocol,
                auth_type: request.auth_type,
                credential_ref: credential.credential_ref,
                secret_ref: existing.secret_ref.clone(),
                key_passphrase_ref: existing.key_passphrase_ref.clone(),
                key_passphrase_secret: None,
                credential_secret: credential.credential_secret,
                credential_status: Default::default(),
                tags,
                production: request.production,
                ssh_options,
                sort_order: request.sort_order,
                created_at: existing.created_at.clone(),
                updated_at: timestamp_now(),
            };
            let host = self.persist_host_credentials(&vault, unit, host, Some(&existing))?;
            self.config
                .stage_remote_host_write(transaction, &host)
                .map_err(config_file_error)?;
            Ok(host)
        })
    }

    /// 删除远程主机配置。
    pub fn delete_host(&self, host_id: &str) -> AppResult<bool> {
        if self.host_by_id(host_id)?.is_none() {
            return Ok(false);
        }
        self.config
            .apply_remote_host_change_set(None, &[], &[host_id.to_owned()])
            .map_err(config_file_error)?;
        Ok(true)
    }

    /// 受控读取单个主机的目标认证凭据，用于编辑表单回显。
    pub fn reveal_host_credential(&self, host_id: &str) -> AppResult<RemoteHostCredentialReveal> {
        let host_id = normalize_required_text("主机 ID", host_id.to_owned())?;
        let host = self.require_host(&host_id)?;
        let base = |status, credential_secret, message| RemoteHostCredentialReveal {
            host_id: host.id.clone(),
            auth_type: host.auth_type,
            status,
            credential_secret,
            message,
        };

        match host.auth_type {
            RemoteHostAuthType::Agent => Ok(base(
                RemoteHostCredentialRevealStatus::Agent,
                None,
                Some("SSH Agent 认证不需要保存密码。".to_owned()),
            )),
            RemoteHostAuthType::Key
                if host
                    .credential_ref
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()) =>
            {
                Ok(base(
                    RemoteHostCredentialRevealStatus::ConfigPath,
                    None,
                    Some("该主机使用私钥路径，无需回显私钥内容。".to_owned()),
                ))
            }
            RemoteHostAuthType::Password | RemoteHostAuthType::Key => {
                let resolver = SshCredentialResolver::new(self.vault_service());
                let resolved = resolver.resolve_host(&host)?;
                match resolved.target.material {
                    ResolvedSshAuthMaterial::Password { value, .. }
                    | ResolvedSshAuthMaterial::PrivateKeyPem { content: value, .. } => Ok(base(
                        RemoteHostCredentialRevealStatus::Available,
                        Some(value),
                        None,
                    )),
                    ResolvedSshAuthMaterial::PrivateKeyPath { .. } => Ok(base(
                        RemoteHostCredentialRevealStatus::ConfigPath,
                        None,
                        Some("该主机使用私钥路径，无需回显私钥内容。".to_owned()),
                    )),
                    ResolvedSshAuthMaterial::Agent { .. } => Ok(base(
                        RemoteHostCredentialRevealStatus::Agent,
                        None,
                        Some("SSH Agent 认证不需要保存密码。".to_owned()),
                    )),
                    ResolvedSshAuthMaterial::PromptOnly { reason, .. } => Ok(base(
                        RemoteHostCredentialRevealStatus::Missing,
                        None,
                        Some(reason),
                    )),
                }
            }
        }
    }

    fn persist_host_credentials(
        &self,
        vault: &EncryptedVaultService,
        unit: &mut VaultUnitOfWork,
        host: RemoteHost,
        existing: Option<&RemoteHost>,
    ) -> AppResult<RemoteHost> {
        self.persist_host_credentials_for_mode(vault, unit, host, existing)
    }

    fn persist_host_credentials_for_mode(
        &self,
        vault: &EncryptedVaultService,
        unit: &mut VaultUnitOfWork,
        mut host: RemoteHost,
        existing: Option<&RemoteHost>,
    ) -> AppResult<RemoteHost> {
        let primary_secret_kind = primary_credential_secret_kind(&host);

        let top_level = persist_primary_credential(
            vault,
            unit,
            &host.id,
            PrimaryCredentialInput {
                secret_kind: primary_secret_kind,
                auth_type: host.auth_type,
                credential_ref: host.credential_ref.take(),
                secret_ref: host.secret_ref.take(),
                credential_secret: host.credential_secret.take(),
                existing,
            },
        )?;
        host.credential_ref = top_level.credential_ref;
        host.secret_ref = top_level.secret_ref;
        host.key_passphrase_ref = top_level.key_passphrase_ref;
        host.credential_secret = None;
        host.credential_status = top_level.credential_status;

        let existing_jump_hosts = existing.map(|item| item.ssh_options.jump_hosts.as_slice());
        let mut jump_hosts = Vec::with_capacity(host.ssh_options.jump_hosts.len());
        for (index, jump_host) in host.ssh_options.jump_hosts.into_iter().enumerate() {
            let existing_jump = existing_jump_hosts.and_then(|items| items.get(index));
            let persisted = persist_jump_host_credential(
                vault,
                unit,
                &host.id,
                index,
                jump_host,
                existing_jump,
            )?;
            jump_hosts.push(persisted.jump_host);
        }
        host.ssh_options.jump_hosts = jump_hosts;

        Ok(host)
    }

    fn vault_service(&self) -> EncryptedVaultService {
        EncryptedVaultService::new(KerminalPaths::from_root(self.config.root()))
    }
}

#[derive(Debug)]
struct PersistedPrimaryCredential {
    credential_ref: Option<String>,
    secret_ref: Option<String>,
    key_passphrase_ref: Option<String>,
    credential_status: RemoteHostCredentialStatus,
}

#[derive(Debug)]
struct PrimaryCredentialInput<'a> {
    secret_kind: &'a str,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    secret_ref: Option<String>,
    credential_secret: Option<String>,
    existing: Option<&'a RemoteHost>,
}

#[derive(Debug)]
struct PersistedJumpHostCredential {
    jump_host: SshJumpHostOptions,
}

fn ensure_group_exists(service: &RemoteHostService, group_id: Option<&str>) -> AppResult<()> {
    let Some(group_id) = group_id else {
        return Ok(());
    };

    if service
        .config
        .remote_host_group_by_id(group_id)
        .map_err(config_file_error)?
        .is_none()
    {
        return Err(AppError::NotFound(format!(
            "远程主机分组不存在: {group_id}"
        )));
    }
    Ok(())
}

fn normalize_required_text(field: &str, value: String) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    Ok(value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

fn normalize_protocol_ssh_options(
    protocol: RemoteHostProtocol,
    options: SshOptions,
) -> AppResult<SshOptions> {
    let mut options = normalize_ssh_options(options)?;
    if protocol == RemoteHostProtocol::Sftp {
        options.transfer.enabled = true;
        options.tunnels.clear();
    }
    Ok(options)
}

fn normalize_username(protocol: RemoteHostProtocol, value: String) -> AppResult<String> {
    let value = value.trim().to_owned();
    let username_optional = matches!(
        protocol,
        RemoteHostProtocol::Telnet | RemoteHostProtocol::Serial
    );
    if value.is_empty() && !username_optional {
        return Err(AppError::InvalidInput("用户名不能为空".to_owned()));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSshCredential {
    credential_ref: Option<String>,
    credential_secret: Option<String>,
}

fn normalize_ssh_credential(
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> AppResult<NormalizedSshCredential> {
    let credential_ref = normalize_optional_text(credential_ref);
    let credential_secret = credential_secret.filter(|secret| !secret.trim().is_empty());

    match auth_type {
        RemoteHostAuthType::Agent => {
            if credential_ref.is_some() || credential_secret.is_some() {
                return Err(AppError::InvalidInput(
                    "SSH Agent 认证不需要密码、私钥路径或私钥内容".to_owned(),
                ));
            }
            Ok(NormalizedSshCredential {
                credential_ref: None,
                credential_secret: None,
            })
        }
        RemoteHostAuthType::Password => {
            if credential_ref.is_some() {
                return Err(AppError::InvalidInput(
                    "密码认证不再使用凭据引用，请直接填写明文密码".to_owned(),
                ));
            }
            Ok(NormalizedSshCredential {
                credential_ref: None,
                credential_secret,
            })
        }
        RemoteHostAuthType::Key => {
            if credential_ref
                .as_deref()
                .is_some_and(|value| value.starts_with("credential:"))
            {
                return Err(AppError::InvalidInput(
                    "密钥认证不再支持 credential: 凭据引用，请填写私钥路径或直接粘贴私钥内容"
                        .to_owned(),
                ));
            }

            match (credential_ref, credential_secret) {
                (Some(_), Some(_)) => Err(AppError::InvalidInput(
                    "密钥认证的私钥路径和私钥内容只能填写一项".to_owned(),
                )),
                (Some(path), None) => Ok(NormalizedSshCredential {
                    credential_ref: Some(path),
                    credential_secret: None,
                }),
                (None, Some(secret)) => Ok(NormalizedSshCredential {
                    credential_ref: None,
                    credential_secret: Some(secret),
                }),
                (None, None) => Ok(NormalizedSshCredential {
                    credential_ref: None,
                    credential_secret: None,
                }),
            }
        }
    }
}

fn persist_primary_credential(
    vault: &EncryptedVaultService,
    unit: &mut VaultUnitOfWork,
    host_id: &str,
    input: PrimaryCredentialInput<'_>,
) -> AppResult<PersistedPrimaryCredential> {
    let PrimaryCredentialInput {
        secret_kind,
        auth_type,
        credential_ref,
        secret_ref,
        credential_secret,
        existing,
    } = input;
    let normalized_secret = normalize_optional_text(credential_secret);
    match auth_type {
        RemoteHostAuthType::Agent => Ok(PersistedPrimaryCredential {
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            credential_status: RemoteHostCredentialStatus::Agent,
        }),
        RemoteHostAuthType::Password => {
            let existing_secret_ref = existing
                .filter(|host| matches!(host.auth_type, RemoteHostAuthType::Password))
                .and_then(|host| normalize_optional_text(host.secret_ref.clone()));
            let reusable_secret_ref =
                reusable_secret_ref_for_kind(secret_ref.or(existing_secret_ref), secret_kind);
            let persisted_secret_ref = persist_secret_ref(
                vault,
                unit,
                SecretPersistenceInput {
                    host_id,
                    kind: secret_kind,
                    scope: "target".to_owned(),
                    material: "password",
                    plaintext: normalized_secret,
                    existing_secret_ref: reusable_secret_ref,
                },
            )?
            .ok_or_else(|| AppError::InvalidInput(password_required_message(secret_kind)))?;
            Ok(PersistedPrimaryCredential {
                credential_ref: None,
                secret_ref: Some(persisted_secret_ref),
                key_passphrase_ref: None,
                credential_status: RemoteHostCredentialStatus::Vault,
            })
        }
        RemoteHostAuthType::Key => {
            let existing_inline_secret_ref = existing
                .filter(|host| matches!(host.auth_type, RemoteHostAuthType::Key))
                .and_then(|host| normalize_optional_text(host.secret_ref.clone()));
            let credential_ref = normalize_optional_text(credential_ref);
            if let Some(path) = credential_ref {
                return Ok(PersistedPrimaryCredential {
                    credential_ref: Some(path),
                    secret_ref: None,
                    key_passphrase_ref: existing.and_then(|host| host.key_passphrase_ref.clone()),
                    credential_status: RemoteHostCredentialStatus::Missing,
                });
            }
            let persisted_secret_ref = persist_secret_ref(
                vault,
                unit,
                SecretPersistenceInput {
                    host_id,
                    kind: secret_kind,
                    scope: "target".to_owned(),
                    material: "private-key",
                    plaintext: normalized_secret,
                    existing_secret_ref: secret_ref.or(existing_inline_secret_ref),
                },
            )?
            .ok_or_else(|| {
                AppError::InvalidInput("密钥认证需要填写私钥路径或直接粘贴私钥内容".to_owned())
            })?;
            Ok(PersistedPrimaryCredential {
                credential_ref: None,
                secret_ref: Some(persisted_secret_ref),
                key_passphrase_ref: existing.and_then(|host| host.key_passphrase_ref.clone()),
                credential_status: RemoteHostCredentialStatus::Vault,
            })
        }
    }
}

fn primary_credential_secret_kind(host: &RemoteHost) -> &'static str {
    if host.protocol == RemoteHostProtocol::Rdp {
        "rdp-host"
    } else {
        "ssh-host"
    }
}

fn persist_jump_host_credential(
    vault: &EncryptedVaultService,
    unit: &mut VaultUnitOfWork,
    host_id: &str,
    index: usize,
    mut jump_host: SshJumpHostOptions,
    existing: Option<&SshJumpHostOptions>,
) -> AppResult<PersistedJumpHostCredential> {
    jump_host.credential_ref = normalize_optional_text(jump_host.credential_ref);
    let incoming_secret = normalize_optional_text(jump_host.credential_secret.take());
    match jump_host.auth_type {
        RemoteHostAuthType::Agent => {
            jump_host.credential_ref = None;
            jump_host.secret_ref = None;
            jump_host.key_passphrase_ref = None;
            jump_host.credential_status = RemoteHostCredentialStatus::Agent;
            Ok(PersistedJumpHostCredential { jump_host })
        }
        RemoteHostAuthType::Password => {
            jump_host.credential_ref = None;
            let existing_secret_ref = existing
                .filter(|item| matches!(item.auth_type, RemoteHostAuthType::Password))
                .and_then(|item| normalize_optional_text(item.secret_ref.clone()));
            jump_host.secret_ref = Some(
                persist_secret_ref(
                    vault,
                    unit,
                    SecretPersistenceInput {
                        host_id,
                        kind: "jump-host",
                        scope: format!("jump-{index}"),
                        material: "password",
                        plaintext: incoming_secret,
                        existing_secret_ref: jump_host.secret_ref.or(existing_secret_ref),
                    },
                )?
                .ok_or_else(|| {
                    AppError::InvalidInput("跳板机密码认证需要填写明文 SSH 密码".to_owned())
                })?,
            );
            jump_host.credential_status = RemoteHostCredentialStatus::Vault;
            Ok(PersistedJumpHostCredential { jump_host })
        }
        RemoteHostAuthType::Key => {
            let existing_inline_secret_ref = existing
                .filter(|item| matches!(item.auth_type, RemoteHostAuthType::Key))
                .and_then(|item| normalize_optional_text(item.secret_ref.clone()));
            if let Some(path) = jump_host.credential_ref.clone() {
                jump_host.credential_ref = Some(path);
                jump_host.secret_ref = None;
                jump_host.key_passphrase_ref =
                    existing.and_then(|item| item.key_passphrase_ref.clone());
                jump_host.credential_status = RemoteHostCredentialStatus::Missing;
                return Ok(PersistedJumpHostCredential { jump_host });
            }
            jump_host.secret_ref = Some(
                persist_secret_ref(
                    vault,
                    unit,
                    SecretPersistenceInput {
                        host_id,
                        kind: "jump-host",
                        scope: format!("jump-{index}"),
                        material: "private-key",
                        plaintext: incoming_secret,
                        existing_secret_ref: jump_host.secret_ref.or(existing_inline_secret_ref),
                    },
                )?
                .ok_or_else(|| {
                    AppError::InvalidInput(
                        "跳板机密钥认证需要填写私钥路径或直接粘贴私钥内容".to_owned(),
                    )
                })?,
            );
            jump_host.key_passphrase_ref =
                existing.and_then(|item| item.key_passphrase_ref.clone());
            jump_host.credential_status = RemoteHostCredentialStatus::Vault;
            Ok(PersistedJumpHostCredential { jump_host })
        }
    }
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
