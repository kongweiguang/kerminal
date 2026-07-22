//! Host schema v1 一次性升级迁移。
//!
//! @author kongweiguang

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use toml_edit::{value, DocumentMut, Item, Value};
use uuid::Uuid;

use crate::storage::file_store::{
    FileStoreError, FileStoreResult, ParseDiagnostic, TomlDocument, TomlParseError,
};

use super::{
    reject_secret_keys_in_host_toml, remote_host_relative_path, timestamp_now, with_error_path,
    ConfigFileStore, RemoteHostTomlDocument, HOSTS_RELATIVE_DIR,
};

const REMOTE_HOST_SCHEMA_V1: i64 = 1;
const REMOTE_HOST_SCHEMA_V2: i64 = 2;

/// 一次性 host schema 升级结果；无候选时不创建 change-set。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHostSchemaMigrationReport {
    /// 实际迁移的主机数量。
    pub migrated_hosts: usize,
    /// durable change-set id；无写入时为空。
    pub change_set_id: Option<String>,
}

impl ConfigFileStore {
    /// 在严格 v2 loader 运行前，把所有 schema v1 主机作为一个可恢复事务迁移。
    ///
    /// v1 只在此升级边界消费一次；正常读取、CRUD 和 validator 仍只接受 v2。
    pub fn migrate_remote_host_schema_v1(
        &self,
    ) -> FileStoreResult<RemoteHostSchemaMigrationReport> {
        let timestamp = timestamp_now();
        let change_set_id = format!("remote-host-schema-v1-{}", Uuid::new_v4());
        let migrated_hosts =
            self.files
                .run_transaction(&change_set_id, &timestamp, |transaction| {
                    let mut migrated_hosts = 0;
                    for relative_path in self.remote_host_paths_for_migration()? {
                        let source = transaction.read_to_string(&relative_path)?;
                        if let Some(migrated) = migrate_host_source(&source, &relative_path)? {
                            transaction.write(&relative_path, migrated.into_bytes())?;
                            migrated_hosts += 1;
                        }
                    }
                    Ok(migrated_hosts)
                })?;
        Ok(RemoteHostSchemaMigrationReport {
            change_set_id: (migrated_hosts > 0).then_some(change_set_id),
            migrated_hosts,
        })
    }

    /// 目录枚举发生在 transaction closure 内，因此与读取、决策和提交共享同一进程/磁盘锁。
    fn remote_host_paths_for_migration(&self) -> FileStoreResult<Vec<PathBuf>> {
        let hosts_dir = self.files.path_for(HOSTS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(hosts_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                return Err(FileStoreError::InvalidPath(
                    "host config filename is not valid UTF-8".to_owned(),
                ));
            };
            if file_name == "groups.toml" {
                continue;
            }
            let host_id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| FileStoreError::InvalidPath(file_name.to_owned()))?;
            let relative_path = remote_host_relative_path(host_id)?;
            if relative_path.file_name().and_then(|value| value.to_str()) != Some(file_name) {
                return Err(FileStoreError::InvalidPath(file_name.to_owned()));
            }
            paths.push(relative_path);
        }
        paths.sort();
        Ok(paths)
    }
}

fn migrate_host_source(source: &str, relative_path: &Path) -> FileStoreResult<Option<String>> {
    reject_secret_keys_in_host_toml(source)
        .map_err(|error| FileStoreError::TomlParse(error.with_path(relative_path.to_path_buf())))
        .and_then(|_| parse_host_document(source, relative_path))
}

fn parse_host_document(source: &str, relative_path: &Path) -> FileStoreResult<Option<String>> {
    let mut document = source.parse::<DocumentMut>().map_err(|_| {
        migration_error(
            relative_path,
            None,
            "host TOML cannot be parsed for schema migration",
            "Fix the TOML syntax without changing credentials, then restart Kerminal.",
        )
    })?;
    let schema_version = document
        .get("schema_version")
        .and_then(Item::as_integer)
        .ok_or_else(|| {
            migration_error(
                relative_path,
                Some("schema_version"),
                "host schema_version must be an integer",
                "Set schema_version = 1 for an old host or schema_version = 2 with an explicit protocol.",
            )
        })?;
    match schema_version {
        REMOTE_HOST_SCHEMA_V2 => {
            validate_v2_host(source, relative_path)?;
            Ok(None)
        }
        REMOTE_HOST_SCHEMA_V1 => {
            if document.get("protocol").is_some() {
                return Err(migration_error(
                    relative_path,
                    Some("protocol"),
                    "host schema v1 must not declare protocol",
                    "Remove the partial protocol field or complete a backed-up manual conversion to schema v2.",
                ));
            }
            let protocol = legacy_protocol(&document);
            replace_schema_version(&mut document)?;
            document.as_table_mut().insert("protocol", value(protocol));
            let migrated = document.to_string();
            validate_v2_host(&migrated, relative_path)?;
            Ok(Some(migrated))
        }
        other => Err(migration_error(
            relative_path,
            Some("schema_version"),
            &format!("unsupported host schema_version: {other}, expected 1 or 2"),
            "Use a Kerminal version that supports this host schema; the file was not modified.",
        )),
    }
}

fn legacy_protocol(document: &DocumentMut) -> &'static str {
    let tags = document
        .get("tags")
        .and_then(Item::as_array)
        .into_iter()
        .flat_map(|tags| tags.iter())
        .filter_map(Value::as_str);
    let normalized = tags
        .map(|tag| tag.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    if normalized.iter().any(|tag| tag == "serial") {
        "serial"
    } else if normalized.iter().any(|tag| tag == "telnet") {
        "telnet"
    } else if normalized.iter().any(|tag| tag == "rdp") {
        "rdp"
    } else {
        "ssh"
    }
}

fn replace_schema_version(document: &mut DocumentMut) -> FileStoreResult<()> {
    let item = document.get_mut("schema_version").ok_or_else(|| {
        FileStoreError::TomlEncode("schema_version disappeared during migration".to_owned())
    })?;
    let decor = item.as_value().map(|value| value.decor().clone());
    let mut schema = Value::from(REMOTE_HOST_SCHEMA_V2);
    if let Some(decor) = decor {
        *schema.decor_mut() = decor;
    }
    *item = Item::Value(schema);
    Ok(())
}

fn validate_v2_host(source: &str, relative_path: &Path) -> FileStoreResult<()> {
    let document = RemoteHostTomlDocument::decode_toml(source)
        .map_err(FileStoreError::TomlParse)
        .and_then(|document| with_error_path(document.into_host(), relative_path))?;
    let expected_id = relative_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| FileStoreError::InvalidPath(relative_path.display().to_string()))?;
    if document.id != expected_id {
        return Err(migration_error(
            relative_path,
            Some("id"),
            "remote host file id does not match its filename",
            "Make id match the hosts/<id>.toml filename before restarting Kerminal.",
        ));
    }
    Ok(())
}

fn migration_error(
    relative_path: &Path,
    key: Option<&str>,
    message: &str,
    recovery: &str,
) -> FileStoreError {
    let mut diagnostic = ParseDiagnostic::new(1, 1, message).with_recovery(recovery);
    if let Some(key) = key {
        diagnostic = diagnostic.with_key(key);
    }
    FileStoreError::TomlParse(
        TomlParseError::new(vec![diagnostic]).with_path(relative_path.to_path_buf()),
    )
}
