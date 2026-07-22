//! SFTP 规则集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::sftp::{
        SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpLocalPathInfo, SftpLocalPathKind,
        SftpRemoteCopyRequest, SftpTransferConflictPolicy, SftpTransferKind,
    },
    services::sftp_service::rules,
};
use russh::keys;
use std::fs::File as StdFile;
use std::io::Read;
use tempfile::tempdir;

#[test]
fn normalize_preview_bytes_uses_safe_bounds() {
    assert_eq!(
        rules::normalize_preview_bytes(None),
        rules::default_preview_bytes()
    );
    assert_eq!(
        rules::normalize_preview_bytes(Some(1)),
        rules::min_preview_bytes()
    );
    assert_eq!(
        rules::normalize_preview_bytes(Some(rules::max_preview_bytes() + 1)),
        rules::max_preview_bytes()
    );
    assert_eq!(rules::normalize_preview_bytes(Some(4096)), 4096);
}

#[test]
fn validate_chmod_mode_accepts_octal_and_rejects_injection() {
    assert_eq!(rules::validate_chmod_mode("644").expect("mode"), 0o644);
    assert_eq!(rules::validate_chmod_mode("0755").expect("mode"), 0o755);

    let invalid = rules::validate_chmod_mode("ugo+r").expect_err("reject symbolic mode");
    assert!(matches!(invalid, AppError::InvalidInput(_)));

    let injected = rules::validate_chmod_mode("644\nrm").expect_err("reject newline");
    assert!(matches!(injected, AppError::InvalidInput(_)));
}

#[test]
fn normalize_remote_path_rejects_control_characters() {
    let error = rules::normalize_remote_path("/tmp/a\nrm").expect_err("reject newline");
    assert!(matches!(error, AppError::InvalidInput(_)));
    assert_eq!(
        rules::normalize_remote_path("\\var\\log\\").expect("normalize"),
        "/var/log"
    );
}

#[test]
fn validate_local_path_strips_windows_verbatim_prefixes() {
    assert_eq!(
        rules::validate_local_path(r"\\?\C:\dev\rust\kerminal\node_modules").expect("drive path"),
        r"C:\dev\rust\kerminal\node_modules"
    );
    assert_eq!(
        rules::validate_local_path(r"\?\C:\dev\rust\kerminal\node_modules")
            .expect("malformed drive path"),
        r"C:\dev\rust\kerminal\node_modules"
    );
    assert_eq!(
        rules::validate_local_path(r"\\?\UNC\nas\share\dist").expect("unc path"),
        r"\\nas\share\dist"
    );
}

#[test]
fn normalize_remote_copy_request_rejects_unsafe_boundaries() {
    let base_request = SftpRemoteCopyRequest {
        source_host_id: "source-host".to_owned(),
        source_remote_path: "/srv/app/".to_owned(),
        target_host_id: "target-host".to_owned(),
        target_remote_path: "/srv/app/".to_owned(),
        kind: SftpTransferKind::File,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
        view_scope: None,
    };

    let cross_host_same_path =
        rules::normalize_remote_copy_request(base_request.clone()).expect("cross host same path");
    assert_eq!(cross_host_same_path.source_remote_path, "/srv/app");
    assert_eq!(cross_host_same_path.target_remote_path, "/srv/app");

    let same_host_same_path = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        target_host_id: "source-host".to_owned(),
        ..base_request.clone()
    })
    .expect_err("reject same host same normalized path");
    assert!(matches!(same_host_same_path, AppError::InvalidInput(_)));

    let root_source = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        source_remote_path: "/".to_owned(),
        ..base_request.clone()
    })
    .expect_err("reject root source");
    assert!(matches!(root_source, AppError::InvalidInput(_)));

    let root_target = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        target_remote_path: "/".to_owned(),
        ..base_request.clone()
    })
    .expect_err("reject root target");
    assert!(matches!(root_target, AppError::InvalidInput(_)));

    let source_injected = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        source_remote_path: "/tmp/a\0rm".to_owned(),
        ..base_request.clone()
    })
    .expect_err("reject source control characters");
    assert!(matches!(source_injected, AppError::InvalidInput(_)));

    let target_injected = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        target_remote_path: "/tmp/a\nrm".to_owned(),
        ..base_request.clone()
    })
    .expect_err("reject target newline");
    assert!(matches!(target_injected, AppError::InvalidInput(_)));

    let carriage_return = rules::normalize_remote_copy_request(SftpRemoteCopyRequest {
        target_remote_path: "/tmp/a\rrm".to_owned(),
        ..base_request
    })
    .expect_err("reject target carriage return");
    assert!(matches!(carriage_return, AppError::InvalidInput(_)));
}

