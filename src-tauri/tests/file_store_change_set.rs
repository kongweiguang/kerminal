//! FileStore manifest, lock, and change-set integration tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::storage::{
    file_store::{FileStore, FileStoreChange, FileStoreError},
    storage_manifest::{ChangeSetStatus, StorageManifest},
};
use tempfile::tempdir;

#[test]
fn storage_manifest_roundtrip_uses_fixed_manifest_path() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    let mut manifest = StorageManifest::new();
    manifest.begin_change_set(
        "change-1",
        "2026-06-24T10:00:00+08:00",
        vec!["settings.toml".to_owned()],
    );
    manifest.mark_applied("change-1", "2026-06-24T10:00:01+08:00");

    store
        .write_storage_manifest(&manifest)
        .expect("write manifest");
    let loaded = store.read_storage_manifest().expect("read manifest");
    let source =
        fs::read_to_string(temp.path().join("storage-manifest.toml")).expect("manifest source");

    assert_eq!(loaded, manifest);
    assert!(source.contains("schema_version = 1"));
    assert!(source.contains("last_applied_change_set_id = \"change-1\""));
}

#[test]
fn read_storage_manifest_defaults_when_missing() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());

    let manifest = store.read_storage_manifest().expect("default manifest");

    assert_eq!(manifest, StorageManifest::new());
    assert!(!temp.path().join("storage-manifest.toml").exists());
}

#[test]
fn lock_file_rejects_second_holder_until_released() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());

    let first_lock = store.acquire_lock().expect("first lock");
    let second_error = store.acquire_lock().expect_err("second lock should fail");

    assert!(matches!(second_error, FileStoreError::Locked(_)));

    drop(first_lock);
    let _released_lock = store.acquire_lock().expect("lock released");
}

#[test]
fn change_set_applies_multiple_files_and_persists_manifest() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    fs::write(
        temp.path().join("settings.toml"),
        "schema_version = 1\nname = \"old\"\n",
    )
    .expect("write settings");
    fs::create_dir_all(temp.path().join("profiles")).expect("create profiles dir");
    fs::write(
        temp.path().join("profiles/default.toml"),
        "schema_version = 1\nname = \"old-profile\"\n",
    )
    .expect("write profile");

    let manifest = store
        .apply_change_set(
            "change-2",
            "2026-06-24T10:01:00+08:00",
            vec![
                FileStoreChange::new(
                    "settings.toml",
                    b"schema_version = 1\nname = \"new\"\n".to_vec(),
                )
                .expect("settings change"),
                FileStoreChange::new(
                    "profiles/default.toml",
                    b"schema_version = 1\nname = \"new-profile\"\n".to_vec(),
                )
                .expect("profile change"),
            ],
        )
        .expect("apply change set");
    let loaded_manifest = store.read_storage_manifest().expect("read manifest");
    let change_set = loaded_manifest.change_set("change-2").expect("change set");

    assert_eq!(loaded_manifest, manifest);
    assert_eq!(change_set.status, ChangeSetStatus::Applied);
    assert_eq!(
        fs::read_to_string(temp.path().join("settings.toml")).expect("settings"),
        "schema_version = 1\nname = \"new\"\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("profiles/default.toml")).expect("profile"),
        "schema_version = 1\nname = \"new-profile\"\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("backups/change-2/settings.toml"))
            .expect("settings backup"),
        "schema_version = 1\nname = \"old\"\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("backups/change-2/profiles/default.toml"))
            .expect("profile backup"),
        "schema_version = 1\nname = \"old-profile\"\n"
    );
}

#[test]
fn legacy_change_set_keeps_last_write_wins_for_duplicate_paths() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    fs::write(temp.path().join("settings.toml"), "old").expect("seed target");

    store
        .apply_change_set(
            "duplicate-path",
            "2026-06-24T10:01:00+08:00",
            vec![
                FileStoreChange::new("settings.toml", b"first".to_vec()).expect("first change"),
                FileStoreChange::new("settings.toml", b"last".to_vec()).expect("last change"),
            ],
        )
        .expect("apply duplicate legacy changes");

    assert_eq!(
        fs::read_to_string(temp.path().join("settings.toml")).expect("target"),
        "last"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("backups/duplicate-path/settings.toml"))
            .expect("backup"),
        "old"
    );
}

