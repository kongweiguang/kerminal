//! 命令建议请求与候选合同兼容测试。
//!
//! @author kongweiguang

use kerminal_lib::models::command_suggestion::{
    CommandSuggestionActivation, CommandSuggestionCandidate, CommandSuggestionCandidateKind,
    CommandSuggestionRequest, CommandSuggestionSensitivity, SuggestionProviderKind,
};
use serde_json::json;

#[test]
fn request_requires_explicit_mode() {
    let error = serde_json::from_value::<CommandSuggestionRequest>(json!({
        "input": "git status",
        "cursor": 10,
        "target": "local",
        "sessionId": null,
        "paneId": null,
        "profileId": null,
        "remoteHostId": null,
        "cwd": null,
        "shell": null,
        "providers": null,
        "limit": 8
    }))
    .expect_err("mode is required");
    assert!(error.to_string().contains("mode"));
}

#[test]
fn snippet_candidate_contract_uses_stable_camel_case_values() {
    let mut payload = current_candidate_json("normal");
    payload["provider"] = json!("snippet");
    payload["candidateKind"] = json!("snippet");
    payload["activation"] = json!("openSnippetPanel");

    let candidate: CommandSuggestionCandidate =
        serde_json::from_value(payload).expect("deserialize snippet candidate");
    let serialized = serde_json::to_value(&candidate).expect("serialize snippet candidate");

    assert_eq!(candidate.provider, SuggestionProviderKind::Snippet);
    assert_eq!(
        candidate.candidate_kind,
        CommandSuggestionCandidateKind::Snippet
    );
    assert_eq!(
        candidate.activation,
        CommandSuggestionActivation::OpenSnippetPanel
    );
    assert_eq!(serialized["provider"], "snippet");
    assert_eq!(serialized["candidateKind"], "snippet");
    assert_eq!(serialized["activation"], "openSnippetPanel");
}

#[test]
fn unicode_candidate_contract_round_trips_without_offset_conversion() {
    let payload = json!({
        "id": "history-unicode",
        "provider": "history",
        "displayText": "echo 服务器/日志",
        "replacementText": "echo 服务器/日志",
        "replacementRange": { "start": 5, "end": 8 },
        "suffix": "器/日志",
        "score": 0.9,
        "sensitivity": "normal",
        "description": "Unicode 候选",
        "sourceId": "history-unicode",
        "metadata": { "source": "test" },
        "candidateKind": "command",
        "activation": "insert",
        "sourceExplanation": null,
        "mergedSourceExplanations": [],
        "allowedPresentations": ["inline", "menu"],
        "acceptBoundaries": [9, 11],
        "contextKey": "ssh:host-prod:/srv:zh"
    });

    let candidate: CommandSuggestionCandidate =
        serde_json::from_value(payload.clone()).expect("deserialize Unicode candidate");
    let serialized = serde_json::to_value(&candidate).expect("serialize Unicode candidate");
    let round_trip: CommandSuggestionCandidate =
        serde_json::from_value(serialized.clone()).expect("round-trip Unicode candidate");

    assert_eq!(round_trip, candidate);
    assert_eq!(serialized, payload);
    assert_eq!(candidate.provider, SuggestionProviderKind::History);
    assert_eq!(candidate.sensitivity, CommandSuggestionSensitivity::Normal);
    assert_eq!(candidate.replacement_range.start, 5);
    assert_eq!(candidate.replacement_range.end, 8);
    assert_eq!(candidate.accept_boundaries, vec![9, 11]);
}

fn current_candidate_json(sensitivity: &str) -> serde_json::Value {
    json!({
        "id": format!("history-{sensitivity}"),
        "provider": "history",
        "displayText": "git status --short",
        "replacementText": "git status --short",
        "replacementRange": { "start": 0, "end": 3 },
        "suffix": " status --short",
        "score": 0.9,
        "sensitivity": sensitivity,
        "description": null,
        "sourceId": null,
        "metadata": null,
        "candidateKind": "command",
        "activation": "insert",
        "sourceExplanation": null,
        "mergedSourceExplanations": [],
        "allowedPresentations": ["inline", "menu"],
        "acceptBoundaries": [],
        "contextKey": null
    })
}
