use std::{
    sync::{atomic::Ordering, mpsc, Arc},
    time::Duration,
};

#[path = "../support/managed_ssh_runtime.rs"]
mod managed_ssh_runtime_support;

use super::support::{
    create_password_remote_host_without_credentials,
    loopback::{
        start_loopback_sftp_server, start_loopback_sftp_server_on_port_with_private_key,
        LOOPBACK_SFTP_SHELL_READY_MARKER,
    },
    test_state,
};
use kerminal_lib::{
    models::{
        sftp::{
            SftpDeleteRequest, SftpEntryKind, SftpListDirectoryRequest, SftpTransferConflictPolicy,
            SftpTransferRequest, SftpTrustHostKeyRequest,
        },
        terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    services::{
        external_launch::{
            external_target_id, ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint,
        },
        sftp_service::SftpService,
        ssh_runtime::{
            auth_broker::SshSessionSecretInput, native_backend::NativeSshRuntimeBackend,
            ManagedSshSessionManager, SshAuthSecretKind, SshChannelKind,
            MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
        },
    },
    state::AppState,
};
use managed_ssh_runtime_support::FakeManagedSshRuntime;
use tempfile::tempdir;
use tokio::{fs, runtime::Runtime};

#[test]
fn ssh_terminal_and_sftp_share_one_session_only_managed_transport() {
    let runtime = Runtime::new().expect("create test runtime");
    let server_root = tempdir().expect("server root");
    runtime.block_on(async {
        fs::write(server_root.path().join("shared-session.txt"), b"runtime")
            .await
            .expect("seed remote file");
    });
    let server = runtime.block_on(start_loopback_sftp_server(server_root.path().to_path_buf()));
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    runtime
        .block_on(state.sftp().trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        ))
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("open managed SSH terminal with session-only secret");

    let output = collect_terminal_output_until(&receiver, LOOPBACK_SFTP_SHELL_READY_MARKER);
    assert!(output.contains(LOOPBACK_SFTP_SHELL_READY_MARKER));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "terminal shell should authenticate exactly once"
    );

    let listing = runtime
        .block_on(state.sftp().list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id,
                path: "/".to_owned(),
            },
        ))
        .expect("list through the same managed SSH session after terminal login");
    assert!(listing
        .entries
        .iter()
        .any(|entry| { entry.name == "shared-session.txt" && entry.kind == SftpEntryKind::File }));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        2,
        "browser SFTP should use an isolated capability transport instead of the terminal lane"
    );

    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.sessions.len(), 2);
    assert_eq!(
        snapshot.active_channels, 2,
        "terminal shell and retained browser SFTP channel should both be active on separate lanes"
    );
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive terminal lane");
    let browser = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("browser capability lane");
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(interactive.channel_counts.get(&SshChannelKind::Sftp), None);
    assert_eq!(browser.channel_counts.get(&SshChannelKind::Sftp), Some(&1));
    let debug = format!("{snapshot:?}");
    assert!(!debug.contains("secret"));

    state
        .terminals()
        .close(&summary.id)
        .expect("close terminal shell");
}