#[test]
fn restoring_change_set_deletes_file_that_had_no_backup() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());

    store
        .apply_change_set(
            "change-1",
            "2026-06-24T10:00:00+08:00",
            vec![FileStoreChange::new(
                "settings.toml",
                b"schema_version = 1\nname = \"new\"\n".to_vec(),
            )
            .expect("settings change")],
        )
        .expect("apply change set");
    assert!(temp.path().join("settings.toml").is_file());
    assert!(!temp.path().join("backups/change-1/settings.toml").exists());

    let repaired_manifest = store
        .restore_change_set("change-1", "2026-06-24T10:00:01+08:00")
        .expect("restore change set");

    assert!(!temp.path().join("settings.toml").exists());
    assert_eq!(
        repaired_manifest
            .change_set("change-1")
            .expect("repaired change")
            .status,
        ChangeSetStatus::Repaired
    );
}

#[test]
fn restore_change_set_preserves_external_edit_and_reports_conflict() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    fs::write(temp.path().join("settings.toml"), "old").expect("seed target");
    store
        .apply_change_set(
            "external-conflict",
            "2026-06-24T10:00:00+08:00",
            vec![FileStoreChange::new("settings.toml", b"new".to_vec()).expect("change")],
        )
        .expect("apply change");
    fs::write(temp.path().join("settings.toml"), "external").expect("external edit");

    let error = store
        .restore_change_set("external-conflict", "2026-06-24T10:00:01+08:00")
        .expect_err("restore must preserve external edit");

    assert!(matches!(error, FileStoreError::TransactionConflict(_)));
    assert_eq!(
        fs::read_to_string(temp.path().join("settings.toml")).expect("target"),
        "external"
    );
}

#[test]
fn failed_change_set_rolls_back_partial_write_and_manual_restore_is_idempotent() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    fs::write(
        temp.path().join("settings.toml"),
        "schema_version = 1\nname = \"old\"\n",
    )
    .expect("write settings");
    fs::write(temp.path().join("profiles"), "not a directory").expect("write blocking file");

    let apply_error = store
        .apply_change_set(
            "change-3",
            "2026-06-24T10:02:00+08:00",
            vec![
                FileStoreChange::new(
                    "settings.toml",
                    b"schema_version = 1\nname = \"new\"\n".to_vec(),
                )
                .expect("settings change"),
                FileStoreChange::new(
                    "profiles/default.toml",
                    b"schema_version = 1\nname = \"profile\"\n".to_vec(),
                )
                .expect("profile change"),
            ],
        )
        .expect_err("second write should fail");
    let recovered_manifest = store.read_storage_manifest().expect("recovered manifest");
    let recovered_change_set = recovered_manifest
        .change_set("change-3")
        .expect("recovered change");

    assert!(matches!(apply_error, FileStoreError::Io(_)));
    assert_eq!(recovered_change_set.status, ChangeSetStatus::Repaired);
    assert!(recovered_manifest.repair_state.is_none());
    assert_eq!(
        fs::read_to_string(temp.path().join("settings.toml")).expect("restored settings"),
        "schema_version = 1\nname = \"old\"\n"
    );

    let repaired_manifest = store
        .restore_change_set("change-3", "2026-06-24T10:02:01+08:00")
        .expect("idempotent restore change set");
    let repaired_change_set = repaired_manifest
        .change_set("change-3")
        .expect("repaired change");

    assert_eq!(repaired_change_set.status, ChangeSetStatus::Repaired);
    assert!(repaired_manifest.repair_state.is_none());
    assert_eq!(
        fs::read_to_string(temp.path().join("settings.toml")).expect("restored settings"),
        "schema_version = 1\nname = \"old\"\n"
    );
}
