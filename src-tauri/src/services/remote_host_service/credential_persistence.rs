//! 远程主机凭据引用的 vault 持久化边界。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        build_vault_secret_ref, parse_vault_secret_ref, RemoteHostAuthType, RemoteHostProtocol,
        SSH_KEY_PASSPHRASE_MAX_BYTES,
    },
    services::encrypted_vault_service::{EncryptedVaultService, VaultUnitOfWork},
};

use super::normalize_optional_text;

pub(super) fn password_required_message(secret_kind: &str) -> String {
    if secret_kind == "rdp-host" {
        "RDP 密码认证需要填写明文密码".to_owned()
    } else {
        "密码认证需要填写明文 SSH 密码".to_owned()
    }
}

pub(super) fn reusable_secret_ref_for_kind(
    secret_ref: Option<String>,
    expected_kind: &str,
) -> Option<String> {
    let secret_ref = secret_ref?;
    match parse_vault_secret_ref(&secret_ref) {
        Ok(parsed) if parsed.kind == expected_kind => Some(secret_ref),
        Ok(_) | Err(_) => None,
    }
}

/// 单个主机凭据材料的持久化意图。
#[derive(Debug)]
pub(super) struct SecretPersistenceInput<'a> {
    pub(super) host_id: &'a str,
    pub(super) kind: &'a str,
    pub(super) scope: String,
    pub(super) material: &'a str,
    pub(super) plaintext: Option<String>,
    pub(super) existing_secret_ref: Option<String>,
}

/// 在共享 vault 工作单元内新增或复用凭据引用，不提前产生文件副作用。
pub(super) fn persist_secret_ref(
    vault: &EncryptedVaultService,
    unit: &mut VaultUnitOfWork,
    input: SecretPersistenceInput<'_>,
) -> AppResult<Option<String>> {
    let SecretPersistenceInput {
        host_id,
        kind,
        scope,
        material,
        plaintext,
        existing_secret_ref,
    } = input;
    let existing_secret_ref = existing_secret_ref.filter(|value| !value.trim().is_empty());
    let secret_ref = existing_secret_ref
        .clone()
        .unwrap_or_else(|| build_vault_secret_ref(kind, host_id, &scope, material));
    let Some(plaintext) = normalize_optional_text(plaintext) else {
        return Ok(existing_secret_ref);
    };
    vault.upsert_secret_in_unit(
        unit,
        &secret_ref,
        kind,
        secret_ref.as_bytes(),
        plaintext.as_bytes(),
    )?;
    Ok(Some(secret_ref))
}

/// 目标主机私钥口令的独立持久化意图。
#[derive(Debug)]
pub(super) struct KeyPassphrasePersistenceInput<'a> {
    pub(super) host_id: &'a str,
    pub(super) kind: &'a str,
    pub(super) plaintext: Option<String>,
    pub(super) existing_secret_ref: Option<String>,
    pub(super) clear: bool,
}

/// Rust 服务边界归一化后的私钥口令修改意图。
#[derive(Debug)]
pub(super) struct NormalizedKeyPassphraseInput {
    pub(super) secret: Option<String>,
    pub(super) clear: bool,
}

/// 校验私钥口令 wire intent，同时保留实际口令中的首尾空白。
pub(super) fn normalize_key_passphrase_input(
    protocol: RemoteHostProtocol,
    auth_type: RemoteHostAuthType,
    secret: Option<String>,
    clear: bool,
    allow_clear: bool,
) -> AppResult<NormalizedKeyPassphraseInput> {
    let secret = secret.filter(|value| !value.is_empty());
    if !matches!(protocol, RemoteHostProtocol::Ssh | RemoteHostProtocol::Sftp)
        && (secret.is_some() || clear)
    {
        return Err(AppError::InvalidInput(
            "只有 SSH 或 SFTP 主机可以保存或清空私钥口令".to_owned(),
        ));
    }
    if !matches!(auth_type, RemoteHostAuthType::Key) && (secret.is_some() || clear) {
        return Err(AppError::InvalidInput(
            "只有私钥认证可以保存或清空私钥口令".to_owned(),
        ));
    }
    if clear && !allow_clear {
        return Err(AppError::InvalidInput(
            "新建主机时没有可清空的私钥口令".to_owned(),
        ));
    }
    if clear && secret.is_some() {
        return Err(AppError::InvalidInput(
            "私钥口令不能同时替换和清空".to_owned(),
        ));
    }
    if secret
        .as_ref()
        .is_some_and(|value| value.len() > SSH_KEY_PASSPHRASE_MAX_BYTES)
    {
        return Err(AppError::InvalidInput(format!(
            "私钥口令不能超过 {SSH_KEY_PASSPHRASE_MAX_BYTES} 字节"
        )));
    }
    Ok(NormalizedKeyPassphraseInput { secret, clear })
}

/// 原子地保留、替换或清空目标私钥口令，只复用当前主机的精确 vault 引用。
pub(super) fn persist_key_passphrase_ref(
    vault: &EncryptedVaultService,
    unit: &mut VaultUnitOfWork,
    input: KeyPassphrasePersistenceInput<'_>,
) -> AppResult<Option<String>> {
    let expected_ref =
        build_vault_secret_ref(input.kind, input.host_id, "target", "key-passphrase");
    let existing_secret_ref = input
        .existing_secret_ref
        .filter(|secret_ref| secret_ref == &expected_ref);
    let plaintext = input.plaintext.filter(|value| !value.is_empty());

    if input.clear && plaintext.is_some() {
        return Err(AppError::InvalidInput(
            "私钥口令不能同时替换和清空".to_owned(),
        ));
    }
    if input.clear {
        if let Some(secret_ref) = existing_secret_ref.as_deref() {
            vault.remove_secret_in_unit(unit, secret_ref)?;
        }
        return Ok(None);
    }
    let Some(plaintext) = plaintext else {
        return Ok(existing_secret_ref);
    };
    vault.upsert_secret_in_unit(
        unit,
        &expected_ref,
        input.kind,
        expected_ref.as_bytes(),
        plaintext.as_bytes(),
    )?;
    Ok(Some(expected_ref))
}
