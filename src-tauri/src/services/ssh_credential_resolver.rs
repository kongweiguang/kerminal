//! SSH credential resolution from host config and encrypted workspace vault.
//!
//! @author kongweiguang

use std::{fmt, path::PathBuf};

use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        parse_vault_secret_ref, RemoteHost, RemoteHostAuthType, SshJumpHostOptions,
    },
    services::encrypted_vault_service::{EncryptedVaultService, VaultKeyEntryReadError},
};

#[derive(Clone)]
pub struct SshCredentialResolver {
    vault: EncryptedVaultService,
}

impl fmt::Debug for SshCredentialResolver {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshCredentialResolver")
            .field("vault", &"<workspace vault>")
            .finish()
    }
}

impl SshCredentialResolver {
    pub fn new(vault: EncryptedVaultService) -> Self {
        Self { vault }
    }

    pub fn resolve_host(&self, host: &RemoteHost) -> AppResult<ResolvedSshRouteAuth> {
        let jumps = host
            .ssh_options
            .jump_hosts
            .iter()
            .enumerate()
            .map(|(index, jump)| self.resolve_jump(index, jump))
            .collect::<AppResult<Vec<_>>>()?;
        let target = self.resolve_target(host)?;
        Ok(ResolvedSshRouteAuth {
            summary: ResolvedSshRouteAuthSummary {
                target: target.summary.clone(),
                jumps: jumps.iter().map(|jump| jump.summary.clone()).collect(),
            },
            target,
            jumps,
        })
    }

    pub fn resolve_runtime_host(&self, host: &RemoteHost) -> AppResult<ResolvedSshRuntimeHost> {
        let auth = self.resolve_host(host)?;
        let host = Self::materialize_runtime_host_from_auth(host, &auth);
        Ok(ResolvedSshRuntimeHost { host, auth })
    }

    pub fn materialize_runtime_host_from_auth(
        host: &RemoteHost,
        resolved_auth: &ResolvedSshRouteAuth,
    ) -> RemoteHost {
        materialize_runtime_host(host, resolved_auth)
    }

    fn resolve_target(&self, host: &RemoteHost) -> AppResult<ResolvedSshHopAuth> {
        let material = self.resolve_material(
            ResolvedSshHopRole::Target,
            host.auth_type,
            host.credential_ref.as_deref(),
            host.secret_ref.as_deref(),
            host.credential_secret.as_deref(),
            host.key_passphrase_ref.as_deref(),
            host.key_passphrase_secret.as_deref(),
        )?;
        Ok(ResolvedSshHopAuth::new(
            ResolvedSshHopRole::Target,
            host.host.clone(),
            host.port,
            host.username.clone(),
            material,
        ))
    }

    fn resolve_jump(
        &self,
        index: usize,
        jump: &SshJumpHostOptions,
    ) -> AppResult<ResolvedSshHopAuth> {
        let role = ResolvedSshHopRole::Jump { index };
        let material = self.resolve_material(
            role,
            jump.auth_type,
            jump.credential_ref.as_deref(),
            jump.secret_ref.as_deref(),
            jump.credential_secret.as_deref(),
            jump.key_passphrase_ref.as_deref(),
            jump.key_passphrase_secret.as_deref(),
        )?;
        Ok(ResolvedSshHopAuth::new(
            role,
            jump.host.clone(),
            jump.port,
            jump.username.clone(),
            material,
        ))
    }

    fn resolve_material(
        &self,
        role: ResolvedSshHopRole,
        auth_type: RemoteHostAuthType,
        credential_ref: Option<&str>,
        secret_ref: Option<&str>,
        credential_secret: Option<&str>,
        key_passphrase_ref: Option<&str>,
        key_passphrase_secret: Option<&str>,
    ) -> AppResult<ResolvedSshAuthMaterial> {
        match auth_type {
            RemoteHostAuthType::Agent => Ok(ResolvedSshAuthMaterial::Agent {
                source: ResolvedSshCredentialSource::Agent,
            }),
            RemoteHostAuthType::Password => {
                self.resolve_password(role, secret_ref, credential_secret)
            }
            RemoteHostAuthType::Key => self.resolve_private_key(
                credential_ref,
                secret_ref,
                credential_secret,
                key_passphrase_ref,
                key_passphrase_secret,
            ),
        }
    }

