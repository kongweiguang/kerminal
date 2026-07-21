//! Materializes external launch requests into temporary SSH runtime targets.
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus, SshJumpHostOptions, SshOptions,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        remote_host_service::RemoteHostService,
        ssh_credential_resolver::{ResolvedSshRouteAuth, SshCredentialResolver},
        ssh_runtime::{
            auth_broker::{
                session_secret_prompt_id, SshAuthBroker, SshAuthBrokerResolution,
                SshAuthPromptPlan, SshSessionSecretInput, SshSessionSecretReceipt,
            },
            SshAuthSecretKind,
        },
    },
};

use super::{
    intake::ExternalLaunchIntake,
    model::{
        ExternalLaunchIntent, ExternalLaunchSourceTool, ExternalSecretKind,
        ExternalSessionSecretRef, ExternalSshLaunchRequest,
    },
};

pub const EXTERNAL_TARGET_PREFIX: &str = "external:";

/// Turns a trusted external launch request into a temporary SSH target.
#[derive(Clone)]
pub struct ExternalSessionMaterializer {
    inner: Arc<ExternalSessionMaterializerInner>,
}

struct ExternalSessionMaterializerInner {
    auth_broker: SshAuthBroker,
    intake: ExternalLaunchIntake,
    remote_hosts: Option<RemoteHostService>,
    targets: Mutex<HashMap<String, ExternalMaterializedTarget>>,
}

