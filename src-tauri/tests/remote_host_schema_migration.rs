//! Host schema v1 一次性升级迁移集成测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::{config_change::ConfigDomain, remote_host::RemoteHostProtocol},
    paths::KerminalPaths,
    state::AppState,
    storage::{config_file_store::ConfigFileStore, file_store::FileStore},
};
use tempfile::tempdir;

#[test]
fn migrates_v1_hosts_as_one_recoverable_v2_change_set() {
    let root = tempdir().expect("config root");
    write_host(
        root.path(),
        "desktop",
        &v1_host("desktop", &["RDP", "prod"]),
    );
    write_host(root.path(), "shell", &v1_host("shell", &["prod"]));
    let desktop_before = read_host(root.path(), "desktop");
    let shell_before = read_host(root.path(), "shell");
    let store = ConfigFileStore::new(root.path());

    let report = store
        .migrate_remote_host_schema_v1()
        .expect("migrate legacy hosts");

    assert_eq!(report.migrated_hosts, 2);
    let change_set_id = report.change_set_id.expect("migration change set");
    let desktop_after = read_host(root.path(), "desktop");
    let shell_after = read_host(root.path(), "shell");
    assert!(desktop_after.contains("schema_version = 2"));
    assert!(desktop_after.contains("protocol = \"rdp\""));
    assert!(shell_after.contains("protocol = \"ssh\""));
    for source in [&desktop_after, &shell_after] {
        assert!(source.contains("# keep this comment"));
        assert!(source.contains("custom_note = \"preserve-me\""));
        assert!(source.contains("secret_ref = \"vault://fixture\""));
    }
    let hosts = store.list_remote_hosts().expect("strict v2 host loader");
    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].protocol, RemoteHostProtocol::Rdp);
    assert_eq!(hosts[1].protocol, RemoteHostProtocol::Ssh);

    let manifest = FileStore::new(root.path())
        .read_storage_manifest()
        .expect("read storage manifest");
    let change_set = manifest
        .change_set(&change_set_id)
        .expect("migration manifest entry");
    let backup_dir = change_set.backup_dir.as_deref().expect("backup directory");
    assert_eq!(
        fs::read_to_string(root.path().join(backup_dir).join("hosts/desktop.toml"))
            .expect("desktop backup"),
        desktop_before
    );
    assert_eq!(
        fs::read_to_string(root.path().join(backup_dir).join("hosts/shell.toml"))
            .expect("shell backup"),
        shell_before
    );

    let manifest_len = manifest.change_sets.len();
    let second = store
        .migrate_remote_host_schema_v1()
        .expect("repeat migration");
    assert_eq!(second.migrated_hosts, 0);
    assert!(second.change_set_id.is_none());
    assert_eq!(read_host(root.path(), "desktop"), desktop_after);
    assert_eq!(
        FileStore::new(root.path())
            .read_storage_manifest()
            .expect("manifest after no-op")
            .change_sets
            .len(),
        manifest_len
    );
}

#[test]
fn migration_failure_leaves_every_host_unchanged() {
    let root = tempdir().expect("config root");
    write_host(root.path(), "valid", &v1_host("valid", &["serial"]));
    write_host(
        root.path(),
        "unsupported",
        &v1_host("unsupported", &["telnet"]).replace("schema_version = 1", "schema_version = 9"),
    );
    let valid_before = read_host(root.path(), "valid");
    let unsupported_before = read_host(root.path(), "unsupported");

    ConfigFileStore::new(root.path())
        .migrate_remote_host_schema_v1()
        .expect_err("unknown schema must fail the migration batch");

    assert_eq!(read_host(root.path(), "valid"), valid_before);
    assert_eq!(read_host(root.path(), "unsupported"), unsupported_before);
    assert!(FileStore::new(root.path())
        .read_storage_manifest()
        .expect("empty manifest")
        .change_sets
        .is_empty());
}

#[test]
fn migration_uses_the_historical_protocol_tag_precedence() {
    for (index, tags, expected) in [
        (
            0,
            vec!["rdp", "telnet", "serial"],
            RemoteHostProtocol::Serial,
        ),
        (1, vec!["rdp", "TELNET"], RemoteHostProtocol::Telnet),
        (2, vec![" RDP "], RemoteHostProtocol::Rdp),
        (3, vec!["prod"], RemoteHostProtocol::Ssh),
    ] {
        let root = tempdir().expect("config root");
        let id = format!("case-{index}");
        write_host(root.path(), &id, &v1_host(&id, &tags));

        ConfigFileStore::new(root.path())
            .migrate_remote_host_schema_v1()
            .expect("migrate protocol case");

        let host = ConfigFileStore::new(root.path())
            .remote_host_by_id(&id)
            .expect("load migrated host")
            .expect("host exists");
        assert_eq!(host.protocol, expected, "case {index}");
    }
}