    fn resolve_password(
        &self,
        role: ResolvedSshHopRole,
        secret_ref: Option<&str>,
        credential_secret: Option<&str>,
    ) -> AppResult<ResolvedSshAuthMaterial> {
        if let Some(value) = normalized(credential_secret) {
            return Ok(ResolvedSshAuthMaterial::Password {
                value: value.to_owned(),
                source: ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: "<runtime-password>".to_owned(),
                },
            });
        }
        if let Some(secret_ref) = normalized(secret_ref) {
            return Ok(ResolvedSshAuthMaterial::Password {
                value: self.decrypt_secret_ref(secret_ref, "password")?,
                source: ResolvedSshCredentialSource::Vault(vault_source(secret_ref)?),
            });
        }
        Ok(ResolvedSshAuthMaterial::PromptOnly {
            source: ResolvedSshCredentialSource::PromptOnly,
            reason: format!("{} password is not stored", role.label()),
        })
    }

    fn resolve_private_key(
        &self,
        credential_ref: Option<&str>,
        secret_ref: Option<&str>,
        credential_secret: Option<&str>,
        key_passphrase_ref: Option<&str>,
        key_passphrase_secret: Option<&str>,
    ) -> AppResult<ResolvedSshAuthMaterial> {
        let passphrase = self.resolve_key_passphrase(key_passphrase_ref, key_passphrase_secret)?;
        if let Some(content) = normalized(credential_secret) {
            return Ok(ResolvedSshAuthMaterial::PrivateKeyPem {
                content: content.to_owned(),
                passphrase,
                source: ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: "<runtime-private-key>".to_owned(),
                },
            });
        }
        if let Some(path) = normalized(credential_ref) {
            return Ok(ResolvedSshAuthMaterial::PrivateKeyPath {
                path: PathBuf::from(path),
                passphrase,
                source: ResolvedSshCredentialSource::ConfigPath,
            });
        }
        if let Some(secret_ref) = normalized(secret_ref) {
            return Ok(ResolvedSshAuthMaterial::PrivateKeyPem {
                content: self.decrypt_secret_ref(secret_ref, "private-key")?,
                passphrase,
                source: ResolvedSshCredentialSource::Vault(vault_source(secret_ref)?),
            });
        }
        Ok(ResolvedSshAuthMaterial::PromptOnly {
            source: ResolvedSshCredentialSource::PromptOnly,
            reason: "private key material is not configured".to_owned(),
        })
    }

    fn resolve_key_passphrase(
        &self,
        key_passphrase_ref: Option<&str>,
        key_passphrase_secret: Option<&str>,
    ) -> AppResult<Option<ResolvedSshSecretValue>> {
        if let Some(value) = normalized(key_passphrase_secret) {
            return Ok(Some(ResolvedSshSecretValue {
                value: value.to_owned(),
                source: ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: "<runtime-key-passphrase>".to_owned(),
                },
            }));
        }
        let Some(secret_ref) = normalized(key_passphrase_ref) else {
            return Ok(None);
        };
        Ok(Some(ResolvedSshSecretValue {
            value: self.decrypt_secret_ref(secret_ref, "key-passphrase")?,
            source: ResolvedSshCredentialSource::Vault(vault_source(secret_ref)?),
        }))
    }

    fn decrypt_secret_ref(&self, secret_ref: &str, expected_material: &str) -> AppResult<String> {
        let parsed = parse_vault_secret_ref(secret_ref).map_err(AppError::InvalidInput)?;
        if parsed.material != expected_material {
            return Err(AppError::InvalidInput(format!(
                "vault ref material {} cannot be used as {expected_material}",
                parsed.material
            )));
        }
        let entry_id = parsed.entry_id();
        let (key, entry) =
            self.vault
                .read_key_and_entry(&entry_id)
                .map_err(|error| match error {
                    VaultKeyEntryReadError::Key => {
                        AppError::Credential("vault key is missing or unreadable".to_owned())
                    }
                    VaultKeyEntryReadError::Vault(error) => error,
                })?;
        let entry = entry
            .ok_or_else(|| AppError::Credential(format!("vault entry is missing: {entry_id}")))?;
        let plaintext = self
            .vault
            .decrypt_secret(&key, &entry, secret_ref.as_bytes())
            .map_err(|_| {
                AppError::Credential(format!("vault entry cannot be decrypted: {entry_id}"))
            })?;
        String::from_utf8(plaintext)
            .map_err(|_| AppError::Credential(format!("vault entry is not utf-8 text: {entry_id}")))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSshRuntimeHost {
    pub host: RemoteHost,
    pub auth: ResolvedSshRouteAuth,
}

#[derive(Clone, PartialEq, Eq)]
pub struct NativeSshRouteMaterial {
    pub target: NativeSshHopMaterial,
    pub jumps: Vec<NativeSshHopMaterial>,
}

impl fmt::Debug for NativeSshRouteMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeSshRouteMaterial")
            .field("target", &self.target)
            .field("jumps", &self.jumps)
            .finish()
    }
}

