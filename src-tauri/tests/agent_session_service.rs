//! Agent session service integration tests.
//!
//! @author kongweiguang

use std::{fs, path::Path, sync::Arc};

use tempfile::tempdir;

pub mod error {
    pub use kerminal_lib::error::*;
}

pub mod storage {
    pub use kerminal_lib::storage::*;
}

#[path = "../src/models/agent_session.rs"]
mod agent_session_impl;

pub mod models {
    pub mod agent_session {
        pub use crate::agent_session_impl::*;
    }
}

#[path = "../src/services/agent_session_file_store.rs"]
mod agent_session_file_store_impl;
#[path = "../src/services/agent_session_service.rs"]
mod agent_session_service_impl;

pub mod services {
    pub mod agent_session_file_store {
        pub use crate::agent_session_file_store_impl::*;
    }

    pub mod agent_session_service {
        pub use crate::agent_session_service_impl::*;
    }
}

use models::agent_session::{
    AgentId, AgentMcpCallLogEntry, AgentMcpEndpointContext, AgentProvider, AgentProviderSession,
    AgentSessionCreateRequest, AgentSessionId, AgentSessionLaunch, AgentSessionScope,
    AgentSessionStatus, AgentSessionTarget, AgentSessionUpdateRequest, AgentTargetBindingContext,
    AgentTargetBindingStatus, AgentTargetLiveStatus, AgentTerminalSnapshotContext,
    AGENT_SESSION_SCHEMA_VERSION,
};
use services::{
    agent_session_file_store::AgentSessionFileStore,
    agent_session_service::{AgentSessionIdGenerator, AgentSessionService},
};

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
    fn generate(&self) -> error::AppResult<AgentSessionId> {
        let mut ids = self.ids.lock().expect("ids lock");
        AgentSessionId::new(ids.pop().expect("next id"))
    }
}

#[test]
fn create_get_update_and_archive_session_files() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_test_001"]);
    let target = AgentSessionTarget {
        binding_id: Some("tb_1".to_owned()),
        binding_generation: 3,
        pane_id: Some("pane-1".to_owned()),
        tab_id: Some("tab-1".to_owned()),
        target_terminal_session_id: Some("term-target-1".to_owned()),
        target_ref: Some("ssh:prod-web-01".to_owned()),
        target_kind: Some("ssh".to_owned()),
        cwd: Some("/var/www/app".to_owned()),
        shell: Some("bash".to_owned()),
        live_status: AgentTargetLiveStatus::Ready,
        last_seen_at: Some("100".to_owned()),
    };

    let created = service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: Some("Prod deploy".to_owned()),
                launch: None,
                scope: None,
                target: Some(target),
                provider: None,
                mcp_endpoint: Some("http://127.0.0.1:37657/mcp/agents/ags_test_001".to_owned()),
            },
            "100",
        )
        .expect("create session");

    assert_eq!(created.session.agent_session_id.as_str(), "ags_test_001");
    assert_eq!(created.session.agent_id, AgentId::Codex);
    assert_eq!(created.session.status, AgentSessionStatus::Active);
    assert_eq!(
        created.provider.expect("provider").provider,
        AgentProvider::Codex
    );
    assert!(Path::new(&created.paths.session_toml).is_file());
    assert!(Path::new(&created.paths.provider_toml).is_file());
    assert!(Path::new(&created.paths.context.target_binding_json).is_file());
    assert!(Path::new(&created.paths.context.mcp_endpoint_json).is_file());
    assert!(Path::new(&created.paths.context.workspace_snapshot_json).is_file());
    assert_no_temp_files(created.paths.session_root.as_ref());

    let id = AgentSessionId::new("ags_test_001").expect("session id");
    let loaded = service.get_session(&id).expect("get session");
    assert_eq!(
        loaded
            .target_binding
            .expect("target binding")
            .binding
            .target_ref,
        Some("ssh:prod-web-01".to_owned())
    );
    assert_eq!(
        loaded.mcp_endpoint.expect("mcp endpoint").endpoint,
        Some("http://127.0.0.1:37657/mcp/agents/ags_test_001".to_owned())
    );

    let updated = service
        .update_session_at(
            &id,
            AgentSessionUpdateRequest {
                title: Some("Prod deploy follow-up".to_owned()),
                launch: Some(AgentSessionLaunch {
                    command_label: "codex".to_owned(),
                    shell: "codex".to_owned(),
                    args: vec!["--ask-for-approval=never".to_owned()],
                    cwd: loaded.session.session_root.clone(),
                }),
                ..AgentSessionUpdateRequest::default()
            },
            "200",
        )
        .expect("update session");
    assert_eq!(updated.session.title, "Prod deploy follow-up");
    assert_eq!(updated.session.updated_at, "200");
    assert_eq!(
        updated.session.launch.args,
        vec!["--ask-for-approval=never".to_owned()]
    );

    let archived = service
        .archive_session_at(&id, "300")
        .expect("archive session");
    assert_eq!(archived.session.status, AgentSessionStatus::Archived);
    assert_eq!(archived.session.updated_at, "300");
}

