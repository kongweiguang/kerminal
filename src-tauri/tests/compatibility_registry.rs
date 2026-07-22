//! 兼容 registry、脱敏指标与退役门禁测试。
//!
//! @author kongweiguang

use kerminal_lib::services::compatibility_registry::{
    build_metric_snapshot, evaluate_activation, evaluate_retirement, registry_entries,
    validate_registry, CompatibilityMetric, CompatibilityMetrics, RetirementDecision,
    RetirementEvidence,
};

const EXPECTED_IDS: [&str; 11] = [
    "command-history.empty-scope-clear",
    "config-watcher.polling",
    "diagnostics.silent-catch-policy",
    "managed-ssh.legacy-fallback",
    "runtime.browser-preview",
    "sftp.transfer-polling",
    "snippet.schema-v1",
    "startup.dynamic-import-retry",
    "terminal.gpu-fallback",
    "terminal.xterm-webview-patch",
    "workspace.schema-v1-migration",
];

#[test]
fn registry_has_complete_unique_governed_inventory() {
    let registry = registry_entries().expect("load compatibility registry");
    validate_registry(registry).expect("registry governance");
    let mut ids = registry
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    assert_eq!(ids, EXPECTED_IDS);
    assert!(registry.iter().all(|entry| !entry.owner.trim().is_empty()));
}

#[test]
fn registry_validation_rejects_malformed_stable_ids() {
    let mut entries = registry_entries().unwrap().to_vec();
    entries[0].id = ".invalid".to_owned();
    assert!(validate_registry(&entries).is_err());
}

#[test]
fn activation_is_fail_closed_for_unknown_ids_and_reasons() {
    assert!(
        evaluate_activation("terminal.gpu-fallback", "context-lost")
            .unwrap()
            .allowed
    );
    assert!(
        evaluate_activation("managed-ssh.legacy-fallback", "backend-unwired")
            .unwrap()
            .allowed
    );
    assert!(
        !evaluate_activation("managed-ssh.legacy-fallback", "authentication-failed")
            .unwrap()
            .allowed
    );
    assert!(evaluate_activation("unknown.compatibility", "anything").is_err());
}

#[test]
fn public_metric_snapshot_contains_only_stable_aggregates() {
    let snapshot = build_metric_snapshot(&[
        CompatibilityMetric {
            activation_count: 4,
            failure_count: 1,
            id: "terminal.gpu-fallback".to_owned(),
        },
        CompatibilityMetric {
            activation_count: 2,
            failure_count: 0,
            id: "terminal.gpu-fallback".to_owned(),
        },
    ])
    .expect("build metric snapshot");
    let json = serde_json::to_string(&snapshot).unwrap();

    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].activation_count, 6);
    assert_eq!(snapshot.entries[0].failure_count, 1);
    for forbidden in [
        "secret",
        "password",
        "path",
        "detail",
        "owner",
        "implementation",
    ] {
        assert!(!json.to_ascii_lowercase().contains(forbidden), "{json}");
    }
    assert!(build_metric_snapshot(&[CompatibilityMetric {
        activation_count: 1,
        failure_count: 0,
        id: "unknown.compatibility".to_owned(),
    }])
    .is_err());
}

#[test]
fn metric_collector_counts_allowed_denied_and_runtime_failures() {
    let metrics = CompatibilityMetrics::default();
    assert!(
        metrics
            .record_activation("terminal.gpu-fallback", "context-lost")
            .unwrap()
            .allowed
    );
    assert!(
        !metrics
            .record_activation("terminal.gpu-fallback", "unregistered-reason")
            .unwrap()
            .allowed
    );
    metrics.record_failure("terminal.gpu-fallback").unwrap();

    let snapshot = metrics.snapshot().unwrap();
    assert_eq!(snapshot.entries[0].activation_count, 1);
    assert_eq!(snapshot.entries[0].failure_count, 2);
    assert!(metrics
        .record_activation("unknown.compatibility", "anything")
        .is_err());
    assert_eq!(metrics.snapshot().unwrap(), snapshot);
}

#[test]
fn retirement_gate_requires_quiet_windows_tests_and_rollback() {
    let blocked = evaluate_retirement(
        "snippet.schema-v1",
        &RetirementEvidence {
            consecutive_zero_windows: 2,
            regression_tests_green: true,
            rollback_documented: true,
        },
    )
    .unwrap();
    assert_eq!(blocked, RetirementDecision::Blocked);

    let allowed = evaluate_retirement(
        "snippet.schema-v1",
        &RetirementEvidence {
            consecutive_zero_windows: 3,
            regression_tests_green: true,
            rollback_documented: true,
        },
    )
    .unwrap();
    assert_eq!(allowed, RetirementDecision::Allowed);

    let permanent = evaluate_retirement(
        "runtime.browser-preview",
        &RetirementEvidence {
            consecutive_zero_windows: u32::MAX,
            regression_tests_green: true,
            rollback_documented: true,
        },
    )
    .unwrap();
    assert_eq!(permanent, RetirementDecision::NotEligible);
}
