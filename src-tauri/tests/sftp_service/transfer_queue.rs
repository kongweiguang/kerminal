use super::support::{
    create_password_remote_host, loopback::start_loopback_sftp_server, test_state,
};
use kerminal_lib::{
    models::sftp::{
        SftpManagedTransferRequest, SftpRemoteCopyRequest, SftpTransferConflictPolicy,
        SftpTransferDirection, SftpTransferEndpoint, SftpTransferKind, SftpTransferOperation,
        SftpTransferScopeRequest, SftpTransferStatus, SftpTransferSummary,
        SftpTransferTransportMode, SftpTrustHostKeyRequest,
    },
    services::sftp_service::rules,
    state::AppState,
};
use tempfile::tempdir;
use tokio::{
    fs,
    time::{sleep, Duration},
};

#[tokio::test]
async fn enqueue_transfer_tracks_public_progress_and_success() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let remote_payload = b"queued transfer payload";
    fs::create_dir_all(server_root.path().join("var/log"))
        .await
        .expect("seed remote directory");
    fs::write(server_root.path().join("var/log/app.log"), remote_payload)
        .await
        .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "source host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;
    let local_target = client_root.path().join("app.log");

    let summary = state
        .sftp()
        .enqueue_transfer(
            state.paths(),
            SftpManagedTransferRequest {
                host_id: host_id.clone(),
                remote_path: "/var/log/app.log".to_owned(),
                local_path: local_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: Some("scope-a".to_owned()),
            },
        )
        .expect("enqueue transfer");

    assert_eq!(summary.host_id, host_id);
    assert_eq!(summary.status, SftpTransferStatus::Queued);
    assert_eq!(
        summary.conflict_policy,
        Some(SftpTransferConflictPolicy::Overwrite)
    );
    assert_eq!(summary.phase.as_deref(), Some("queued"));

    let completed = wait_for_transfer_success(&state, &summary.id).await;
    assert_eq!(completed.bytes_transferred, remote_payload.len() as u64);
    assert_eq!(
        fs::read(&local_target)
            .await
            .expect("read downloaded transfer target"),
        remote_payload
    );
}

#[tokio::test]
async fn failed_upload_reports_only_confirmed_bytes_and_cleans_empty_partial() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let upload_source = client_root.path().join("upload.bin");
    fs::write(&upload_source, b"server must reject these bytes")
        .await
        .expect("write upload fixture");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "rejecting host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let summary = state
        .sftp()
        .enqueue_transfer(
            state.paths(),
            SftpManagedTransferRequest {
                host_id,
                remote_path: "/reject-write.bin".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: Some("failed-upload".to_owned()),
            },
        )
        .expect("enqueue rejected upload");

    let failed = wait_for_transfer_failure(&state, &summary.id).await;
    assert_eq!(failed.bytes_transferred, 0);
    assert!(failed
        .error
        .as_deref()
        .is_some_and(|error| error.contains("远端文件写入失败")));
    assert!(!server_root
        .path()
        .join("reject-write.bin.kerminal-part")
        .exists());
}

#[tokio::test]
async fn upload_retries_sequentially_when_first_pipelined_write_leaves_empty_partial() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let upload_source = client_root.path().join("upload.bin");
    let payload = b"retry this upload sequentially";
    fs::write(&upload_source, payload)
        .await
        .expect("write upload fixture");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "retry host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let summary = state
        .sftp()
        .enqueue_transfer(
            state.paths(),
            SftpManagedTransferRequest {
                host_id,
                remote_path: "/reject-first-write.bin".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: Some("sequential-retry".to_owned()),
            },
        )
        .expect("enqueue retry upload");

    let completed = wait_for_transfer_success(&state, &summary.id).await;
    assert_eq!(completed.bytes_transferred, payload.len() as u64);
    assert_eq!(
        fs::read(server_root.path().join("reject-first-write.bin"))
            .await
            .expect("read retried upload"),
        payload
    );
    assert!(!server_root
        .path()
        .join("reject-first-write.bin.kerminal-part")
        .exists());
}

