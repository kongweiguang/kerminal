//! Terminal session 与 Agent target binding 生命周期回归测试。
//!
//! @author kongweiguang

use kerminal_lib::models::agent_session::AgentSessionScope;
use kerminal_lib::services::terminal_session_binding_service::{
    AgentTargetBindingRequest, AgentTargetBindingStatus, TerminalSessionBindingCapabilityUse,
    TerminalSessionBindingEventKind, TerminalSessionBindingMetadata, TerminalSessionBindingService,
    TerminalSessionBindingStatus, TerminalSessionSnapshotStatus,
};
use std::time::Duration;

#[test]
fn lifecycle_events_drive_active_and_stale_queries() {
    let service = TerminalSessionBindingService::new(16, Duration::from_millis(100));

    let registered = service
        .register_at("pane-a", "session-a", 10)
        .expect("register binding");
    assert_eq!(registered.status, TerminalSessionBindingStatus::Registered);
    assert_eq!(registered.generation, 1);
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .map(|binding| binding.session_id),
        Some("session-a".to_owned())
    );

    let ready = service
        .ready_at("pane-a", "session-a", 20)
        .expect("ready binding")
        .expect("registered binding");
    assert_eq!(ready.status, TerminalSessionBindingStatus::Ready);
    assert_eq!(ready.generation, 2);
    assert_eq!(ready.ready_at_ms, Some(20));

    service
        .disconnected_at("pane-a", "session-a", 30)
        .expect("disconnect binding");
    assert!(
        service
            .active_binding_for_session("session-a")
            .expect("query session")
            .is_none(),
        "disconnected bindings are not active"
    );
    assert!(service
        .stale_sessions_at(129)
        .expect("query stale sessions")
        .is_empty());
    assert_eq!(
        service
            .stale_sessions_at(130)
            .expect("query stale sessions")
            .len(),
        1
    );

    let reconnected = service
        .reconnected_at("pane-a", "session-a", 140)
        .expect("reconnect binding")
        .expect("registered binding");
    assert_eq!(reconnected.generation, 4);
    assert!(service
        .stale_sessions_at(240)
        .expect("query stale sessions")
        .is_empty());
    assert_eq!(
        service
            .active_binding_for_session("session-a")
            .expect("query session")
            .map(|binding| binding.pane_id),
        Some("pane-a".to_owned())
    );

    assert!(service
        .closed_at("pane-a", "session-a", 150)
        .expect("close binding"));
    assert!(service
        .active_binding_for_pane("pane-a")
        .expect("query pane")
        .is_none());

    let kinds: Vec<_> = service
        .events()
        .expect("events")
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            TerminalSessionBindingEventKind::Registered,
            TerminalSessionBindingEventKind::Ready,
            TerminalSessionBindingEventKind::Disconnected,
            TerminalSessionBindingEventKind::Reconnected,
            TerminalSessionBindingEventKind::Closed,
        ]
    );
}

/// tab scope 必须动态包含同一 Tab 的多个 pane，并保留断开成员供重连发现。
#[test]
fn tab_scope_lists_all_current_and_disconnected_members_without_crossing_tabs() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    for (pane_id, session_id, tab_id) in [
        ("pane-a1", "session-a1", "tab-a"),
        ("pane-a2", "session-a2", "tab-a"),
        ("pane-b1", "session-b1", "tab-b"),
    ] {
        service
            .register_at_with_metadata(
                pane_id,
                session_id,
                Some(TerminalSessionBindingMetadata {
                    tab_id: Some(tab_id.to_owned()),
                    target_ref: None,
                    target_kind: Some("local".to_owned()),
                    remote_host_id: None,
                    profile_id: None,
                    cwd: None,
                    shell: Some("pwsh".to_owned()),
                }),
                10,
            )
            .expect("register scoped terminal");
    }
    service
        .disconnected_at("pane-a2", "session-a2", 20)
        .expect("disconnect second tab member");

    let members = service
        .bindings_for_scope(&AgentSessionScope::Tab {
            tab_id: "tab-a".to_owned(),
        })
        .expect("list tab scope");
    assert_eq!(
        members
            .iter()
            .map(|binding| binding.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-a1", "session-a2"]
    );
    assert_eq!(
        members[1].status,
        TerminalSessionBindingStatus::Disconnected
    );
}