#[test]
fn remote_copy_request_requires_conflict_policy() {
    let error = serde_json::from_value::<SftpRemoteCopyRequest>(serde_json::json!({
        "sourceHostId": "source-host",
        "sourceRemotePath": "/var/log/app.log",
        "targetHostId": "target-host",
        "targetRemotePath": "/srv/app/app.log",
        "kind": "file",
        "viewScope": null
    }))
    .expect_err("reject remote copy request without conflict policy");

    assert!(error.to_string().contains("conflictPolicy"));
}

#[test]
fn archive_requests_require_conflict_policy() {
    let download_error = serde_json::from_value::<SftpArchiveDownloadRequest>(serde_json::json!({
        "hostId": "source-host",
        "sourceRemotePath": "/var/log",
        "targetLocalPath": "C:/tmp/log.zip",
        "kind": "directory",
        "viewScope": null
    }))
    .expect_err("reject archive download request without conflict policy");
    let upload_error = serde_json::from_value::<SftpArchiveUploadRequest>(serde_json::json!({
        "hostId": "target-host",
        "sourceLocalPath": "C:/tmp/logs",
        "targetRemotePath": "/uploads/logs.zip",
        "kind": "directory",
        "viewScope": null
    }))
    .expect_err("reject archive upload request without conflict policy");

    assert!(download_error.to_string().contains("conflictPolicy"));
    assert!(upload_error.to_string().contains("conflictPolicy"));
}

#[test]
fn shell_single_quote_escapes_remote_path_for_rm_rf() {
    assert_eq!(
        rules::shell_single_quote("/srv/app data"),
        "'/srv/app data'"
    );
    assert_eq!(
        rules::shell_single_quote("/srv/app's data; rm -rf /"),
        "'/srv/app'\\''s data; rm -rf /'"
    );
}

