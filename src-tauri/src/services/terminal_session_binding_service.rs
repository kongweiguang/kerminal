//! Terminal pane/session binding registry and tracer.
//!
//! This service is intentionally standalone for ADR-0014 P2: it records the
//! backend truth without changing AI chat routing or exposing new commands.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};
use crate::models::agent_session::AgentSessionScope;
use std::{sync::Mutex, time::Duration};

mod agent_target_migration;
mod state;
mod types;

use agent_target_migration::migrate_agent_targets_to_replacement_binding;
use state::*;

pub use types::{
    AgentTargetBindingRequest, AgentTargetBindingSnapshot, AgentTargetBindingStatus,
    TerminalSessionBindingCapabilityUse, TerminalSessionBindingEvent,
    TerminalSessionBindingEventKind, TerminalSessionBindingMetadata,
    TerminalSessionBindingSnapshot, TerminalSessionBindingStatus, TerminalSessionSnapshotStatus,
};

const DEFAULT_EVENT_LIMIT: usize = 256;
const DEFAULT_STALE_AFTER: Duration = Duration::from_secs(5 * 60);

#[derive(Debug)]
pub struct TerminalSessionBindingService {
    inner: Mutex<TerminalSessionBindingState>,
    event_limit: usize,
    stale_after: Duration,
}

impl Default for TerminalSessionBindingService {
    fn default() -> Self {
        Self::new(DEFAULT_EVENT_LIMIT, DEFAULT_STALE_AFTER)
    }
}

impl TerminalSessionBindingService {
    pub fn new(event_limit: usize, stale_after: Duration) -> Self {
        Self {
            inner: Mutex::new(TerminalSessionBindingState::default()),
            event_limit: event_limit.max(1),
            stale_after,
        }
    }

    pub fn register(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_with_metadata(pane_id, session_id, None)
    }

    pub fn register_with_metadata(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(pane_id, session_id, metadata, None, now_ms())
    }

    pub fn register_with_metadata_and_capability(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        capability: Option<TerminalSessionBindingCapabilityUse>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(
            pane_id,
            session_id,
            metadata,
            capability,
            now_ms(),
        )
    }

    pub fn register_at(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata(pane_id, session_id, None, occurred_at_ms)
    }

    pub fn register_at_with_metadata(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(
            pane_id,
            session_id,
            metadata,
            None,
            occurred_at_ms,
        )
    }

    pub fn register_at_with_metadata_and_capability(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        capability: Option<TerminalSessionBindingCapabilityUse>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        let pane_id = pane_id.into();
        let session_id = session_id.into();
        let metadata = metadata.and_then(TerminalSessionBindingMetadata::normalized);
        let capability = capability.and_then(TerminalSessionBindingCapabilityUse::normalized);
        let mut state = self.lock_state()?;

        if let Some(capability) = &capability {
            state.verify_target_capability(
                self.event_limit,
                &pane_id,
                &session_id,
                capability,
                occurred_at_ms,
            )?;
        }

        if let Some(previous_session_id) = state.by_pane.get(&pane_id).cloned() {
            if previous_session_id != session_id {
                state.by_session.remove(&previous_session_id);
                state
                    .bindings
                    .remove(&binding_key(&pane_id, &previous_session_id));
                state.push_event(
                    self.event_limit,
                    occurred_at_ms,
                    TerminalSessionBindingEventKind::Mismatch,
                    Some(pane_id.clone()),
                    Some(previous_session_id),
                    Some(format!("pane rebound to session {session_id}")),
                );
            }
        }

        if let Some(previous_pane_id) = state.by_session.get(&session_id).cloned() {
            if previous_pane_id != pane_id {
                state.by_pane.remove(&previous_pane_id);
                state
                    .bindings
                    .remove(&binding_key(&previous_pane_id, &session_id));
                state.push_event(
                    self.event_limit,
                    occurred_at_ms,
                    TerminalSessionBindingEventKind::Mismatch,
                    Some(previous_pane_id),
                    Some(session_id.clone()),
                    Some(format!("session rebound to pane {pane_id}")),
                );
            }
        }

        let generation = state.next_generation();
        let binding = TerminalSessionBindingSnapshot {
            pane_id: pane_id.clone(),
            session_id: session_id.clone(),
            generation,
            metadata,
            status: TerminalSessionBindingStatus::Registered,
            registered_at_ms: occurred_at_ms,
            updated_at_ms: occurred_at_ms,
            ready_at_ms: None,
            disconnected_at_ms: None,
            last_snapshot_status: None,
        };
        state.by_pane.insert(pane_id.clone(), session_id.clone());
        state.by_session.insert(session_id.clone(), pane_id.clone());
        state
            .bindings
            .insert(binding_key(&pane_id, &session_id), binding.clone());
        migrate_agent_targets_to_replacement_binding(&mut state, &binding, occurred_at_ms);
        if let Some(capability) = capability {
            state.target_capability_claims.insert(
                capability.jti,
                TerminalTargetCapabilityClaim {
                    pane_id: pane_id.clone(),
                    session_id: session_id.clone(),
                    generation,
                    expires_at_ms: capability.expires_at_ms,
                },
            );
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Registered,
            Some(pane_id),
            Some(session_id),
            None,
        );
        Ok(binding)
    }