impl fmt::Debug for ExternalSessionMaterializer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSessionMaterializer")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl ExternalSessionMaterializer {
    pub fn new(intake: ExternalLaunchIntake, auth_broker: SshAuthBroker) -> Self {
        Self {
            inner: Arc::new(ExternalSessionMaterializerInner {
                auth_broker,
                intake,
                remote_hosts: None,
                targets: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// 创建可匹配已保存主机安全级别的生产 materializer。
    ///
    /// 外部目标没有精确匹配时必须 fail closed，按受限生产目标处理；只有精确匹配到
    /// 已显式标记为非生产的保存主机时，才允许降低保护级别。
    pub fn with_remote_hosts(
        intake: ExternalLaunchIntake,
        auth_broker: SshAuthBroker,
        remote_hosts: RemoteHostService,
    ) -> Self {
        Self {
            inner: Arc::new(ExternalSessionMaterializerInner {
                auth_broker,
                intake,
                remote_hosts: Some(remote_hosts),
                targets: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn materialize(
        &self,
        paths: &KerminalPaths,
        launch_id: &str,
        username_override: Option<String>,
    ) -> AppResult<ExternalMaterializedTarget> {
        tauri_plugin_log::log::info!(
            target: "external_launch.materializer",
            "materialize requested request_hash={} username_override_present={}",
            super::redaction::opaque_id_hash(launch_id),
            username_override
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        );
        match self.materialize_outcome(paths, launch_id, username_override)? {
            ExternalMaterializeOutcome::Ready(target) => Ok(*target),
            ExternalMaterializeOutcome::PromptRequired(prompt_plan) => {
                Err(AppError::Credential(format!(
                    "external SSH launch still requires authentication: prompt_count={} kinds={}",
                    prompt_plan.prompts.len(),
                    prompt_plan
                        .prompts
                        .iter()
                        .map(|prompt| prompt.secret_kind.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )))
            }
        }
    }

    pub fn materialize_outcome(
        &self,
        paths: &KerminalPaths,
        launch_id: &str,
        username_override: Option<String>,
    ) -> AppResult<ExternalMaterializeOutcome> {
        let request = self
            .inner
            .intake
            .active_request(launch_id)?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "外部 SSH 启动请求不存在: request_hash={}",
                    super::redaction::opaque_id_hash(launch_id)
                ))
            })?;
        let outcome = self.materialize_request_outcome(paths, request, username_override)?;
        let ExternalMaterializeOutcome::Ready(target) = outcome else {
            return Ok(outcome);
        };
        tauri_plugin_log::log::info!(
            target: "external_launch.materializer",
            "materialized request_hash={} auth_type={:?} route_hops={} safety={:?}",
            super::redaction::opaque_id_hash(&target.launch_id),
            target.host.auth_type,
            target.route_auth.jumps.len(),
            target.safety
        );
        self.targets()?
            .insert(target.host_id.clone(), target.as_ref().clone());
        Ok(ExternalMaterializeOutcome::Ready(target))
    }

    pub fn resolve_target(&self, host_id: &str) -> AppResult<Option<ExternalMaterializedTarget>> {
        if !is_external_target_id(host_id) {
            return Ok(None);
        }
        Ok(self.targets()?.get(host_id).cloned())
    }

    pub fn forget_launch(&self, launch_id: &str) -> AppResult<bool> {
        let host_id = external_target_id(launch_id);
        let removed = self.targets()?.remove(&host_id);
        if let Some(target) = &removed {
            for receipt in &target.session_secret_receipts {
                self.inner
                    .auth_broker
                    .forget_session_secret_receipt(receipt)?;
            }
        }
        self.inner.intake.forget_active(launch_id)?;
        Ok(removed.is_some())
    }

    pub fn snapshot(&self) -> AppResult<ExternalMaterializerSnapshot> {
        let mut target_ids = self.targets()?.keys().cloned().collect::<Vec<_>>();
        target_ids.sort();
        Ok(ExternalMaterializerSnapshot { target_ids })
    }

    fn materialize_request_outcome(
        &self,
        paths: &KerminalPaths,
        request: ExternalSshLaunchRequest,
        username_override: Option<String>,
    ) -> AppResult<ExternalMaterializeOutcome> {
        let username = resolve_username(&request, username_override)?;
        let mut receipts = Vec::new();
        let safety = self.resolve_target_safety(&request, &username);
        let mut host = request_to_remote_host(&request, &username, safety.is_restricted());

        let result = (|| -> AppResult<ExternalMaterializeOutcome> {
            if let Some(password) = request.auth.password.as_ref() {
                let secret_ref = password.as_session_ref().ok_or_else(|| {
                    AppError::Credential("external password was not protected".to_owned())
                })?;
                if secret_ref.kind != ExternalSecretKind::Password {
                    return Err(AppError::Credential(
                        "external password secret ref has unexpected kind".to_owned(),
                    ));
                }
                let password = self
                    .inner
                    .intake
                    .secret_broker()
                    .resolve_secret(secret_ref)?
                    .ok_or_else(|| external_secret_expired_error(secret_ref))?;
                let prompt_id = session_secret_prompt_id(
                    crate::services::ssh_credential_resolver::ResolvedSshHopRole::Target,
                    &host.host,
                    host.port,
                    &host.username,
                    SshAuthSecretKind::Password,
                );
                let receipt =
                    self.inner
                        .auth_broker
                        .remember_session_secret(SshSessionSecretInput {
                            prompt_id,
                            secret_kind: SshAuthSecretKind::Password,
                            value: password,
                        })?;
                receipts.push(receipt);
            }
            if let Some(passphrase) = request.auth.key_passphrase.as_ref() {
                let secret_ref = passphrase.as_session_ref().ok_or_else(|| {
                    AppError::Credential("external key passphrase was not protected".to_owned())
                })?;
                if secret_ref.kind != ExternalSecretKind::KeyPassphrase {
                    return Err(AppError::Credential(
                        "external key passphrase secret ref has unexpected kind".to_owned(),
                    ));
                }
                let passphrase = self
                    .inner
                    .intake
                    .secret_broker()
                    .resolve_secret(secret_ref)?
                    .ok_or_else(|| external_secret_expired_error(secret_ref))?;
                let prompt_id = session_secret_prompt_id(
                    crate::services::ssh_credential_resolver::ResolvedSshHopRole::Target,
                    &host.host,
                    host.port,
                    &host.username,
                    SshAuthSecretKind::KeyPassphrase,
                );
                let receipt =
                    self.inner
                        .auth_broker
                        .remember_session_secret(SshSessionSecretInput {
                            prompt_id,
                            secret_kind: SshAuthSecretKind::KeyPassphrase,
                            value: passphrase.clone(),
                        })?;
                host.key_passphrase_secret = Some(passphrase);
                receipts.push(receipt);
            }

            let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
            let resolved_auth = resolver.resolve_host(&host)?;
            let resolved_auth = match self.inner.auth_broker.resolve_route_auth(&resolved_auth)? {
                SshAuthBrokerResolution::Ready { auth } => auth,
                SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                    return Ok(ExternalMaterializeOutcome::PromptRequired(prompt_plan));
                }
            };
            let runtime_host =
                SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
            Ok(ExternalMaterializeOutcome::Ready(Box::new(
                ExternalMaterializedTarget {
                    display_name: display_name(&request, &runtime_host),
                    host: runtime_host,
                    host_id: external_target_id(&request.id),
                    launch_id: request.id,
                    route_auth: resolved_auth,
                    safety,
                    session_secret_receipts: std::mem::take(&mut receipts),
                    source_tool: request.source.tool,
                },
            )))
        })();
        if !matches!(result, Ok(ExternalMaterializeOutcome::Ready(_))) {
            for receipt in &receipts {
                self.inner
                    .auth_broker
                    .forget_session_secret_receipt(receipt)?;
            }
        }
        result
    }

    fn resolve_target_safety(
        &self,
        request: &ExternalSshLaunchRequest,
        username: &str,
    ) -> ExternalTargetSafety {
        let Some(remote_hosts) = self.inner.remote_hosts.as_ref() else {
            return ExternalTargetSafety::RestrictedUnknown;
        };
        let saved_hosts = match remote_hosts.list_tree() {
            Ok(groups) => groups
                .into_iter()
                .flat_map(|group| group.hosts)
                .collect::<Vec<_>>(),
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    target: "external_launch.materializer",
                    "failed to classify external target against saved hosts; keeping restricted: {error}"
                );
                return ExternalTargetSafety::RestrictedUnknown;
            }
        };
        external_target_safety_for_saved_hosts(request, username, &saved_hosts)
    }

    fn targets(&self) -> AppResult<MutexGuard<'_, HashMap<String, ExternalMaterializedTarget>>> {
        self.inner
            .targets
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external materialized targets"))
    }
}