#[test]
fn list_skips_bad_session_toml_and_reports_diagnostics() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_good"]);
    service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Claude,
                title: None,
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create good session");

    let bad_root = temp.path().join("agents/sessions/ags_bad");
    fs::create_dir_all(&bad_root).expect("bad root");
    fs::write(bad_root.join("session.toml"), "schema_version =\n").expect("bad session");

    let listed = service.list_sessions().expect("list sessions");

    assert_eq!(listed.sessions.len(), 1);
    assert_eq!(
        listed.sessions[0].session.agent_session_id.as_str(),
        "ags_good"
    );
    assert!(listed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalidToml"));
}

#[test]
fn list_reports_bad_context_json_without_skipping_session() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_json"]);
    let created = service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Custom,
                title: Some("Custom".to_owned()),
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");
    fs::write(&created.paths.context.target_binding_json, "{not-json").expect("bad json");

    let listed = service.list_sessions().expect("list sessions");

    assert_eq!(listed.sessions.len(), 1);
    assert!(listed.sessions[0]
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalidTargetBinding"));
    assert!(listed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalidTargetBinding"));
}

#[test]
fn list_orders_by_updated_at_descending() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_old", "ags_new", "ags_middle"]);
    service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: Some("old".to_owned()),
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("old");
    service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Claude,
                title: Some("new".to_owned()),
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "300",
        )
        .expect("new");
    service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Custom,
                title: Some("middle".to_owned()),
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "200",
        )
        .expect("middle");

    let listed = service.list_sessions().expect("list sessions");
    let ids = listed
        .sessions
        .iter()
        .map(|record| record.session.agent_session_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["ags_new", "ags_middle", "ags_old"]);
}

#[test]
fn store_writes_provider_and_mcp_endpoint_directly() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_direct"]);
    service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: None,
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");
    let id = AgentSessionId::new("ags_direct").expect("id");
    let store = AgentSessionFileStore::new(temp.path());
    store
        .write_provider(
            &id,
            &AgentProviderSession {
                schema_version: AGENT_SESSION_SCHEMA_VERSION,
                provider: AgentProvider::Codex,
                provider_session_id: Some("provider-1".to_owned()),
                resume_command: Some("codex resume provider-1".to_owned()),
                resume_supported: true,
                last_resume_at: Some("150".to_owned()),
            },
        )
        .expect("write provider");
    store
        .write_mcp_endpoint_context(&AgentMcpEndpointContext::new(
            id.clone(),
            Some("http://127.0.0.1:4000/mcp/agents/ags_direct".to_owned()),
            "150",
        ))
        .expect("write endpoint");

    let record = store.read_record(&id).expect("read record");
    let provider = record.provider.expect("provider");
    assert_eq!(provider.provider_session_id, Some("provider-1".to_owned()));
    assert_eq!(
        record.mcp_endpoint.expect("endpoint").endpoint,
        Some("http://127.0.0.1:4000/mcp/agents/ags_direct".to_owned())
    );
}

