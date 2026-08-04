//! Config change observer model and smoke tests.
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use kerminal_lib::models::config_change::{
    classify_config_relative_path, ConfigChangeBatch, ConfigChangeDiagnostic,
    ConfigChangeSourceHint, ConfigDomain, ConfigWatchBackend, ConfigWatchStatus,
    CONFIG_CHANGE_EVENT_NAME, CONFIG_CHANGE_EVENT_VERSION,
};
use kerminal_lib::models::{
    profile::TerminalProfile,
    remote_host::{RemoteHost, RemoteHostAuthType, RemoteHostGroup, SshOptions},
    settings::AppSettings,
    snippet::{CommandSnippet, SnippetScope},
    workflow::{CommandWorkflow, CommandWorkflowStep, WorkflowScope},
};
use kerminal_lib::{
    services::config_change_observer_service::{
        ConfigChangeObserverService, ConfigWatchBackendPreference,
    },
    storage::config_file_store::ConfigFileStore,
};

#[test]
fn config_change_event_contract_uses_frontend_strings() {
    let batch = ConfigChangeBatch {
        version: CONFIG_CHANGE_EVENT_VERSION,
        sequence: 42,
        batch_id: "batch-42".to_owned(),
        observed_at: "2026-06-26T00:03:28+08:00".to_owned(),
        domains: vec![ConfigDomain::Hosts, ConfigDomain::Workflows],
        status: ConfigWatchStatus::WatcherUnavailable,
        diagnostics: vec![ConfigChangeDiagnostic {
            domain: Some(ConfigDomain::Hosts),
            message: "watcher fallback unavailable".to_owned(),
            path: None,
            line: None,
            column: None,
            key: None,
            recovery: None,
        }],
        source_hint: ConfigChangeSourceHint::External,
    };

    let value = serde_json::to_value(batch).expect("serialize batch");

    assert_eq!(CONFIG_CHANGE_EVENT_NAME, "kerminal-config-changed");
    assert_eq!(value["version"], 1);
    assert_eq!(value["domains"][0], "hosts");
    assert_eq!(value["domains"][1], "workflows");
    assert_eq!(value["status"], "watcher-unavailable");
    assert_eq!(value["sourceHint"], "external");
    assert_eq!(value["diagnostics"][0]["domain"], "hosts");
}

#[test]
fn classifies_all_supported_config_domains() {
    let cases = [
        ("settings.toml", ConfigDomain::Settings),
        ("profiles/default.toml", ConfigDomain::Profiles),
        ("hosts/groups.toml", ConfigDomain::Hosts),
        ("hosts/staging-api.toml", ConfigDomain::Hosts),
        ("snippets/grep-logs.toml", ConfigDomain::Snippets),
        ("workflows/deploy.toml", ConfigDomain::Workflows),
    ];

    for (path, expected_domain) in cases {
        let classification = classify_config_relative_path(path).expect("classified path");
        assert_eq!(classification.domain, expected_domain, "{path}");
        assert_eq!(classification.safe_relative_path.as_deref(), Some(path));
    }
}

#[test]
fn classifies_windows_separators_without_leaking_backslashes() {
    let classification =
        classify_config_relative_path(r"hosts\staging-api.toml").expect("classified host");

    assert_eq!(classification.domain, ConfigDomain::Hosts);
    assert_eq!(
        classification.safe_relative_path.as_deref(),
        Some("hosts/staging-api.toml")
    );
}

#[test]
fn ignores_runtime_temp_backup_agent_and_log_paths() {
    let ignored = [
        ".storage.lock",
        "storage-manifest.toml",
        "backups/hosts/staging-api.toml",
        "agents/sessions/session-1/AGENTS.md",
        "workspace/session.json",
        "data/command.sqlite",
        "logs/app.log",
        "hosts/.tmp-123.toml",
        "hosts/.staging-api.toml.tmp-123",
        "profiles/default.toml.tmp",
        "secrets/hosts/staging-api.toml",
    ];

    for path in ignored {
        assert_eq!(classify_config_relative_path(path), None, "{path}");
    }
}

#[test]
fn ignores_unowned_and_unsafe_relative_paths() {
    let ignored = [
        "../settings.toml",
        "hosts/nested/staging-api.toml",
        "hosts/staging-api.json",
        "secrets/other/staging-api.toml",
        "unknown/config.toml",
    ];

    for path in ignored {
        assert_eq!(classify_config_relative_path(path), None, "{path}");
    }
}

#[test]
fn watcher_status_uses_relative_roots_and_redacts_secret_files() {
    let temp = tempfile::tempdir().expect("temp config root");
    let service = ConfigChangeObserverService::new(ConfigFileStore::new(temp.path()));

    let status = service.status();

    assert!(!status.enabled);
    assert_eq!(status.backend, ConfigWatchBackend::Unavailable);
    assert!(!status.watched_roots.contains(&"secrets/hosts".to_owned()));
    assert!(status
        .watched_roots
        .iter()
        .all(|root| !root.contains("staging-api.toml")
            && !root.contains(temp.path().to_string_lossy().as_ref())));
}

