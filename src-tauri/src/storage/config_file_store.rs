//! File-backed configuration repository primitives.
//!
//! @author kongweiguang

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

mod documents;
mod profiles;
mod remote_host_migration;
mod remote_host_repository;
mod settings;
mod snippet_document;
mod snippets;
mod workflows;

pub use remote_host_migration::RemoteHostSchemaMigrationReport;
pub use snippet_document::{
    SnippetDocumentList, SnippetDocumentPatch, SnippetDocumentSnapshot, SnippetDocumentWarning,
};

use documents::{
    ProfileTomlDocument, RemoteHostGroupsTomlDocument, RemoteHostTomlDocument,
    SettingsTomlDocument, SnippetTomlDocument, WorkflowTomlDocument,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    models::{
        profile::TerminalProfile,
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus, RemoteHostGroup,
            RemoteHostGroupWithHosts, SshOptions,
        },
        settings::AppSettings,
        snippet::CommandSnippet,
        workflow::{CommandWorkflow, CommandWorkflowStep},
    },
    storage::file_store::{
        FileStore, FileStoreChange, FileStoreError, FileStoreResult, ParseDiagnostic, TomlDocument,
        TomlParseError,
    },
};

/// Kerminal file-backed config schema version.
pub const CONFIG_FILE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDeleteReceipt {
    pub change_set_id: String,
    pub snippet_id: String,
    pub expires_at_unix_ms: u128,
}
const SETTINGS_RELATIVE_PATH: &str = "settings.toml";
const PROFILES_RELATIVE_DIR: &str = "profiles";
const HOSTS_RELATIVE_DIR: &str = "hosts";
const HOST_GROUPS_RELATIVE_PATH: &str = "hosts/groups.toml";
const SNIPPETS_RELATIVE_DIR: &str = "snippets";
const WORKFLOWS_RELATIVE_DIR: &str = "workflows";
const UNGROUPED_REMOTE_HOST_GROUP_ID: &str = "__ungrouped__";
const UNGROUPED_REMOTE_HOST_GROUP_NAME: &str = "默认分组";

/// File repository for low-frequency, agent-editable Kerminal config.
#[derive(Debug, Clone)]
pub struct ConfigFileStore {
    files: FileStore,
}