/// global scope 覆盖所有用户 Tab，但右栏 Agent 自身 pane 永远不进入授权集合。
#[test]
fn global_scope_lists_workspace_terminals_but_excludes_agent_tui() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    for (pane_id, session_id, tab_id) in [
        ("pane-a", "session-a", "tab-a"),
        ("pane-b", "session-b", "tab-b"),
        ("agent-terminal-ags-1", "agent-session", "tab-a"),
    ] {
        service
            .register_at_with_metadata(
                pane_id,
                session_id,
                Some(TerminalSessionBindingMetadata {
                    tab_id: Some(tab_id.to_owned()),
                    target_ref: None,
                    target_kind: Some("local".to_owned()),
                    remote_host_id: None,
                    profile_id: None,
                    cwd: None,
                    shell: Some("pwsh".to_owned()),
                }),
                10,
            )
            .expect("register global member candidate");
    }

    let members = service
        .bindings_for_scope(&AgentSessionScope::Global)
        .expect("list global scope");
    assert_eq!(
        members
            .iter()
            .map(|binding| binding.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-a", "session-b"]
    );
}

#[test]
fn dual_index_rebinding_records_mismatch_and_replaces_previous_owner() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at("pane-a", "session-a", 1)
        .expect("register first binding");
    assert_eq!(first.generation, 1);
    let second = service
        .register_at("pane-a", "session-b", 2)
        .expect("rebind pane to new session");
    assert_eq!(second.generation, 2);
    assert!(service
        .active_binding_for_session("session-a")
        .expect("query old session")
        .is_none());
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .map(|binding| (binding.session_id, binding.generation)),
        Some(("session-b".to_owned(), 2))
    );

    let third = service
        .register_at("pane-b", "session-b", 3)
        .expect("rebind session to new pane");
    assert_eq!(third.generation, 3);
    assert!(service
        .active_binding_for_pane("pane-a")
        .expect("query old pane")
        .is_none());
    assert_eq!(
        service
            .active_binding_for_session("session-b")
            .expect("query session")
            .map(|binding| (binding.pane_id, binding.generation)),
        Some(("pane-b".to_owned(), 3))
    );

    let mismatch_count = service
        .events()
        .expect("events")
        .into_iter()
        .filter(|event| event.kind == TerminalSessionBindingEventKind::Mismatch)
        .count();
    assert_eq!(mismatch_count, 2);
}

#[test]
fn register_binding_stores_normalized_target_metadata_in_snapshot() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let snapshot = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some(" tab-a ".to_owned()),
                target_ref: Some(" ssh:host-a ".to_owned()),
                target_kind: Some(" ssh ".to_owned()),
                remote_host_id: Some(" host-a ".to_owned()),
                profile_id: None,
                cwd: Some(" /srv/app ".to_owned()),
                shell: Some(" bash ".to_owned()),
            }),
            10,
        )
        .expect("register binding with metadata");

    let metadata = snapshot.metadata.expect("metadata is stored");
    assert_eq!(metadata.tab_id.as_deref(), Some("tab-a"));
    assert_eq!(metadata.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(metadata.target_kind.as_deref(), Some("ssh"));
    assert_eq!(metadata.remote_host_id.as_deref(), Some("host-a"));
    assert_eq!(metadata.cwd.as_deref(), Some("/srv/app"));
    assert_eq!(metadata.shell.as_deref(), Some("bash"));
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .and_then(|binding| binding.metadata)
            .and_then(|metadata| metadata.remote_host_id),
        Some("host-a".to_owned())
    );
}

#[test]
fn authoritative_target_ref_overwrites_client_metadata() {
    let metadata = TerminalSessionBindingMetadata::with_authoritative_target_ref(
        Some(TerminalSessionBindingMetadata {
            tab_id: Some("tab-a".to_owned()),
            target_ref: Some("ssh:evil".to_owned()),
            target_kind: Some("ssh".to_owned()),
            remote_host_id: Some("host-a".to_owned()),
            profile_id: None,
            cwd: None,
            shell: None,
        }),
        Some("ssh:host-a".to_owned()),
    )
    .expect("metadata remains present");

    assert_eq!(metadata.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(metadata.remote_host_id.as_deref(), Some("host-a"));
}

#[test]
fn missing_authoritative_target_ref_strips_client_target_ref() {
    let metadata = TerminalSessionBindingMetadata::with_authoritative_target_ref(
        Some(TerminalSessionBindingMetadata {
            tab_id: None,
            target_ref: Some("ssh:evil".to_owned()),
            target_kind: None,
            remote_host_id: None,
            profile_id: None,
            cwd: None,
            shell: None,
        }),
        None,
    );

    assert!(metadata.is_none());
}

#[test]
fn repeated_register_updates_metadata_and_advances_generation() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("local:profile-a".to_owned()),
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-a".to_owned()),
                cwd: Some("/tmp/old".to_owned()),
                shell: Some("pwsh".to_owned()),
            }),
            10,
        )
        .expect("register first binding");
    let second = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("local:profile-a".to_owned()),
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-a".to_owned()),
                cwd: Some("/tmp/new".to_owned()),
                shell: Some("pwsh".to_owned()),
            }),
            20,
        )
        .expect("register metadata update");

    assert!(second.generation > first.generation);
    assert_eq!(second.registered_at_ms, 20);
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query active binding")
            .map(|binding| {
                (
                    binding.generation,
                    binding
                        .metadata
                        .and_then(|metadata| metadata.cwd)
                        .unwrap_or_default(),
                )
            }),
        Some((second.generation, "/tmp/new".to_owned()))
    );
}