/// Structured materialization result used by trusted UI authentication prompts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalMaterializeOutcome {
    Ready(Box<ExternalMaterializedTarget>),
    PromptRequired(SshAuthPromptPlan),
}

/// A temporary SSH target generated from an external launch.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalMaterializedTarget {
    pub display_name: String,
    pub host: RemoteHost,
    pub host_id: String,
    pub launch_id: String,
    pub route_auth: ResolvedSshRouteAuth,
    pub safety: ExternalTargetSafety,
    pub source_tool: ExternalLaunchSourceTool,
    pub session_secret_receipts: Vec<SshSessionSecretReceipt>,
}

impl fmt::Debug for ExternalMaterializedTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalMaterializedTarget")
            .field("display_name_present", &!self.display_name.is_empty())
            .field(
                "request_hash",
                &super::redaction::opaque_id_hash(&self.launch_id),
            )
            .field("auth_type", &self.host.auth_type)
            .field("route_hops", &self.route_auth.jumps.len())
            .field("safety", &self.safety)
            .field("source_tool", &self.source_tool)
            .field(
                "session_secret_receipts",
                &self.session_secret_receipts.len(),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalMaterializerSnapshot {
    pub target_ids: Vec<String>,
}

/// 外部目标的运行态安全分类，不写回 host 配置。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalTargetSafety {
    /// 未找到唯一可信映射，必须按生产/受限目标执行保护。
    RestrictedUnknown,
    /// 精确匹配到已保存的非生产主机。
    KnownNonProduction,
    /// 精确匹配到至少一个生产主机。
    Production,
}

impl ExternalTargetSafety {
    pub fn is_restricted(self) -> bool {
        !matches!(self, Self::KnownNonProduction)
    }
}

pub fn external_target_id(launch_id: &str) -> String {
    format!("{EXTERNAL_TARGET_PREFIX}{launch_id}")
}

pub fn is_external_target_id(host_id: &str) -> bool {
    host_id.starts_with(EXTERNAL_TARGET_PREFIX)
}

/// 从临时 target id 取回内部 launch id；只用于运行态任务关联，不进入公开快照。
pub fn external_launch_id_from_target_id(host_id: &str) -> Option<&str> {
    host_id
        .strip_prefix(EXTERNAL_TARGET_PREFIX)
        .filter(|launch_id| !launch_id.is_empty())
}

fn resolve_username(
    request: &ExternalSshLaunchRequest,
    username_override: Option<String>,
) -> AppResult<String> {
    username_override
        .or_else(|| request.target.username.clone())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput("external SSH launch username is required".to_owned())
        })
}

