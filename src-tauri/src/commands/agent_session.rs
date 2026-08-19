//! Agent session Tauri Commands。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentId, AgentProviderSession, AgentSessionCreateRequest, AgentSessionId,
        AgentSessionLaunchRequest, AgentSessionList, AgentSessionRecord, AgentSessionScope,
        AgentSessionTarget, AgentSessionUpdateRequest, AgentTargetLiveStatus,
        AgentTerminalSnapshotContext, AGENT_SESSION_SCHEMA_VERSION,
    },
    security::redaction::redact_terminal_text,
    services::{
        agent_target_hydration_service::hydrate_agent_target_binding,
        terminal_session_binding_service::{
            AgentTargetBindingRequest, AgentTargetBindingSnapshot,
            AgentTargetBindingStatus as RuntimeAgentTargetBindingStatus,
        },
    },
    state::AppState,
};

const AGENT_SESSION_TERMINAL_SNAPSHOT_BYTES: usize = 24 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionCreateCommandRequest {
    pub agent_id: AgentId,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub launch: Option<AgentSessionLaunchRequest>,
    /// 新会话 scope；缺失时由旧 target/tabId 兼容迁移。
    #[serde(default)]
    pub scope: Option<AgentSessionScope>,
    #[serde(default)]
    pub target: Option<AgentSessionTargetCommandRequest>,
    #[serde(default)]
    pub provider: Option<AgentProviderSession>,
    #[serde(default)]
    pub mcp_endpoint: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionTargetCommandRequest {
    #[serde(default)]
    pub binding_id: Option<String>,
    #[serde(default)]
    pub binding_generation: u64,
    #[serde(default)]
    pub pane_id: Option<String>,
    #[serde(default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub target_terminal_session_id: Option<String>,
    #[serde(default)]
    pub target_ref: Option<String>,
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub live_status: Option<AgentTargetLiveStatus>,
    #[serde(default)]
    pub last_seen_at: Option<String>,
}

#[tauri::command]
pub fn agent_session_create(
    state: State<'_, AppState>,
    request: AgentSessionCreateCommandRequest,
) -> Result<AgentSessionRecord, String> {
    create_agent_session(&state, request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_session_list(state: State<'_, AppState>) -> Result<AgentSessionList, String> {
    list_agent_sessions(&state).map_err(|error| error.to_string())
}

fn list_agent_sessions(state: &AppState) -> AppResult<AgentSessionList> {
    let listed = state.agent_sessions().list_sessions()?;
    let live_ids = live_terminal_session_ids(state)?;
    let sessions = listed
        .sessions
        .into_iter()
        .map(|record| {
            hydrate_agent_target_binding(
                state.agent_sessions(),
                state.terminal_session_bindings(),
                &record.session.agent_session_id,
                live_ids.iter().map(String::as_str),
            )
            .unwrap_or(record)
        })
        .collect();
    Ok(AgentSessionList {
        sessions,
        diagnostics: listed.diagnostics,
    })
}

fn get_agent_session(
    state: &AppState,
    agent_session_id: &AgentSessionId,
) -> AppResult<AgentSessionRecord> {
    let live_ids = live_terminal_session_ids(state)?;
    hydrate_agent_target_binding(
        state.agent_sessions(),
        state.terminal_session_bindings(),
        agent_session_id,
        live_ids.iter().map(String::as_str),
    )
}

fn live_terminal_session_ids(state: &AppState) -> AppResult<Vec<String>> {
    Ok(state
        .terminals()
        .list_sessions()?
        .into_iter()
        .map(|session| session.id)
        .collect())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_session_get(
    state: State<'_, AppState>,
    agent_session_id: String,
) -> Result<AgentSessionRecord, String> {
    let agent_session_id =
        AgentSessionId::new(agent_session_id).map_err(|error| error.to_string())?;
    get_agent_session(&state, &agent_session_id).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_session_update(
    state: State<'_, AppState>,
    agent_session_id: String,
    request: AgentSessionUpdateRequest,
) -> Result<AgentSessionRecord, String> {
    let agent_session_id =
        AgentSessionId::new(agent_session_id).map_err(|error| error.to_string())?;
    state
        .agent_sessions()
        .update_session(&agent_session_id, request)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_session_rebind_target(
    state: State<'_, AppState>,
    agent_session_id: String,
    target: AgentSessionTargetCommandRequest,
) -> Result<AgentSessionRecord, String> {
    rebind_agent_session_target(&state, agent_session_id, target).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_session_archive(
    state: State<'_, AppState>,
    agent_session_id: String,
) -> Result<AgentSessionRecord, String> {
    let agent_session_id =
        AgentSessionId::new(agent_session_id).map_err(|error| error.to_string())?;
    state
        .agent_sessions()
        .archive_session(&agent_session_id)
        .map_err(|error| error.to_string())
}

fn create_agent_session(
    state: &AppState,
    request: AgentSessionCreateCommandRequest,
) -> AppResult<AgentSessionRecord> {
    let create_request = AgentSessionCreateRequest {
        agent_id: request.agent_id,
        title: request.title,
        launch: request.launch,
        scope: request.scope,
        target: request.target.clone().map(AgentSessionTarget::from),
        provider: request.provider,
        mcp_endpoint: request.mcp_endpoint,
    };
    if let Some(target) = create_request
        .target
        .as_ref()
        .filter(|target| !is_unbound_agent_session_target(target))
    {
        validate_agent_session_target(state, target)?;
    }

    let record = state.agent_sessions().create_session(create_request)?;

    if record
        .session
        .target
        .as_ref()
        .and_then(|target| target.target_terminal_session_id.as_deref())
        .is_some()
    {
        let agent_session_id = record.session.agent_session_id.as_str().to_owned();
        if let Some(target) = record.session.target.as_ref() {
            let runtime_binding =
                save_runtime_agent_target_binding(state, &agent_session_id, target)?;
            let update = AgentSessionUpdateRequest {
                target: Some(agent_target_from_runtime_binding(
                    &runtime_binding,
                    target.target_kind.clone(),
                )),
                ..AgentSessionUpdateRequest::default()
            };
            let updated = state
                .agent_sessions()
                .update_session(&record.session.agent_session_id, update);
            if let Ok(record) = updated.as_ref() {
                persist_terminal_snapshot_for_target(
                    state,
                    &record.session.agent_session_id,
                    record.session.target.as_ref(),
                )?;
            }
            return updated;
        }
    }

    Ok(record)
}

fn rebind_agent_session_target(
    state: &AppState,
    agent_session_id: String,
    target: AgentSessionTargetCommandRequest,
) -> AppResult<AgentSessionRecord> {
    let agent_session_id = AgentSessionId::new(agent_session_id)?;
    state.agent_sessions().get_session(&agent_session_id)?;

    let target = AgentSessionTarget::from(target);
    let runtime_binding =
        save_runtime_agent_target_binding(state, agent_session_id.as_str(), &target)?;
    let update = AgentSessionUpdateRequest {
        target: Some(agent_target_from_runtime_binding(
            &runtime_binding,
            target.target_kind,
        )),
        ..AgentSessionUpdateRequest::default()
    };
    let record = state
        .agent_sessions()
        .update_session(&agent_session_id, update)?;
    persist_terminal_snapshot_for_target(
        state,
        &record.session.agent_session_id,
        record.session.target.as_ref(),
    )?;
    Ok(record)
}

fn save_runtime_agent_target_binding(
    state: &AppState,
    agent_session_id: &str,
    target: &AgentSessionTarget,
) -> AppResult<AgentTargetBindingSnapshot> {
    let (target_terminal_session_id, pane_id) = validate_agent_session_target(state, target)?;
    state
        .terminal_session_bindings()
        .save_agent_target_binding(AgentTargetBindingRequest {
            agent_session_id: agent_session_id.to_owned(),
            target_terminal_session_id,
            pane_id,
            tab_id: target.tab_id.clone(),
            target_ref: target.target_ref.clone(),
            cwd: target.cwd.clone(),
            shell: target.shell.clone(),
        })
}

fn is_unbound_agent_session_target(target: &AgentSessionTarget) -> bool {
    target.live_status == AgentTargetLiveStatus::Unbound
        && is_empty_target_field(target.binding_id.as_deref())
        && target.binding_generation == 0
        && is_empty_target_field(target.pane_id.as_deref())
        && is_empty_target_field(target.tab_id.as_deref())
        && is_empty_target_field(target.target_terminal_session_id.as_deref())
        && is_empty_target_field(target.target_ref.as_deref())
        && is_empty_target_field(target.target_kind.as_deref())
        && is_empty_target_field(target.cwd.as_deref())
        && is_empty_target_field(target.shell.as_deref())
        && is_empty_target_field(target.last_seen_at.as_deref())
}

fn is_empty_target_field(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
}

fn validate_agent_session_target(
    state: &AppState,
    target: &AgentSessionTarget,
) -> AppResult<(String, String)> {
    let target_terminal_session_id = target
        .target_terminal_session_id
        .as_deref()
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput("Agent target requires a live terminal session id".to_owned())
        })?;
    let pane_id = target
        .pane_id
        .as_deref()
        .map(str::trim)
        .filter(|pane_id| !pane_id.is_empty())
        .ok_or_else(|| AppError::InvalidInput("Agent target requires a pane id".to_owned()))?;
    if pane_id.starts_with("agent-terminal-") {
        return Err(AppError::InvalidInput(
            "Agent target cannot be another right-panel Agent terminal".to_owned(),
        ));
    }
    state
        .terminals()
        .session_summary(target_terminal_session_id)?;
    Ok((target_terminal_session_id.to_owned(), pane_id.to_owned()))
}

fn agent_target_from_runtime_binding(
    binding: &AgentTargetBindingSnapshot,
    target_kind: Option<String>,
) -> AgentSessionTarget {
    AgentSessionTarget {
        binding_id: Some(binding.binding_id.clone()),
        binding_generation: binding.generation,
        pane_id: Some(binding.pane_id.clone()),
        tab_id: binding.tab_id.clone(),
        target_terminal_session_id: Some(binding.target_terminal_session_id.clone()),
        target_ref: binding.target_ref.clone(),
        target_kind,
        cwd: binding.cwd.clone(),
        shell: binding.shell.clone(),
        live_status: match binding.status {
            RuntimeAgentTargetBindingStatus::Live => AgentTargetLiveStatus::Ready,
            RuntimeAgentTargetBindingStatus::Stale => AgentTargetLiveStatus::Stale,
            RuntimeAgentTargetBindingStatus::Closed => AgentTargetLiveStatus::Closed,
        },
        last_seen_at: Some(binding.updated_at_ms.to_string()),
    }
}

fn persist_terminal_snapshot_for_target(
    state: &AppState,
    agent_session_id: &AgentSessionId,
    target: Option<&AgentSessionTarget>,
) -> AppResult<()> {
    let Some(target_terminal_session_id) =
        target.and_then(|target| target.target_terminal_session_id.as_deref())
    else {
        return Ok(());
    };
    let (_summary, snapshot) = state.terminals().output_snapshot(
        target_terminal_session_id,
        AGENT_SESSION_TERMINAL_SNAPSHOT_BYTES,
    )?;
    let (output, redacted) = redact_terminal_text(&snapshot.data);
    state
        .agent_sessions()
        .write_terminal_snapshot_context(&AgentTerminalSnapshotContext {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: agent_session_id.clone(),
            target_terminal_session_id: Some(target_terminal_session_id.to_owned()),
            captured_bytes: output.len(),
            max_bytes: snapshot.max_bytes,
            truncated: snapshot.truncated,
            redacted,
            output,
            generated_at: current_unix_timestamp(),
        })
}

fn current_unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

impl From<AgentSessionTargetCommandRequest> for AgentSessionTarget {
    fn from(request: AgentSessionTargetCommandRequest) -> Self {
        Self {
            binding_id: request.binding_id,
            binding_generation: request.binding_generation,
            pane_id: request.pane_id,
            tab_id: request.tab_id,
            target_terminal_session_id: request.target_terminal_session_id,
            target_ref: request.target_ref,
            target_kind: request.target_kind,
            cwd: request.cwd,
            shell: request.shell,
            live_status: request
                .live_status
                .unwrap_or(AgentTargetLiveStatus::Unbound),
            last_seen_at: request.last_seen_at,
        }
    }
}
