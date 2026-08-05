//! Kerminal encrypted workspace vault primitives.
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    storage::{
        durable_file_transaction::DurableFileTransaction,
        file_store::{FileStore, FileStoreError, FileStoreResult},
    },
};

pub const VAULT_KEY_SCHEMA_VERSION: u32 = 1;
pub const VAULT_SCHEMA_VERSION: u32 = 1;
pub const WORKSPACE_DEFAULT_KEY_ID: &str = "workspace-default";
pub const VAULT_ALGORITHM_XCHACHA20POLY1305: &str = "xchacha20poly1305";
const MASTER_KEY_BYTES: usize = 32;
const XCHACHA20_NONCE_BYTES: usize = 24;
const VAULT_KEY_RELATIVE_PATH: &str = "secrets/vault-key.toml";
const VAULT_RELATIVE_PATH: &str = "secrets/vault.toml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultKeyFile {
    pub schema_version: u32,
    pub key_id: String,
    pub algorithm: String,
    pub created_at: String,
    pub master_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultFile {
    pub schema_version: u32,
    #[serde(default)]
    pub entries: Vec<VaultEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    pub id: String,
    pub kind: String,
    pub algorithm: String,
    pub key_id: String,
    #[serde(default)]
    pub associated_data: String,
    pub nonce: String,
    pub ciphertext: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct EncryptedVaultService {
    paths: KerminalPaths,
}

impl EncryptedVaultService {
    pub fn new(paths: KerminalPaths) -> Self {
        Self { paths }
    }

    pub fn paths(&self) -> &KerminalPaths {
        &self.paths
    }

    pub fn ensure_workspace_key_if_safe(&self) -> AppResult<Option<VaultKeyFile>> {
        self.run_vault_transaction(
            "vault-key-ensure",
            |transaction| match read_transaction_toml(transaction, VAULT_KEY_RELATIVE_PATH) {
                Ok(key) => Ok(Some(key)),
                Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                    match transaction.read(VAULT_RELATIVE_PATH) {
                        Ok(_) => Ok(None),
                        Err(FileStoreError::Io(error))
                            if error.kind() == std::io::ErrorKind::NotFound =>
                        {
                            let key = self.new_workspace_key().map_err(vault_application_error)?;
                            transaction.write(VAULT_KEY_RELATIVE_PATH, encode_vault_toml(&key)?)?;
                            Ok(Some(key))
                        }
                        Err(error) => Err(error),
                    }
                }
                Err(error) => Err(error),
            },
        )
    }

    pub fn create_workspace_key(&self) -> AppResult<VaultKeyFile> {
        let key = self.new_workspace_key()?;
        let source = encode_vault_toml(&key).map_err(vault_file_store_error)?;
        self.run_vault_transaction("vault-key-create", |transaction| {
            match transaction.read(VAULT_KEY_RELATIVE_PATH) {
                Ok(_) => {
                    return Err(FileStoreError::InvalidPath(
                        "vault key already exists".to_owned(),
                    ))
                }
                Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            match transaction.read(VAULT_RELATIVE_PATH) {
                Ok(_) => {
                    return Err(FileStoreError::InvalidPath(
                        "vault exists without a key".to_owned(),
                    ))
                }
                Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            transaction.write(VAULT_KEY_RELATIVE_PATH, source)
        })?;
        Ok(key)
    }

    pub fn read_key(&self) -> AppResult<VaultKeyFile> {
        self.run_vault_transaction("vault-key-read", |transaction| {
            read_transaction_toml(transaction, VAULT_KEY_RELATIVE_PATH)
        })
    }

    pub fn read_vault(&self) -> AppResult<VaultFile> {
        self.run_vault_transaction("vault-read", read_vault_transaction)
    }

    pub fn vault_has_entries(&self) -> AppResult<bool> {
        Ok(!self.read_vault()?.entries.is_empty())
    }

    pub fn entry_count(&self) -> AppResult<usize> {
        Ok(self.read_vault()?.entries.len())
    }

    pub fn entry_by_id(&self, entry_id: &str) -> AppResult<Option<VaultEntry>> {
        Ok(self
            .read_vault()?
            .entries
            .into_iter()
            .find(|entry| entry.id == entry_id))
    }

    /// 在同一存储锁内读取密钥与条目，避免密钥轮换时观察到跨代数据。
    pub(crate) fn read_key_and_entry(
        &self,
        entry_id: &str,
    ) -> Result<(VaultKeyFile, Option<VaultEntry>), VaultKeyEntryReadError> {
        let id = format!("vault-key-entry-read-{}", Uuid::new_v4());
        FileStore::new(self.paths.root.clone()).run_transaction_with(
            &id,
            &current_unix_timestamp_string(),
            |transaction| {
                let key = read_transaction_toml(transaction, VAULT_KEY_RELATIVE_PATH)
                    .map_err(|_| VaultKeyEntryReadError::Key)?;
                let entry = read_vault_transaction(transaction)
                    .map_err(vault_file_store_error)
                    .map_err(VaultKeyEntryReadError::Vault)?
                    .entries
                    .into_iter()
                    .find(|entry| entry.id == entry_id);
                Ok((key, entry))
            },
            |error| VaultKeyEntryReadError::Vault(vault_file_store_error(error)),
        )
    }

    pub fn upsert_secret(
        &self,
        entry_id: &str,
        kind: &str,
        associated_data: &[u8],
        plaintext: &[u8],
    ) -> AppResult<VaultEntry> {
        self.run_unit_of_work("vault-upsert", |unit, _| {
            self.upsert_secret_in_unit(unit, entry_id, kind, associated_data, plaintext)
        })
    }

    /// 在调用方持有的 vault 工作单元中累计 secret 变更，不提前写盘。
    pub(crate) fn upsert_secret_in_unit(
        &self,
        unit: &mut VaultUnitOfWork,
        entry_id: &str,
        kind: &str,
        associated_data: &[u8],
        plaintext: &[u8],
    ) -> AppResult<VaultEntry> {
        unit.ensure_vault()?;
        let key = unit.ensure_key(self)?;
        let vault = unit.ensure_vault()?;
        let previous_created_at = vault
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .map(|entry| entry.created_at.clone());
        let mut next_entry =
            self.encrypt_secret(&key, entry_id, kind, associated_data, plaintext)?;
        if let Some(created_at) = previous_created_at {
            next_entry.created_at = created_at;
        }
        vault.entries.retain(|entry| entry.id != entry_id);
        vault.entries.push(next_entry.clone());
        vault.entries.sort_by(|left, right| left.id.cmp(&right.id));
        unit.vault_dirty = true;
        Ok(next_entry)
    }

    /// 在调用方持有的 vault 工作单元中删除单个 secret；不存在时保持幂等。
    pub(crate) fn remove_secret_in_unit(
        &self,
        unit: &mut VaultUnitOfWork,
        entry_id: &str,
    ) -> AppResult<bool> {
        let vault = unit.ensure_vault()?;
        let previous_len = vault.entries.len();
        vault.entries.retain(|entry| entry.id != entry_id);
        let removed = vault.entries.len() != previous_len;
        if removed {
            unit.vault_dirty = true;
        }
        Ok(removed)
    }

    pub fn write_vault(&self, vault: &VaultFile) -> AppResult<()> {
        let source = encode_vault_toml(vault).map_err(vault_file_store_error)?;
        self.run_vault_transaction("vault-write", |transaction| {
            transaction.write(VAULT_RELATIVE_PATH, source)
        })
    }

    pub fn encrypt_secret(
        &self,
        key: &VaultKeyFile,
        entry_id: &str,
        kind: &str,
        associated_data: &[u8],
        plaintext: &[u8],
    ) -> AppResult<VaultEntry> {
        validate_key(key)?;
        let key_bytes = BASE64
            .decode(&key.master_key)
            .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
        let nonce_bytes: [u8; XCHACHA20_NONCE_BYTES] = random_bytes(XCHACHA20_NONCE_BYTES)?
            .try_into()
            .map_err(|_| AppError::Credential("vault nonce length invalid".to_owned()))?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
            .map_err(|_| AppError::Credential("vault key length invalid".to_owned()))?;
        let nonce = XNonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: associated_data,
                },
            )
            .map_err(|_| AppError::Credential("vault encryption failed".to_owned()))?;
        let timestamp = current_unix_timestamp_string();
        Ok(VaultEntry {
            id: entry_id.to_owned(),
            kind: kind.to_owned(),
            algorithm: key.algorithm.clone(),
            key_id: key.key_id.clone(),
            associated_data: BASE64.encode(associated_data),
            nonce: BASE64.encode(nonce),
            ciphertext: BASE64.encode(ciphertext),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        })
    }

    pub fn decrypt_secret(
        &self,
        key: &VaultKeyFile,
        entry: &VaultEntry,
        associated_data: &[u8],
    ) -> AppResult<Vec<u8>> {
        validate_key(key)?;
        if entry.algorithm != key.algorithm || entry.key_id != key.key_id {
            return Err(AppError::Credential(
                "vault entry key metadata does not match".to_owned(),
            ));
        }
        if !entry.associated_data.is_empty() {
            let stored_associated_data =
                BASE64.decode(&entry.associated_data).map_err(|error| {
                    AppError::Credential(format!("vault associated data base64 invalid: {error}"))
                })?;
            if stored_associated_data != associated_data {
                return Err(AppError::Credential(
                    "vault associated data does not match".to_owned(),
                ));
            }
        }
        let key_bytes = BASE64
            .decode(&key.master_key)
            .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
        let nonce_bytes = BASE64.decode(&entry.nonce).map_err(|error| {
            AppError::Credential(format!("vault nonce base64 invalid: {error}"))
        })?;
        if nonce_bytes.len() != XCHACHA20_NONCE_BYTES {
            return Err(AppError::Credential(format!(
                "vault nonce must be {XCHACHA20_NONCE_BYTES} bytes"
            )));
        }
        let nonce_bytes: [u8; XCHACHA20_NONCE_BYTES] = nonce_bytes
            .try_into()
            .map_err(|_| AppError::Credential("vault nonce length invalid".to_owned()))?;
        let ciphertext = BASE64.decode(&entry.ciphertext).map_err(|error| {
            AppError::Credential(format!("vault ciphertext base64 invalid: {error}"))
        })?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
            .map_err(|_| AppError::Credential("vault key length invalid".to_owned()))?;
        let nonce = XNonce::from(nonce_bytes);
        cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext.as_slice(),
                    aad: associated_data,
                },
            )
            .map_err(|_| AppError::Credential("vault decryption failed".to_owned()))
    }

    pub fn export_key_toml(&self) -> AppResult<String> {
        let key = self.read_key()?;
        validate_key(&key)?;
        toml::to_string_pretty(&key).map_err(|error| {
            AppError::Credential(format!("vault key TOML serialize failed: {error}"))
        })
    }

    pub fn read_key_toml_source(&self) -> AppResult<String> {
        self.run_vault_transaction("vault-key-source-read", |transaction| {
            let source = transaction.read_to_string(VAULT_KEY_RELATIVE_PATH)?;
            let key: VaultKeyFile = toml::from_str(&source).map_err(|error| {
                FileStoreError::TomlEncode(format!("vault key TOML parse failed: {error}"))
            })?;
            validate_key(&key).map_err(vault_application_error)?;
            Ok(source)
        })
    }

    pub fn save_key_toml(&self, source: &str) -> AppResult<VaultKeyOperationResult> {
        self.import_key_toml(source, false)
    }

    pub fn import_key_toml(
        &self,
        source: &str,
        dry_run: bool,
    ) -> AppResult<VaultKeyOperationResult> {
        let key: VaultKeyFile = toml::from_str(source).map_err(|error| {
            AppError::Credential(format!("vault key TOML parse failed: {error}"))
        })?;
        validate_key(&key)?;
        let key_source = encode_vault_toml(&key).map_err(vault_file_store_error)?;
        let backup_relative_path = backup_relative_path(VAULT_KEY_RELATIVE_PATH);
        self.run_vault_transaction("vault-key-import", |transaction| {
            let vault = read_vault_transaction(transaction)?;
            self.validate_key_against_vault(&key, &vault)
                .map_err(vault_application_error)?;
            let existing_key = match transaction.read(VAULT_KEY_RELATIVE_PATH) {
                Ok(source) => Some(source),
                Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                    None
                }
                Err(error) => return Err(error),
            };
            if !dry_run {
                if let Some(existing_key) = existing_key.as_ref() {
                    transaction.write(&backup_relative_path, existing_key.clone())?;
                }
                transaction.write(VAULT_KEY_RELATIVE_PATH, key_source)?;
            }
            Ok(VaultKeyOperationResult {
                key_id: key.key_id,
                dry_run,
                entry_count: vault.entries.len(),
                backup_created: !dry_run && existing_key.is_some(),
            })
        })
    }

    pub fn rotate_workspace_key(&self, dry_run: bool) -> AppResult<VaultKeyOperationResult> {
        let next_key = self.new_workspace_key()?;
        let key_backup_relative_path = backup_relative_path(VAULT_KEY_RELATIVE_PATH);
        let vault_backup_relative_path = backup_relative_path(VAULT_RELATIVE_PATH);
        self.run_vault_transaction("vault-key-rotate", |transaction| {
            let current_key_source = transaction.read(VAULT_KEY_RELATIVE_PATH)?;
            let current_key_source_text =
                std::str::from_utf8(&current_key_source).map_err(|error| {
                    FileStoreError::TomlEncode(format!("vault key is not UTF-8: {error}"))
                })?;
            let current_key: VaultKeyFile =
                toml::from_str(current_key_source_text).map_err(|error| {
                    FileStoreError::TomlEncode(format!("vault TOML parse failed: {error}"))
                })?;
            validate_key(&current_key).map_err(vault_application_error)?;
            let vault = read_vault_transaction(transaction)?;
            let mut next_entries = Vec::with_capacity(vault.entries.len());
            for previous_entry in &vault.entries {
                let associated_data =
                    entry_associated_data(previous_entry).map_err(vault_application_error)?;
                let plaintext = self
                    .decrypt_secret(&current_key, previous_entry, &associated_data)
                    .map_err(vault_application_error)?;
                let mut next_entry = self
                    .encrypt_secret(
                        &next_key,
                        &previous_entry.id,
                        &previous_entry.kind,
                        &associated_data,
                        &plaintext,
                    )
                    .map_err(vault_application_error)?;
                next_entry.created_at = previous_entry.created_at.clone();
                next_entries.push(next_entry);
            }
            if !dry_run {
                // 备份与新一代 key/vault 属于同一 journal；恢复后只会看到完整的一代。
                transaction.write(&key_backup_relative_path, current_key_source)?;
                match transaction.read(VAULT_RELATIVE_PATH) {
                    Ok(current_vault_source) => {
                        transaction.write(&vault_backup_relative_path, current_vault_source)?;
                    }
                    Err(FileStoreError::Io(error))
                        if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                transaction.write(VAULT_KEY_RELATIVE_PATH, encode_vault_toml(&next_key)?)?;
                transaction.write(
                    VAULT_RELATIVE_PATH,
                    encode_vault_toml(&VaultFile {
                        schema_version: vault.schema_version,
                        entries: next_entries,
                    })?,
                )?;
            }
            Ok(VaultKeyOperationResult {
                key_id: next_key.key_id.clone(),
                dry_run,
                entry_count: vault.entries.len(),
                backup_created: !dry_run,
            })
        })
    }

    fn new_workspace_key(&self) -> AppResult<VaultKeyFile> {
        Ok(VaultKeyFile {
            schema_version: VAULT_KEY_SCHEMA_VERSION,
            key_id: WORKSPACE_DEFAULT_KEY_ID.to_owned(),
            algorithm: VAULT_ALGORITHM_XCHACHA20POLY1305.to_owned(),
            created_at: current_unix_timestamp_string(),
            master_key: BASE64.encode(random_bytes(MASTER_KEY_BYTES)?),
        })
    }

    fn validate_key_against_vault(&self, key: &VaultKeyFile, vault: &VaultFile) -> AppResult<()> {
        for entry in &vault.entries {
            let associated_data = entry_associated_data(entry)?;
            let _ = self.decrypt_secret(key, entry, &associated_data)?;
        }
        Ok(())
    }

    fn run_vault_transaction<T, F>(&self, prefix: &str, operation: F) -> AppResult<T>
    where
        F: FnOnce(&mut DurableFileTransaction<'_>) -> FileStoreResult<T>,
    {
        let id = format!("{prefix}-{}", Uuid::new_v4());
        FileStore::new(self.paths.root.clone())
            .run_transaction(&id, &current_unix_timestamp_string(), operation)
            .map_err(vault_file_store_error)
    }

    /// 将 vault 变更与调用方追加的其它文件写入放入同一个可恢复 journal。
    pub(crate) fn run_unit_of_work<T, F>(&self, prefix: &str, operation: F) -> AppResult<T>
    where
        F: FnOnce(&mut VaultUnitOfWork, &mut DurableFileTransaction<'_>) -> AppResult<T>,
    {
        let id = format!("{prefix}-{}", Uuid::new_v4());
        FileStore::new(self.paths.root.clone()).run_transaction_with(
            &id,
            &current_unix_timestamp_string(),
            |transaction| {
                let mut unit =
                    VaultUnitOfWork::load(transaction).map_err(vault_file_store_error)?;
                let result = operation(&mut unit, transaction)?;
                unit.stage(transaction).map_err(vault_file_store_error)?;
                Ok(result)
            },
            vault_file_store_error,
        )
    }
}

/// 一次凭据业务操作中的内存态 vault；成功结束时才把聚合后的写集加入事务。
pub(crate) struct VaultUnitOfWork {
    key: Option<VaultKeyFile>,
    key_source: Option<Vec<u8>>,
    key_dirty: bool,
    vault: Option<VaultFile>,
    vault_source: Option<Vec<u8>>,
    vault_existed: bool,
    vault_dirty: bool,
}

/// key 与 vault 在同锁读取时的脱敏错误边界。
pub(crate) enum VaultKeyEntryReadError {
    Key,
    Vault(AppError),
}

impl VaultUnitOfWork {
    fn load(transaction: &mut DurableFileTransaction<'_>) -> FileStoreResult<Self> {
        let vault_source = match transaction.read(VAULT_RELATIVE_PATH) {
            Ok(source) => Some(source),
            Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        let vault_existed = vault_source.is_some();
        let key_source = match transaction.read(VAULT_KEY_RELATIVE_PATH) {
            Ok(source) => Some(source),
            Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        Ok(Self {
            key: None,
            key_source,
            key_dirty: false,
            vault: None,
            vault_source,
            vault_existed,
            vault_dirty: false,
        })
    }

    fn ensure_vault(&mut self) -> AppResult<&mut VaultFile> {
        if self.vault.is_none() {
            self.vault = Some(match self.vault_source.take() {
                Some(source) => {
                    let source = std::str::from_utf8(&source).map_err(|error| {
                        AppError::Credential(format!("vault is not UTF-8: {error}"))
                    })?;
                    toml::from_str(source).map_err(|error| {
                        AppError::Credential(format!("vault TOML parse failed: {error}"))
                    })?
                }
                None => VaultFile {
                    schema_version: VAULT_SCHEMA_VERSION,
                    entries: Vec::new(),
                },
            });
        }
        self.vault
            .as_mut()
            .ok_or_else(|| AppError::Credential("vault state is unavailable".to_owned()))
    }

    fn ensure_key(&mut self, service: &EncryptedVaultService) -> AppResult<VaultKeyFile> {
        if self.key.is_none() {
            if let Some(source) = self.key_source.take() {
                let source = std::str::from_utf8(&source).map_err(|error| {
                    AppError::Credential(format!("vault key is not UTF-8: {error}"))
                })?;
                let key: VaultKeyFile = toml::from_str(source).map_err(|error| {
                    AppError::Credential(format!("vault key TOML parse failed: {error}"))
                })?;
                validate_key(&key)?;
                self.key = Some(key);
            } else {
                if self.vault_existed {
                    return Err(AppError::Credential("vault key is missing".to_owned()));
                }
                self.key = Some(service.new_workspace_key()?);
                self.key_dirty = true;
            }
        }
        self.key
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Credential("vault key is missing".to_owned()))
    }

    fn stage(self, transaction: &mut DurableFileTransaction<'_>) -> FileStoreResult<()> {
        if self.key_dirty {
            let key = self.key.ok_or_else(|| {
                FileStoreError::InvalidPath("vault key mutation is incomplete".to_owned())
            })?;
            transaction.write(VAULT_KEY_RELATIVE_PATH, encode_vault_toml(&key)?)?;
        }
        if self.vault_dirty {
            let vault = self.vault.ok_or_else(|| {
                FileStoreError::InvalidPath("vault mutation is incomplete".to_owned())
            })?;
            transaction.write(VAULT_RELATIVE_PATH, encode_vault_toml(&vault)?)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyOperationResult {
    pub key_id: String,
    pub dry_run: bool,
    pub entry_count: usize,
    pub backup_created: bool,
}

pub fn validate_key(key: &VaultKeyFile) -> AppResult<()> {
    if key.schema_version != VAULT_KEY_SCHEMA_VERSION {
        return Err(AppError::Credential(format!(
            "unsupported vault key schema version {}",
            key.schema_version
        )));
    }
    if key.algorithm != VAULT_ALGORITHM_XCHACHA20POLY1305 {
        return Err(AppError::Credential(format!(
            "unsupported vault algorithm {}",
            key.algorithm
        )));
    }
    let decoded = BASE64
        .decode(&key.master_key)
        .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
    if decoded.len() != MASTER_KEY_BYTES {
        return Err(AppError::Credential(format!(
            "vault key must be {MASTER_KEY_BYTES} bytes"
        )));
    }
    Ok(())
}

fn random_bytes(len: usize) -> AppResult<Vec<u8>> {
    let mut bytes = vec![0_u8; len];
    getrandom::fill(&mut bytes)
        .map_err(|error| AppError::Credential(format!("random generation failed: {error}")))?;
    Ok(bytes)
}

fn read_transaction_toml<T>(
    transaction: &mut DurableFileTransaction<'_>,
    relative_path: &str,
) -> FileStoreResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let source = transaction.read_to_string(relative_path)?;
    toml::from_str(&source)
        .map_err(|error| FileStoreError::TomlEncode(format!("vault TOML parse failed: {error}")))
}

fn read_vault_transaction(
    transaction: &mut DurableFileTransaction<'_>,
) -> FileStoreResult<VaultFile> {
    match read_transaction_toml(transaction, VAULT_RELATIVE_PATH) {
        Ok(vault) => Ok(vault),
        Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(VaultFile {
                schema_version: VAULT_SCHEMA_VERSION,
                entries: Vec::new(),
            })
        }
        Err(error) => Err(error),
    }
}

fn encode_vault_toml<T: Serialize>(value: &T) -> FileStoreResult<Vec<u8>> {
    toml::to_string_pretty(value)
        .map(String::into_bytes)
        .map_err(|error| {
            FileStoreError::TomlEncode(format!("vault TOML serialize failed: {error}"))
        })
}

fn vault_application_error(error: AppError) -> FileStoreError {
    FileStoreError::TomlEncode(error.to_string())
}

fn vault_file_store_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::Credential(other.to_string()),
    }
}

pub fn write_toml_atomically<T>(path: &Path, value: &T) -> AppResult<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let source = toml::to_string_pretty(value)
        .map_err(|error| AppError::Credential(format!("vault TOML serialize failed: {error}")))?;
    let temp_path = atomic_temp_path(path);
    fs::write(&temp_path, source)?;
    replace_file(&temp_path, path)?;
    Ok(())
}

fn entry_associated_data(entry: &VaultEntry) -> AppResult<Vec<u8>> {
    if entry.associated_data.is_empty() {
        return Err(AppError::Credential(format!(
            "vault entry {} is missing associated data",
            entry.id
        )));
    }
    BASE64.decode(&entry.associated_data).map_err(|error| {
        AppError::Credential(format!("vault associated data base64 invalid: {error}"))
    })
}

fn backup_relative_path(relative_path: &str) -> String {
    format!(
        "{relative_path}.bak.{}-{}",
        current_unix_timestamp_string(),
        Uuid::new_v4()
    )
}

fn replace_file(temp_path: &Path, path: &Path) -> AppResult<()> {
    match fs::rename(temp_path, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            fs::remove_file(path)?;
            fs::rename(temp_path, path).map_err(Into::into)
        }
        Err(error) => Err(error.into()),
    }
}

fn atomic_temp_path(path: &Path) -> PathBuf {
    let mut temp_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("vault")
        .to_owned();
    temp_name.push_str(".tmp");
    path.with_file_name(temp_name)
}

fn current_unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