fn request_to_remote_host(
    request: &ExternalSshLaunchRequest,
    username: &str,
    production: bool,
) -> RemoteHost {
    let auth_type = if request.auth.password.is_some() {
        RemoteHostAuthType::Password
    } else if request.auth.identity_file.is_some() {
        RemoteHostAuthType::Key
    } else if matches!(request.intent, ExternalLaunchIntent::SftpTransfer { .. })
        && !request.auth.agent
    {
        // 外部 SFTP 临时目标缺少显式凭据时只做 session-only 补录，不能静默假设 agent。
        RemoteHostAuthType::Password
    } else {
        RemoteHostAuthType::Agent
    };
    let credential_status = match auth_type {
        RemoteHostAuthType::Agent => RemoteHostCredentialStatus::Agent,
        RemoteHostAuthType::Password | RemoteHostAuthType::Key => {
            RemoteHostCredentialStatus::Missing
        }
    };
    RemoteHost {
        auth_type,
        created_at: request.received_at.clone(),
        credential_ref: request.auth.identity_file.clone(),
        credential_secret: None,
        credential_status,
        group_id: None,
        host: request.target.host.clone(),
        id: external_target_id(&request.id),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        name: display_name_from_request(request),
        port: request.target.port,
        production,
        secret_ref: None,
        sort_order: 0,
        ssh_options: request_ssh_options(request, username),
        tags: vec![
            "external".to_owned(),
            request.source.tool.as_str().to_owned(),
        ],
        updated_at: request.received_at.clone(),
        username: username.to_owned(),
    }
}

/// 按 canonical target 和完整跳板链匹配保存主机；任何不确定性都保持受限。
#[doc(hidden)]
pub fn external_target_safety_for_saved_hosts(
    request: &ExternalSshLaunchRequest,
    username: &str,
    saved_hosts: &[RemoteHost],
) -> ExternalTargetSafety {
    let matches = saved_hosts
        .iter()
        .filter(|host| saved_host_matches_request(host, request, username))
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return ExternalTargetSafety::RestrictedUnknown;
    }
    if matches.iter().any(|host| host.production) {
        ExternalTargetSafety::Production
    } else {
        ExternalTargetSafety::KnownNonProduction
    }
}

fn saved_host_matches_request(
    host: &RemoteHost,
    request: &ExternalSshLaunchRequest,
    username: &str,
) -> bool {
    canonical_host(&host.host) == canonical_host(&request.target.host)
        && host.port == request.target.port
        && host.username.trim() == username.trim()
        && host.ssh_options.jump_hosts.len() == request.target.route.len()
        && host
            .ssh_options
            .jump_hosts
            .iter()
            .zip(&request.target.route)
            .all(|(saved, external)| {
                canonical_host(&saved.host) == canonical_host(&external.host)
                    && saved.port == external.port
                    && saved.username.trim()
                        == external.username.as_deref().unwrap_or(username).trim()
            })
}

fn canonical_host(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn request_ssh_options(request: &ExternalSshLaunchRequest, username: &str) -> SshOptions {
    SshOptions {
        jump_hosts: request
            .target
            .route
            .iter()
            .enumerate()
            .map(|(index, hop)| SshJumpHostOptions {
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                credential_status: RemoteHostCredentialStatus::Agent,
                host: hop.host.clone(),
                key_passphrase_ref: None,
                key_passphrase_secret: None,
                name: format!("External jump {}", index + 1),
                port: hop.port,
                secret_ref: None,
                username: hop.username.clone().unwrap_or_else(|| username.to_owned()),
            })
            .collect(),
        ..Default::default()
    }
}

fn display_name(request: &ExternalSshLaunchRequest, host: &RemoteHost) -> String {
    request
        .options
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| host.name.clone())
}

fn display_name_from_request(request: &ExternalSshLaunchRequest) -> String {
    request
        .options
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| request.target.display_name())
}

fn external_secret_expired_error(secret_ref: &ExternalSessionSecretRef) -> AppError {
    AppError::Credential(format!(
        "外部 SSH 启动凭据已过期或不可用，请从外部 SSH 客户端重新发起连接。request_hash={} secret_kind={}",
        super::redaction::opaque_id_hash(&secret_ref.launch_id),
        secret_ref.kind.as_str()
    ))
}