#[test]
fn external_launch_clients_terminal_and_sftp_share_interactive_transport() {
    let runtime = Runtime::new().expect("create test runtime");
    for client in ExternalClientFixture::all() {
        let server_root = tempdir().expect("server root");
        runtime.block_on(async {
            fs::write(server_root.path().join("external-session.txt"), b"runtime")
                .await
                .expect("seed remote file");
            fs::create_dir_all(server_root.path().join("external-dir/nested"))
                .await
                .expect("seed external directory");
            fs::write(
                server_root.path().join("external-dir/nested/app.log"),
                b"delete through external managed exec",
            )
            .await
            .expect("seed external nested file");
        });
        let server = runtime.block_on(start_loopback_sftp_server(server_root.path().to_path_buf()));
        let (_home, state) = test_state();
        let trust_host_id = create_password_remote_host_without_credentials(
            &state,
            &format!("loopback-trust-{}", client.label()),
            server.addr.port(),
        );
        runtime
            .block_on(state.sftp().trust_host_key(
                state.paths(),
                SftpTrustHostKeyRequest {
                    host_id: trust_host_id,
                },
            ))
            .expect("trust loopback host key");

        let launch_id =
            queue_external_client_loopback_password_launch(&state, client, server.addr.port());
        let pending = state
            .external_launch_intake()
            .take_pending()
            .expect("take pending external launch");
        assert_eq!(pending.len(), 1, "{}", client.label());
        assert_eq!(pending[0].id, launch_id, "{}", client.label());
        assert_eq!(
            pending[0].source.tool,
            client.source_tool(),
            "{}",
            client.label()
        );
        let target = state
            .external_session_materializer()
            .materialize(state.paths(), &launch_id, None)
            .expect("materialize external launch");
        state
            .external_launch_intake()
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("ack external launch secret");
        assert_eq!(target.host_id, external_target_id(&launch_id));

        let (sender, receiver) = mpsc::channel();
        let summary = state
            .ssh_terminals()
            .create_session(
                state.remote_hosts(),
                state.paths(),
                state.terminals(),
                SshTerminalCreateRequest {
                    host_id: target.host_id.clone(),
                    cwd: None,
                    remote_command: None,
                    cols: 96,
                    rows: 28,
                },
                move |event| sender.send(event).is_ok(),
            )
            .unwrap_or_else(|error| {
                panic!(
                    "{} should open managed SSH terminal for materialized external target: {error}",
                    client.label()
                )
            });

        let output = collect_terminal_output_until(&receiver, LOOPBACK_SFTP_SHELL_READY_MARKER);
        assert!(
            output.contains(LOOPBACK_SFTP_SHELL_READY_MARKER),
            "{}",
            client.label()
        );
        assert_eq!(
            server.auth_successes.load(Ordering::SeqCst),
            1,
            "{} terminal should authenticate exactly once",
            client.label()
        );

        let listing = runtime
            .block_on(state.sftp().list_directory(
                state.paths(),
                SftpListDirectoryRequest {
                    host_id: target.host_id.clone(),
                    path: "/".to_owned(),
                },
            ))
            .unwrap_or_else(|error| {
                panic!(
                    "{} should list external target through the terminal managed SSH transport: {error}",
                    client.label()
                )
            });
        assert!(
            listing.entries.iter().any(|entry| {
                entry.name == "external-session.txt" && entry.kind == SftpEntryKind::File
            }),
            "{}",
            client.label()
        );
        let second_listing = runtime
            .block_on(state.sftp().list_directory(
                state.paths(),
                SftpListDirectoryRequest {
                    host_id: target.host_id.clone(),
                    path: "/".to_owned(),
                },
            ))
            .expect("repeat external directory listing should reuse the guarded browser lane");
        assert_eq!(
            second_listing.entries,
            listing.entries,
            "{}",
            client.label()
        );
        assert_eq!(
            server.auth_successes.load(Ordering::SeqCst),
            2,
            "{} SFTP browsing should use an isolated capability transport",
            client.label()
        );
        runtime
            .block_on(state.sftp().delete(
                state.paths(),
                SftpDeleteRequest {
                    host_id: target.host_id.clone(),
                    path: "/external-dir".to_owned(),
                    directory: true,
                },
            ))
            .expect("delete external directory through the terminal managed SSH transport");
        assert!(
            !server_root.path().join("external-dir").exists(),
            "{} external managed exec helper should remove the remote directory",
            client.label()
        );
        let after_delete_listing = runtime
            .block_on(state.sftp().list_directory(
                state.paths(),
                SftpListDirectoryRequest {
                    host_id: target.host_id.clone(),
                    path: "/".to_owned(),
                },
            ))
            .expect("listing after external delete should bypass stale cache");
        assert!(
            !after_delete_listing
                .entries
                .iter()
                .any(|entry| entry.name == "external-dir"),
            "{} external mutation should invalidate the cached parent directory",
            client.label()
        );
        assert_eq!(
            server.auth_successes.load(Ordering::SeqCst),
            2,
            "{} external SFTP directory helper should stay on the browser capability transport",
            client.label()
        );

        let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
        assert_eq!(snapshot.sessions.len(), 2, "{}", client.label());
        assert_eq!(
            snapshot.active_channels,
            2,
            "{} terminal shell and retained browser SFTP channel should both be active on separate lanes",
            client.label()
        );
        assert!(
            snapshot.recent_legacy_fallbacks.is_empty(),
            "{}",
            client.label()
        );
        let interactive = snapshot
            .sessions
            .iter()
            .find(|session| session.key.runtime_flags.is_empty())
            .expect("external terminal interactive lane");
        assert_eq!(
            interactive.channel_counts.get(&SshChannelKind::Shell),
            Some(&1),
            "{}",
            client.label()
        );
        assert_eq!(
            interactive.channel_counts.get(&SshChannelKind::Exec),
            None,
            "{} external SFTP helper exec should not use the interactive transport",
            client.label()
        );
        assert_eq!(
            interactive.channel_counts.get(&SshChannelKind::Sftp),
            None,
            "{}",
            client.label()
        );
        let browser = snapshot
            .sessions
            .iter()
            .find(|session| {
                session
                    .key
                    .runtime_flags
                    .iter()
                    .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
            })
            .expect("external browser capability lane");
        assert_eq!(
            browser.channel_counts.get(&SshChannelKind::Sftp),
            Some(&1),
            "{}",
            client.label()
        );
        assert_eq!(
            browser.channel_counts.get(&SshChannelKind::Exec),
            Some(&1),
            "{} external SFTP helper exec should share the browser capability transport",
            client.label()
        );
        let debug = format!("{snapshot:?}");
        assert!(!debug.contains("secret"), "{}", client.label());
        assert!(
            !format!("{target:?}").contains("external-secret:"),
            "{}",
            client.label()
        );

        state
            .terminals()
            .close(&summary.id)
            .expect("close external terminal shell");
    }
}

