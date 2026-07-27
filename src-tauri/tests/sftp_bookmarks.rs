//! SFTP 路径书签持久化与边界测试。
//!
//! @author kongweiguang

use std::{fs, sync::Arc, thread};

use kerminal_lib::{
    models::{
        sftp_bookmark::{
            SftpBookmarkListRequest, SftpBookmarkSetRequest, SFTP_BOOKMARK_LIMIT_PER_TARGET,
        },
        target::{ContainerRuntime, RemoteTargetRef},
    },
    paths::KerminalPaths,
    storage::RuntimeFileStore,
};
use tempfile::TempDir;

#[test]
fn starts_empty_and_persists_normalized_bookmarks_across_store_reopen() {
    let (home, paths, store) = test_store();
    let request = list_request(ssh_target("host-a"));

    assert!(store
        .list_sftp_bookmarks(request.clone())
        .expect("read missing bookmark file")
        .is_empty());

    let saved = store
        .set_sftp_bookmark(set_request(ssh_target("host-a"), "srv//app/", true))
        .expect("save bookmark");
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].path, "/srv/app");

    drop(store);
    let reopened = RuntimeFileStore::open(&paths).expect("reopen runtime storage");
    assert_eq!(
        reopened
            .list_sftp_bookmarks(request)
            .expect("read persisted bookmarks")
            .iter()
            .map(|bookmark| bookmark.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/srv/app"]
    );
    let persisted = fs::read_to_string(paths.root.join("data/sftp-bookmarks.json"))
        .expect("read persisted bookmark document");
    assert!(persisted.contains("\"schemaVersion\": 1"));
    assert!(persisted.contains("\"path\": \"/srv/app\""));
    drop(home);
}

#[test]
fn isolates_ssh_and_container_bookmarks_by_stable_target_identity() {
    let (_home, _paths, store) = test_store();
    let ssh = ssh_target("host-a");
    let docker = container_target("host-a", "container-a", ContainerRuntime::Docker);
    let podman = container_target("host-a", "container-a", ContainerRuntime::Podman);

    store
        .set_sftp_bookmark(set_request(ssh.clone(), "/srv/ssh", true))
        .expect("save ssh bookmark");
    store
        .set_sftp_bookmark(set_request(docker.clone(), "/srv/docker", true))
        .expect("save docker bookmark");
    store
        .set_sftp_bookmark(set_request(podman.clone(), "/srv/podman", true))
        .expect("save podman bookmark");

    assert_eq!(paths_for(&store, ssh), vec!["/srv/ssh"]);
    assert_eq!(paths_for(&store, docker), vec!["/srv/docker"]);
    assert_eq!(paths_for(&store, podman), vec!["/srv/podman"]);
}