#[test]
fn target_capability_rejects_expired_unclaimed_token() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let result = service.register_at_with_metadata_and_capability(
        "pane-a",
        "session-a",
        None,
        Some(TerminalSessionBindingCapabilityUse {
            jti: "token-a".to_owned(),
            expires_at_ms: 99,
        }),
        100,
    );

    assert!(result
        .expect_err("expired capability is rejected")
        .to_string()
        .contains("已过期"));
    assert_eq!(
        service
            .events()
            .expect("events")
            .last()
            .map(|event| event.kind),
        Some(TerminalSessionBindingEventKind::Mismatch)
    );
}

#[test]
fn target_capability_binds_jti_to_first_pane_session_pair() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at_with_metadata_and_capability(
            "pane-a",
            "session-a",
            None,
            Some(TerminalSessionBindingCapabilityUse {
                jti: "token-a".to_owned(),
                expires_at_ms: 100,
            }),
            10,
        )
        .expect("first claim");
    let second = service
        .register_at_with_metadata_and_capability(
            "pane-a",
            "session-a",
            None,
            Some(TerminalSessionBindingCapabilityUse {
                jti: "token-a".to_owned(),
                expires_at_ms: 100,
            }),
            200,
        )
        .expect("same binding can refresh after claim");
    let replay = service.register_at_with_metadata_and_capability(
        "pane-b",
        "session-a",
        None,
        Some(TerminalSessionBindingCapabilityUse {
            jti: "token-a".to_owned(),
            expires_at_ms: 100,
        }),
        210,
    );

    assert_eq!(first.generation, 1);
    assert!(second.generation > first.generation);
    assert!(replay
        .expect_err("cross-pane replay is rejected")
        .to_string()
        .contains("已被其它终端绑定使用"));
}

#[test]
fn snapshot_events_update_binding_and_event_log_is_bounded() {
    let service = TerminalSessionBindingService::new(4, Duration::from_secs(60));

    service
        .register_at("pane-a", "session-a", 10)
        .expect("register binding");
    service
        .record_snapshot_resolved_at("pane-a", "session-a", 11)
        .expect("resolve snapshot");
    service
        .record_snapshot_rejected_at("pane-a", "session-a", 12)
        .expect("reject snapshot");
    let degraded = service
        .record_snapshot_degraded_at("pane-a", "session-a", 13)
        .expect("degrade snapshot")
        .expect("registered binding");
    assert_eq!(degraded.generation, 4);
    assert_eq!(
        degraded.last_snapshot_status,
        Some(TerminalSessionSnapshotStatus::Degraded)
    );

    service
        .ready_at("pane-missing", "session-missing", 14)
        .expect("missing ready records mismatch");

    let events = service.events().expect("events");
    assert_eq!(events.len(), 4);
    assert_eq!(events[0].sequence, 2, "oldest event was evicted");
    assert_eq!(
        events.iter().map(|event| event.kind).collect::<Vec<_>>(),
        vec![
            TerminalSessionBindingEventKind::SnapshotResolved,
            TerminalSessionBindingEventKind::SnapshotRejected,
            TerminalSessionBindingEventKind::SnapshotDegraded,
            TerminalSessionBindingEventKind::Mismatch,
        ]
    );
}