#[tokio::test]
async fn remote_copy_task_uses_source_and_target_hosts() {
    let source_root = tempdir().expect("source server root");
    let target_root = tempdir().expect("target server root");
    fs::create_dir_all(source_root.path().join("var/log"))
        .await
        .expect("seed source directory");
    fs::write(
        source_root.path().join("var/log/app.log"),
        b"remote copy payload",
    )
    .await
    .expect("seed source file");
    fs::create_dir_all(target_root.path().join("srv/app"))
        .await
        .expect("seed target parent directory");
    fs::write(
        target_root.path().join("srv/app/app.log.kerminal-part"),
        b"remote ",
    )
    .await
    .expect("seed target partial for remote copy resume");
    let source_server = start_loopback_sftp_server(source_root.path().to_path_buf()).await;
    let target_server = start_loopback_sftp_server(target_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let source_host_id =
        create_password_remote_host(&state, "source host", source_server.addr.port());
    let target_host_id =
        create_password_remote_host(&state, "target host", target_server.addr.port());
    trust_loopback_host(&state, &source_host_id).await;
    trust_loopback_host(&state, &target_host_id).await;

    let summary = state
        .sftp()
        .enqueue_remote_copy(
            state.paths(),
            SftpRemoteCopyRequest {
                source_host_id: source_host_id.clone(),
                source_remote_path: "/var/log/app.log".to_owned(),
                target_host_id: target_host_id.clone(),
                target_remote_path: "/srv/app/app.log".to_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
        )
        .expect("enqueue remote copy");

    assert_eq!(summary.host_id, target_host_id);
    assert_eq!(summary.direction, SftpTransferDirection::Upload);
    assert_eq!(summary.remote_path, "/srv/app/app.log");
    assert_eq!(
        summary.local_path,
        format!("sftp://{source_host_id}/var/log/app.log")
    );
    assert_eq!(summary.operation, SftpTransferOperation::RemoteCopy);
    assert_eq!(
        summary.conflict_policy,
        Some(SftpTransferConflictPolicy::Overwrite)
    );
    assert_eq!(
        summary.transport_mode,
        SftpTransferTransportMode::ClientBridge
    );
    assert_eq!(summary.phase.as_deref(), Some("queued"));
    assert_eq!(
        summary.source,
        SftpTransferEndpoint::Remote {
            host_id: source_host_id,
            host_label: "source host".to_owned(),
            path: "/var/log/app.log".to_owned(),
        }
    );
    assert_eq!(
        summary.target,
        SftpTransferEndpoint::Remote {
            host_id: target_host_id,
            host_label: "target host".to_owned(),
            path: "/srv/app/app.log".to_owned(),
        }
    );

    wait_for_transfer_success(&state, &summary.id).await;
    assert_eq!(
        fs::read_to_string(target_root.path().join("srv/app/app.log"))
            .await
            .expect("read remote copy target"),
        "remote copy payload"
    );
}

#[tokio::test]
async fn staged_remote_copy_removes_temp_dir_on_success() {
    let server_root = tempdir().expect("server root");
    fs::create_dir_all(server_root.path().join("var/nested"))
        .await
        .expect("seed source directory");
    fs::write(
        server_root.path().join("var/nested/app.log"),
        b"staged copy",
    )
    .await
    .expect("seed source file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "same host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let summary = state
        .sftp()
        .enqueue_remote_copy(
            state.paths(),
            SftpRemoteCopyRequest {
                source_host_id: host_id.clone(),
                source_remote_path: "/var".to_owned(),
                target_host_id: host_id,
                target_remote_path: "/var/backup".to_owned(),
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
        )
        .expect("enqueue staged remote copy");

    assert_eq!(
        summary.transport_mode,
        SftpTransferTransportMode::LocalStage
    );
    wait_for_transfer_success(&state, &summary.id).await;

    assert_eq!(
        fs::read_to_string(server_root.path().join("var/backup/nested/app.log"))
            .await
            .expect("read staged copy target"),
        "staged copy"
    );
    assert!(
        !state
            .paths()
            .temp
            .join("sftp-remote-copy")
            .join(&summary.id)
            .exists(),
        "staged remote copy should remove its temporary directory"
    );
}

#[test]
fn transfer_registry_scope_rules_keep_view_histories_isolated() {
    let summaries = [
        transfer_summary(
            "succeeded-a",
            SftpTransferStatus::Succeeded,
            1,
            Some("scope-a"),
        ),
        transfer_summary("queued-a", SftpTransferStatus::Queued, 2, Some("scope-a")),
        transfer_summary(
            "succeeded-b",
            SftpTransferStatus::Succeeded,
            3,
            Some("scope-b"),
        ),
        transfer_summary("running-b", SftpTransferStatus::Running, 4, Some("scope-b")),
    ];
    let scope_a = SftpTransferScopeRequest {
        view_scope: Some("scope-a".to_owned()),
    };
    let scope_b = SftpTransferScopeRequest {
        view_scope: Some("scope-b".to_owned()),
    };

    assert_eq!(
        summaries
            .iter()
            .filter(|summary| rules::transfer_matches_scope(summary, scope_a.view_scope.as_deref()))
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["succeeded-a", "queued-a"]
    );
    assert!(
        !rules::transfer_matches_scope(
            summaries
                .iter()
                .find(|summary| summary.id == "queued-a")
                .expect("queued-a summary"),
            scope_b.view_scope.as_deref(),
        ),
        "a transfer from another view scope must not match"
    );

    assert_eq!(
        summaries
            .iter()
            .filter(|summary| {
                rules::retain_after_clear_completed(summary, scope_a.view_scope.as_deref())
            })
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["queued-a", "succeeded-b", "running-b"]
    );
    assert_eq!(
        summaries
            .iter()
            .filter(|summary| {
                rules::retain_after_clear_completed(summary, scope_b.view_scope.as_deref())
            })
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["succeeded-a", "queued-a", "running-b"]
    );
}

#[test]
fn transfer_registry_retention_prunes_oldest_completed_but_keeps_active_tasks() {
    let now = rules::completed_transfer_retention_seconds() + 10_000;
    let limit = rules::completed_transfer_retention_limit();
    let mut summaries = vec![
        transfer_summary(
            "queued-expired",
            SftpTransferStatus::Queued,
            now - rules::completed_transfer_retention_seconds() - 100,
            None,
        ),
        transfer_summary(
            "running-expired",
            SftpTransferStatus::Running,
            now - rules::completed_transfer_retention_seconds() - 90,
            None,
        ),
        transfer_summary(
            "failed-expired",
            SftpTransferStatus::Failed,
            now - rules::completed_transfer_retention_seconds() - 80,
            None,
        ),
        transfer_summary(
            "canceled-expired",
            SftpTransferStatus::Canceled,
            now - rules::completed_transfer_retention_seconds() - 70,
            None,
        ),
    ];
    for index in 0..(limit + 3) {
        let id = format!("done-{index:03}");
        summaries.push(transfer_summary(
            &id,
            SftpTransferStatus::Succeeded,
            now - (limit as u64) + index as u64,
            None,
        ));
    }

    assert_eq!(
        rules::pruned_completed_transfer_ids(&summaries, now),
        vec![
            "canceled-expired",
            "done-000",
            "done-001",
            "done-002",
            "failed-expired",
        ]
    );
}

async fn trust_loopback_host(state: &AppState, host_id: &str) {
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.to_owned(),
            },
        )
        .await
        .expect("trust loopback host key");
}

async fn wait_for_transfer_success(state: &AppState, transfer_id: &str) -> SftpTransferSummary {
    for _ in 0..100 {
        let tasks = state.sftp().list_transfers().expect("list transfers");
        if let Some(task) = tasks.iter().find(|task| task.id == transfer_id) {
            match task.status {
                SftpTransferStatus::Succeeded => return task.clone(),
                SftpTransferStatus::Failed | SftpTransferStatus::Canceled => {
                    panic!(
                        "transfer {transfer_id} finished as {:?}: {:?}",
                        task.status, task.error
                    );
                }
                SftpTransferStatus::Queued | SftpTransferStatus::Running => {}
            }
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("transfer {transfer_id} did not finish");
}

async fn wait_for_transfer_failure(state: &AppState, transfer_id: &str) -> SftpTransferSummary {
    for _ in 0..100 {
        let tasks = state.sftp().list_transfers().expect("list transfers");
        if let Some(task) = tasks.iter().find(|task| task.id == transfer_id) {
            match task.status {
                SftpTransferStatus::Failed => return task.clone(),
                SftpTransferStatus::Succeeded | SftpTransferStatus::Canceled => {
                    panic!("transfer {transfer_id} finished as {:?}", task.status);
                }
                SftpTransferStatus::Queued | SftpTransferStatus::Running => {}
            }
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("transfer {transfer_id} did not fail");
}

fn transfer_summary(
    id: &str,
    status: SftpTransferStatus,
    created_at: u64,
    view_scope: Option<&str>,
) -> SftpTransferSummary {
    SftpTransferSummary {
        id: id.to_owned(),
        host_id: "host-1".to_owned(),
        view_scope: view_scope.map(str::to_owned),
        remote_path: "/var/log/app.log".to_owned(),
        local_path: "C:/tmp/app.log".to_owned(),
        direction: SftpTransferDirection::Download,
        kind: SftpTransferKind::File,
        conflict_policy: Some(SftpTransferConflictPolicy::Overwrite),
        status,
        bytes_transferred: 0,
        speed_bytes_per_second: 0,
        total_bytes: None,
        error: (status == SftpTransferStatus::Failed)
            .then(|| "failed for registry test".to_owned()),
        cancel_requested: status == SftpTransferStatus::Canceled,
        created_at,
        updated_at: created_at,
        operation: SftpTransferOperation::Download,
        source: SftpTransferEndpoint::Remote {
            host_id: "host-1".to_owned(),
            host_label: "dev".to_owned(),
            path: "/var/log/app.log".to_owned(),
        },
        target: SftpTransferEndpoint::Local {
            path: "C:/tmp/app.log".to_owned(),
        },
        transport_mode: SftpTransferTransportMode::SingleHostSftp,
        phase: Some("queued".to_owned()),
        current_item: None,
    }
}