impl NativeSshRouteMaterial {
    pub fn from_resolved_auth(resolved_auth: &ResolvedSshRouteAuth) -> AppResult<Self> {
        Ok(Self {
            target: NativeSshHopMaterial::from_resolved_hop(&resolved_auth.target)?,
            jumps: resolved_auth
                .jumps
                .iter()
                .map(NativeSshHopMaterial::from_resolved_hop)
                .collect::<AppResult<Vec<_>>>()?,
        })
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct NativeSshHopMaterial {
    pub role: ResolvedSshHopRole,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: NativeSshAuthMaterial,
}

impl fmt::Debug for NativeSshHopMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeSshHopMaterial")
            .field("role", &self.role)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("auth", &self.auth)
            .finish()
    }
}

impl NativeSshHopMaterial {
    fn from_resolved_hop(hop: &ResolvedSshHopAuth) -> AppResult<Self> {
        Ok(Self {
            role: hop.role,
            host: hop.host.clone(),
            port: hop.port,
            username: hop.username.clone(),
            auth: NativeSshAuthMaterial::from_resolved_material(hop.role, &hop.material)?,
        })
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum NativeSshAuthMaterial {
    Agent {
        source: ResolvedSshCredentialSource,
    },
    Password {
        value: String,
        source: ResolvedSshCredentialSource,
    },
    PrivateKeyPath {
        path: PathBuf,
        passphrase: Option<ResolvedSshSecretValue>,
        source: ResolvedSshCredentialSource,
    },
    PrivateKeyPem {
        content: String,
        passphrase: Option<ResolvedSshSecretValue>,
        source: ResolvedSshCredentialSource,
    },
}

impl fmt::Debug for NativeSshAuthMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent { source } => formatter
                .debug_struct("Agent")
                .field("source", source)
                .finish(),
            Self::Password { source, .. } => formatter
                .debug_struct("Password")
                .field("value", &"<redacted>")
                .field("source", source)
                .finish(),
            Self::PrivateKeyPath {
                path,
                passphrase,
                source,
            } => formatter
                .debug_struct("PrivateKeyPath")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .field("source", source)
                .finish(),
            Self::PrivateKeyPem {
                passphrase, source, ..
            } => formatter
                .debug_struct("PrivateKeyPem")
                .field("content", &"<redacted>")
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .field("source", source)
                .finish(),
        }
    }
}

