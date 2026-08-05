// @author kongweiguang

use super::*;

#[test]
fn telemetry_tracks_provider_queries_cache_and_feedback() {
    let (_home, state) = test_state();
    cache_commands(&state, vec!["git".to_owned(), "grep".to_owned()]);

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");
    assert_eq!(suggestions.len(), 1);

    state
        .command_suggestions()
        .record_feedback(
            state.command_store(),
            CommandSuggestionFeedbackRecordRequest {
                action: CommandSuggestionFeedbackAction::Accepted,
                cwd: Some("/srv/app".to_owned()),
                input: "gi".to_owned(),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                provider: SuggestionProviderKind::RemoteCommand,
                remote_host_id: Some("host-prod".to_owned()),
                replacement_text: "git".to_owned(),
                session_id: Some("session-1".to_owned()),
                shell: Some("bash".to_owned()),
                source_id: Some("git".to_owned()),
                target: CommandHistoryTarget::Ssh,
            },
        )
        .expect("record feedback");

    let summary = state
        .command_suggestions()
        .telemetry_summary()
        .expect("telemetry summary");
    let remote_command = summary
        .providers
        .iter()
        .find(|provider| provider.provider == SuggestionProviderKind::RemoteCommand)
        .expect("remote command telemetry");

    assert_eq!(summary.total_query_count, 1);
    assert_eq!(summary.total_candidate_count, 1);
    assert_eq!(remote_command.query_count, 1);
    assert_eq!(remote_command.candidate_count, 1);
    assert_eq!(remote_command.cache_hit_count, 1);
    assert_eq!(remote_command.cache_miss_count, 0);
    assert_eq!(remote_command.refresh_success_count, 1);
    assert_eq!(remote_command.feedback_accepted_count, 1);
    assert_eq!(remote_command.feedback_dismissed_count, 0);
    assert!(remote_command.last_event_unix_ms.is_some());
}

#[test]
fn telemetry_tracks_remote_cache_misses() {
    let (_home, state) = test_state();

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git checkout fe".to_owned(),
                cursor: "git checkout fe".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert!(suggestions.is_empty());
    let summary = state
        .command_suggestions()
        .telemetry_summary()
        .expect("telemetry summary");
    let git = summary
        .providers
        .iter()
        .find(|provider| provider.provider == SuggestionProviderKind::Git)
        .expect("git telemetry");

    assert_eq!(git.query_count, 1);
    assert_eq!(git.candidate_count, 0);
    assert_eq!(git.cache_hit_count, 0);
    assert_eq!(git.cache_miss_count, 1);
}

#[test]
fn telemetry_export_persists_across_app_state_reopen() {
    let (home, state) = test_state();
    cache_commands(&state, vec!["git".to_owned(), "grep".to_owned()]);

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");
    assert_eq!(suggestions.len(), 1);

    state
        .command_suggestions()
        .record_feedback(
            state.command_store(),
            CommandSuggestionFeedbackRecordRequest {
                action: CommandSuggestionFeedbackAction::Accepted,
                cwd: Some("/srv/app".to_owned()),
                input: "gi".to_owned(),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                provider: SuggestionProviderKind::RemoteCommand,
                remote_host_id: Some("host-prod".to_owned()),
                replacement_text: "git".to_owned(),
                session_id: Some("session-1".to_owned()),
                shell: Some("bash".to_owned()),
                source_id: Some("git".to_owned()),
                target: CommandHistoryTarget::Ssh,
            },
        )
        .expect("record accepted feedback");

    let export = state
        .command_suggestions()
        .telemetry_export(state.command_store())
        .expect("telemetry export");
    let runtime_remote_command =
        telemetry_provider(&export.runtime, SuggestionProviderKind::RemoteCommand);
    let persisted_remote_command =
        telemetry_provider(&export.persisted, SuggestionProviderKind::RemoteCommand);
    assert_eq!(runtime_remote_command.query_count, 1);
    assert_eq!(persisted_remote_command.query_count, 1);
    assert_eq!(persisted_remote_command.cache_hit_count, 1);
    assert_eq!(persisted_remote_command.refresh_success_count, 1);
    assert_eq!(persisted_remote_command.feedback_accepted_count, 1);
    drop(state);

    let paths = KerminalPaths::from_home_dir(home.path());
    let reopened = AppState::initialize_with_paths(paths).expect("reopen app state");
    let reopened_export = reopened
        .command_suggestions()
        .telemetry_export(reopened.command_store())
        .expect("telemetry export after reopen");
    let reopened_runtime = telemetry_provider(
        &reopened_export.runtime,
        SuggestionProviderKind::RemoteCommand,
    );
    let reopened_persisted = telemetry_provider(
        &reopened_export.persisted,
        SuggestionProviderKind::RemoteCommand,
    );

    assert_eq!(reopened_runtime.query_count, 0);
    assert_eq!(reopened_persisted.query_count, 1);
    assert_eq!(reopened_persisted.cache_hit_count, 1);
    assert_eq!(reopened_persisted.feedback_accepted_count, 1);
}

#[test]
fn telemetry_export_includes_recent_audit_events() {
    let (_home, state) = test_state();
    let mut metadata = BTreeMap::new();
    metadata.insert("remoteProbeEnabled".to_owned(), "false".to_owned());

    state
        .command_suggestions()
        .record_audit_event(
            state.command_store(),
            CommandSuggestionAuditRecordRequest {
                cwd: Some("/srv/app".to_owned()),
                decision: CommandSuggestionAuditDecision::Skipped,
                event_kind: CommandSuggestionAuditEventKind::RemoteProbeSchedule,
                metadata,
                pane_id: Some("pane-1".to_owned()),
                path: None,
                provider: Some(SuggestionProviderKind::RemoteCommand),
                reason: Some("remote-probe-disabled".to_owned()),
                remote_host_id: Some("host-1".to_owned()),
                session_id: Some("session-1".to_owned()),
                target: CommandHistoryTarget::Ssh,
            },
        )
        .expect("record audit event");

    let export = state
        .command_suggestions()
        .telemetry_export(state.command_store())
        .expect("export telemetry");

    assert_eq!(export.audit_events.len(), 1);
    let event = &export.audit_events[0];
    assert_eq!(
        event.event_kind,
        CommandSuggestionAuditEventKind::RemoteProbeSchedule
    );
    assert_eq!(event.decision, CommandSuggestionAuditDecision::Skipped);
    assert_eq!(event.provider, Some(SuggestionProviderKind::RemoteCommand));
    assert_eq!(event.remote_host_id.as_deref(), Some("host-1"));
    assert_eq!(event.reason.as_deref(), Some("remote-probe-disabled"));
    assert_eq!(
        event.metadata.get("remoteProbeEnabled").map(String::as_str),
        Some("false")
    );
    assert!(!event.metadata.contains_key("productionHost"));
    assert!(!event.metadata.contains_key("productionHostPolicy"));
}