impl ConfigFileStore {
    /// Create a config repository rooted at the Kerminal config workspace.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            files: FileStore::new(root),
        }
    }

    /// Return the root directory used by this repository.
    pub fn root(&self) -> &Path {
        self.files.root()
    }

    /// Read all remote host groups from `hosts/groups.toml`.
    pub fn list_remote_host_groups(&self) -> FileStoreResult<Vec<RemoteHostGroup>> {
        match self
            .files
            .read_toml::<RemoteHostGroupsTomlDocument>(HOST_GROUPS_RELATIVE_PATH)
        {
            Ok(document) => {
                with_error_path(document.into_groups(), Path::new(HOST_GROUPS_RELATIVE_PATH))
            }
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error),
        }
    }

    /// Read one remote host group by id.
    pub fn remote_host_group_by_id(
        &self,
        group_id: &str,
    ) -> FileStoreResult<Option<RemoteHostGroup>> {
        Ok(self
            .list_remote_host_groups()?
            .into_iter()
            .find(|group| group.id == group_id))
    }

    /// Read one remote host from `hosts/<id>.toml`.
    pub fn remote_host_by_id(&self, host_id: &str) -> FileStoreResult<Option<RemoteHost>> {
        match self.read_remote_host(host_id) {
            Ok(host) => Ok(Some(host)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Read all remote host TOML files, ordered by group, sort order and name.
    pub fn list_remote_hosts(&self) -> FileStoreResult<Vec<RemoteHost>> {
        let mut hosts = self.list_remote_host_metadata()?;
        sort_remote_hosts(&mut hosts);
        Ok(hosts)
    }

    /// Read public remote host TOML files.
    pub fn list_remote_host_metadata(&self) -> FileStoreResult<Vec<RemoteHost>> {
        let hosts_dir = self.files.path_for(HOSTS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&hosts_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut hosts = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(host_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if host_id == "groups" {
                continue;
            }
            hosts.push(self.read_remote_host_metadata(host_id)?);
        }

        sort_remote_hosts(&mut hosts);
        Ok(hosts)
    }

    /// Read the grouped host tree. The ungrouped group is runtime-only and never written.
    pub fn list_remote_host_tree(&self) -> FileStoreResult<Vec<RemoteHostGroupWithHosts>> {
        let groups = self.list_remote_host_groups()?;
        let hosts = self.list_remote_hosts()?;
        let mut tree = groups
            .into_iter()
            .map(|group| {
                let mut group_hosts = hosts
                    .iter()
                    .filter(|host| host.group_id.as_deref() == Some(group.id.as_str()))
                    .cloned()
                    .collect::<Vec<_>>();
                sort_remote_hosts(&mut group_hosts);
                RemoteHostGroupWithHosts {
                    id: group.id,
                    name: group.name,
                    sort_order: group.sort_order,
                    created_at: group.created_at,
                    updated_at: group.updated_at,
                    hosts: group_hosts,
                }
            })
            .collect::<Vec<_>>();

        let mut ungrouped_hosts = hosts
            .into_iter()
            .filter(|host| host.group_id.is_none())
            .collect::<Vec<_>>();
        sort_remote_hosts(&mut ungrouped_hosts);
        if !ungrouped_hosts.is_empty() {
            tree.insert(
                0,
                RemoteHostGroupWithHosts {
                    id: UNGROUPED_REMOTE_HOST_GROUP_ID.to_owned(),
                    name: UNGROUPED_REMOTE_HOST_GROUP_NAME.to_owned(),
                    sort_order: i64::MIN,
                    created_at: String::new(),
                    updated_at: String::new(),
                    hosts: ungrouped_hosts,
                },
            );
        }
        Ok(tree)
    }

    /// Return the next host sort order within a group or ungrouped area.
    pub fn next_remote_host_sort_order(&self, group_id: Option<&str>) -> FileStoreResult<i64> {
        Ok(self
            .list_remote_hosts()?
            .into_iter()
            .filter(|host| host.group_id.as_deref() == group_id)
            .map(|host| host.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply remote host/group writes as one recoverable change set.
    pub fn apply_remote_host_change_set(
        &self,
        groups: Option<&[RemoteHostGroup]>,
        hosts_to_write: &[RemoteHost],
        host_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("remote-hosts-{}", Uuid::new_v4());
        let mut changes = Vec::new();

        if let Some(groups) = groups {
            let document = RemoteHostGroupsTomlDocument::from_groups(groups.to_vec());
            changes.push(FileStoreChange::new(
                HOST_GROUPS_RELATIVE_PATH,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for host in hosts_to_write {
            let host_path = remote_host_relative_path(&host.id)?;
            let host_document = RemoteHostTomlDocument::from_host(host.clone());
            changes.push(FileStoreChange::new(
                host_path,
                host_document.encode_toml()?.into_bytes(),
            )?);
        }

        for host_id in host_ids_to_delete {
            changes.push(FileStoreChange::delete(remote_host_relative_path(
                host_id,
            )?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    fn read_remote_host(&self, host_id: &str) -> FileStoreResult<RemoteHost> {
        self.read_remote_host_metadata(host_id)
    }

    fn read_snippet(&self, snippet_id: &str) -> FileStoreResult<CommandSnippet> {
        let relative_path = snippet_relative_path(snippet_id)?;
        let document = self
            .files
            .read_toml::<SnippetTomlDocument>(&relative_path)?;
        let snippet = with_error_path(document.into_snippet(), &relative_path)?;
        crate::models::snippet::validate_snippet_metadata_contract(
            snippet.risk.as_deref(),
            snippet.default_action.as_deref(),
            &snippet.variables,
            &snippet.context_bindings,
        )
        .map_err(|message| {
            FileStoreError::TomlParse(
                TomlParseError::single(1, 1, message)
                    .with_path(relative_path.clone())
                    .with_recovery("修正 snippets/<id>.toml 中的可选元数据字段。"),
            )
        })?;
        if snippet.id != snippet_id {
            return Err(FileStoreError::TomlParse(
                TomlParseError::single(
                    1,
                    1,
                    format!(
                        "snippet file id mismatch: expected {snippet_id}, found {}",
                        snippet.id
                    ),
                )
                .with_path(relative_path)
                .with_key("id")
                .with_recovery("Make the snippet id match the snippets/<id>.toml file name."),
            ));
        }
        Ok(snippet)
    }
}

fn validate_schema_version(schema_version: u32) -> FileStoreResult<()> {
    if schema_version == CONFIG_FILE_SCHEMA_VERSION {
        return Ok(());
    }

    Err(FileStoreError::TomlParse(
        TomlParseError::single(
            1,
            1,
            format!(
                "unsupported config schema_version: {schema_version}, expected {CONFIG_FILE_SCHEMA_VERSION}"
            ),
        )
        .with_key("schema_version")
        .with_recovery(format!(
            "Set schema_version = {CONFIG_FILE_SCHEMA_VERSION} for this Kerminal config file."
        )),
    ))
}

fn profile_relative_path(profile_id: &str) -> FileStoreResult<PathBuf> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty()
        || profile_id == "."
        || profile_id == ".."
        || !profile_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid profile id: {profile_id}"
        )));
    }

    Ok(PathBuf::from("profiles").join(format!("{profile_id}.toml")))
}

fn snippet_relative_path(snippet_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(SNIPPETS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("snippet id", snippet_id)?
    )))
}

fn workflow_relative_path(workflow_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(WORKFLOWS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("workflow id", workflow_id)?
    )))
}

fn remote_host_relative_path(host_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(HOSTS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("remote host id", host_id)?
    )))
}

fn sanitize_file_id(field: &str, value: &str) -> FileStoreResult<String> {
    let value = value.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value == "groups"
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid {field}: {value}"
        )));
    }
    Ok(value.to_owned())
}

