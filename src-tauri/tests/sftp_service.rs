//! SFTP 文件工具服务集成测试。
//!
//! @author kongweiguang

#[path = "sftp_service/archive_clipboard.rs"]
mod archive_clipboard;
#[path = "sftp_service/managed_runtime.rs"]
mod managed_runtime;
#[path = "sftp_service/native_backend.rs"]
mod native_backend;
#[path = "sftp_service/native_jump_backend.rs"]
mod native_jump_backend;
#[path = "sftp_service/support/mod.rs"]
mod support;
#[path = "sftp_service/transfer_queue.rs"]
mod transfer_queue;
#[path = "sftp_service/validation.rs"]
mod validation;

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest},
        settings::SftpPerformanceSettings,
        sftp::{
            SftpClassifyLocalPathsRequest, SftpClipboardDownloadRequest, SftpListDirectoryRequest,
            SftpLocalPathKind, SftpPreviewRequest, SftpTransferConflictPolicy,
            SftpTransferEndpoint, SftpTransferKind,
        },
    },
    paths::KerminalPaths,
    services::sftp_service::rules,
    state::AppState,
};
use russh_sftp::protocol::StatusCode;
use std::fs;
use tempfile::{tempdir, TempDir};
use tokio::{fs as async_fs, io::AsyncWriteExt};

#[tokio::test]
async fn list_directory_rejects_unknown_remote_host_before_connecting_sftp() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: "missing-host".to_owned(),
                path: "/var/log".to_owned(),
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[tokio::test]
async fn list_directory_missing_external_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: "external:missing-launch".to_owned(),
                path: "/var/log".to_owned(),
            },
        )
        .await
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}

#[tokio::test]
async fn preview_file_rejects_unknown_remote_host_before_connecting_sftp() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .preview_file(
            state.paths(),
            SftpPreviewRequest {
                host_id: "missing-host".to_owned(),
                max_bytes: Some(4096),
                path: "/var/log/app.log".to_owned(),
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
    assert!(!state.paths().temp.join("sftp-preview").exists());
}

#[tokio::test]
async fn preview_file_rejects_root_path_before_connecting_sftp() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state);

    let error = state
        .sftp()
        .preview_file(
            state.paths(),
            SftpPreviewRequest {
                host_id,
                max_bytes: Some(4096),
                path: "/".to_owned(),
            },
        )
        .await
        .expect_err("reject root path");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("远程根目录")));
    assert!(!state.paths().temp.join("sftp-preview").exists());
}

#[test]
fn classify_local_paths_accepts_files_and_directories() {
    let (_home, state) = test_state();
    let local_root = tempdir().expect("create local root");
    let file_path = local_root.path().join("release.tgz");
    let directory_path = local_root.path().join("dist");
    fs::write(&file_path, b"artifact").expect("write file");
    fs::create_dir(&directory_path).expect("create directory");

    let paths = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest {
            paths: vec![
                file_path.to_string_lossy().into_owned(),
                directory_path.to_string_lossy().into_owned(),
            ],
        })
        .expect("classify local paths");

    assert_eq!(paths.len(), 2);
    assert_eq!(paths[0].kind, SftpLocalPathKind::File);
    assert_eq!(paths[1].kind, SftpLocalPathKind::Directory);
}

#[test]
fn classify_local_paths_rejects_empty_requests() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest { paths: vec![] })
        .expect_err("reject empty request");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("至少提供")));
}

#[test]
fn classify_local_paths_rejects_missing_paths() {
    let (_home, state) = test_state();
    let local_root = tempdir().expect("create local root");
    let missing_path = local_root.path().join("missing.log");

    let error = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest {
            paths: vec![missing_path.to_string_lossy().into_owned()],
        })
        .expect_err("reject missing path");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message.contains("无法读取本地路径"))
    );
}

#[test]
#[cfg(windows)]
fn system_file_clipboard_supports_native_file_list_on_windows() {
    assert!(rules::system_file_clipboard_supports_native_file_list());
    rules::ensure_local_file_clipboard_supported().expect("windows supports file list clipboard");
}

#[test]
#[cfg(not(windows))]
fn system_file_clipboard_degrades_to_internal_clipboard_off_windows() {
    assert!(!rules::system_file_clipboard_supports_native_file_list());

    let error = rules::ensure_local_file_clipboard_supported()
        .expect_err("non-windows file list clipboard is not implemented yet");
    assert!(
        matches!(error, AppError::Sftp(message) if message.contains("Kerminal SFTP 内部复制/粘贴"))
    );
}