#[test]
fn watcher_stop_is_idempotent_and_allows_restart() {
    let temp = tempfile::tempdir().expect("temp config root");
    let service = ConfigChangeObserverService::new(ConfigFileStore::new(temp.path()));

    service
        .start_with_emitter(|_: &ConfigChangeBatch| Ok(()))
        .expect("start config watcher");
    assert!(service.status().enabled);

    service.stop().expect("stop config watcher");
    service.stop().expect("repeat config watcher stop");
    assert!(!service.status().enabled);

    service
        .start_with_emitter(|_: &ConfigChangeBatch| Ok(()))
        .expect("restart config watcher");
    assert!(service.status().enabled);
    service.stop().expect("final config watcher stop");
}

#[test]
fn native_and_polling_backends_follow_explicit_strategy() {
    for (preference, expected) in [
        (
            ConfigWatchBackendPreference::Native,
            ConfigWatchBackend::Native,
        ),
        (
            ConfigWatchBackendPreference::Polling,
            ConfigWatchBackend::Polling,
        ),
    ] {
        let temp = tempfile::tempdir().expect("temp config root");
        let service = ConfigChangeObserverService::with_backend_preference(
            ConfigFileStore::new(temp.path()),
            preference,
        );
        service
            .start_with_emitter(|_: &ConfigChangeBatch| Ok(()))
            .expect("start explicit watcher backend");
        assert_eq!(service.status().backend, expected);
        service.stop().expect("stop explicit watcher backend");
    }
}

#[test]
fn typed_validation_accepts_missing_optional_config_directories() {
    let temp = tempfile::tempdir().expect("temp config root");
    let service = ConfigChangeObserverService::new(ConfigFileStore::new(temp.path()));

    let diagnostics = service.validate_domains(&[
        ConfigDomain::Settings,
        ConfigDomain::Profiles,
        ConfigDomain::Hosts,
        ConfigDomain::Snippets,
        ConfigDomain::Workflows,
    ]);

    assert_eq!(diagnostics, Vec::<ConfigChangeDiagnostic>::new());
}

#[test]
fn watcher_smoke_external_writes_emit_ready_invalid_and_recovery_batches() {
    let target = tempfile::tempdir().expect("target config root");
    let source = tempfile::tempdir().expect("source config root");
    let target_store = ConfigFileStore::new(target.path());
    let service = ConfigChangeObserverService::new(target_store.clone());
    let (event_tx, event_rx) = mpsc::channel::<ConfigChangeBatch>();

    service
        .start_with_emitter(move |batch: &ConfigChangeBatch| {
            event_tx
                .send(batch.clone())
                .map_err(|error| error.to_string())
        })
        .expect("start config watcher with test sink");
    assert!(service.status().enabled);

    seed_rendered_config_files(source.path());
    copy_external_config_file(source.path(), target.path(), "settings.toml");
    copy_external_config_file(source.path(), target.path(), "profiles/smoke-profile.toml");
    copy_external_config_file(source.path(), target.path(), "hosts/groups.toml");
    copy_external_config_file(source.path(), target.path(), "hosts/smoke-host.toml");
    copy_external_config_file(source.path(), target.path(), "snippets/smoke-snippet.toml");
    copy_external_config_file(
        source.path(),
        target.path(),
        "workflows/smoke-workflow.toml",
    );

    let ready = recv_matching_batch(&event_rx, Duration::from_secs(8), |batch| {
        batch.status == ConfigWatchStatus::Ready
            && contains_domains(
                batch,
                &[
                    ConfigDomain::Settings,
                    ConfigDomain::Profiles,
                    ConfigDomain::Hosts,
                    ConfigDomain::Snippets,
                    ConfigDomain::Workflows,
                ],
            )
    })
    .expect("ready batch for all config domains");

    assert_eq!(ready.version, CONFIG_CHANGE_EVENT_VERSION);
    assert_eq!(ready.source_hint, ConfigChangeSourceHint::Unknown);
    assert!(ready.diagnostics.is_empty());
    assert!(target_store
        .list_remote_host_tree()
        .expect("read host tree")
        .iter()
        .any(|group| group.hosts.iter().any(|host| host.id == "smoke-host")));
    assert!(target_store
        .list_profiles()
        .expect("read profiles")
        .iter()
        .any(|profile| profile.id == "smoke-profile"));
    assert!(target_store
        .list_snippets()
        .expect("read snippets")
        .iter()
        .any(|snippet| snippet.id == "smoke-snippet"));
    assert!(target_store
        .list_workflows()
        .expect("read workflows")
        .iter()
        .any(|workflow| workflow.id == "smoke-workflow"));

    fs::write(
        target.path().join("hosts").join("smoke-host.toml"),
        "schema_version = 1\nid = [\n",
    )
    .expect("write invalid host toml");
    let invalid = recv_matching_batch(&event_rx, Duration::from_secs(8), |batch| {
        batch.status == ConfigWatchStatus::Invalid
            && contains_domains(batch, &[ConfigDomain::Hosts])
    })
    .expect("invalid host batch");
    assert_eq!(invalid.diagnostics[0].domain, Some(ConfigDomain::Hosts));
    assert_eq!(
        invalid.diagnostics[0].path.as_deref(),
        Some("hosts/smoke-host.toml")
    );
    assert_eq!(invalid.diagnostics[0].line, Some(2));
    assert_eq!(invalid.diagnostics[0].key.as_deref(), Some("id"));
    assert!(invalid.diagnostics[0].column.is_some());
    assert!(invalid.diagnostics[0]
        .recovery
        .as_deref()
        .is_some_and(|recovery| recovery.contains("last-known-good")
            || recovery.contains("kerminal.config.validate")));
    assert!(target_store.list_remote_host_tree().is_err());

    copy_external_config_file(source.path(), target.path(), "hosts/smoke-host.toml");
    let recovered = recv_matching_batch(&event_rx, Duration::from_secs(8), |batch| {
        batch.status == ConfigWatchStatus::Ready && contains_domains(batch, &[ConfigDomain::Hosts])
    })
    .expect("recovered host batch");
    assert!(recovered.diagnostics.is_empty());
    assert!(target_store.list_remote_host_tree().is_ok());
}

