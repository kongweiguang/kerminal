//! 配置文件 TOML 文档结构与运行时模型转换。
//!
//! @author kongweiguang

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    models::{
        profile::TerminalProfile,
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostGroup, RemoteHostProtocol, SshOptions,
        },
        settings::AppSettings,
        snippet::{CommandSnippet, SnippetScope},
        workflow::{CommandWorkflow, CommandWorkflowStep, WorkflowScope},
    },
    storage::file_store::{FileStoreError, FileStoreResult, TomlDocument, TomlParseError},
};

use super::{
    credential_status_from_metadata, decode_toml, encode_toml,
    normalize_jump_host_credential_statuses, reject_secret_keys_in_host_toml, sort_workflow_steps,
    toml_validation_error, validate_schema_version, CONFIG_FILE_SCHEMA_VERSION,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct SettingsTomlDocument {
    schema_version: u32,
    #[serde(flatten)]
    settings: AppSettings,
}

impl SettingsTomlDocument {
    pub(super) fn from_settings(settings: AppSettings) -> FileStoreResult<Self> {
        Ok(Self {
            schema_version: CONFIG_FILE_SCHEMA_VERSION,
            settings: settings.validated().map_err(toml_validation_error)?,
        })
    }

    pub(super) fn into_settings(self) -> FileStoreResult<AppSettings> {
        validate_schema_version(self.schema_version)?;
        self.settings.validated().map_err(toml_validation_error)
    }
}

impl TomlDocument for SettingsTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        decode_toml(source)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct ProfileTomlDocument {
    schema_version: u32,
    id: String,
    name: String,
    shell: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    is_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sidebar_group_id: Option<String>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl ProfileTomlDocument {
    pub(super) fn from_profile(profile: TerminalProfile) -> Self {
        Self {
            schema_version: CONFIG_FILE_SCHEMA_VERSION,
            id: profile.id,
            name: profile.name,
            shell: profile.shell,
            args: profile.args,
            cwd: profile.cwd,
            env: profile.env,
            is_default: profile.is_default,
            sidebar_group_id: profile.sidebar_group_id,
            sort_order: profile.sort_order,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }
    }

    pub(super) fn into_profile(self) -> FileStoreResult<TerminalProfile> {
        validate_schema_version(self.schema_version)?;
        Ok(TerminalProfile {
            id: self.id,
            name: self.name,
            shell: self.shell,
            args: self.args,
            cwd: self.cwd,
            env: self.env,
            is_default: self.is_default,
            sidebar_group_id: self.sidebar_group_id,
            sort_order: self.sort_order,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl TomlDocument for ProfileTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        decode_toml(source)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct SnippetTomlDocument {
    schema_version: u32,
    id: String,
    title: String,
    description: Option<String>,
    command: String,
    #[serde(default)]
    tags: Vec<String>,
    scope: SnippetScope,
    sort_order: i64,
    created_at: String,
    updated_at: String,
    category: Option<String>,
    risk: Option<String>,
    default_action: Option<String>,
    #[serde(default)]
    variables: Vec<SnippetVariableTomlEntry>,
    #[serde(default)]
    context_bindings: Vec<SnippetContextBindingTomlEntry>,
    derived_from: Option<String>,
}

impl SnippetTomlDocument {
    pub(super) fn from_snippet(snippet: CommandSnippet) -> Self {
        Self {
            schema_version: CONFIG_FILE_SCHEMA_VERSION,
            id: snippet.id,
            title: snippet.title,
            description: snippet.description,
            command: snippet.command,
            tags: snippet.tags,
            scope: snippet.scope,
            sort_order: snippet.sort_order,
            created_at: snippet.created_at,
            updated_at: snippet.updated_at,
            category: snippet.category,
            risk: snippet.risk,
            default_action: snippet.default_action,
            variables: snippet.variables.into_iter().map(Into::into).collect(),
            context_bindings: snippet
                .context_bindings
                .into_iter()
                .map(Into::into)
                .collect(),
            derived_from: snippet.derived_from,
        }
    }

    pub(super) fn into_snippet(self) -> FileStoreResult<CommandSnippet> {
        validate_schema_version(self.schema_version)?;
        reject_secret_variable_values(self.variables.iter().map(|variable| {
            (
                &variable.kind,
                &variable.default_value,
                &variable.suggestions,
            )
        }))?;
        Ok(CommandSnippet {
            id: self.id,
            title: self.title,
            description: self.description,
            command: self.command,
            tags: self.tags,
            scope: self.scope,
            sort_order: self.sort_order,
            created_at: self.created_at,
            updated_at: self.updated_at,
            category: self.category,
            risk: self.risk,
            default_action: self.default_action,
            variables: self.variables.into_iter().map(Into::into).collect(),
            context_bindings: self.context_bindings.into_iter().map(Into::into).collect(),
            derived_from: self.derived_from,
        })
    }
}

fn reject_secret_variable_values<'a>(
    variables: impl IntoIterator<Item = (&'a String, &'a Option<String>, &'a Vec<String>)>,
) -> FileStoreResult<()> {
    if variables.into_iter().any(|(kind, default, suggestions)| {
        kind == "secret"
            && (default.as_deref().is_some_and(|value| !value.is_empty())
                || !suggestions.is_empty())
    }) {
        return Err(toml_validation_error(AppError::InvalidInput(
            "variables 中的 secret 变量禁止保存 default_value 或 suggestions".to_owned(),
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnippetVariableTomlEntry {
    name: String,
    label: String,
    description: String,
    kind: String,
    required: bool,
    default_value: Option<String>,
    #[serde(default)]
    suggestions: Vec<String>,
    validation: Option<String>,
    render_strategy: String,
    #[serde(default)]
    sensitive: bool,
}

impl From<SnippetVariableTomlEntry> for crate::models::snippet::SnippetCatalogVariable {
    fn from(value: SnippetVariableTomlEntry) -> Self {
        Self {
            name: value.name,
            label: value.label,
            description: value.description,
            kind: value.kind,
            required: value.required,
            default_value: value.default_value,
            suggestions: value.suggestions,
            validation: value.validation,
            render_strategy: value.render_strategy,
            sensitive: value.sensitive,
        }
    }
}

impl From<crate::models::snippet::SnippetCatalogVariable> for SnippetVariableTomlEntry {
    fn from(value: crate::models::snippet::SnippetCatalogVariable) -> Self {
        Self {
            name: value.name,
            label: value.label,
            description: value.description,
            kind: value.kind,
            required: value.required,
            default_value: value.default_value,
            suggestions: value.suggestions,
            validation: value.validation,
            render_strategy: value.render_strategy,
            sensitive: value.sensitive,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnippetContextBindingTomlEntry {
    kind: crate::models::snippet::SnippetContextBindingKind,
    target_id: Option<String>,
}

impl From<SnippetContextBindingTomlEntry> for crate::models::snippet::SnippetContextBinding {
    fn from(value: SnippetContextBindingTomlEntry) -> Self {
        Self {
            kind: value.kind,
            target_id: value.target_id,
        }
    }
}

impl From<crate::models::snippet::SnippetContextBinding> for SnippetContextBindingTomlEntry {
    fn from(value: crate::models::snippet::SnippetContextBinding) -> Self {
        Self {
            kind: value.kind,
            target_id: value.target_id,
        }
    }
}

impl TomlDocument for SnippetTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        decode_toml(source)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct WorkflowTomlDocument {
    schema_version: u32,
    id: String,
    title: String,
    description: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    scope: WorkflowScope,
    #[serde(default)]
    steps: Vec<WorkflowStepTomlEntry>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl WorkflowTomlDocument {
    pub(super) fn from_workflow(workflow: CommandWorkflow) -> Self {
        Self {
            schema_version: CONFIG_FILE_SCHEMA_VERSION,
            id: workflow.id,
            title: workflow.title,
            description: workflow.description,
            tags: workflow.tags,
            scope: workflow.scope,
            steps: workflow.steps.into_iter().map(Into::into).collect(),
            sort_order: workflow.sort_order,
            created_at: workflow.created_at,
            updated_at: workflow.updated_at,
        }
    }

    pub(super) fn into_workflow(self) -> FileStoreResult<CommandWorkflow> {
        validate_schema_version(self.schema_version)?;
        let mut steps = self
            .steps
            .into_iter()
            .map(Into::into)
            .collect::<Vec<CommandWorkflowStep>>();
        sort_workflow_steps(&mut steps);
        Ok(CommandWorkflow {
            id: self.id,
            title: self.title,
            description: self.description,
            tags: self.tags,
            scope: self.scope,
            steps,
            sort_order: self.sort_order,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl TomlDocument for WorkflowTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        decode_toml(source)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkflowStepTomlEntry {
    id: String,
    title: String,
    description: Option<String>,
    command: String,
    scope: Option<WorkflowScope>,
    requires_confirmation: bool,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl From<CommandWorkflowStep> for WorkflowStepTomlEntry {
    fn from(step: CommandWorkflowStep) -> Self {
        Self {
            id: step.id,
            title: step.title,
            description: step.description,
            command: step.command,
            scope: step.scope,
            requires_confirmation: step.requires_confirmation,
            sort_order: step.sort_order,
            created_at: step.created_at,
            updated_at: step.updated_at,
        }
    }
}

impl From<WorkflowStepTomlEntry> for CommandWorkflowStep {
    fn from(step: WorkflowStepTomlEntry) -> Self {
        Self {
            id: step.id,
            title: step.title,
            description: step.description,
            command: step.command,
            scope: step.scope,
            requires_confirmation: step.requires_confirmation,
            sort_order: step.sort_order,
            created_at: step.created_at,
            updated_at: step.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct RemoteHostGroupsTomlDocument {
    schema_version: u32,
    #[serde(default)]
    groups: Vec<RemoteHostGroupTomlEntry>,
}

impl RemoteHostGroupsTomlDocument {
    pub(super) fn from_groups(groups: Vec<RemoteHostGroup>) -> Self {
        Self {
            schema_version: CONFIG_FILE_SCHEMA_VERSION,
            groups: groups.into_iter().map(Into::into).collect(),
        }
    }

    pub(super) fn into_groups(self) -> FileStoreResult<Vec<RemoteHostGroup>> {
        validate_schema_version(self.schema_version)?;
        let mut groups = self
            .groups
            .into_iter()
            .map(Into::into)
            .collect::<Vec<RemoteHostGroup>>();
        groups.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(groups)
    }
}

impl TomlDocument for RemoteHostGroupsTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        decode_toml(source)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteHostGroupTomlEntry {
    id: String,
    name: String,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl From<RemoteHostGroup> for RemoteHostGroupTomlEntry {
    fn from(group: RemoteHostGroup) -> Self {
        Self {
            id: group.id,
            name: group.name,
            sort_order: group.sort_order,
            created_at: group.created_at,
            updated_at: group.updated_at,
        }
    }
}

impl From<RemoteHostGroupTomlEntry> for RemoteHostGroup {
    fn from(group: RemoteHostGroupTomlEntry) -> Self {
        Self {
            id: group.id,
            name: group.name,
            sort_order: group.sort_order,
            created_at: group.created_at,
            updated_at: group.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct RemoteHostTomlDocument {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    protocol: Option<RemoteHostProtocol>,
    id: String,
    group_id: Option<String>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key_passphrase_ref: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    production: bool,
    #[serde(default)]
    ssh_options: SshOptions,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl RemoteHostTomlDocument {
    pub(super) fn from_host(host: RemoteHost) -> Self {
        let mut ssh_options = host.ssh_options;
        for jump_host in &mut ssh_options.jump_hosts {
            jump_host.credential_secret = None;
            jump_host.key_passphrase_secret = None;
        }
        Self {
            schema_version: 2,
            protocol: Some(host.protocol),
            id: host.id,
            group_id: host.group_id,
            name: host.name,
            host: host.host,
            port: host.port,
            username: host.username,
            auth_type: host.auth_type,
            credential_ref: host.credential_ref,
            secret_ref: host.secret_ref,
            key_passphrase_ref: host.key_passphrase_ref,
            tags: host.tags,
            production: host.production,
            ssh_options,
            sort_order: host.sort_order,
            created_at: host.created_at,
            updated_at: host.updated_at,
        }
    }

    pub(super) fn into_host(self) -> FileStoreResult<RemoteHost> {
        let protocol = match self.schema_version {
            CONFIG_FILE_SCHEMA_VERSION => {
                if self.protocol.is_some() {
                    return Err(remote_host_schema_error(
                        "host schema v1 must not declare protocol",
                        "Remove protocol or set schema_version = 2 for an SFTP-only host.",
                    ));
                }
                RemoteHostProtocol::from_legacy_tags(&self.tags)
            }
            2 => match self.protocol {
                Some(protocol) => protocol,
                None => {
                    return Err(remote_host_schema_error(
                        "host schema v2 requires an explicit protocol",
                        "Add protocol = \"ssh\", \"sftp\", \"rdp\", \"telnet\", or \"serial\".",
                    ))
                }
            },
            version => {
                return Err(remote_host_schema_error(
                    &format!("unsupported host schema_version: {version}, expected 1 or 2"),
                    "Use schema_version = 2 with an explicit protocol.",
                ))
            }
        };
        let secret_ref = self.secret_ref;
        let key_passphrase_ref = self.key_passphrase_ref;
        let ssh_options = normalize_jump_host_credential_statuses(self.ssh_options);
        let credential_status =
            credential_status_from_metadata(self.auth_type, secret_ref.as_deref());
        Ok(RemoteHost {
            id: self.id,
            group_id: self.group_id,
            name: self.name,
            host: self.host,
            port: self.port,
            username: self.username,
            protocol,
            auth_type: self.auth_type,
            credential_ref: self.credential_ref,
            secret_ref,
            key_passphrase_ref,
            key_passphrase_secret: None,
            credential_secret: None,
            credential_status,
            tags: self.tags,
            production: self.production,
            ssh_options,
            sort_order: self.sort_order,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn remote_host_schema_error(message: &str, recovery: &str) -> FileStoreError {
    FileStoreError::TomlParse(
        TomlParseError::single(1, 1, message)
            .with_key("schema_version")
            .with_recovery(recovery),
    )
}

impl TomlDocument for RemoteHostTomlDocument {
    fn encode_toml(&self) -> FileStoreResult<String> {
        encode_toml(self)
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        reject_secret_keys_in_host_toml(source)?;
        decode_toml(source)
    }
}