impl NativeSshAuthMaterial {
    fn from_resolved_material(
        role: ResolvedSshHopRole,
        material: &ResolvedSshAuthMaterial,
    ) -> AppResult<Self> {
        match material {
            ResolvedSshAuthMaterial::Agent { source } => Ok(Self::Agent {
                source: source.clone(),
            }),
            ResolvedSshAuthMaterial::Password { value, source } => Ok(Self::Password {
                value: value.clone(),
                source: source.clone(),
            }),
            ResolvedSshAuthMaterial::PrivateKeyPath {
                path,
                passphrase,
                source,
            } => Ok(Self::PrivateKeyPath {
                path: path.clone(),
                passphrase: passphrase.clone(),
                source: source.clone(),
            }),
            ResolvedSshAuthMaterial::PrivateKeyPem {
                content,
                passphrase,
                source,
            } => Ok(Self::PrivateKeyPem {
                content: content.clone(),
                passphrase: passphrase.clone(),
                source: source.clone(),
            }),
            ResolvedSshAuthMaterial::PromptOnly { reason, .. } => {
                Err(AppError::InvalidInput(format!(
                    "{} requires interactive SSH credential prompt: {reason}",
                    role.label()
                )))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSshRouteAuth {
    pub target: ResolvedSshHopAuth,
    pub jumps: Vec<ResolvedSshHopAuth>,
    pub summary: ResolvedSshRouteAuthSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSshHopAuth {
    pub role: ResolvedSshHopRole,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub material: ResolvedSshAuthMaterial,
    pub secret_input_plan: TerminalSecretInputPlan,
    pub summary: ResolvedSshAuthSummary,
}

impl ResolvedSshHopAuth {
    pub fn from_material(
        role: ResolvedSshHopRole,
        host: String,
        port: u16,
        username: String,
        material: ResolvedSshAuthMaterial,
    ) -> Self {
        Self::new(role, host, port, username, material)
    }

    fn new(
        role: ResolvedSshHopRole,
        host: String,
        port: u16,
        username: String,
        material: ResolvedSshAuthMaterial,
    ) -> Self {
        let secret_input_plan = TerminalSecretInputPlan::from_material(&material);
        let summary =
            ResolvedSshAuthSummary::from_material(role, &host, port, &username, &material);
        Self {
            role,
            host,
            port,
            username,
            material,
            secret_input_plan,
            summary,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedSshHopRole {
    Target,
    Jump { index: usize },
}

impl ResolvedSshHopRole {
    fn label(self) -> String {
        match self {
            Self::Target => "target".to_owned(),
            Self::Jump { index } => format!("jump[{index}]"),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum ResolvedSshAuthMaterial {
    Agent {
        source: ResolvedSshCredentialSource,
    },
    Password {
        value: String,
        source: ResolvedSshCredentialSource,
    },
    PrivateKeyPath {
        path: PathBuf,
        passphrase: Option<ResolvedSshSecretValue>,
        source: ResolvedSshCredentialSource,
    },
    PrivateKeyPem {
        content: String,
        passphrase: Option<ResolvedSshSecretValue>,
        source: ResolvedSshCredentialSource,
    },
    PromptOnly {
        source: ResolvedSshCredentialSource,
        reason: String,
    },
}

impl fmt::Debug for ResolvedSshAuthMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent { source } => formatter
                .debug_struct("Agent")
                .field("source", source)
                .finish(),
            Self::Password { source, .. } => formatter
                .debug_struct("Password")
                .field("value", &"<redacted>")
                .field("source", source)
                .finish(),
            Self::PrivateKeyPath {
                path,
                passphrase,
                source,
            } => formatter
                .debug_struct("PrivateKeyPath")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .field("source", source)
                .finish(),
            Self::PrivateKeyPem {
                passphrase, source, ..
            } => formatter
                .debug_struct("PrivateKeyPem")
                .field("content", &"<redacted>")
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .field("source", source)
                .finish(),
            Self::PromptOnly { source, reason } => formatter
                .debug_struct("PromptOnly")
                .field("source", source)
                .field("reason", reason)
                .finish(),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedSshSecretValue {
    pub value: String,
    pub source: ResolvedSshCredentialSource,
}

impl fmt::Debug for ResolvedSshSecretValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedSshSecretValue")
            .field("value", &"<redacted>")
            .field("source", &self.source)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedSshCredentialSource {
    Agent,
    ConfigPath,
    PromptOnly,
    SessionOnly { prompt_id: String },
    Vault(VaultResolvedSource),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultResolvedSource {
    pub secret_ref: String,
    pub entry_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSecretInputPlan {
    pub mode: TerminalSecretInputMode,
    pub source: ResolvedSshCredentialSource,
}

impl TerminalSecretInputPlan {
    fn from_material(material: &ResolvedSshAuthMaterial) -> Self {
        match material {
            ResolvedSshAuthMaterial::Password { source, .. } => Self {
                mode: TerminalSecretInputMode::Password,
                source: source.clone(),
            },
            ResolvedSshAuthMaterial::PromptOnly { source, .. } => Self {
                mode: TerminalSecretInputMode::PromptOnly,
                source: source.clone(),
            },
            ResolvedSshAuthMaterial::Agent { source }
            | ResolvedSshAuthMaterial::PrivateKeyPath { source, .. }
            | ResolvedSshAuthMaterial::PrivateKeyPem { source, .. } => Self {
                mode: TerminalSecretInputMode::None,
                source: source.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSecretInputMode {
    None,
    Password,
    PromptOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSshRouteAuthSummary {
    pub target: ResolvedSshAuthSummary,
    pub jumps: Vec<ResolvedSshAuthSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSshAuthSummary {
    pub role: ResolvedSshHopRole,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: ResolvedSshAuthKind,
    pub source: ResolvedSshCredentialSource,
    pub has_secret_material: bool,
    pub has_key_passphrase: bool,
    pub prompt_required: bool,
}

impl ResolvedSshAuthSummary {
    fn from_material(
        role: ResolvedSshHopRole,
        host: &str,
        port: u16,
        username: &str,
        material: &ResolvedSshAuthMaterial,
    ) -> Self {
        let (auth_kind, source, has_secret_material, has_key_passphrase, prompt_required) =
            match material {
                ResolvedSshAuthMaterial::Agent { source } => (
                    ResolvedSshAuthKind::Agent,
                    source.clone(),
                    false,
                    false,
                    false,
                ),
                ResolvedSshAuthMaterial::Password { source, .. } => (
                    ResolvedSshAuthKind::Password,
                    source.clone(),
                    true,
                    false,
                    false,
                ),
                ResolvedSshAuthMaterial::PrivateKeyPath {
                    passphrase, source, ..
                } => (
                    ResolvedSshAuthKind::PrivateKeyPath,
                    source.clone(),
                    false,
                    passphrase.is_some(),
                    false,
                ),
                ResolvedSshAuthMaterial::PrivateKeyPem {
                    passphrase, source, ..
                } => (
                    ResolvedSshAuthKind::PrivateKeyPem,
                    source.clone(),
                    true,
                    passphrase.is_some(),
                    false,
                ),
                ResolvedSshAuthMaterial::PromptOnly { source, .. } => (
                    ResolvedSshAuthKind::PromptOnly,
                    source.clone(),
                    false,
                    false,
                    true,
                ),
            };
        Self {
            role,
            host: host.to_owned(),
            port,
            username: username.to_owned(),
            auth_kind,
            source,
            has_secret_material,
            has_key_passphrase,
            prompt_required,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedSshAuthKind {
    Agent,
    Password,
    PrivateKeyPath,
    PrivateKeyPem,
    PromptOnly,
}

fn vault_source(secret_ref: &str) -> AppResult<VaultResolvedSource> {
    let parsed = parse_vault_secret_ref(secret_ref).map_err(AppError::InvalidInput)?;
    Ok(VaultResolvedSource {
        secret_ref: secret_ref.to_owned(),
        entry_id: parsed.entry_id(),
    })
}

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn materialize_runtime_host(host: &RemoteHost, resolved_auth: &ResolvedSshRouteAuth) -> RemoteHost {
    let mut runtime_host = host.clone();
    apply_material_to_host(&mut runtime_host, &resolved_auth.target.material);
    for (jump, resolved_jump) in runtime_host
        .ssh_options
        .jump_hosts
        .iter_mut()
        .zip(&resolved_auth.jumps)
    {
        apply_material_to_jump(jump, &resolved_jump.material);
    }
    runtime_host
}

fn apply_material_to_host(host: &mut RemoteHost, material: &ResolvedSshAuthMaterial) {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => {
            host.credential_ref = None;
            host.credential_secret = None;
            host.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::Password { value, .. } => {
            host.credential_ref = None;
            host.credential_secret = Some(value.clone());
            host.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => {
            host.credential_ref = Some(display_path_arg(path));
            host.credential_secret = None;
            host.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => {
            host.credential_ref = None;
            host.credential_secret = Some(content.clone());
            host.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PromptOnly { .. } => {
            host.credential_secret = None;
            host.key_passphrase_secret = None;
        }
    }
}

fn apply_material_to_jump(jump: &mut SshJumpHostOptions, material: &ResolvedSshAuthMaterial) {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => {
            jump.credential_ref = None;
            jump.credential_secret = None;
            jump.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::Password { value, .. } => {
            jump.credential_ref = None;
            jump.credential_secret = Some(value.clone());
            jump.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => {
            jump.credential_ref = Some(display_path_arg(path));
            jump.credential_secret = None;
            jump.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => {
            jump.credential_ref = None;
            jump.credential_secret = Some(content.clone());
            jump.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PromptOnly { .. } => {
            jump.credential_secret = None;
            jump.key_passphrase_secret = None;
        }
    }
}

fn passphrase_value(passphrase: &Option<ResolvedSshSecretValue>) -> Option<String> {
    passphrase.as_ref().map(|value| value.value.clone())
}

fn display_path_arg(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}