fn credential_status_from_metadata(
    auth_type: RemoteHostAuthType,
    secret_ref: Option<&str>,
) -> RemoteHostCredentialStatus {
    if matches!(auth_type, RemoteHostAuthType::Agent) {
        return RemoteHostCredentialStatus::Agent;
    }
    if secret_ref.is_some_and(|value| !value.trim().is_empty()) {
        return RemoteHostCredentialStatus::Vault;
    }
    RemoteHostCredentialStatus::Missing
}

fn normalize_jump_host_credential_statuses(mut options: SshOptions) -> SshOptions {
    for jump_host in &mut options.jump_hosts {
        jump_host.credential_status =
            credential_status_from_metadata(jump_host.auth_type, jump_host.secret_ref.as_deref());
    }
    options
}

fn sort_remote_hosts(hosts: &mut [RemoteHost]) {
    hosts.sort_by(|left, right| {
        left.group_id
            .cmp(&right.group_id)
            .then_with(|| left.sort_order.cmp(&right.sort_order))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn sort_snippets(snippets: &mut [CommandSnippet]) {
    snippets.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn sort_workflows(workflows: &mut [CommandWorkflow]) {
    workflows.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn sort_workflow_steps(steps: &mut [CommandWorkflowStep]) {
    steps.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn unix_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn encode_toml<T: Serialize>(value: &T) -> FileStoreResult<String> {
    toml::to_string_pretty(value).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
}

fn decode_toml<T: DeserializeOwned>(source: &str) -> Result<T, TomlParseError> {
    toml::from_str(source).map_err(|error| toml_parse_error(source, error))
}

fn toml_validation_error(error: crate::error::AppError) -> FileStoreError {
    let message = error.to_string();
    let mut diagnostic = ParseDiagnostic::new(1, 1, message.clone()).with_recovery(
        "Fix the value according to the Kerminal config guide; the app keeps last-known-good until validation passes.",
    );
    if let Some(key) = infer_validation_key(&message) {
        diagnostic = diagnostic.with_key(key);
    }
    FileStoreError::TomlParse(TomlParseError::new(vec![diagnostic]))
}

fn reject_secret_keys_in_host_toml(source: &str) -> Result<(), TomlParseError> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "credential_secret",
        "credentialSecret",
        "password",
        "inline_private_key",
        "inlinePrivateKey",
        "key_passphrase",
        "keyPassphrase",
        "key_passphrase_secret",
        "keyPassphraseSecret",
    ];
    for (line_index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some((assignment, _)) = trimmed.split_once('=') else {
            continue;
        };
        let leaf_key = assignment
            .trim()
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .trim()
            .trim_matches(['"', '\'']);
        if let Some(key) = FORBIDDEN_KEYS.iter().find(|key| leaf_key == **key) {
            let column = line.find(key).map(|index| index + 1).unwrap_or(1);
            let diagnostic = ParseDiagnostic::new(
                line_index + 1,
                column,
                "ordinary host config must not contain credential secret fields; save credentials through encrypted vault",
            )
            .with_key(*key)
            .with_recovery(
                "Remove the plaintext secret field and save credentials through the encrypted vault; host TOML may only keep secret_ref/key_passphrase_ref references.",
            );
            return Err(TomlParseError::new(vec![diagnostic]));
        }
    }
    Ok(())
}

fn with_error_path<T>(result: FileStoreResult<T>, relative_path: &Path) -> FileStoreResult<T> {
    result.map_err(|error| match error {
        FileStoreError::TomlParse(parse_error) => {
            FileStoreError::TomlParse(parse_error.with_path(relative_path.to_path_buf()))
        }
        other => other,
    })
}

fn toml_parse_error(source: &str, error: toml::de::Error) -> TomlParseError {
    let message = error.message().to_owned();
    let (line, column) = error
        .span()
        .map(|span| line_column_for_byte_index(source, span.start))
        .unwrap_or((1, 1));
    let key = infer_toml_error_key(source, line, &message);
    let recovery = recovery_for_toml_diagnostic(key.as_deref(), &message);
    let mut diagnostic = ParseDiagnostic::new(line, column, message);
    if let Some(key) = key {
        diagnostic = diagnostic.with_key(key);
    }
    if let Some(recovery) = recovery {
        diagnostic = diagnostic.with_recovery(recovery);
    }
    TomlParseError::new(vec![diagnostic])
}

fn line_column_for_byte_index(source: &str, index: usize) -> (usize, usize) {
    if source.is_empty() {
        return (1, 1);
    }

    let bytes = source.as_bytes();
    let safe_index = index.min(bytes.len().saturating_sub(1));
    let column_offset = index.saturating_sub(safe_index);
    let line_start = bytes[..safe_index]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|position| position + 1)
        .unwrap_or(0);
    let line = bytes[..line_start]
        .iter()
        .filter(|byte| **byte == b'\n')
        .count()
        + 1;
    let column = std::str::from_utf8(&bytes[line_start..=safe_index])
        .map(|text| text.chars().count())
        .unwrap_or_else(|_| safe_index.saturating_sub(line_start) + 1)
        + column_offset;
    (line, column.max(1))
}

fn infer_toml_error_key(source: &str, line: usize, message: &str) -> Option<String> {
    key_from_missing_field_message(message).or_else(|| key_from_toml_line(source, line))
}

fn key_from_missing_field_message(message: &str) -> Option<String> {
    let marker = "missing field `";
    let start = message.find(marker)? + marker.len();
    let rest = &message[start..];
    let end = rest.find('`')?;
    let key = rest[..end].trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_owned())
    }
}

fn key_from_toml_line(source: &str, line: usize) -> Option<String> {
    let line_text = source.lines().nth(line.saturating_sub(1))?;
    let (raw_key, _) = line_text.split_once('=')?;
    let local_key = normalize_toml_key(raw_key)?;
    let table = table_for_toml_line(source, line);
    Some(match table {
        Some(table) if !table.is_empty() => format!("{table}.{local_key}"),
        _ => local_key,
    })
}

fn table_for_toml_line(source: &str, line: usize) -> Option<String> {
    let mut table = None;
    for line_text in source.lines().take(line.saturating_sub(1)) {
        let trimmed = line_text.trim();
        if trimmed.starts_with("[[") && trimmed.ends_with("]]") {
            table = Some(
                trimmed[2..trimmed.len().saturating_sub(2)]
                    .trim()
                    .to_owned(),
            );
        } else if trimmed.starts_with('[') && trimmed.ends_with(']') {
            table = Some(
                trimmed[1..trimmed.len().saturating_sub(1)]
                    .trim()
                    .to_owned(),
            );
        }
    }
    table.filter(|value| !value.is_empty())
}

fn normalize_toml_key(raw_key: &str) -> Option<String> {
    let key = raw_key
        .split('#')
        .next()
        .unwrap_or(raw_key)
        .trim()
        .trim_matches('"')
        .trim_matches('\'');
    if key.is_empty() {
        None
    } else {
        Some(key.to_owned())
    }
}

fn infer_validation_key(message: &str) -> Option<&'static str> {
    if message.contains("背景图路径") {
        Some("appearance.backgroundImagePath")
    } else if message.contains("终端字体") {
        Some("terminal.fontFamily")
    } else if message.contains("终端字号") {
        Some("terminal.fontSize")
    } else if message.contains("终端行高") {
        Some("terminal.lineHeight")
    } else if message.contains("滚屏缓冲") {
        Some("terminal.scrollback")
    } else {
        None
    }
}

fn recovery_for_toml_diagnostic(key: Option<&str>, message: &str) -> Option<String> {
    if key == Some("schema_version") {
        return Some(format!(
            "Set schema_version = {CONFIG_FILE_SCHEMA_VERSION} for this Kerminal config file."
        ));
    }
    if message.contains("missing field") {
        return Some(match key {
            Some(key) => {
                format!("Add the required `{key}` key or restore the last-known-good file.")
            }
            None => "Add the missing required key or restore the last-known-good file.".to_owned(),
        });
    }
    if message.contains("invalid type") {
        return Some(match key {
            Some(key) => format!(
                "Use the documented value type for `{key}` and rerun kerminal.config.validate."
            ),
            None => "Use the documented value type and rerun kerminal.config.validate.".to_owned(),
        });
    }
    Some("Fix this TOML entry; Kerminal keeps last-known-good until validation passes.".to_owned())
}
