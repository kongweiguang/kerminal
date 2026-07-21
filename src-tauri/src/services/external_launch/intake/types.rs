//! External launch intake 的公共状态、策略和事件类型。
//!
//! @author kongweiguang

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::models::settings::{ExternalLaunchSettings, ExternalLaunchToolSetting};

use super::health::ExternalLaunchRuntimeHealthSnapshot;
use super::{EXTERNAL_LAUNCH_CLAIM_LEASE, EXTERNAL_LAUNCH_PENDING_CAPACITY};
use crate::services::external_launch::model::{
    ExternalLaunchEntrypoint, ExternalLaunchSourceTool, ExternalSshTarget,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalLaunchAcceptOutcome {
    Noop(ExternalLaunchNoop),
    Queued(ExternalLaunchQueued),
    Rejected(ExternalLaunchRejected),
}

impl ExternalLaunchAcceptOutcome {
    pub fn event_payload(&self) -> Option<ExternalLaunchEventPayload> {
        match self {
            Self::Noop(_) => None,
            Self::Queued(queued) => Some(ExternalLaunchEventPayload {
                kind: ExternalLaunchEventKind::Queued,
                launch_id: Some(queued.launch_id.clone()),
                source_tool: Some(queued.source_tool),
                entrypoint: queued.entrypoint,
                target: Some(queued.target.clone()),
                pending_count: queued.pending_count,
                message: None,
            }),
            Self::Rejected(rejected) => Some(ExternalLaunchEventPayload {
                kind: ExternalLaunchEventKind::Rejected,
                launch_id: None,
                source_tool: rejected.source_tool,
                entrypoint: rejected.entrypoint,
                target: None,
                pending_count: 0,
                message: Some(rejected.message.clone()),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchNoop {
    pub entrypoint: ExternalLaunchEntrypoint,
    pub reason: String,
    pub arg_count: usize,
    pub cwd_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchQueued {
    pub launch_id: String,
    pub source_tool: ExternalLaunchSourceTool,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub target: ExternalLaunchTargetSummary,
    pub pending_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchRejected {
    pub entrypoint: ExternalLaunchEntrypoint,
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub message: String,
    pub arg_count: usize,
    pub raw_hash: String,
    pub cwd_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchIntakeSnapshot {
    pub pending_count: usize,
    pub pending_launch_ids: Vec<String>,
    pub claimed_count: usize,
    pub claimed_launch_ids: Vec<String>,
    pub accepted_count: u64,
    pub rejected_count: u64,
    pub noop_count: u64,
    pub last_rejection: Option<ExternalLaunchRejected>,
    pub policy: ExternalLaunchPolicy,
    pub health: ExternalLaunchRuntimeHealthSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchPolicy {
    pub enabled: bool,
    pub accept_vendor_args: bool,
    pub auto_open_sftp: bool,
    #[serde(default)]
    pub disabled_tools: Vec<ExternalLaunchSourceTool>,
    #[serde(default = "default_pending_capacity")]
    pub pending_capacity: usize,
    #[serde(default = "default_claim_lease_ms")]
    pub claim_lease_ms: u64,
}

impl Default for ExternalLaunchPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            accept_vendor_args: true,
            auto_open_sftp: false,
            disabled_tools: Vec::new(),
            pending_capacity: EXTERNAL_LAUNCH_PENDING_CAPACITY,
            claim_lease_ms: EXTERNAL_LAUNCH_CLAIM_LEASE.as_millis() as u64,
        }
    }
}

impl From<&ExternalLaunchSettings> for ExternalLaunchPolicy {
    fn from(settings: &ExternalLaunchSettings) -> Self {
        Self {
            enabled: settings.enabled,
            accept_vendor_args: settings.accept_vendor_args,
            auto_open_sftp: settings.auto_open_sftp,
            disabled_tools: settings
                .disabled_tools
                .iter()
                .copied()
                .map(ExternalLaunchSourceTool::from)
                .collect(),
            pending_capacity: EXTERNAL_LAUNCH_PENDING_CAPACITY,
            claim_lease_ms: EXTERNAL_LAUNCH_CLAIM_LEASE.as_millis() as u64,
        }
    }
}

fn default_pending_capacity() -> usize {
    EXTERNAL_LAUNCH_PENDING_CAPACITY
}

fn default_claim_lease_ms() -> u64 {
    EXTERNAL_LAUNCH_CLAIM_LEASE.as_millis() as u64
}

impl From<ExternalLaunchToolSetting> for ExternalLaunchSourceTool {
    fn from(tool: ExternalLaunchToolSetting) -> Self {
        match tool {
            ExternalLaunchToolSetting::Putty => Self::Putty,
            ExternalLaunchToolSetting::Mobaxterm => Self::Mobaxterm,
            ExternalLaunchToolSetting::Xshell => Self::Xshell,
            ExternalLaunchToolSetting::Securecrt => Self::Securecrt,
            ExternalLaunchToolSetting::Openssh => Self::Openssh,
            ExternalLaunchToolSetting::SftpClient => Self::SftpClient,
            ExternalLaunchToolSetting::KerminalNative => Self::KerminalNative,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchEventPayload {
    pub kind: ExternalLaunchEventKind,
    pub launch_id: Option<String>,
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub target: Option<ExternalLaunchTargetSummary>,
    pub pending_count: usize,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLaunchEventKind {
    Queued,
    Rejected,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchTargetSummary {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub display_name: String,
}

impl fmt::Debug for ExternalLaunchTargetSummary {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchTargetSummary")
            .field("host", &"<redacted>")
            .field("port", &self.port)
            .field("username_present", &self.username.is_some())
            .field("display_name_present", &!self.display_name.is_empty())
            .finish()
    }
}

impl ExternalLaunchTargetSummary {
    pub(super) fn from_target(target: &ExternalSshTarget) -> Self {
        Self {
            host: target.host.clone(),
            port: target.port,
            username: target.username.clone(),
            display_name: target.display_name(),
        }
    }
}
