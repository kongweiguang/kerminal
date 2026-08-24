//! External agent workspace request, response, and internal planning types.
//!
//! @author kongweiguang

use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareExternalAgentWorkspaceRequest {
    pub agent_id: String,
    #[serde(default)]
    pub agent_session_id: Option<String>,
    #[serde(default)]
    pub custom_command: Option<String>,
    #[serde(default)]
    pub resume_provider_session: bool,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub overwrite_policy: ExternalAgentOverwritePolicy,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAgentOverwritePolicy {
    #[default]
    BackupAndReplaceInvalid,
    PreserveUserContent,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentLaunchSpec {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    pub title: String,
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
    pub message: String,
    pub dry_run: bool,
    pub operations: Vec<ExternalAgentFileOperation>,
    pub validator: ExternalAgentValidatorStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentWorkspaceStatus {
    pub workspace_dir: String,
    pub mcp_endpoint: String,
    pub mcp_server_running: bool,
    pub agents: ExternalAgentStatuses,
    pub validator: ExternalAgentValidatorStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentStatuses {
    pub codex: ExternalAgentStatus,
    pub claude: ExternalAgentStatus,
    pub pi: ExternalAgentStatus,
    pub custom: ExternalAgentStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentStatus {
    pub id: String,
    pub title: String,
    pub cli_command: String,
    pub installed: bool,
    pub adapter_available: bool,
    pub config_ready: bool,
    pub config_path: String,
    pub status_detail: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentValidatorStatus {
    pub available: bool,
    pub command: String,
    pub detail: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentFileOperation {
    pub path: String,
    pub action: ExternalAgentFileAction,
    pub changed: bool,
    pub dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAgentFileAction {
    Created,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone)]
pub(super) struct WorkspaceWriteOptions {
    pub(super) dry_run: bool,
    pub(super) overwrite_policy: ExternalAgentOverwritePolicy,
}

impl WorkspaceWriteOptions {
    pub(super) fn from_request(request: &PrepareExternalAgentWorkspaceRequest) -> Self {
        Self {
            dry_run: request.dry_run,
            overwrite_policy: request.overwrite_policy.clone(),
        }
    }

    pub(super) fn write_default() -> Self {
        Self {
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        }
    }
}

#[derive(Debug)]
pub(super) struct WorkspaceTextPlan {
    pub(super) path: PathBuf,
    pub(super) next: String,
    pub(super) current: Option<String>,
    pub(super) current_snippet: Option<String>,
    pub(super) next_snippet: String,
    pub(super) reason: String,
}

#[derive(Debug, Clone)]
pub(super) struct AgentSessionWorkspaceContext {
    pub(super) agent_id: String,
    pub(super) agent_session_id: String,
    pub(super) session_root: PathBuf,
    pub(super) mcp_endpoint: String,
}
