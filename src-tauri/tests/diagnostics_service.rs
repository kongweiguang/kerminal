//! 诊断包服务测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::settings::AppSettings,
    paths::KerminalPaths,
    services::{diagnostics_service::DiagnosticsService, terminal_manager::TerminalManager},
    storage::{command_migrations::CURRENT_COMMAND_SCHEMA_VERSION, CommandSqliteStore},
};
use serde_json::Value;
use tempfile::tempdir;

#[test]
fn create_bundle_writes_redacted_summary_json() {
    let temp = tempdir().unwrap();
    let paths = KerminalPaths::from_root(temp.path().join(".kerminal"));
    let command_store = CommandSqliteStore::open(&paths).unwrap();
    paths.ensure_directories().unwrap();
    fs::write(
        paths.app_log_file(),
        "Bearer super-secret-token password=hunter2",
    )
    .unwrap();
    let terminals = TerminalManager::new();
    let service = DiagnosticsService::new();
    let mut settings = AppSettings::default();
    settings.terminal.font_family = "token=super-secret-token-12345".to_owned();

    let bundle = service
        .create_bundle(&paths, &command_store, &terminals, settings)
        .unwrap();

    assert!(bundle.redacted);
    assert!(bundle.path.contains("diagnostics"));
    assert!(bundle.file_name.starts_with("diagnostics-"));
    assert!(bundle.sections.contains(&"runtimeHealth".to_owned()));
    assert!(bundle.sections.contains(&"logs".to_owned()));
    assert!(bundle.sections.contains(&"terminalSessions".to_owned()));

    let content = fs::read_to_string(&bundle.path).unwrap();
    assert_eq!(bundle.bytes_written, content.len() as u64);
    assert!(!content.contains("super-secret-token-12345"));
    assert!(!content.contains("hunter2"));
    assert!(!content.contains("super-secret-token password"));
    assert!(content.contains("token=[已脱敏]"));

    let payload: Value = serde_json::from_str(&content).unwrap();
    assert_eq!(payload["schema"], "kerminal.diagnostics.v1");
    assert_eq!(payload["app"]["name"], "Kerminal");
    assert_eq!(
        payload["commandDatabase"]["schemaVersion"],
        CURRENT_COMMAND_SCHEMA_VERSION
    );
    assert_eq!(payload["runtimeHealth"]["sampling"]["source"], "sysinfo");
    assert!(payload["paths"]["appLogFile"]
        .as_str()
        .unwrap()
        .ends_with("kerminal.log"));
    assert_eq!(payload["logs"]["contentIncluded"], false);
    assert_eq!(payload["logs"]["maxFileSizeBytes"], 1_000_000);
    assert_eq!(payload["logs"]["rotationKeepFiles"], 5);
    assert!(payload["logs"]["activeFile"]
        .as_str()
        .unwrap()
        .ends_with("kerminal.log"));
    assert_eq!(
        payload["runtimeHealth"]["sampling"]["cpuRefreshedTwice"],
        true
    );
    assert!(payload["runtimeHealth"]["system"]["gpus"].is_array());
    assert_eq!(payload["terminalSessions"]["total"], 0);
    assert_eq!(payload["terminalSessions"]["rawOutputIncluded"], false);
    assert_eq!(payload["security"]["secretRedaction"], true);
    assert_eq!(payload["security"]["commandHistoryIncluded"], false);
    assert_eq!(payload["security"]["credentialValuesIncluded"], false);
    assert_eq!(payload["security"]["logContentIncluded"], false);
}

#[test]
fn runtime_health_returns_process_system_and_storage_summary() {
    let temp = tempdir().unwrap();
    let paths = KerminalPaths::from_root(temp.path().join(".kerminal"));
    let command_store = CommandSqliteStore::open(&paths).unwrap();
    paths.ensure_directories().unwrap();
    fs::write(paths.app_log_file(), "health-check").unwrap();
    let service = DiagnosticsService::new();

    let snapshot = service.runtime_health(&paths, &command_store).unwrap();

    assert!(snapshot.redacted);
    assert_eq!(snapshot.sampling.source, "sysinfo");
    assert!(snapshot.sampling.cpu_refreshed_twice);
    assert!(snapshot.sampling.cpu_sample_interval_ms > 0);
    assert!(snapshot.process.pid > 0);
    assert!(!snapshot.process.name.is_empty());
    assert!(snapshot.process.memory_bytes > 0);
    assert!(snapshot.system.cpu_count > 0);
    assert_eq!(
        snapshot.system.cpu_core_usage_percents.len(),
        snapshot.system.cpu_count
    );
    assert!(snapshot.system.total_memory_bytes >= snapshot.system.used_memory_bytes);
    assert!(snapshot.system.gpus.iter().all(|gpu| !gpu.name.is_empty()));
    assert!(snapshot.storage.root.contains(".kerminal"));
    assert!(snapshot
        .storage
        .command_database_file
        .ends_with("command.sqlite"));
    assert!(snapshot.storage.app_log_file.ends_with("kerminal.log"));
    assert!(snapshot.storage.app_log_file_size_bytes >= "health-check".len() as u64);
    assert_eq!(snapshot.storage.app_log_max_file_size_bytes, 1_000_000);
    assert_eq!(snapshot.storage.app_log_rotation_keep_files, 5);
    assert!(snapshot.storage.root_size_bytes >= "health-check".len() as u64);
}

#[cfg(target_os = "windows")]
#[test]
fn parse_windows_gpu_json_keeps_usage_and_dedicated_memory() {
    let gpus = kerminal_lib::services::diagnostics_service::rules::parse_windows_gpu_json(
        r#"[{"Name":"NVIDIA GeForce RTX 4060","AdapterCompatibility":"NVIDIA","DriverVersion":"31.0.15","AdapterRAM":8589934592,"UtilizationPercent":42.25,"DedicatedUsageBytes":2147483648}]"#,
    );

    assert_eq!(gpus.len(), 1);
    assert_eq!(gpus[0].name, "NVIDIA GeForce RTX 4060");
    assert_eq!(gpus[0].vendor.as_deref(), Some("NVIDIA"));
    assert_eq!(gpus[0].memory_total_bytes, Some(8_589_934_592));
    assert_eq!(gpus[0].memory_used_bytes, Some(2_147_483_648));
    assert_eq!(gpus[0].utilization_percent, Some(42.3));
}
