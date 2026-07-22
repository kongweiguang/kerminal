use super::*;
use kerminal_lib::models::command_suggestion::{
    CommandSuggestionActivation, CommandSuggestionCandidateKind, SuggestionPresentation,
    SuggestionQueryMode,
};
use kerminal_lib::models::snippet::{
    SnippetContextBinding, SnippetContextBindingKind, SnippetCreateRequest, SnippetScope,
};
use kerminal_lib::storage::config_file_store::SnippetDocumentPatch;
use kerminal_lib::storage::snippet_preferences::SnippetPreferenceOrigin;

#[test]
fn parameterized_snippet_menu_opens_panel_without_inline_replacement() {
    let (_home, state) = test_state();
    let input = "HTTP";
    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: SuggestionQueryMode::Menu,
                input: input.to_owned(),
                cursor: input.chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-1".to_owned()),
                cwd: Some("/srv".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Snippet]),
                limit: Some(10),
            },
        )
        .expect("snippet suggestions");
    let candidate = suggestions
        .iter()
        .find(|candidate| candidate.source_id.as_deref() == Some("snippet.builtin.core.http_head"))
        .expect("HTTP snippet");
    assert_eq!(
        candidate.candidate_kind,
        CommandSuggestionCandidateKind::Snippet
    );
    assert_eq!(
        candidate.activation,
        CommandSuggestionActivation::OpenSnippetPanel
    );
    assert_eq!(
        candidate.allowed_presentations,
        vec![SuggestionPresentation::Menu]
    );
}

#[test]
fn legacy_provider_requests_do_not_enable_snippets() {
    let (_home, state) = test_state();
    let input = "docker";
    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: SuggestionQueryMode::Menu,
                input: input.to_owned(),
                cursor: input.len(),
                target: CommandHistoryTarget::Local,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: Some("pwsh.exe".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Spec]),
                limit: Some(10),
            },
        )
        .expect("suggestions");
    assert!(suggestions
        .iter()
        .all(|candidate| candidate.provider != SuggestionProviderKind::Snippet));
}

#[test]
fn accepted_inline_snippet_feedback_counts_one_usage() {
    let (_home, state) = test_state();
    let snippet_id = "snippet.builtin.core.current_directory";
    let request = CommandSuggestionFeedbackRecordRequest {
        action: CommandSuggestionFeedbackAction::Accepted,
        cwd: None,
        input: "pw".to_owned(),
        pane_id: Some("pane-1".to_owned()),
        profile_id: None,
        provider: SuggestionProviderKind::Snippet,
        remote_host_id: None,
        replacement_text: "pwd && ls".to_owned(),
        session_id: Some("session-1".to_owned()),
        shell: Some("bash".to_owned()),
        source_id: Some(snippet_id.to_owned()),
        target: CommandHistoryTarget::Local,
    };

    state
        .command_suggestions()
        .record_feedback(state.command_store(), request)
        .expect("record snippet feedback");

    let preference = state
        .command_store()
        .snippet_preference(SnippetPreferenceOrigin::Builtin, snippet_id)
        .expect("read preference")
        .expect("usage preference");
    assert_eq!(preference.use_count, 1);
}