#[test]
fn agent_target_resolver_returns_live_target_from_explicit_binding() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let terminal_binding = service
        .register_at_with_metadata(
            "pane-a",
            "target-session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("ssh:prod-a".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-a".to_owned()),
                profile_id: None,
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
            }),
            10,
        )
        .expect("register target terminal binding");
    let terminal_binding = service
        .ready_at(&terminal_binding.pane_id, &terminal_binding.session_id, 20)
        .expect("ready target terminal binding")
        .expect("registered binding");

    let saved = service
        .bind_agent_target_to_terminal_binding_at("agent-session-a", &terminal_binding, 30)
        .expect("bind agent target");
    let resolved = service
        .resolve_agent_target("agent-session-a", ["target-session-a"])
        .expect("resolve live target");
    let write_target = service
        .resolve_agent_target_for_write("agent-session-a", saved.generation, ["target-session-a"])
        .expect("live binding is writable by explicit generation");

    assert_eq!(resolved.status, AgentTargetBindingStatus::Live);
    assert!(resolved.live);
    assert!(!resolved.stale);
    assert_eq!(resolved.target_terminal_session_id, "target-session-a");
    assert_eq!(resolved.pane_id, "pane-a");
    assert_eq!(resolved.tab_id.as_deref(), Some("tab-a"));
    assert_eq!(resolved.target_ref.as_deref(), Some("ssh:prod-a"));
    assert_eq!(resolved.cwd.as_deref(), Some("/srv/app"));
    assert_eq!(resolved.shell.as_deref(), Some("bash"));
    assert_eq!(write_target.binding_id, saved.binding_id);
}

#[test]
fn agent_target_resolver_marks_missing_live_session_stale_and_rejects_write() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let saved = service
        .save_agent_target_binding_at(
            AgentTargetBindingRequest {
                agent_session_id: "agent-session-a".to_owned(),
                target_terminal_session_id: "target-session-a".to_owned(),
                pane_id: "pane-a".to_owned(),
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("local:default".to_owned()),
                cwd: Some("C:/work".to_owned()),
                shell: Some("powershell".to_owned()),
            },
            10,
        )
        .expect("save agent target binding");

    let resolved = service
        .resolve_agent_target("agent-session-a", ["other-live-session"])
        .expect("resolve stale target");
    let error = service
        .resolve_agent_target_for_write("agent-session-a", saved.generation, ["other-live-session"])
        .expect_err("stale default target cannot be used for writes");

    assert_eq!(resolved.status, AgentTargetBindingStatus::Stale);
    assert!(!resolved.live);
    assert!(resolved.stale);
    assert!(error.to_string().contains("stale"));
}

#[test]
fn agent_target_write_guard_rejects_generation_mismatch() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let saved = service
        .save_agent_target_binding_at(
            AgentTargetBindingRequest {
                agent_session_id: "agent-session-a".to_owned(),
                target_terminal_session_id: "target-session-a".to_owned(),
                pane_id: "pane-a".to_owned(),
                tab_id: None,
                target_ref: None,
                cwd: None,
                shell: None,
            },
            10,
        )
        .expect("save agent target binding");

    let error = service
        .resolve_agent_target_for_write(
            "agent-session-a",
            saved.generation + 1,
            ["target-session-a"],
        )
        .expect_err("old or future generation is rejected");

    assert!(error.to_string().contains("generation mismatch"));
}

#[test]
fn agent_target_rebind_replaces_mapping_and_advances_generation() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let first = service
        .save_agent_target_binding_at(
            AgentTargetBindingRequest {
                agent_session_id: "agent-session-a".to_owned(),
                target_terminal_session_id: "target-session-a".to_owned(),
                pane_id: "pane-a".to_owned(),
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("ssh:first".to_owned()),
                cwd: Some("/srv/first".to_owned()),
                shell: Some("bash".to_owned()),
            },
            10,
        )
        .expect("save first target");
    let second = service
        .save_agent_target_binding_at(
            AgentTargetBindingRequest {
                agent_session_id: "agent-session-a".to_owned(),
                target_terminal_session_id: "target-session-b".to_owned(),
                pane_id: "pane-b".to_owned(),
                tab_id: Some("tab-b".to_owned()),
                target_ref: Some("ssh:second".to_owned()),
                cwd: Some("/srv/second".to_owned()),
                shell: Some("zsh".to_owned()),
            },
            20,
        )
        .expect("rebind target");

    let resolved = service
        .resolve_agent_target("agent-session-a", ["target-session-b"])
        .expect("resolve rebound target");

    assert!(second.generation > first.generation);
    assert_ne!(second.binding_id, first.binding_id);
    assert_eq!(resolved.generation, second.generation);
    assert_eq!(resolved.target_terminal_session_id, "target-session-b");
    assert_eq!(resolved.pane_id, "pane-b");
    assert_eq!(resolved.target_ref.as_deref(), Some("ssh:second"));
}