#[test]
fn duplicate_add_is_idempotent_and_removal_only_affects_matching_path() {
    let (_home, _paths, store) = test_store();
    let target = ssh_target("host-a");

    let first = store
        .set_sftp_bookmark(set_request(target.clone(), "/srv/app", true))
        .expect("save first bookmark");
    let repeated = store
        .set_sftp_bookmark(set_request(target.clone(), "/srv/app/", true))
        .expect("repeat bookmark");
    assert_eq!(repeated, first);

    store
        .set_sftp_bookmark(set_request(target.clone(), "/srv/logs", true))
        .expect("save second bookmark");
    let after_remove = store
        .set_sftp_bookmark(set_request(target.clone(), "/srv/app", false))
        .expect("remove bookmark");
    assert_eq!(
        after_remove
            .iter()
            .map(|bookmark| bookmark.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/srv/logs"]
    );
}

#[test]
fn enforces_limits_and_rejects_non_file_targets_or_invalid_paths() {
    let (_home, _paths, store) = test_store();
    let target = ssh_target("host-a");

    for index in 0..SFTP_BOOKMARK_LIMIT_PER_TARGET {
        store
            .set_sftp_bookmark(set_request(
                target.clone(),
                &format!("/bookmarks/{index}"),
                true,
            ))
            .expect("save within bookmark limit");
    }
    let overflow = store
        .set_sftp_bookmark(set_request(target.clone(), "/bookmarks/overflow", true))
        .expect_err("reject per-target bookmark overflow");
    assert!(overflow.to_string().contains("最多保存"));

    let telnet = RemoteTargetRef::Telnet {
        host_id: "host-a".to_owned(),
    };
    assert!(store
        .list_sftp_bookmarks(list_request(telnet))
        .expect_err("reject telnet target")
        .to_string()
        .contains("仅支持"));
    assert!(store
        .set_sftp_bookmark(set_request(target, "/contains\nnewline", true))
        .expect_err("reject control characters")
        .to_string()
        .contains("控制字符"));
}

#[test]
fn corrupt_or_future_documents_are_preserved_and_never_overwritten() {
    let (_home, paths, store) = test_store();
    let path = paths.root.join("data/sftp-bookmarks.json");
    let malformed = "{not-json";
    fs::write(&path, malformed).expect("write malformed state");

    assert!(store
        .list_sftp_bookmarks(list_request(ssh_target("host-a")))
        .expect_err("reject malformed document")
        .to_string()
        .contains("格式无效"));
    assert_eq!(
        fs::read_to_string(&path).expect("read malformed state"),
        malformed
    );

    let future = r#"{"schemaVersion":2,"bookmarks":[]}"#;
    fs::write(&path, future).expect("write future schema");
    assert!(store
        .set_sftp_bookmark(set_request(ssh_target("host-a"), "/srv/app", true))
        .expect_err("reject future document")
        .to_string()
        .contains("版本不受当前应用支持"));
    assert_eq!(
        fs::read_to_string(&path).expect("read future state"),
        future
    );
}

#[test]
fn serializes_concurrent_bookmark_updates_without_losing_paths() {
    let (_home, _paths, store) = test_store();
    let store = Arc::new(store);
    let handles = (0..16)
        .map(|index| {
            let store = Arc::clone(&store);
            thread::spawn(move || {
                store.set_sftp_bookmark(set_request(
                    ssh_target("host-a"),
                    &format!("/parallel/{index}"),
                    true,
                ))
            })
        })
        .collect::<Vec<_>>();

    for handle in handles {
        handle
            .join()
            .expect("join bookmark update")
            .expect("save concurrent bookmark");
    }
    assert_eq!(paths_for(&store, ssh_target("host-a")).len(), 16);
}

fn test_store() -> (TempDir, KerminalPaths, RuntimeFileStore) {
    let home = tempfile::tempdir().expect("create temporary home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let store = RuntimeFileStore::open(&paths).expect("open runtime storage");
    (home, paths, store)
}

fn ssh_target(host_id: &str) -> RemoteTargetRef {
    RemoteTargetRef::Ssh {
        host_id: host_id.to_owned(),
    }
}

fn container_target(
    host_id: &str,
    container_id: &str,
    runtime: ContainerRuntime,
) -> RemoteTargetRef {
    RemoteTargetRef::DockerContainer {
        container_id: container_id.to_owned(),
        container_name: None,
        host_id: host_id.to_owned(),
        runtime,
        user: None,
        workdir: None,
    }
}

fn list_request(target: RemoteTargetRef) -> SftpBookmarkListRequest {
    SftpBookmarkListRequest { target }
}

fn set_request(target: RemoteTargetRef, path: &str, bookmarked: bool) -> SftpBookmarkSetRequest {
    SftpBookmarkSetRequest {
        bookmarked,
        path: path.to_owned(),
        target,
    }
}

fn paths_for(store: &RuntimeFileStore, target: RemoteTargetRef) -> Vec<String> {
    store
        .list_sftp_bookmarks(list_request(target))
        .expect("list target bookmarks")
        .into_iter()
        .map(|bookmark| bookmark.path)
        .collect()
}