#[test]
#[cfg(not(windows))]
fn reading_system_file_clipboard_reports_explicit_degradation_off_windows() {
    let error = rules::read_local_file_clipboard()
        .expect_err("non-windows read should not masquerade as an empty clipboard");

    assert!(
        matches!(error, AppError::Sftp(message) if message.contains("当前平台暂不支持读取系统文件剪贴板"))
    );
}

#[test]
fn transfer_endpoint_serializes_remote_fields_as_camel_case() {
    let endpoint = SftpTransferEndpoint::Remote {
        host_id: "source-host".to_owned(),
        host_label: "dev".to_owned(),
        path: "/bwy/app/abc/.codex/jdk-21.0.2".to_owned(),
    };

    assert_eq!(
        serde_json::to_value(endpoint).expect("serialize transfer endpoint"),
        serde_json::json!({
            "kind": "remote",
            "hostId": "source-host",
            "hostLabel": "dev",
            "path": "/bwy/app/abc/.codex/jdk-21.0.2"
        })
    );
}

#[test]
fn clipboard_download_target_uses_unique_download_name() {
    let target_root = tempdir().expect("clipboard download target root");
    fs::write(target_root.path().join("app.log"), b"existing").expect("write first collision");
    fs::write(target_root.path().join("app (2).log"), b"existing").expect("write second collision");

    let target_path = rules::reserve_clipboard_download_target_path_in(
        target_root.path(),
        &SftpClipboardDownloadRequest {
            host_id: "source-host".to_owned(),
            source_remote_path: "/var/log/app.log".to_owned(),
            kind: SftpTransferKind::File,
            view_scope: None,
        },
    )
    .expect("reserve clipboard target");

    assert_eq!(target_path, target_root.path().join("app (3).log"));
    assert!(target_path.exists());
}

#[test]
fn clipboard_download_target_reservation_prevents_same_name_collision() {
    let target_root = tempdir().expect("clipboard download target root");
    let request = SftpClipboardDownloadRequest {
        host_id: "source-host".to_owned(),
        source_remote_path: "/var/log/app.log".to_owned(),
        kind: SftpTransferKind::File,
        view_scope: None,
    };

    let first_target =
        rules::reserve_clipboard_download_target_path_in(target_root.path(), &request)
            .expect("reserve first target");
    let second_target =
        rules::reserve_clipboard_download_target_path_in(target_root.path(), &request)
            .expect("reserve second target");

    assert_eq!(first_target, target_root.path().join("app.log"));
    assert_eq!(second_target, target_root.path().join("app (2).log"));
}

#[test]
fn clipboard_download_target_sanitizes_remote_file_name() {
    let target_root = tempdir().expect("clipboard download target root");

    let target_path = rules::reserve_clipboard_download_target_path_in(
        target_root.path(),
        &SftpClipboardDownloadRequest {
            host_id: "source-host".to_owned(),
            source_remote_path: "/tmp/..".to_owned(),
            kind: SftpTransferKind::Directory,
            view_scope: None,
        },
    )
    .expect("reserve sanitized clipboard target");

    assert_eq!(target_path, target_root.path().join("remote-directory"));
    assert!(target_path.is_dir());
}

#[test]
fn normalized_sftp_runtime_settings_preserve_user_performance_profile() {
    let settings = SftpPerformanceSettings {
        global_transfers: 4,
        host_transfers: 2,
        packet_bytes: 256 * 1024,
        pipeline_depth: 64,
        timeout_seconds: 30,
    };

    assert_eq!(
        rules::normalized_sftp_runtime_settings(settings),
        (2, 64, 256 * 1024, 30)
    );
}

#[test]
fn external_bulk_transfer_runtime_settings_use_bastion_safe_profile() {
    let settings = SftpPerformanceSettings {
        global_transfers: 4,
        host_transfers: 2,
        packet_bytes: 256 * 1024,
        pipeline_depth: 64,
        timeout_seconds: 30,
    };

    assert_eq!(
        rules::external_bulk_transfer_runtime_settings(settings),
        (1, 8, 64 * 1024, 180)
    );
}

#[test]
fn numbered_candidate_name_preserves_file_extension() {
    assert_eq!(
        rules::numbered_candidate_name("report.txt", 1),
        "report (1).txt"
    );
    assert_eq!(rules::numbered_candidate_name("archive", 2), "archive (2)");
    assert_eq!(rules::numbered_candidate_name(".env", 3), ".env (3)");
}