#[test]
fn store_writes_terminal_snapshot_and_rotates_mcp_call_log() {
    let temp = tempdir().expect("temp dir");
    let service = service_with_ids(temp.path(), &["ags_log"]);
    let created = service
        .create_session_at(
            AgentSessionCreateRequest {
                agent_id: AgentId::Codex,
                title: None,
                launch: None,
                scope: None,
                target: None,
                provider: None,
                mcp_endpoint: None,
            },
            "100",
        )
        .expect("create session");
    let id = AgentSessionId::new("ags_log").expect("id");
    let store = AgentSessionFileStore::new(temp.path());

    store
        .write_terminal_snapshot_context(&AgentTerminalSnapshotContext {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: id.clone(),
            target_terminal_session_id: Some("term-1".to_owned()),
            captured_bytes: 5,
            max_bytes: 24 * 1024,
            truncated: false,
            redacted: true,
            output: "hello".to_owned(),
            generated_at: "150".to_owned(),
        })
        .expect("write terminal snapshot");
    let terminal_snapshot =
        fs::read_to_string(&created.paths.context.terminal_snapshot_json).expect("snapshot file");
    assert!(terminal_snapshot.contains("\"targetTerminalSessionId\": \"term-1\""));
    assert!(terminal_snapshot.contains("\"redacted\": true"));

    let log_dir = temp.path().join("agents/sessions/ags_log/logs");
    fs::create_dir_all(&log_dir).expect("log dir");
    fs::write(log_dir.join("mcp-calls.jsonl"), "x".repeat(1024 * 1024)).expect("seed large log");
    store
        .append_mcp_call_log(&AgentMcpCallLogEntry {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: id,
            tool_id: "kerminal.agent.current_session".to_owned(),
            status: "succeeded".to_owned(),
            summary: Some("ok".to_owned()),
            error: None,
            runtime_audit: Some("backend=managed-ssh-runtime".to_owned()),
            generated_at: "200".to_owned(),
        })
        .expect("append mcp log");

    let current_log = fs::read_to_string(log_dir.join("mcp-calls.jsonl")).expect("current log");
    assert!(current_log.contains("\"toolId\":\"kerminal.agent.current_session\""));
    assert!(current_log.contains("\"runtimeAudit\":\"backend=managed-ssh-runtime\""));
    let rotated_logs = fs::read_dir(&log_dir)
        .expect("read logs")
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name != "mcp-calls.jsonl" && name.starts_with("mcp-calls.") && name.ends_with(".jsonl")
        })
        .count();
    assert_eq!(rotated_logs, 1);
}

#[test]
fn list_one_hundred_sessions_uses_metadata_only_and_ignores_large_snapshot() {
    let temp = tempdir().expect("temp dir");
    let ids = (0..100)
        .map(|index| format!("ags_perf_{index:03}"))
        .collect::<Vec<_>>();
    let id_refs = ids.iter().map(String::as_str).collect::<Vec<_>>();
    let service = service_with_ids(temp.path(), &id_refs);

    for index in 0..100 {
        service
            .create_session_at(
                AgentSessionCreateRequest {
                    agent_id: AgentId::Codex,
                    title: Some(format!("session {index}")),
                    launch: None,
                    scope: None,
                    target: None,
                    provider: None,
                    mcp_endpoint: None,
                },
                index.to_string(),
            )
            .expect("create session");
    }

    let large_snapshot = temp
        .path()
        .join("agents/sessions/ags_perf_000/context/terminal-snapshot.json");
    fs::write(large_snapshot, "{".to_owned() + &"x".repeat(512 * 1024))
        .expect("write intentionally invalid large snapshot");

    let listed = service.list_sessions().expect("list sessions");

    assert_eq!(listed.sessions.len(), 100);
    assert!(listed.diagnostics.is_empty());
}

