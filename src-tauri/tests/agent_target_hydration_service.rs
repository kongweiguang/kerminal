//! Agent target hydration integration tests.
//!
//! @author kongweiguang

use std::{path::Path, sync::Arc};

use kerminal_lib::{
    error::AppResult,
    models::agent_session::{
        AgentId, AgentSessionCreateRequest, AgentSessionId, AgentSessionTarget,
        AgentTargetLiveStatus,
    },
    services::{
        agent_session_file_store::AgentSessionFileStore,
        agent_session_service::{AgentSessionIdGenerator, AgentSessionService},
        agent_target_hydration_service::hydrate_agent_target_binding,
        terminal_session_binding_service::{
            AgentTargetBindingRequest, TerminalSessionBindingService,
        },
    },
};
use tempfile::tempdir;

#[derive(Debug)]
struct FixedIdGenerator {
    ids: std::sync::Mutex<Vec<String>>,
}

impl FixedIdGenerator {
    fn new(ids: &[&str]) -> Self {
        Self {
            ids: std::sync::Mutex::new(ids.iter().rev().map(|id| (*id).to_owned()).collect()),
        }
    }
}

impl AgentSessionIdGenerator for FixedIdGenerator {
    fn generate(&self) -> AppResult<AgentSessionId> {
        let mut ids = self.ids.lock().expect("ids lock");
        AgentSessionId::new(ids.pop().expect("next id"))
    }
}

#[test]
fn hydrate_restores_runtime_binding_from_persisted_session_target() {
    let temp = tempdir().expect("temp dir");
    let agent_sessions = service_with_ids(temp.path(), &["ags_hydrate_live"]);
    let terminal_bindings = TerminalSessionBindingService::default();
    let id = AgentSessionId::new("ags_hydrate_live").expect("id");
    agent_sessions
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: Some("Live target".to_owned()),
                launch: None,
                target: Some(target_with_status(AgentTargetLiveStatus::Ready)),
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");

    let hydrated =
        hydrate_agent_target_binding(&agent_sessions, &terminal_bindings, &id, ["term-live"])
            .expect("hydrate target");

    let target = hydrated.session.target.expect("target");
    assert_eq!(hydrated.session.updated_at, "100");
    assert_eq!(target.live_status, AgentTargetLiveStatus::Ready);
    assert_ne!(target.binding_id.as_deref(), Some("persisted-binding"));
    assert!(target.binding_generation > 0);
    assert_eq!(
        terminal_bindings
            .agent_target_binding(id.as_str())
            .expect("runtime query")
            .expect("runtime binding")
            .target_terminal_session_id,
        "term-live"
    );
    assert_eq!(
        hydrated
            .target_binding
            .expect("target binding context")
            .binding
            .generation,
        target.binding_generation
    );
}

#[test]
fn hydrate_marks_persisted_target_stale_when_terminal_is_not_live() {
    let temp = tempdir().expect("temp dir");
    let agent_sessions = service_with_ids(temp.path(), &["ags_hydrate_stale"]);
    let terminal_bindings = TerminalSessionBindingService::default();
    let id = AgentSessionId::new("ags_hydrate_stale").expect("id");
    agent_sessions
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Claude,
                title: Some("Stale target".to_owned()),
                launch: None,
                target: Some(target_with_status(AgentTargetLiveStatus::Ready)),
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");

    let hydrated = hydrate_agent_target_binding(
        &agent_sessions,
        &terminal_bindings,
        &id,
        std::iter::empty::<&str>(),
    )
    .expect("hydrate stale target");

    let target = hydrated.session.target.expect("target");
    assert_eq!(hydrated.session.updated_at, "100");
    assert_eq!(target.live_status, AgentTargetLiveStatus::Stale);
    assert!(
        hydrated
            .target_binding
            .expect("target binding context")
            .binding
            .stale
    );
    assert!(terminal_bindings
        .resolve_agent_target_for_write(
            id.as_str(),
            target.binding_generation,
            std::iter::empty::<&str>(),
        )
        .expect_err("stale target blocks writes")
        .to_string()
        .contains("stale"));
}

#[test]
fn hydrate_does_not_resurrect_closed_persisted_target() {
    let temp = tempdir().expect("temp dir");
    let agent_sessions = service_with_ids(temp.path(), &["ags_hydrate_closed"]);
    let terminal_bindings = TerminalSessionBindingService::default();
    let id = AgentSessionId::new("ags_hydrate_closed").expect("id");
    agent_sessions
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: Some("Closed target".to_owned()),
                launch: None,
                target: Some(target_with_status(AgentTargetLiveStatus::Closed)),
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");

    let hydrated =
        hydrate_agent_target_binding(&agent_sessions, &terminal_bindings, &id, ["term-live"])
            .expect("hydrate closed target");

    assert_eq!(
        hydrated.session.target.expect("target").live_status,
        AgentTargetLiveStatus::Closed
    );
    assert!(terminal_bindings
        .agent_target_binding(id.as_str())
        .expect("runtime query")
        .is_none());
}

#[test]
fn hydrate_accepts_newer_runtime_rebind_after_persisted_target_closed() {
    let temp = tempdir().expect("temp dir");
    let agent_sessions = service_with_ids(temp.path(), &["ags_hydrate_reconnected"]);
    let terminal_bindings = TerminalSessionBindingService::default();
    let id = AgentSessionId::new("ags_hydrate_reconnected").expect("id");
    agent_sessions
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: Some("Reconnected target".to_owned()),
                launch: None,
                target: Some(target_with_status(AgentTargetLiveStatus::Closed)),
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");
    terminal_bindings
        .save_agent_target_binding(AgentTargetBindingRequest {
            agent_session_id: id.as_str().to_owned(),
            target_terminal_session_id: "term-reconnected".to_owned(),
            pane_id: "pane-live".to_owned(),
            tab_id: Some("tab-a".to_owned()),
            target_ref: Some("ssh:prod-a".to_owned()),
            cwd: Some("/srv/app".to_owned()),
            shell: Some("bash".to_owned()),
        })
        .expect("save newer runtime binding");

    let hydrated = hydrate_agent_target_binding(
        &agent_sessions,
        &terminal_bindings,
        &id,
        ["term-reconnected"],
    )
    .expect("hydrate reconnected target");

    let target = hydrated.session.target.expect("target");
    assert_eq!(target.live_status, AgentTargetLiveStatus::Ready);
    assert_eq!(
        target.target_terminal_session_id.as_deref(),
        Some("term-reconnected")
    );
    assert_ne!(target.binding_id.as_deref(), Some("persisted-binding"));
}

fn service_with_ids(root: &Path, ids: &[&str]) -> AgentSessionService {
    AgentSessionService::with_id_generator(
        AgentSessionFileStore::new(root),
        Arc::new(FixedIdGenerator::new(ids)),
    )
}

fn target_with_status(live_status: AgentTargetLiveStatus) -> AgentSessionTarget {
    AgentSessionTarget {
        binding_id: Some("persisted-binding".to_owned()),
        binding_generation: 7,
        pane_id: Some("pane-live".to_owned()),
        tab_id: Some("tab-a".to_owned()),
        target_terminal_session_id: Some("term-live".to_owned()),
        target_ref: Some("ssh:prod-a".to_owned()),
        target_kind: Some("ssh".to_owned()),
        cwd: Some("/srv/app".to_owned()),
        shell: Some("bash".to_owned()),
        live_status,
        last_seen_at: Some("99".to_owned()),
    }
}