#[test]
fn reliable_partial_target_paths_append_kerminal_part_suffix() {
    let root = tempdir().expect("tempdir");
    let local_target = root.path().join("release.tar.gz");

    assert_eq!(
        rules::reliable_partial_file_name("release.tar.gz"),
        "release.tar.gz.kerminal-part"
    );
    assert_eq!(
        rules::reliable_local_partial_path(&local_target),
        root.path().join("release.tar.gz.kerminal-part")
    );
    assert_eq!(
        rules::reliable_remote_partial_path("/opt/releases/release.tar.gz"),
        "/opt/releases/release.tar.gz.kerminal-part"
    );
    assert_eq!(
        rules::reliable_remote_partial_path("/release.tar.gz"),
        "/release.tar.gz.kerminal-part"
    );
}

#[test]
fn reliable_write_decision_uses_partial_size_for_resume_boundaries() {
    assert_eq!(
        rules::reliable_write_decision(SftpTransferConflictPolicy::Overwrite, false, 100, None),
        ("fresh", None)
    );
    assert_eq!(
        rules::reliable_write_decision(SftpTransferConflictPolicy::Overwrite, false, 100, Some(40)),
        ("resume", Some(40))
    );
    assert_eq!(
        rules::reliable_write_decision(
            SftpTransferConflictPolicy::Overwrite,
            false,
            100,
            Some(100),
        ),
        ("commit-existing-partial", None)
    );
    assert_eq!(
        rules::reliable_write_decision(
            SftpTransferConflictPolicy::Overwrite,
            false,
            100,
            Some(120),
        ),
        ("restart-partial", None)
    );
}

#[test]
fn reliable_write_decision_preserves_conflict_policy_before_partial_resume() {
    assert_eq!(
        rules::reliable_write_decision(SftpTransferConflictPolicy::Skip, true, 100, Some(40)),
        ("skip-existing-final", None)
    );
    assert_eq!(
        rules::reliable_write_decision(SftpTransferConflictPolicy::Rename, true, 100, Some(40)),
        ("choose-renamed-final", None)
    );
    assert_eq!(
        rules::reliable_write_decision(SftpTransferConflictPolicy::Overwrite, true, 100, Some(40)),
        ("resume", Some(40))
    );
}

#[test]
fn reliable_write_size_confirmation_requires_exact_size_match() {
    assert!(rules::reliable_size_confirmed(4096, 4096));
    assert!(!rules::reliable_size_confirmed(4096, 2048));
    assert!(!rules::reliable_size_confirmed(4096, 8192));
}

#[test]
fn sftp_already_exists_classification_requires_clear_exists_status_message() {
    assert!(!rules::sftp_status_error_is_already_exists(
        StatusCode::Failure,
        "Failure"
    ));
    assert!(!rules::sftp_status_error_is_already_exists(
        StatusCode::Failure,
        "quota exceeded"
    ));
    assert!(!rules::sftp_status_error_is_already_exists(
        StatusCode::PermissionDenied,
        "Permission denied"
    ));
    assert!(rules::sftp_status_error_is_already_exists(
        StatusCode::Failure,
        "File exists"
    ));
    assert!(rules::sftp_status_error_is_already_exists(
        StatusCode::Failure,
        "already exists"
    ));
}

#[tokio::test]
async fn local_reliable_write_target_keeps_final_until_size_verified_commit() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("download.txt");
    async_fs::write(&target, b"original")
        .await
        .expect("seed final target");

    let (final_path, partial_path, offset, mut file) = rules::prepare_local_reliable_write_target(
        &target,
        SftpTransferConflictPolicy::Overwrite,
        10,
    )
    .await
    .expect("prepare reliable target")
    .expect("prepared target");
    assert_eq!(offset, 0);
    file.write_all(b"downloaded").await.expect("write partial");
    file.flush().await.expect("flush partial");
    drop(file);

    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read final before commit"),
        "original"
    );
    assert_eq!(
        async_fs::read_to_string(&partial_path)
            .await
            .expect("read partial before commit"),
        "downloaded"
    );

    rules::commit_local_reliable_write_target(&final_path, &partial_path, 10)
        .await
        .expect("commit reliable target");

    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read final after commit"),
        "downloaded"
    );
    assert!(
        !partial_path.exists(),
        "successful commit should remove the partial path by renaming it"
    );
}