#[test]
fn mcp_call_log_bounds_large_summary_and_error_fields() {
    let temp = tempdir().expect("temp dir");
    let id = AgentSessionId::new("ags_bounded_log").expect("id");
    let store = AgentSessionFileStore::new(temp.path());
    let large_summary = "s".repeat(10 * 1024);
    let large_error = "e".repeat(10 * 1024);
    let large_audit = "a".repeat(10 * 1024);

    store
        .append_mcp_call_log(&AgentMcpCallLogEntry {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: id,
            tool_id: "terminal.snapshot".to_owned(),
            status: "failed".to_owned(),
            summary: Some(large_summary),
            error: Some(large_error),
            runtime_audit: Some(large_audit),
            generated_at: "300".to_owned(),
        })
        .expect("append bounded mcp log");

    let log = fs::read_to_string(
        temp.path()
            .join("agents/sessions/ags_bounded_log/logs/mcp-calls.jsonl"),
    )
    .expect("mcp calls log");
    let line: serde_json::Value = serde_json::from_str(log.trim()).expect("log json");
    let summary = line
        .pointer("/summary")
        .and_then(serde_json::Value::as_str)
        .expect("summary");
    let error = line
        .pointer("/error")
        .and_then(serde_json::Value::as_str)
        .expect("error");
    let runtime_audit = line
        .pointer("/runtimeAudit")
        .and_then(serde_json::Value::as_str)
        .expect("runtime audit");

    assert!(summary.ends_with("..."));
    assert!(error.ends_with("..."));
    assert!(runtime_audit.ends_with("..."));
    assert!(summary.len() < 4_200);
    assert!(error.len() < 4_200);
    assert!(runtime_audit.len() < 4_200);
}

fn service_with_ids(root: &Path, ids: &[&str]) -> AgentSessionService {
    AgentSessionService::with_id_generator(
        AgentSessionFileStore::new(root),
        Arc::new(FixedIdGenerator::new(ids)),
    )
}

#[test]
fn legacy_target_binding_context_without_scope_migrates_from_binding() {
    let tab_context: AgentTargetBindingContext = serde_json::from_value(serde_json::json!({
        "schemaVersion": AGENT_SESSION_SCHEMA_VERSION,
        "agentSessionId": "ags_legacy_tab",
        "binding": {
            "generation": 7,
            "status": "ready",
            "stale": false,
            "tabId": "tab-legacy"
        },
        "generatedAt": "100"
    }))
    .expect("legacy tab context");
    assert_eq!(
        tab_context.effective_scope(),
        AgentSessionScope::Tab {
            tab_id: "tab-legacy".to_owned()
        }
    );
    tab_context.validate().expect("legacy tab context valid");

    let global_context: AgentTargetBindingContext = serde_json::from_value(serde_json::json!({
        "schemaVersion": AGENT_SESSION_SCHEMA_VERSION,
        "agentSessionId": "ags_legacy_global",
        "binding": {
            "generation": 0,
            "status": "unbound",
            "stale": false
        },
        "generatedAt": "101"
    }))
    .expect("legacy global context");
    assert_eq!(
        global_context.binding.status,
        AgentTargetBindingStatus::Unbound
    );
    assert_eq!(global_context.effective_scope(), AgentSessionScope::Global);
    global_context
        .validate()
        .expect("legacy global context valid");
}

fn assert_no_temp_files(session_root: &str) {
    let entries = fs::read_dir(session_root).expect("session root");
    for entry in entries {
        let entry = entry.expect("entry");
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        assert!(
            !file_name.contains(".tmp-"),
            "unexpected temp file left behind: {file_name}"
        );
    }
}
