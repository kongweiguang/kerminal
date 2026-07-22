//! Managed SSH runtime diagnostics snapshots.
//!
//! @author kongweiguang

use std::collections::BTreeMap;

use serde::Serialize;

use super::{ManagedSshSessionState, SshChannelKind, SshSessionKeySummary};

/// Snapshot for all managed SSH sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshRuntimeSnapshot {
    pub active_channels: u64,
    pub active_sessions: usize,
    pub generated_at: String,
    pub recent_legacy_fallbacks: Vec<ManagedSshLegacyFallbackSnapshot>,
    pub sessions: Vec<ManagedSshSessionSnapshot>,
}

/// Recent intentional legacy fallback diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshLegacyFallbackSnapshot {
    pub capability: String,
    pub count: u64,
    pub last_at: String,
    pub reason: String,
    pub target: Option<String>,
}

/// Redacted session diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshSessionSnapshot {
    pub active_channels: u64,
    pub channel_counts: BTreeMap<SshChannelKind, u64>,
    pub created_at: String,
    pub key: SshSessionKeySummary,
    pub last_error: Option<String>,
    pub last_used_at: String,
    pub max_concurrent_exec_channels: usize,
    pub opened_channels: u64,
    pub pending_exec_requests: u64,
    pub ref_count: u64,
    pub session_id: String,
    pub state: ManagedSshSessionState,
}
