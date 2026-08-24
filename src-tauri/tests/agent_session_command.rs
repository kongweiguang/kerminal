//! Agent session command boundary tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    commands::agent_session::{
        agent_session_create, agent_session_rebind_target, AgentSessionCreateCommandRequest,
        AgentSessionTargetCommandRequest,
    },
    models::agent_session::{
        AgentId, AgentSessionCreateRequest, AgentTargetBindingStatus, AgentTargetLiveStatus,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tauri::Manager;

#[test]
/// 目标不存在时在写 session 前拒绝请求，防止留下半成品。
fn create_rejects_non_live_agent_target_without_partial_session() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let result = agent_session_create(
        state,
        AgentSessionCreateCommandRequest {
            agent_id: AgentId::Codex,
            launcher_key: None,
            title: Some("Codex".to_owned()),
            launch: None,
            scope: None,
            target: Some(target_request("pane-prod", "missing-terminal")),
            provider: None,
            mcp_endpoint: None,
        },
    );

    assert!(
        format!("{result:?}").contains("终端会话不存在: missing-terminal"),
        "expected missing terminal rejection, got {result:?}"
    );
    assert!(
        app.state::<AppState>()
            .agent_sessions()
            .list_sessions()
            .expect("list sessions")
            .sessions
            .is_empty(),
        "failed create must not leave a partial Agent session on disk"
    );
}

#[test]
/// 未绑定 scope 可在没有 live terminal 时创建，并持久化内置 launcher key。
fn create_accepts_unbound_agent_target_without_live_terminal() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let record = agent_session_create(
        state,
        AgentSessionCreateCommandRequest {
            agent_id: AgentId::Codex,
            launcher_key: Some("builtin:codex".to_owned()),
            title: Some("Codex".to_owned()),
            launch: None,
            scope: None,
            target: Some(unbound_target_request()),
            provider: None,
            mcp_endpoint: None,
        },
    )
    .expect("create unbound agent session");

    assert_eq!(
        record.session.launcher_key.as_deref(),
        Some("builtin:codex")
    );
    let target = record.session.target.expect("session target");
    assert_eq!(target.live_status, AgentTargetLiveStatus::Unbound);
    assert_eq!(target.target_terminal_session_id, None);
    assert_eq!(target.pane_id, None);

    let binding = record.target_binding.expect("target binding").binding;
    assert_eq!(binding.status, AgentTargetBindingStatus::Unbound);
    assert_eq!(binding.target_terminal_session_id, None);
    assert_eq!(binding.pane_id, None);
}

#[test]
/// 标记为 ready 的目标必须带完整运行态身份，避免创建不可恢复绑定。
fn create_rejects_incomplete_bound_agent_target_without_partial_session() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let mut target = unbound_target_request();
    target.live_status = Some(AgentTargetLiveStatus::Ready);
    let result = agent_session_create(
        state,
        AgentSessionCreateCommandRequest {
            agent_id: AgentId::Codex,
            launcher_key: None,
            title: Some("Codex".to_owned()),
            launch: None,
            scope: None,
            target: Some(target),
            provider: None,
            mcp_endpoint: None,
        },
    );

    assert!(
        format!("{result:?}").contains("Agent target requires a live terminal session id"),
        "expected missing terminal id rejection, got {result:?}"
    );
    assert!(
        app.state::<AppState>()
            .agent_sessions()
            .list_sessions()
            .expect("list sessions")
            .sessions
            .is_empty(),
        "failed create must not leave a partial Agent session on disk"
    );
}

#[test]
fn rebind_rejects_missing_target_terminal_and_agent_terminal_panes() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();
    let agent_session = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("Codex".to_owned()),
            launch: None,
            scope: None,
            target: None,
            provider: None,
            mcp_endpoint: None,
        })
        .expect("create agent session");
    let agent_session_id = agent_session.session.agent_session_id.as_str().to_owned();

    let missing = agent_session_rebind_target(
        app.state::<AppState>(),
        agent_session_id.clone(),
        target_request("pane-prod", "missing-terminal"),
    );
    assert!(
        format!("{missing:?}").contains("终端会话不存在: missing-terminal"),
        "expected missing terminal rejection, got {missing:?}"
    );

    let agent_pane = agent_session_rebind_target(
        app.state::<AppState>(),
        agent_session_id,
        target_request("agent-terminal-ags_test", "any-terminal"),
    );
    assert!(
        format!("{agent_pane:?}").contains("right-panel Agent terminal"),
        "expected Agent terminal pane rejection, got {agent_pane:?}"
    );
}

fn unbound_target_request() -> AgentSessionTargetCommandRequest {
    AgentSessionTargetCommandRequest {
        binding_id: None,
        binding_generation: 0,
        pane_id: None,
        tab_id: None,
        target_terminal_session_id: None,
        target_ref: None,
        target_kind: None,
        cwd: None,
        shell: None,
        live_status: Some(AgentTargetLiveStatus::Unbound),
        last_seen_at: None,
    }
}

fn target_request(
    pane_id: &str,
    target_terminal_session_id: &str,
) -> AgentSessionTargetCommandRequest {
    AgentSessionTargetCommandRequest {
        binding_id: None,
        binding_generation: 0,
        pane_id: Some(pane_id.to_owned()),
        tab_id: Some("tab-main".to_owned()),
        target_terminal_session_id: Some(target_terminal_session_id.to_owned()),
        target_ref: Some("ssh:prod-web".to_owned()),
        target_kind: Some("ssh".to_owned()),
        cwd: Some("/srv/app".to_owned()),
        shell: Some("bash".to_owned()),
        live_status: None,
        last_seen_at: None,
    }
}