#[test]
fn external_browser_transport_reconnects_after_retained_sftp_channel_breaks() {
    let runtime = Runtime::new().expect("create test runtime");
    let first_root = tempdir().expect("first server root");
    runtime.block_on(async {
        fs::write(first_root.path().join("before.txt"), b"before")
            .await
            .expect("seed first server file");
    });
    let first_server =
        runtime.block_on(start_loopback_sftp_server(first_root.path().to_path_buf()));
    let port = first_server.addr.port();
    let (_home, state) = test_state();
    let launch_id = queue_putty_loopback_password_launch(&state, port);
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending external launch");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, launch_id);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    runtime
        .block_on(state.sftp().trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: target.host_id.clone(),
            },
        ))
        .expect("explicitly trust external loopback host key");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");

    let first_listing = runtime
        .block_on(state.sftp().list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target.host_id.clone(),
                path: "/".to_owned(),
            },
        ))
        .expect("first list should open retained browser SFTP transport");
    assert!(first_listing
        .entries
        .iter()
        .any(|entry| entry.name == "before.txt"));
    assert_eq!(first_server.auth_successes.load(Ordering::SeqCst), 1);
    let restart_private_key = first_server.clone_private_key_for_restart();
    drop(first_server);

    let second_root = tempdir().expect("second server root");
    runtime.block_on(async {
        fs::create_dir_all(second_root.path().join("after"))
            .await
            .expect("seed second server directory");
        fs::write(second_root.path().join("after/reconnected.txt"), b"after")
            .await
            .expect("seed second server file");
    });
    let second_server = runtime.block_on(start_loopback_sftp_server_on_port_with_private_key(
        second_root.path().to_path_buf(),
        port,
        restart_private_key,
    ));

    let second_listing = runtime
        .block_on(state.sftp().list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target.host_id.clone(),
                path: "/after".to_owned(),
            },
        ))
        .expect("second list should rebuild browser SFTP transport after channel break");
    assert!(second_listing
        .entries
        .iter()
        .any(|entry| entry.name == "reconnected.txt"));
    assert_eq!(
        second_server.auth_successes.load(Ordering::SeqCst),
        1,
        "reconnect should authenticate once against restarted loopback server"
    );
    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    let browser = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("external browser capability lane");
    assert_eq!(
        browser.channel_counts.get(&SshChannelKind::Sftp),
        Some(&2),
        "broken retained SFTP channel should be dropped and rebuilt once"
    );
}