#[test]
fn unified_provider_discovers_user_snippets_and_records_user_usage() {
    let (_home, state) = test_state();
    let created = state
        .snippets()
        .create_snippet(SnippetCreateRequest {
            title: "我的安全检查".to_owned(),
            command: "my-safe-check --status".to_owned(),
            description: Some("用户自定义只读检查".to_owned()),
            tags: vec!["custom".to_owned()],
            scope: SnippetScope::Local,
        })
        .expect("create user snippet");
    let snapshot = state
        .snippets()
        .config()
        .read_snippet_document(&created.id)
        .expect("read user snippet document");
    state
        .snippets()
        .config()
        .patch_snippet_document(
            &created.id,
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: created.title.clone(),
                description: created.description.clone(),
                command: created.command.clone(),
                tags: created.tags.clone(),
                scope: created.scope,
                sort_order: created.sort_order,
                updated_at: created.updated_at.clone(),
                category: Some("custom".to_owned()),
                risk: Some("inspect".to_owned()),
                default_action: Some("insert".to_owned()),
                variables: Vec::new(),
                context_bindings: Vec::new(),
                derived_from: None,
            },
        )
        .expect("patch user snippet metadata");

    let input = "my-";
    let suggestions = state
        .command_suggestions()
        .list_suggestions_with_snippets(
            state.command_store(),
            state.command_history(),
            state.snippets(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: SuggestionQueryMode::Inline,
                input: input.to_owned(),
                cursor: input.chars().count(),
                target: CommandHistoryTarget::Local,
                session_id: None,
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: Some("pwsh.exe".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Snippet]),
                limit: Some(10),
            },
        )
        .expect("unified snippet suggestions");
    let candidate = suggestions
        .iter()
        .find(|candidate| candidate.source_id.as_deref() == Some(created.id.as_str()))
        .expect("user snippet suggestion");
    assert_eq!(candidate.activation, CommandSuggestionActivation::Insert);
    assert_eq!(candidate.replacement_text, created.command);
    assert_eq!(
        candidate
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("origin"))
            .map(String::as_str),
        Some("user")
    );
    let candidate_id = candidate.id.clone();

    state
        .command_suggestions()
        .record_feedback_with_snippets(
            state.command_store(),
            state.snippets(),
            CommandSuggestionFeedbackRecordRequest {
                action: CommandSuggestionFeedbackAction::Accepted,
                cwd: None,
                input: "my-opaque-input-7b0f9a".to_owned(),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                provider: SuggestionProviderKind::Snippet,
                remote_host_id: None,
                replacement_text: "my-safe-check --status opaque-7b0f9a".to_owned(),
                session_id: Some("session-1".to_owned()),
                shell: Some("pwsh.exe".to_owned()),
                source_id: Some(candidate_id.clone()),
                target: CommandHistoryTarget::Local,
            },
        )
        .expect("record user snippet feedback");
    let preference = state
        .command_store()
        .snippet_preference(SnippetPreferenceOrigin::User, &created.id)
        .expect("read user preference")
        .expect("user usage preference");
    assert_eq!(preference.use_count, 1);

    let connection = Connection::open(state.command_store().database_file())
        .expect("open command database for privacy assertion");
    let (replacement_text, feedback_input): (String, String) = connection
        .query_row(
            "SELECT replacement_text, input FROM command_suggestion_feedback ORDER BY created_at_unix_ms DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read redacted snippet feedback");
    assert_eq!(replacement_text, format!("@snippet:{candidate_id}"));
    assert_eq!(feedback_input, "@snippet");
    assert!(!replacement_text.contains("opaque-7b0f9a"));
    assert!(!feedback_input.contains("opaque-7b0f9a"));
}

#[test]
fn host_bound_user_snippet_is_not_suggested_on_another_host() {
    let (_home, state) = test_state();
    let created = state
        .snippets()
        .create_snippet(SnippetCreateRequest {
            title: "绑定主机检查".to_owned(),
            command: "bound-check --status".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: SnippetScope::Ssh,
        })
        .expect("create host-bound snippet");
    let snapshot = state
        .snippets()
        .config()
        .read_snippet_document(&created.id)
        .expect("read snippet document");
    state
        .snippets()
        .config()
        .patch_snippet_document(
            &created.id,
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: created.title.clone(),
                description: created.description.clone(),
                command: created.command.clone(),
                tags: created.tags.clone(),
                scope: created.scope,
                sort_order: created.sort_order,
                updated_at: created.updated_at.clone(),
                category: Some("custom".to_owned()),
                risk: Some("inspect".to_owned()),
                default_action: Some("insert".to_owned()),
                variables: Vec::new(),
                context_bindings: vec![SnippetContextBinding {
                    kind: SnippetContextBindingKind::Host,
                    target_id: Some("host-a".to_owned()),
                }],
                derived_from: None,
            },
        )
        .expect("patch host binding");
    state.snippets().invalidate_catalog_cache();

    let query = |remote_host_id: &str| {
        state
            .command_suggestions()
            .list_suggestions_with_snippets(
                state.command_store(),
                state.command_history(),
                state.snippets(),
                CommandSuggestionRequest {
                    context_key: None,
                    generation: None,
                    mode: SuggestionQueryMode::Menu,
                    input: "bound".to_owned(),
                    cursor: 5,
                    target: CommandHistoryTarget::Ssh,
                    session_id: None,
                    pane_id: Some("pane-1".to_owned()),
                    profile_id: None,
                    remote_host_id: Some(remote_host_id.to_owned()),
                    cwd: None,
                    shell: Some("bash".to_owned()),
                    providers: Some(vec![SuggestionProviderKind::Snippet]),
                    limit: Some(10),
                },
            )
            .expect("query host-bound snippet")
    };
    assert!(query("host-b")
        .iter()
        .all(|candidate| candidate.source_id.as_deref() != Some(created.id.as_str())));
    assert!(query("host-a")
        .iter()
        .any(|candidate| candidate.source_id.as_deref() == Some(created.id.as_str())));
}