fn seed_rendered_config_files(root: &Path) {
    let store = ConfigFileStore::new(root);
    let timestamp = "2026-06-26T02:39:34Z".to_owned();
    store
        .write_settings(&AppSettings::default())
        .expect("render settings toml");
    store
        .write_profile(&TerminalProfile {
            id: "smoke-profile".to_owned(),
            name: "Smoke Profile".to_owned(),
            shell: "pwsh".to_owned(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            is_default: false,
            sidebar_group_id: Some("group-smoke".to_owned()),
            sort_order: 10,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        })
        .expect("render profile toml");
    store
        .apply_remote_host_change_set(
            Some(&[RemoteHostGroup {
                id: "group-smoke".to_owned(),
                name: "Smoke Group".to_owned(),
                sort_order: 10,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            }]),
            &[RemoteHost {
                id: "smoke-host".to_owned(),
                group_id: Some("group-smoke".to_owned()),
                name: "Smoke Host".to_owned(),
                host: "127.0.0.1".to_owned(),
                port: 22,
                username: "smoke".to_owned(),
                protocol: Default::default(),
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                secret_ref: None,
                key_passphrase_ref: None,
                key_passphrase_secret: None,
                credential_secret: None,
                credential_status: Default::default(),
                tags: vec!["smoke".to_owned()],
                ssh_options: SshOptions::default(),
                sort_order: 10,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            }],
            &[],
        )
        .expect("render host toml");
    store
        .apply_snippet_change_set(
            &[CommandSnippet {
                id: "smoke-snippet".to_owned(),
                title: "Smoke Snippet".to_owned(),
                description: Some("watcher smoke".to_owned()),
                command: "echo smoke".to_owned(),
                tags: vec!["smoke".to_owned()],
                scope: SnippetScope::Any,
                sort_order: 10,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                category: None,
                risk: None,
                default_action: None,
                variables: Vec::new(),
                context_bindings: Vec::new(),
                derived_from: None,
            }],
            &[],
        )
        .expect("render snippet toml");
    store
        .apply_workflow_change_set(
            &[CommandWorkflow {
                id: "smoke-workflow".to_owned(),
                title: "Smoke Workflow".to_owned(),
                description: Some("watcher smoke".to_owned()),
                tags: vec!["smoke".to_owned()],
                scope: WorkflowScope::Any,
                steps: vec![CommandWorkflowStep {
                    id: "smoke-step".to_owned(),
                    title: "Smoke Step".to_owned(),
                    command: "echo smoke".to_owned(),
                    description: None,
                    scope: None,
                    requires_confirmation: false,
                    sort_order: 10,
                    created_at: timestamp.clone(),
                    updated_at: timestamp,
                }],
                sort_order: 10,
                created_at: "2026-06-26T02:39:34Z".to_owned(),
                updated_at: "2026-06-26T02:39:34Z".to_owned(),
            }],
            &[],
        )
        .expect("render workflow toml");
}

fn copy_external_config_file(source_root: &Path, target_root: &Path, relative_path: &str) {
    let source = source_root.join(relative_path);
    let target = target_root.join(relative_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).expect("create target parent");
    }
    fs::copy(&source, &target).unwrap_or_else(|error| {
        panic!("copy {} to {}: {error}", source.display(), target.display())
    });
}

fn recv_matching_batch<F>(
    event_rx: &Receiver<ConfigChangeBatch>,
    timeout: Duration,
    matches: F,
) -> Option<ConfigChangeBatch>
where
    F: Fn(&ConfigChangeBatch) -> bool,
{
    let started = Instant::now();
    while started.elapsed() < timeout {
        let remaining = timeout.saturating_sub(started.elapsed());
        let wait_for = remaining.min(Duration::from_millis(250));
        match event_rx.recv_timeout(wait_for) {
            Ok(batch) if matches(&batch) => return Some(batch),
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
    None
}

fn contains_domains(batch: &ConfigChangeBatch, domains: &[ConfigDomain]) -> bool {
    domains
        .iter()
        .all(|domain| batch.domains.iter().any(|item| item == domain))
}