#[test]
fn directory_shell_delete_requires_absolute_non_parent_path() {
    rules::validate_remote_directory_shell_delete_path("/srv/app").expect("absolute path");

    assert!(matches!(
        rules::validate_remote_directory_shell_delete_path("srv/app"),
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(
        rules::validate_remote_directory_shell_delete_path("/"),
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(
        rules::validate_remote_directory_shell_delete_path("/srv/../app"),
        Err(AppError::InvalidInput(_))
    ));
}

#[test]
fn remote_copy_staging_policy_uses_safe_fallback_only_when_needed() {
    let cross_host_file = SftpRemoteCopyRequest {
        source_host_id: "source-host".to_owned(),
        source_remote_path: "/var/log/app.log".to_owned(),
        target_host_id: "target-host".to_owned(),
        target_remote_path: "/srv/app/app.log".to_owned(),
        kind: SftpTransferKind::File,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
        view_scope: None,
    };
    let nested_same_host_directory = SftpRemoteCopyRequest {
        source_host_id: "source-host".to_owned(),
        source_remote_path: "/srv/app".to_owned(),
        target_host_id: "source-host".to_owned(),
        target_remote_path: "/srv/app/copy".to_owned(),
        kind: SftpTransferKind::Directory,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
        view_scope: None,
    };

    assert!(
        !rules::should_stage_remote_copy(&cross_host_file, 2),
        "cross-host copies should stream when source and target slots can be held together"
    );
    assert!(
        rules::should_stage_remote_copy(&cross_host_file, 1),
        "single global transfer slot must keep the old staged path to avoid waiting forever"
    );
    assert!(
        rules::should_stage_remote_copy(&nested_same_host_directory, 2),
        "same-host directory copies into their own subtree must not stream recursively"
    );
}

#[test]
fn zip_local_path_to_file_includes_directory_contents() {
    let source_root = tempdir().expect("source root");
    let target_root = tempdir().expect("target root");
    let source_dir = source_root.path().join("release");
    let nested_dir = source_dir.join("nested");
    std::fs::create_dir_all(&nested_dir).expect("create nested source dir");
    std::fs::write(source_dir.join("README.md"), b"hello archive").expect("write file");
    std::fs::write(nested_dir.join("app.log"), b"nested log").expect("write nested file");
    let target_zip = target_root.path().join("release.zip");

    rules::zip_local_path_to_file(
        &source_dir,
        &target_zip,
        "release",
        SftpTransferKind::Directory,
        rules::new_cancel_flag(false),
    )
    .expect("zip directory");

    let file = StdFile::open(target_zip).expect("open zip");
    let mut archive = zip::ZipArchive::new(file).expect("read zip");
    let mut readme = String::new();
    archive
        .by_name("release/README.md")
        .expect("readme entry")
        .read_to_string(&mut readme)
        .expect("read readme");
    assert_eq!(readme, "hello archive");
    assert!(archive.by_name("release/nested/app.log").is_ok());
}

#[test]
fn classify_clipboard_local_paths_accepts_files_and_directories() {
    let root = tempdir().expect("clipboard local path root");
    let file_path = root.path().join("release.tgz");
    let dir_path = root.path().join("dist");
    std::fs::write(&file_path, b"artifact").expect("write local file");
    std::fs::create_dir(&dir_path).expect("create local directory");

    let paths = rules::classify_clipboard_local_paths(vec![file_path.clone(), dir_path.clone()])
        .expect("classify clipboard local paths");

    assert_eq!(
        paths,
        vec![
            SftpLocalPathInfo {
                path: file_path.to_string_lossy().into_owned(),
                kind: SftpLocalPathKind::File,
            },
            SftpLocalPathInfo {
                path: dir_path.to_string_lossy().into_owned(),
                kind: SftpLocalPathKind::Directory,
            },
        ]
    );
}

#[tokio::test]
async fn host_key_policy_rejects_unknown_key_without_learning() {
    let dir = tempdir().expect("temp known hosts dir");
    let known_hosts_path = dir.path().join("known_hosts");
    let key = keys::parse_public_key_base64(
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
    )
    .expect("parse public key");

    assert!(!rules::check_native_host_key(
        "localhost",
        13265,
        known_hosts_path.clone(),
        false,
        &key
    )
    .await
    .expect("check key"));
    assert!(
        !known_hosts_path.exists(),
        "strict SFTP host key check must not silently learn unknown hosts"
    );
}

#[tokio::test]
async fn host_key_policy_learns_unknown_key_only_when_explicit() {
    let dir = tempdir().expect("temp known hosts dir");
    let known_hosts_path = dir.path().join("known_hosts");
    let key = keys::parse_public_key_base64(
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
    )
    .expect("parse public key");

    assert!(
        rules::check_native_host_key("localhost", 13265, known_hosts_path.clone(), true, &key)
            .await
            .expect("learn key")
    );
    assert!(
        keys::known_hosts::check_known_hosts_path("localhost", 13265, &key, &known_hosts_path)
            .expect("check learned key")
    );
}

#[tokio::test]
async fn host_key_policy_rejects_revoked_key_even_when_explicit_trust_is_requested() {
    use std::io::Write;

    let dir = tempdir().expect("temp known hosts dir");
    let known_hosts_path = dir.path().join("known_hosts");
    let key = keys::parse_public_key_base64(
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
    )
    .expect("parse public key");
    let mut file = std::fs::File::create(&known_hosts_path).expect("create known_hosts");
    writeln!(
        file,
        "@revoked *.internal {}",
        key.to_openssh().expect("encode key")
    )
    .expect("write revoked marker");

    assert!(
        !rules::check_native_host_key("localhost", 13265, known_hosts_path, true, &key)
            .await
            .expect("revoked key must be rejected")
    );
}