#[test]
fn migration_rejects_partially_converted_v1_without_rewriting_it() {
    let root = tempdir().expect("config root");
    let source = v1_host("partial", &["rdp"]).replace(
        "schema_version = 1",
        "schema_version = 1\nprotocol = \"rdp\"",
    );
    write_host(root.path(), "partial", &source);

    ConfigFileStore::new(root.path())
        .migrate_remote_host_schema_v1()
        .expect_err("partially converted v1 must fail closed");

    assert_eq!(read_host(root.path(), "partial"), source);
}

#[test]
fn migration_rejects_id_filename_mismatch_without_rewriting_it() {
    let root = tempdir().expect("config root");
    let source = v1_host("different-id", &["rdp"]);
    write_host(root.path(), "filename", &source);

    ConfigFileStore::new(root.path())
        .migrate_remote_host_schema_v1()
        .expect_err("id mismatch must fail closed");

    assert_eq!(read_host(root.path(), "filename"), source);
}

#[test]
fn migration_rejects_plaintext_secrets_without_rewriting_any_host() {
    let root = tempdir().expect("config root");
    let source = v1_host("unsafe", &["rdp"]).replace(
        "secret_ref = \"vault://fixture\"",
        "password = \"do-not-copy\"",
    );
    write_host(root.path(), "unsafe", &source);

    let error = ConfigFileStore::new(root.path())
        .migrate_remote_host_schema_v1()
        .expect_err("plaintext secret must fail closed");

    assert_eq!(read_host(root.path(), "unsafe"), source);
    let error_text = format!("{error:?}");
    assert!(error_text.contains("password"));
    assert!(!error_text.contains("do-not-copy"));
}

#[test]
fn app_startup_migrates_v1_before_the_strict_host_loader() {
    let root = tempdir().expect("config root");
    write_host(root.path(), "console", &v1_host("console", &["serial"]));

    let state = AppState::initialize_with_paths(KerminalPaths::from_root(root.path()))
        .expect("initialize with legacy host");

    assert!(!state.startup_recovery().read_only);
    let host = state
        .remote_hosts()
        .require_host("console")
        .expect("migrated host");
    assert_eq!(host.protocol, RemoteHostProtocol::Serial);
    assert!(read_host(root.path(), "console").contains("schema_version = 2"));
}

#[test]
fn app_startup_reports_invalid_host_migration_without_overwriting_it() {
    let root = tempdir().expect("config root");
    let source = v1_host("broken", &["rdp"]).replace("schema_version = 1", "schema_version = 8");
    write_host(root.path(), "broken", &source);

    let state = AppState::initialize_with_paths(KerminalPaths::from_root(root.path()))
        .expect("initialize in host recovery mode");

    assert!(state.startup_recovery().read_only);
    assert!(state
        .startup_recovery()
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.domain == ConfigDomain::Hosts
            && diagnostic.path == "hosts/*.toml"));
    assert_eq!(read_host(root.path(), "broken"), source);
    assert!(state.remote_hosts().list_tree().is_err());
}

fn write_host(root: &std::path::Path, id: &str, source: &str) {
    fs::create_dir_all(root.join("hosts")).expect("create hosts directory");
    fs::write(root.join("hosts").join(format!("{id}.toml")), source).expect("write host");
}

fn read_host(root: &std::path::Path, id: &str) -> String {
    fs::read_to_string(root.join("hosts").join(format!("{id}.toml"))).expect("read host")
}

fn v1_host(id: &str, tags: &[&str]) -> String {
    let tags = tags
        .iter()
        .map(|tag| format!("\"{tag}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r#"# keep this comment
schema_version = 1
id = "{id}"
name = "{id}"
host = "{id}.internal"
port = 22
username = "deploy"
auth_type = "agent"
secret_ref = "vault://fixture"
tags = [{tags}]
production = false
sort_order = 10
created_at = "1"
updated_at = "1"
custom_note = "preserve-me"
"#
    )
}