#[tokio::test]
async fn local_reliable_write_target_size_mismatch_preserves_final_and_partial() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("download.txt");
    async_fs::write(&target, b"original")
        .await
        .expect("seed final target");

    let (final_path, partial_path, offset, mut file) = rules::prepare_local_reliable_write_target(
        &target,
        SftpTransferConflictPolicy::Overwrite,
        10,
    )
    .await
    .expect("prepare reliable target")
    .expect("prepared target");
    assert_eq!(offset, 0);
    file.write_all(b"short").await.expect("write partial");
    file.flush().await.expect("flush partial");
    drop(file);

    let error = rules::commit_local_reliable_write_target(&final_path, &partial_path, 10)
        .await
        .expect_err("reject mismatched size");

    assert!(
        error.to_string().contains("size"),
        "error should explain size confirmation failure: {error}"
    );
    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read final after failed commit"),
        "original"
    );
    assert_eq!(
        async_fs::read_to_string(&partial_path)
            .await
            .expect("read partial after failed commit"),
        "short"
    );
}

#[tokio::test]
async fn local_reliable_write_target_resumes_existing_partial() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("download.txt");
    let partial = root.path().join("download.txt.kerminal-part");
    async_fs::write(&target, b"original")
        .await
        .expect("seed final target");
    async_fs::write(&partial, b"down")
        .await
        .expect("seed partial target");

    let (final_path, partial_path, offset, mut file) = rules::prepare_local_reliable_write_target(
        &target,
        SftpTransferConflictPolicy::Overwrite,
        10,
    )
    .await
    .expect("prepare reliable target")
    .expect("prepared target");

    assert_eq!(partial_path, partial);
    assert_eq!(offset, 4);
    file.write_all(b"loaded").await.expect("append partial");
    file.flush().await.expect("flush partial");
    drop(file);

    rules::commit_local_reliable_write_target(&final_path, &partial_path, 10)
        .await
        .expect("commit resumed target");

    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read final after resumed commit"),
        "downloaded"
    );
    assert!(
        !partial_path.exists(),
        "successful resumed commit should remove partial"
    );
}

#[tokio::test]
async fn open_local_write_target_skip_keeps_existing_file() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("existing.txt");
    async_fs::write(&target, b"original")
        .await
        .expect("seed target");

    let file = rules::open_local_write_target(&target, SftpTransferConflictPolicy::Skip, 8)
        .await
        .expect("open target");

    assert!(file.is_none());
    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read target"),
        "original"
    );
}

#[tokio::test]
async fn open_local_write_target_rename_creates_numbered_candidate() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("report.txt");
    let renamed = root.path().join("report (1).txt");
    async_fs::write(&target, b"original")
        .await
        .expect("seed target");

    let mut file = rules::open_local_write_target(&target, SftpTransferConflictPolicy::Rename, 8)
        .await
        .expect("open renamed target")
        .expect("renamed file");
    file.write_all(b"new").await.expect("write renamed target");
    file.flush().await.expect("flush renamed target");

    assert_eq!(
        async_fs::read_to_string(&target)
            .await
            .expect("read target"),
        "original"
    );
    assert_eq!(
        async_fs::read_to_string(&renamed)
            .await
            .expect("read renamed"),
        "new"
    );
}

#[tokio::test]
async fn prepare_local_directory_root_skip_keeps_existing_tree() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("release");
    async_fs::create_dir_all(target.join("nested"))
        .await
        .expect("seed target directory");
    async_fs::write(target.join("nested/existing.txt"), b"original")
        .await
        .expect("seed existing child");

    let prepared = rules::prepare_local_directory_root(&target, SftpTransferConflictPolicy::Skip)
        .await
        .expect("prepare target");

    assert!(prepared.is_none());
    assert_eq!(
        async_fs::read_to_string(target.join("nested/existing.txt"))
            .await
            .expect("read existing child"),
        "original"
    );
}

#[tokio::test]
async fn prepare_local_directory_root_rename_creates_numbered_directory() {
    let root = tempdir().expect("tempdir");
    let target = root.path().join("release");
    let renamed = root.path().join("release (1)");
    async_fs::create_dir_all(&target)
        .await
        .expect("seed target directory");

    let prepared = rules::prepare_local_directory_root(&target, SftpTransferConflictPolicy::Rename)
        .await
        .expect("prepare renamed target")
        .expect("renamed target");

    assert_eq!(prepared, renamed);
    assert!(target.is_dir());
    assert!(prepared.is_dir());
}

fn create_test_remote_host(state: &AppState) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create test host")
        .id
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
