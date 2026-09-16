//! MCP terminal scope unit tests.
//!
//! @author kongweiguang

use super::*;
use crate::models::terminal::{TerminalSessionStatus, TerminalShellIntegrationSummary};
use crate::services::terminal_session_binding_service::TerminalSessionBindingMetadata;

/// 写入权限的底层 membership 判定必须拒绝其他 Tab，同时允许 global。
#[test]
fn scope_membership_rejects_cross_tab_and_allows_global() {
    let binding = TerminalSessionBindingSnapshot {
        pane_id: "pane-b".to_owned(),
        session_id: "session-b".to_owned(),
        generation: 1,
        metadata: Some(TerminalSessionBindingMetadata {
            tab_id: Some("tab-b".to_owned()),
            target_ref: None,
            target_kind: Some("local".to_owned()),
            remote_host_id: None,
            profile_id: None,
            cwd: None,
            shell: Some("pwsh".to_owned()),
        }),
        status: TerminalSessionBindingStatus::Ready,
        registered_at_ms: 1,
        updated_at_ms: 1,
        ready_at_ms: Some(1),
        disconnected_at_ms: None,
        last_snapshot_status: None,
    };

    assert!(!scope_binding_matches(
        &AgentSessionScope::Tab {
            tab_id: "tab-a".to_owned(),
        },
        &binding,
    ));
    assert!(scope_binding_matches(
        &AgentSessionScope::Tab {
            tab_id: "tab-b".to_owned(),
        },
        &binding,
    ));
    assert!(scope_binding_matches(&AgentSessionScope::Global, &binding));
}

/// global terminal.list 必须携带足够的 pane 元数据，Agent 才能安全区分跨 Tab 目标。
#[test]
fn live_terminal_entry_includes_binding_metadata() {
    let binding = TerminalSessionBindingSnapshot {
        pane_id: "pane-a".to_owned(),
        session_id: "session-a".to_owned(),
        generation: 1,
        metadata: Some(TerminalSessionBindingMetadata {
            tab_id: Some("tab-a".to_owned()),
            target_ref: Some("ssh:host-a".to_owned()),
            target_kind: Some("ssh".to_owned()),
            remote_host_id: Some("host-a".to_owned()),
            profile_id: None,
            cwd: Some("/srv/app".to_owned()),
            shell: Some("bash".to_owned()),
        }),
        status: TerminalSessionBindingStatus::Ready,
        registered_at_ms: 1,
        updated_at_ms: 1,
        ready_at_ms: Some(1),
        disconnected_at_ms: None,
        last_snapshot_status: None,
    };
    let mut object = serde_json::Map::new();

    insert_terminal_binding_metadata(&mut object, &binding);

    assert_eq!(object.get("tabId"), Some(&json!("tab-a")));
    assert_eq!(object.get("targetRef"), Some(&json!("ssh:host-a")));
    assert_eq!(object.get("remoteHostId"), Some(&json!("host-a")));
    assert_eq!(object.get("cwd"), Some(&json!("/srv/app")));
    assert_eq!(object.get("shell"), Some(&json!("bash")));
}

/// global scope 不能依赖 renderer 的 pane telemetry；未注册的用户终端仍须
/// 返回显式 sessionId，同时继续排除带 Agent 身份的右栏 TUI 会话。
#[test]
fn global_scope_lists_unbound_user_session_but_excludes_agent_tui() {
    let sessions = vec![
        TerminalSessionSummary {
            id: "session-unbound".to_owned(),
            shell: "bash".to_owned(),
            cwd: Some("/srv/app".to_owned()),
            cols: 120,
            rows: 40,
            pid: Some(42),
            status: TerminalSessionStatus::Running,
            target_ref: Some("ssh:prod".to_owned()),
            target_token: None,
            shell_integration: TerminalShellIntegrationSummary::disabled("test"),
            agent_session_id: None,
            agent_signal: None,
        },
        TerminalSessionSummary {
            id: "session-agent".to_owned(),
            shell: "codex".to_owned(),
            cwd: None,
            cols: 120,
            rows: 40,
            pid: Some(43),
            status: TerminalSessionStatus::Running,
            target_ref: None,
            target_token: None,
            shell_integration: TerminalShellIntegrationSummary::disabled("test"),
            agent_session_id: Some("ags_right_panel".to_owned()),
            agent_signal: None,
        },
        TerminalSessionSummary {
            id: "session-exited".to_owned(),
            shell: "bash".to_owned(),
            cwd: None,
            cols: 120,
            rows: 40,
            pid: None,
            status: TerminalSessionStatus::Exited,
            target_ref: None,
            target_token: None,
            shell_integration: TerminalShellIntegrationSummary::disabled("test"),
            agent_session_id: None,
            agent_signal: None,
        },
    ];
    let bindings = TerminalSessionBindingService::default();
    bindings
        .register_at("agent-terminal-ags_right_panel", "session-agent", 1)
        .expect("register hidden Agent TUI binding");

    let entries = scoped_terminal_entries(&AgentSessionScope::Global, &sessions, &bindings)
        .expect("list global scope entries");

    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].get("id").and_then(Value::as_str),
        Some("session-unbound")
    );
    assert_eq!(
        entries[0].get("sessionId").and_then(Value::as_str),
        Some("session-unbound")
    );
    assert_eq!(
        entries[0].get("connectionState").and_then(Value::as_str),
        Some("connected")
    );
}