#[test]
fn external_launch_sftp_directory_listing_falls_back_to_managed_exec() {
    let runtime = Runtime::new().expect("create test runtime");
    let (_home, state) = test_state();
    let launch_id = queue_putty_loopback_password_launch(&state, 1);
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending external launch");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, launch_id);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");

    let fake_runtime = Arc::new(FakeManagedSshRuntime::with_stdout(
        "directory\0/srv/app\0app\0drwxr-xr-x 2 0 0 4096 Jul  6 12:00 /srv/app\0\
         file\0/srv/readme.txt\0readme.txt\0-rw-r--r-- 1 0 0 12 Jul  6 12:01 /srv/readme.txt\0",
    ));
    let manager = ManagedSshSessionManager::with_backend(fake_runtime.clone());
    let service = SftpService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let listing = runtime
        .block_on(service.list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target.host_id.clone(),
                path: "/srv".to_owned(),
            },
        ))
        .expect("external SFTP directory listing should fall back to managed exec");
    let repeat_listing = runtime
        .block_on(service.list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target.host_id.clone(),
                path: "/srv".to_owned(),
            },
        ))
        .expect("repeat listing should be served from external directory cache");

    assert_eq!(listing.path, "/srv");
    assert_eq!(repeat_listing.entries, listing.entries);
    assert!(listing.entries.iter().any(|entry| {
        entry.name == "app"
            && entry.path == "/srv/app"
            && entry.kind == SftpEntryKind::Directory
            && entry.size == Some(4096)
    }));
    assert!(listing.entries.iter().any(|entry| {
        entry.name == "readme.txt"
            && entry.path == "/srv/readme.txt"
            && entry.kind == SftpEntryKind::File
            && entry.size == Some(12)
    }));
    assert_eq!(fake_runtime.exec_count(), 1);
    let key = fake_runtime.last_key().expect("last managed key");
    assert!(key
        .runtime_flags
        .iter()
        .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG));
    let snapshot = manager.snapshot().expect("runtime snapshot");
    let browser = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("browser capability session");
    assert_eq!(browser.channel_counts.get(&SshChannelKind::Exec), Some(&1));
    assert_eq!(manager.close_idle_sessions().expect("close idle"), 1);
}

#[tokio::test]
async fn sftp_operations_use_real_managed_sftp_channel_without_second_ssh_connection() {
    let server_root = tempdir().expect("server root");
    fs::write(server_root.path().join("managed-runtime.txt"), b"runtime")
        .await
        .expect("seed remote file");
    fs::create_dir_all(server_root.path().join("managed-dir/nested"))
        .await
        .expect("seed remote directory");
    fs::write(
        server_root.path().join("managed-dir/nested/app.log"),
        b"delete through managed exec",
    )
    .await
    .expect("seed nested remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        )
        .await
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let service = SftpService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("list through managed SFTP channel");
    let second_listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("reuse managed SFTP channel for second listing");

    for listing in [&listing, &second_listing] {
        assert!(listing.entries.iter().any(|entry| {
            entry.name == "managed-runtime.txt" && entry.kind == SftpEntryKind::File
        }));
    }
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "two SFTP operations should reuse the authenticated managed SSH transport"
    );
    service
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: host_id.clone(),
                path: "/managed-dir".to_owned(),
                directory: true,
            },
        )
        .await
        .expect("delete directory through managed exec channel");
    assert!(!server_root.path().join("managed-dir").exists());
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "managed exec delete should reuse the already authenticated SSH transport"
    );

    let local_download = tempdir().expect("local download");
    let local_download_path = local_download.path().join("managed-runtime-download.txt");
    service
        .download(
            state.paths(),
            SftpTransferRequest {
                host_id,
                local_path: local_download_path.to_string_lossy().into_owned(),
                remote_path: "/managed-runtime.txt".to_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("download through bulk transfer lane");
    assert_eq!(
        fs::read(&local_download_path)
            .await
            .expect("downloaded file"),
        b"runtime"
    );
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        2,
        "bulk transfer should use a second managed SSH transport while reusing session-only auth"
    );
    assert_eq!(manager.active_session_count().expect("active sessions"), 2);
    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(
        snapshot.active_channels, 1,
        "browser SFTP transport should keep one interactive channel open until service drop or idle close"
    );
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let browser = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("browser capability SFTP lane");
    let bulk = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG)
        })
        .expect("bulk transfer SFTP lane");
    assert_eq!(
        browser.channel_counts.get(&SshChannelKind::Sftp),
        Some(&1),
        "two browser listings should reuse one retained SFTP subsystem"
    );
    assert_eq!(browser.channel_counts.get(&SshChannelKind::Exec), Some(&1));
    assert_eq!(bulk.channel_counts.get(&SshChannelKind::Sftp), Some(&1));
    let debug = format!("{snapshot:?}");
    assert!(!debug.contains("secret"));
    assert!(!debug.contains("PRIVATE KEY"));
    drop(service);
    let snapshot_after_drop = manager.snapshot().expect("runtime snapshot after drop");
    assert_eq!(
        snapshot_after_drop.active_channels, 0,
        "dropping the SFTP service should release the retained browser transport channel"
    );
    assert_eq!(manager.close_idle_sessions().expect("close idle"), 2);
}

#[path = "managed_runtime/runtime_support.rs"]
mod runtime_support;
use runtime_support::*;