    pub fn ready(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.ready_at(pane_id, session_id, now_ms())
    }

    pub fn ready_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Ready,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Ready;
                binding.ready_at_ms = Some(occurred_at_ms);
                binding.disconnected_at_ms = None;
            },
        )
    }

    pub fn disconnected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.disconnected_at(pane_id, session_id, now_ms())
    }

    pub fn disconnected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Disconnected,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Disconnected;
                binding.disconnected_at_ms = Some(occurred_at_ms);
            },
        )
    }

    pub fn reconnected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.reconnected_at(pane_id, session_id, now_ms())
    }

    pub fn reconnected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Reconnected,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Ready;
                binding.ready_at_ms = Some(occurred_at_ms);
                binding.disconnected_at_ms = None;
            },
        )
    }

    pub fn closed(&self, pane_id: &str, session_id: &str) -> AppResult<bool> {
        self.closed_at(pane_id, session_id, now_ms())
    }

    pub fn closed_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<bool> {
        let mut state = self.lock_state()?;
        let removed = state
            .bindings
            .remove(&binding_key(pane_id, session_id))
            .is_some();
        if removed {
            state.by_pane.remove(pane_id);
            state.by_session.remove(session_id);
            let closing_agent_session_ids = state
                .agent_targets
                .iter()
                .filter(|(_, binding)| {
                    binding.pane_id == pane_id
                        && binding.target_terminal_session_id == session_id
                        && binding.status != AgentTargetBindingStatus::Closed
                })
                .map(|(agent_session_id, _)| agent_session_id.clone())
                .collect::<Vec<_>>();
            for agent_session_id in closing_agent_session_ids {
                let generation = state.next_generation();
                if let Some(binding) = state.agent_targets.get_mut(&agent_session_id) {
                    binding.generation = generation;
                    binding.status = AgentTargetBindingStatus::Closed;
                    binding.live = false;
                    binding.stale = false;
                    binding.updated_at_ms = occurred_at_ms;
                }
            }
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Closed,
            Some(pane_id.to_owned()),
            Some(session_id.to_owned()),
            None,
        );
        Ok(removed)
    }

    pub fn record_mismatch_at(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
        occurred_at_ms: u64,
    ) -> AppResult<()> {
        let mut state = self.lock_state()?;
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Mismatch,
            pane_id.map(str::to_owned),
            session_id.map(str::to_owned),
            Some(message.into()),
        );
        Ok(())
    }

    pub fn record_mismatch(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_mismatch_at(pane_id, session_id, message, now_ms())
    }

    pub fn record_snapshot_resolved(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_resolved_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_resolved_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Resolved,
        )
    }

    pub fn record_snapshot_rejected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_rejected_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_rejected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Rejected,
        )
    }

    pub fn record_snapshot_degraded(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_degraded_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_degraded_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Degraded,
        )
    }

    pub fn record_snapshot_rejected_event(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_snapshot_event(
            TerminalSessionBindingEventKind::SnapshotRejected,
            pane_id,
            session_id,
            Some(message.into()),
            now_ms(),
        )
    }

    pub fn record_snapshot_degraded_event(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_snapshot_event(
            TerminalSessionBindingEventKind::SnapshotDegraded,
            pane_id,
            session_id,
            Some(message.into()),
            now_ms(),
        )
    }

    pub fn active_binding_for_pane(
        &self,
        pane_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_pane
            .get(pane_id)
            .and_then(|session_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .filter(|binding| is_active(&binding.status))
            .cloned())
    }

    pub fn active_binding_for_session(
        &self,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_session
            .get(session_id)
            .and_then(|pane_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .filter(|binding| is_active(&binding.status))
            .cloned())
    }

    /// 返回当前 pane/session registry 中属于 Agent scope 的用户终端绑定。
    ///
    /// 这里故意不只返回 Ready 绑定：Disconnected 仍是 scope 成员，前端
    /// 可以基于 pane id 重新连接；只有 Closed/被替换的绑定才不再参与解析。
    pub fn bindings_for_scope(
        &self,
        scope: &AgentSessionScope,
    ) -> AppResult<Vec<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        let mut bindings = state
            .bindings
            .values()
            .filter(|binding| !is_agent_terminal_pane(&binding.pane_id))
            .filter(|binding| match scope {
                AgentSessionScope::Global => true,
                AgentSessionScope::Tab { tab_id } => binding
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.tab_id.as_deref())
                    .is_some_and(|candidate| candidate == tab_id),
            })
            .cloned()
            .collect::<Vec<_>>();
        bindings.sort_by(|left, right| {
            left.pane_id
                .cmp(&right.pane_id)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        Ok(bindings)
    }

    /// 返回指定 session 当前 pane binding，包括暂时断开的成员。
    pub fn binding_for_session(
        &self,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_session
            .get(session_id)
            .and_then(|pane_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .cloned())
    }

    /// 返回指定 pane 当前 binding，包括断开但尚未关闭的连接成员。
    pub fn binding_for_pane(
        &self,
        pane_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_pane
            .get(pane_id)
            .and_then(|session_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .cloned())
    }

    pub fn stale_sessions_at(
        &self,
        occurred_at_ms: u64,
    ) -> AppResult<Vec<TerminalSessionBindingSnapshot>> {
        let stale_after_ms = self.stale_after.as_millis() as u64;
        let state = self.lock_state()?;
        Ok(state
            .bindings
            .values()
            .filter(|binding| {
                binding.status == TerminalSessionBindingStatus::Disconnected
                    && binding.disconnected_at_ms.is_some_and(|disconnected_at| {
                        occurred_at_ms.saturating_sub(disconnected_at) >= stale_after_ms
                    })
            })
            .cloned()
            .collect())
    }

    pub fn stale_sessions(&self) -> AppResult<Vec<TerminalSessionBindingSnapshot>> {
        self.stale_sessions_at(now_ms())
    }

    pub fn save_agent_target_binding(
        &self,
        request: AgentTargetBindingRequest,
    ) -> AppResult<AgentTargetBindingSnapshot> {
        self.save_agent_target_binding_at(request, now_ms())
    }

    pub fn save_agent_target_binding_at(
        &self,
        request: AgentTargetBindingRequest,
        occurred_at_ms: u64,
    ) -> AppResult<AgentTargetBindingSnapshot> {
        let request = request.normalized()?;
        let mut state = self.lock_state()?;
        let generation = state.next_generation();
        let binding = AgentTargetBindingSnapshot {
            binding_id: format!("atb_{generation}"),
            generation,
            status: AgentTargetBindingStatus::Live,
            live: true,
            stale: false,
            updated_at_ms: occurred_at_ms,
            agent_session_id: request.agent_session_id.clone(),
            target_terminal_session_id: request.target_terminal_session_id,
            pane_id: request.pane_id,
            tab_id: request.tab_id,
            target_ref: request.target_ref,
            cwd: request.cwd,
            shell: request.shell,
        };
        state
            .agent_targets
            .insert(request.agent_session_id, binding.clone());
        Ok(binding)
    }

    pub fn bind_agent_target_to_terminal_binding(
        &self,
        agent_session_id: impl Into<String>,
        binding: &TerminalSessionBindingSnapshot,
    ) -> AppResult<AgentTargetBindingSnapshot> {
        self.bind_agent_target_to_terminal_binding_at(agent_session_id, binding, now_ms())
    }

    pub fn bind_agent_target_to_terminal_binding_at(
        &self,
        agent_session_id: impl Into<String>,
        binding: &TerminalSessionBindingSnapshot,
        occurred_at_ms: u64,
    ) -> AppResult<AgentTargetBindingSnapshot> {
        if !is_active(&binding.status) {
            return Err(AppError::InvalidInput(format!(
                "agent target binding cannot use inactive terminal binding {}:{} status {:?}",
                binding.pane_id, binding.session_id, binding.status
            )));
        }
        let metadata = binding.metadata.clone();
        self.save_agent_target_binding_at(
            AgentTargetBindingRequest {
                agent_session_id: agent_session_id.into(),
                target_terminal_session_id: binding.session_id.clone(),
                pane_id: binding.pane_id.clone(),
                tab_id: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.tab_id.clone()),
                target_ref: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.target_ref.clone()),
                cwd: metadata.as_ref().and_then(|metadata| metadata.cwd.clone()),
                shell: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.shell.clone()),
            },
            occurred_at_ms,
        )
    }

    pub fn agent_target_binding(
        &self,
        agent_session_id: &str,
    ) -> AppResult<Option<AgentTargetBindingSnapshot>> {
        Ok(self
            .lock_state()?
            .agent_targets
            .get(agent_session_id)
            .cloned())
    }

    pub fn resolve_agent_target<I, S>(
        &self,
        agent_session_id: &str,
        live_terminal_session_ids: I,
    ) -> AppResult<AgentTargetBindingSnapshot>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let binding = self
            .agent_target_binding(agent_session_id)?
            .ok_or_else(|| agent_target_not_found(agent_session_id))?;
        Ok(resolve_agent_target_snapshot(
            binding,
            live_terminal_session_ids,
        ))
    }

    pub fn resolve_agent_target_for_write<I, S>(
        &self,
        agent_session_id: &str,
        expected_generation: u64,
        live_terminal_session_ids: I,
    ) -> AppResult<AgentTargetBindingSnapshot>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let binding = self
            .agent_target_binding(agent_session_id)?
            .ok_or_else(|| agent_target_not_found(agent_session_id))?;
        if binding.generation != expected_generation {
            return Err(AppError::InvalidInput(format!(
                "agent target binding generation mismatch for {agent_session_id}: expected {expected_generation}, current {}",
                binding.generation
            )));
        }

        let resolved = resolve_agent_target_snapshot(binding, live_terminal_session_ids);
        match resolved.status {
            AgentTargetBindingStatus::Live if resolved.live => Ok(resolved),
            AgentTargetBindingStatus::Closed => Err(AppError::InvalidInput(format!(
                "agent target binding closed for {agent_session_id}: binding {} target terminal {}",
                resolved.binding_id, resolved.target_terminal_session_id
            ))),
            AgentTargetBindingStatus::Stale | AgentTargetBindingStatus::Live => {
                Err(AppError::InvalidInput(format!(
                    "agent target binding stale for {agent_session_id}: target terminal {} is not live",
                    resolved.target_terminal_session_id
                )))
            }
        }
    }

    pub fn events(&self) -> AppResult<Vec<TerminalSessionBindingEvent>> {
        Ok(self.lock_state()?.events.iter().cloned().collect())
    }

    fn record_snapshot_event(
        &self,
        kind: TerminalSessionBindingEventKind,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: Option<String>,
        occurred_at_ms: u64,
    ) -> AppResult<()> {
        let mut state = self.lock_state()?;
        if let (Some(pane_id), Some(session_id), Some(snapshot_status)) =
            (pane_id, session_id, snapshot_status_for_event(kind))
        {
            let key = binding_key(pane_id, session_id);
            if state.bindings.contains_key(&key) {
                let generation = state.next_generation();
                if let Some(binding) = state.bindings.get_mut(&key) {
                    binding.generation = generation;
                    binding.updated_at_ms = occurred_at_ms;
                    binding.last_snapshot_status = Some(snapshot_status);
                }
            }
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            kind,
            pane_id.map(str::to_owned),
            session_id.map(str::to_owned),
            message,
        );
        Ok(())
    }

    fn record_snapshot_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
        snapshot_status: TerminalSessionSnapshotStatus,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let kind = match snapshot_status {
            TerminalSessionSnapshotStatus::Resolved => {
                TerminalSessionBindingEventKind::SnapshotResolved
            }
            TerminalSessionSnapshotStatus::Rejected => {
                TerminalSessionBindingEventKind::SnapshotRejected
            }
            TerminalSessionSnapshotStatus::Degraded => {
                TerminalSessionBindingEventKind::SnapshotDegraded
            }
        };
        self.update_binding(pane_id, session_id, occurred_at_ms, kind, |binding| {
            binding.last_snapshot_status = Some(snapshot_status);
        })
    }

    fn update_binding(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
        kind: TerminalSessionBindingEventKind,
        update: impl FnOnce(&mut TerminalSessionBindingSnapshot),
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let mut state = self.lock_state()?;
        let key = binding_key(pane_id, session_id);
        if !state.bindings.contains_key(&key) {
            state.push_event(
                self.event_limit,
                occurred_at_ms,
                TerminalSessionBindingEventKind::Mismatch,
                Some(pane_id.to_owned()),
                Some(session_id.to_owned()),
                Some("binding not registered".to_owned()),
            );
            return Ok(None);
        };
        let generation = state.next_generation();
        let binding = state
            .bindings
            .get_mut(&key)
            .expect("binding exists after contains_key");
        update(binding);
        binding.generation = generation;
        binding.updated_at_ms = occurred_at_ms;
        let snapshot = binding.clone();
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            kind,
            Some(pane_id.to_owned()),
            Some(session_id.to_owned()),
            None,
        );
        Ok(Some(snapshot))
    }

    fn lock_state(&self) -> AppResult<std::sync::MutexGuard<'_, TerminalSessionBindingState>> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_session_binding_registry"))
    }
}

/// 右栏 Agent 自身的 PTY 不是用户终端，必须从 global/tab scope 中排除。
fn is_agent_terminal_pane(pane_id: &str) -> bool {
    pane_id.starts_with("agent-terminal-")
}