#[test]
fn agent_target_closed_terminal_has_explicit_write_error() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let terminal_binding = service
        .register_at("pane-a", "target-session-a", 10)
        .expect("register target terminal binding");
    let saved = service
        .bind_agent_target_to_terminal_binding_at("agent-session-a", &terminal_binding, 20)
        .expect("bind agent target");

    assert!(service
        .closed_at("pane-a", "target-session-a", 30)
        .expect("close terminal binding"));
    let closed = service
        .resolve_agent_target("agent-session-a", ["target-session-a"])
        .expect("resolve closed target");
    let error = service
        .resolve_agent_target_for_write("agent-session-a", closed.generation, ["target-session-a"])
        .expect_err("closed target cannot be used for writes");

    assert!(closed.generation > saved.generation);
    assert_eq!(closed.status, AgentTargetBindingStatus::Closed);
    assert!(!closed.live);
    assert!(!closed.stale);
    assert!(error.to_string().contains("closed"));
}

#[test]
fn replacement_session_for_same_pane_and_target_migrates_agent_binding() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let metadata = || TerminalSessionBindingMetadata {
        tab_id: Some("tab-a".to_owned()),
        target_ref: Some("ssh:prod-a".to_owned()),
        target_kind: Some("ssh".to_owned()),
        remote_host_id: Some("host-a".to_owned()),
        profile_id: None,
        cwd: Some("/srv/app".to_owned()),
        shell: Some("bash".to_owned()),
    };
    let original = service
        .register_at_with_metadata("pane-a", "session-old", Some(metadata()), 10)
        .expect("register original terminal");
    let original_agent = service
        .bind_agent_target_to_terminal_binding_at("agent-a", &original, 20)
        .expect("bind agent to original terminal");

    service
        .closed_at("pane-a", "session-old", 30)
        .expect("close original terminal");
    service
        .register_at_with_metadata("pane-a", "session-new", Some(metadata()), 40)
        .expect("register replacement terminal");

    let migrated = service
        .resolve_agent_target("agent-a", ["session-new"])
        .expect("resolve migrated agent target");
    assert_eq!(migrated.status, AgentTargetBindingStatus::Live);
    assert_eq!(migrated.target_terminal_session_id, "session-new");
    assert_eq!(migrated.pane_id, "pane-a");
    assert_eq!(migrated.target_ref.as_deref(), Some("ssh:prod-a"));
    assert!(migrated.generation > original_agent.generation);
    assert_ne!(migrated.binding_id, original_agent.binding_id);
}

#[test]
fn late_close_from_replaced_session_does_not_close_migrated_agent_binding() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let metadata = || TerminalSessionBindingMetadata {
        tab_id: Some("tab-a".to_owned()),
        target_ref: Some("ssh:prod-a".to_owned()),
        target_kind: Some("ssh".to_owned()),
        remote_host_id: Some("host-a".to_owned()),
        profile_id: None,
        cwd: None,
        shell: None,
    };
    let original = service
        .register_at_with_metadata("pane-a", "session-old", Some(metadata()), 10)
        .expect("register original terminal");
    service
        .bind_agent_target_to_terminal_binding_at("agent-a", &original, 20)
        .expect("bind agent to original terminal");

    service
        .register_at_with_metadata("pane-a", "session-new", Some(metadata()), 30)
        .expect("register replacement before old close arrives");
    assert!(!service
        .closed_at("pane-a", "session-old", 40)
        .expect("ignore late close for replaced terminal"));

    let migrated = service
        .resolve_agent_target("agent-a", ["session-new"])
        .expect("resolve migrated agent target");
    assert_eq!(migrated.status, AgentTargetBindingStatus::Live);
    assert_eq!(migrated.target_terminal_session_id, "session-new");
}

#[test]
fn replacement_session_for_different_target_does_not_migrate_agent_binding() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));
    let original = service
        .register_at_with_metadata(
            "pane-a",
            "session-old",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("ssh:prod-a".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-a".to_owned()),
                profile_id: None,
                cwd: None,
                shell: None,
            }),
            10,
        )
        .expect("register original terminal");
    service
        .bind_agent_target_to_terminal_binding_at("agent-a", &original, 20)
        .expect("bind agent to original terminal");
    service
        .closed_at("pane-a", "session-old", 30)
        .expect("close original terminal");

    service
        .register_at_with_metadata(
            "pane-a",
            "session-other",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("ssh:prod-b".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-b".to_owned()),
                profile_id: None,
                cwd: None,
                shell: None,
            }),
            40,
        )
        .expect("register different target");

    let closed = service
        .resolve_agent_target("agent-a", ["session-other"])
        .expect("resolve original agent target");
    assert_eq!(closed.status, AgentTargetBindingStatus::Closed);
    assert_eq!(closed.target_terminal_session_id, "session-old");
}
