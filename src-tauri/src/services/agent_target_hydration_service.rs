//! Agent target binding hydration service.
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    models::agent_session::{
        AgentSessionId, AgentSessionRecord, AgentSessionTarget, AgentSessionUpdateRequest,
        AgentTargetLiveStatus,
    },
    services::{
        agent_session_service::AgentSessionService,
        terminal_session_binding_service::{
            AgentTargetBindingRequest, AgentTargetBindingSnapshot, AgentTargetBindingStatus,
            TerminalSessionBindingService,
        },
    },
};

/// Hydrates the in-memory agent target binding from persisted session files.
///
/// The runtime terminal binding registry is intentionally memory-backed. On app
/// restart, `session.toml` is the source of truth for the last known target, so
/// MCP and UI reads must restore a runtime binding before resolving live/stale
/// status. This function preserves the session ordering timestamp and only
/// writes files when the target view changed.
pub fn hydrate_agent_target_binding<I, S>(
    agent_sessions: &AgentSessionService,
    terminal_session_bindings: &TerminalSessionBindingService,
    agent_session_id: &AgentSessionId,
    live_terminal_session_ids: I,
) -> AppResult<AgentSessionRecord>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let live_terminal_session_ids = normalize_live_terminal_session_ids(live_terminal_session_ids);
    let record = agent_sessions.get_session(agent_session_id)?;
    let Some(target) = record.session.target.clone() else {
        return Ok(record);
    };
    let Some(target_terminal_session_id) =
        normalize_optional_string(target.target_terminal_session_id.clone())
    else {
        return Ok(record);
    };
    let Some(pane_id) = normalize_optional_string(target.pane_id.clone()) else {
        return Ok(record);
    };

    let runtime_binding =
        terminal_session_bindings.agent_target_binding(agent_session_id.as_str())?;
    if runtime_binding.is_none() {
        // 磁盘中的 Closed 在没有更新运行态证据时仍是终态，不能因应用重启被复活。
        if matches!(target.live_status, AgentTargetLiveStatus::Closed) {
            return Ok(record);
        }
        terminal_session_bindings.save_agent_target_binding(AgentTargetBindingRequest {
            agent_session_id: agent_session_id.as_str().to_owned(),
            target_terminal_session_id,
            pane_id,
            tab_id: target.tab_id.clone(),
            target_ref: target.target_ref.clone(),
            cwd: target.cwd.clone(),
            shell: target.shell.clone(),
        })?;
    }

    let resolved = terminal_session_bindings.resolve_agent_target(
        agent_session_id.as_str(),
        live_terminal_session_ids.iter().map(String::as_str),
    )?;
    let hydrated_target = agent_target_from_runtime_binding(&resolved, target.target_kind.clone());

    if target == hydrated_target && record.target_binding.is_some() {
        return Ok(record);
    }

    let update = AgentSessionUpdateRequest {
        target: Some(hydrated_target),
        ..AgentSessionUpdateRequest::default()
    };
    agent_sessions.update_session_at(agent_session_id, update, record.session.updated_at)
}

/// Resolves an agent target after hydrating the runtime binding from files.
pub fn resolve_hydrated_agent_target_binding<I, S>(
    agent_sessions: &AgentSessionService,
    terminal_session_bindings: &TerminalSessionBindingService,
    agent_session_id: &AgentSessionId,
    live_terminal_session_ids: I,
) -> AppResult<(AgentSessionRecord, AgentTargetBindingSnapshot)>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let live_terminal_session_ids = normalize_live_terminal_session_ids(live_terminal_session_ids);
    let record = hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        agent_session_id,
        live_terminal_session_ids.iter().map(String::as_str),
    )?;
    let binding = terminal_session_bindings.resolve_agent_target(
        agent_session_id.as_str(),
        live_terminal_session_ids.iter().map(String::as_str),
    )?;
    Ok((record, binding))
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
            AgentTargetBindingStatus::Live => AgentTargetLiveStatus::Ready,
            AgentTargetBindingStatus::Stale => AgentTargetLiveStatus::Stale,
            AgentTargetBindingStatus::Closed => AgentTargetLiveStatus::Closed,
        },
        last_seen_at: Some(binding.updated_at_ms.to_string()),
    }
}

fn normalize_live_terminal_session_ids<I, S>(live_terminal_session_ids: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    live_terminal_session_ids
        .into_iter()
        .filter_map(|session_id| normalize_optional_string(Some(session_id.as_ref().to_owned())))
        .collect()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
