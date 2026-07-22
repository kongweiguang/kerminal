//! SSH runtime 会话、通道与队列集成测试。

use super::fixtures::*;
use super::*;

#[test]
fn manager_reuses_session_for_same_key_tracks_ref_counts_and_keeps_idle() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let first = manager.acquire_session(key.clone()).expect("first session");
    let first_id = first.session_id().to_owned();
    let second = manager.acquire_session(key).expect("second session");

    assert_eq!(first_id, second.session_id());
    assert_eq!(backend.connect_count(), 1);

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 2);
    assert_eq!(snapshot.active_channels, 0);

    drop(first);
    let snapshot = manager.snapshot().expect("snapshot after first drop");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 1);

    drop(second);
    assert_eq!(manager.active_session_count().expect("count"), 1);
    assert_eq!(backend.disconnect_count(), 0);

    let third = manager
        .acquire_session(sample_key())
        .expect("third session");
    assert_eq!(first_id, third.session_id());
    assert_eq!(backend.connect_count(), 1);
    drop(third);

    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.disconnect_count(), 1);
}

#[test]
fn legacy_fallback_diagnostics_are_counted_and_capped() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));

    for index in 0..25 {
        manager.record_legacy_fallback("sftp", format!("unsupported-{index}"), None);
    }
    manager.record_legacy_fallback(
        "exec",
        "managed-exec-unsupported",
        Some("deploy@example.com:22".to_owned()),
    );
    manager.record_legacy_fallback(
        "exec",
        "managed-exec-unsupported",
        Some("deploy@example.com:22".to_owned()),
    );

    let snapshot = manager.snapshot().expect("snapshot");

    assert_eq!(snapshot.recent_legacy_fallbacks.len(), 20);
    assert!(!snapshot
        .recent_legacy_fallbacks
        .iter()
        .any(|event| event.reason == "unsupported-0"));
    let counted = snapshot
        .recent_legacy_fallbacks
        .iter()
        .find(|event| event.capability == "exec")
        .expect("exec fallback");
    assert_eq!(counted.count, 2);
    assert_eq!(counted.reason, "managed-exec-unsupported");
    assert_eq!(counted.target.as_deref(), Some("deploy@example.com:22"));
}

#[test]
fn channel_factory_counts_and_releases_channels() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let sftp = session.open_channel(SshChannelKind::Sftp).expect("sftp");
    let exec = session.open_channel(SshChannelKind::Exec).expect("exec");

    assert!(sftp.channel_id().starts_with("fake-channel-"));
    assert_eq!(exec.kind(), SshChannelKind::Exec);

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 2);
    assert_eq!(snapshot.sessions[0].active_channels, 2);
    assert_eq!(snapshot.sessions[0].opened_channels, 2);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );

    drop(sftp);
    let snapshot = manager.snapshot().expect("snapshot after sftp drop");
    assert_eq!(snapshot.active_channels, 1);

    drop(exec);
    drop(session);
    assert_eq!(manager.active_session_count().expect("count"), 1);
    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.disconnect_count(), 1);
}

#[tokio::test]
async fn sftp_channel_opens_and_releases_diagnostics() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let channel = session.open_sftp().await.expect("open sftp");

    assert_eq!(backend.sftp_open_count(), 1);
    let snapshot = manager.snapshot().expect("snapshot with sftp");
    assert_eq!(snapshot.active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );

    drop(channel);
    let snapshot = manager.snapshot().expect("snapshot after sftp drop");
    assert_eq!(snapshot.active_channels, 0);
}

#[test]
fn backend_failure_is_not_cached_as_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_connect("network unavailable");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));

    let error = manager.acquire_session(sample_key()).expect_err("failure");

    assert!(error.to_string().contains("network unavailable"));
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.connect_count(), 1);
}

#[test]
fn channel_failure_marks_session_failed_but_releases_active_count() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_channel("sftp subsystem rejected");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let error = session
        .open_channel(SshChannelKind::Sftp)
        .expect_err("channel failure");

    assert!(error.to_string().contains("sftp subsystem rejected"));
    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(snapshot.sessions[0].opened_channels, 1);
    assert_eq!(
        snapshot.sessions[0].last_error.as_deref(),
        Some("SSH 远程命令执行失败: sftp subsystem rejected")
    );
}

#[test]
fn manager_reconnects_after_failed_channel_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_channel("Channel send error");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let first = manager
        .acquire_session(sample_key())
        .expect("first session");
    let first_id = first.session_id().to_owned();

    let error = first
        .open_channel(SshChannelKind::Sftp)
        .expect_err("channel failure");
    assert!(error.to_string().contains("Channel send error"));

    backend.clear_channel_failure();
    let second = manager
        .acquire_session(sample_key())
        .expect("second session");

    assert_ne!(first_id, second.session_id());
    assert_eq!(backend.connect_count(), 2);
    assert_eq!(backend.disconnect_count(), 1);
    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].state, ManagedSshSessionState::Ready);
}

#[test]
fn transient_channel_open_failure_retries_without_poisoning_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_next_channel_opens(1, "Failed to open channel (ConnectFailed)");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let sftp = session.open_channel(SshChannelKind::Sftp).expect("sftp");

    assert!(sftp.channel_id().starts_with("fake-channel-sftp-"));
    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 1);
    assert_eq!(snapshot.sessions[0].active_channels, 1);
    assert_eq!(snapshot.sessions[0].opened_channels, 2);
    assert_eq!(snapshot.sessions[0].state, ManagedSshSessionState::Ready);
    assert_eq!(snapshot.sessions[0].last_error, None);
    assert_eq!(backend.connect_count(), 1);
}

#[tokio::test]
async fn exec_retries_transient_channel_open_failure_before_running_command() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_exec();
    backend.fail_next_channel_opens(
        1,
        "SSH 远程命令执行失败: Failed to open channel (ConnectFailed)",
    );
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let exec_task = tokio::spawn(async move {
        session
            .execute_exec(SshRuntimeExecRequest::new(
                "printf stable\\n".to_owned(),
                5,
                1024,
            ))
            .await
    });
    backend.wait_for_exec_start().await;
    backend.release_one_exec();

    let output = exec_task
        .await
        .expect("exec task")
        .expect("exec output after retry");
    assert_eq!(output.stdout, "printf stable\\n");
    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.sessions[0].opened_channels, 2);
    assert_eq!(snapshot.sessions[0].state, ManagedSshSessionState::Ready);
    assert_eq!(snapshot.sessions[0].last_error, None);
    assert_eq!(backend.connect_count(), 1);
}

#[tokio::test]
async fn exec_queue_limits_concurrency_and_reports_pending_depth() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let first = manager
        .acquire_session(sample_key())
        .expect("first session");
    let second = manager
        .acquire_session(sample_key())
        .expect("second session");

    let first_task = tokio::spawn(async move {
        first
            .execute_exec(SshRuntimeExecRequest::new("echo one\n".to_owned(), 5, 1024))
            .await
    });
    backend.wait_for_exec_start().await;

    let second_task = tokio::spawn(async move {
        second
            .execute_exec(SshRuntimeExecRequest::new("echo two\n".to_owned(), 5, 1024))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;
    let snapshot = manager.snapshot().expect("snapshot with queued exec");
    assert_eq!(snapshot.sessions[0].active_channels, 1);
    assert_eq!(snapshot.sessions[0].pending_exec_requests, 1);
    assert_eq!(snapshot.sessions[0].max_concurrent_exec_channels, 1);

    backend.release_one_exec();
    let first_output = first_task.await.expect("first task").expect("first output");
    assert_eq!(first_output.stdout, "echo one\n");
    backend.wait_for_exec_start().await;
    backend.release_one_exec();
    let second_output = second_task
        .await
        .expect("second task")
        .expect("second output");
    assert_eq!(second_output.stdout, "echo two\n");
    assert_eq!(backend.max_active_exec(), 1);
}

#[tokio::test]
async fn exec_cancel_while_queued_releases_pending_depth() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let first = manager
        .acquire_session(sample_key())
        .expect("first session");
    let second = manager
        .acquire_session(sample_key())
        .expect("second session");
    let cancel_token = CancellationToken::new();

    let first_task = tokio::spawn(async move {
        first
            .execute_exec(SshRuntimeExecRequest::new("sleep\n".to_owned(), 5, 1024))
            .await
    });
    backend.wait_for_exec_start().await;

    let queued_request = SshRuntimeExecRequest::new("queued\n".to_owned(), 5, 1024)
        .with_cancel_token(cancel_token.clone());
    let queued_task = tokio::spawn(async move { second.execute_exec(queued_request).await });
    wait_for_pending_exec_requests(&manager, 1).await;

    cancel_token.cancel();
    let queued_error = queued_task
        .await
        .expect("queued task")
        .expect_err("queued command canceled");
    assert!(queued_error.to_string().contains("远程命令已取消"));
    wait_for_pending_exec_requests(&manager, 0).await;

    backend.release_one_exec();
    first_task.await.expect("first task").expect("first output");
}

#[tokio::test]
async fn streaming_exec_uses_exec_queue_and_releases_channel() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let session = manager.acquire_session(sample_key()).expect("session");
    let queued_session = manager
        .acquire_session(sample_key())
        .expect("queued session");

    let mut streaming = session
        .open_streaming_exec(SshRuntimeStreamingExecRequest::new("cat".to_owned(), 5))
        .await
        .expect("open streaming exec");
    let queued_task = tokio::spawn(async move {
        queued_session
            .open_streaming_exec(SshRuntimeStreamingExecRequest::new(
                "cat queued".to_owned(),
                5,
            ))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;

    {
        let mut stdin = streaming.take_stdin().expect("stdin");
        stdin.write_all(b"hello").expect("write stdin");
    }
    let mut stdout = String::new();
    streaming
        .take_stdout()
        .expect("stdout")
        .read_to_string(&mut stdout)
        .expect("read stdout");
    assert_eq!(stdout, "streaming-output");
    assert_eq!(streaming.wait().expect("wait").exit_code, Some(0));

    let mut queued = queued_task
        .await
        .expect("queued task")
        .expect("queued streaming exec");
    assert_eq!(queued.wait().expect("queued wait").exit_code, Some(0));

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(backend.streaming_exec_count(), 2);
    assert_eq!(backend.streaming_stdin(), b"hello");
}

#[tokio::test]
async fn concurrent_capability_channels_share_one_managed_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    backend.enable_exec();
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let key = sample_key();
    let shell_session = manager.acquire_session(key.clone()).expect("shell session");
    let sftp_session = manager.acquire_session(key.clone()).expect("sftp session");
    let exec_session = manager.acquire_session(key.clone()).expect("exec session");
    let streaming_session = manager.acquire_session(key).expect("streaming session");

    let mut shell = shell_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open shell");
    let sftp = sftp_session.open_sftp().await.expect("open sftp");
    let exec_task = tokio::spawn(async move {
        exec_session
            .execute_exec(SshRuntimeExecRequest::new(
                "printf managed-exec\n".to_owned(),
                5,
                1024,
            ))
            .await
    });
    backend.wait_for_exec_start().await;
    let streaming_task = tokio::spawn(async move {
        streaming_session
            .open_streaming_exec(SshRuntimeStreamingExecRequest::new(
                "cat managed-stream".to_owned(),
                5,
            ))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;

    let snapshot = manager
        .snapshot()
        .expect("snapshot while mixed capabilities run");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 4);
    assert_eq!(snapshot.sessions[0].active_channels, 3);
    assert_eq!(snapshot.sessions[0].pending_exec_requests, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );

    backend.release_one_exec();
    let exec_output = exec_task.await.expect("exec task").expect("exec output");
    assert_eq!(exec_output.stdout, "printf managed-exec\n");
    let mut streaming = streaming_task
        .await
        .expect("streaming task")
        .expect("streaming exec");
    {
        let mut stdin = streaming.take_stdin().expect("streaming stdin");
        stdin
            .write_all(b"streaming-input")
            .expect("write streaming stdin");
    }
    assert_eq!(streaming.wait().expect("streaming wait").exit_code, Some(0));
    shell.close().await.expect("close shell");
    drop(sftp);

    let snapshot = manager
        .snapshot()
        .expect("snapshot after mixed capabilities settle");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(backend.shell_open_count(), 1);
    assert_eq!(backend.sftp_open_count(), 1);
    assert_eq!(backend.streaming_exec_count(), 1);
    assert_eq!(backend.streaming_stdin(), b"streaming-input");
}

#[tokio::test]
async fn bulk_transfer_lane_uses_separate_session_without_reprompt_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let bulk_session = manager
        .acquire_bulk_transfer_session(key)
        .expect("bulk transfer session");

    assert_ne!(interactive_session.session_id(), bulk_session.session_id());
    assert_eq!(backend.connect_count(), 2);

    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let sftp = bulk_session.open_sftp().await.expect("open bulk sftp");

    let snapshot = manager.snapshot().expect("snapshot with isolated lanes");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 2);

    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive runtime lane");
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
        .expect("bulk transfer runtime lane");
    assert_eq!(interactive.key.target, bulk.key.target);
    assert_eq!(
        interactive.key.known_hosts_profile,
        bulk.key.known_hosts_profile
    );
    assert_eq!(interactive.key.jumps, bulk.key.jumps);
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(bulk.channel_counts.get(&SshChannelKind::Sftp), Some(&1));

    shell.close().await.expect("close shell");
    drop(sftp);
    let snapshot = manager.snapshot().expect("snapshot after drops");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 0);
}

#[tokio::test]
async fn capability_lane_uses_separate_session_from_interactive_shell_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let capability_session = manager
        .acquire_capability_session_with_request(SshRuntimeConnectRequest::key_only(key))
        .expect("capability session");

    assert_ne!(
        interactive_session.session_id(),
        capability_session.session_id()
    );
    assert_eq!(backend.connect_count(), 2);

    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let exec = capability_session
        .open_channel(SshChannelKind::Exec)
        .expect("capability exec channel");

    let snapshot = manager
        .snapshot()
        .expect("snapshot with isolated capability lane");
    assert_eq!(snapshot.active_sessions, 2);
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive runtime lane");
    let capability = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("capability runtime lane");
    assert_eq!(interactive.key.target, capability.key.target);
    assert_eq!(
        interactive.key.known_hosts_profile,
        capability.key.known_hosts_profile
    );
    assert_eq!(interactive.key.jumps, capability.key.jumps);
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(
        capability.channel_counts.get(&SshChannelKind::Exec),
        Some(&1)
    );

    shell.close().await.expect("close shell");
    drop(exec);
}

#[tokio::test]
async fn bulk_transfer_lane_does_not_block_interactive_shell_input_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let bulk_session = manager
        .acquire_bulk_transfer_session(key)
        .expect("bulk transfer session");
    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let sftp = bulk_session.open_sftp().await.expect("open bulk sftp");

    tokio::time::timeout(
        Duration::from_millis(200),
        shell.write(b"echo still-interactive\r".to_vec()),
    )
    .await
    .expect("interactive shell write should not wait for the bulk SFTP lane")
    .expect("write interactive shell while bulk SFTP is active");
    assert_eq!(
        backend.shell_write_count(),
        1,
        "bulk SFTP transfer lane must not block interactive shell input"
    );

    let snapshot = manager
        .snapshot()
        .expect("snapshot while shell and bulk SFTP are active");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 2);
    assert_eq!(backend.connect_count(), 2);

    shell.close().await.expect("close shell");
    drop(sftp);
}

#[tokio::test]
async fn shell_channel_opens_and_releases_diagnostics() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let mut shell = session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 80, 24))
        .await
        .expect("open shell");
    shell
        .write(b"echo managed-shell\r".to_vec())
        .await
        .expect("write shell");
    shell.resize(100, 40).await.expect("resize shell");
    let event = shell.read_event().await.expect("read shell event");

    assert_eq!(
        event,
        SshRuntimeShellEvent::Data(b"fake-shell-ready".to_vec())
    );
    assert_eq!(backend.shell_open_count(), 1);
    assert_eq!(backend.shell_write_count(), 1);
    assert_eq!(backend.shell_resize_count(), 1);
    assert_eq!(
        backend
            .shell_last_request()
            .as_ref()
            .map(|request| request.term.as_str()),
        Some("xterm-256color")
    );

    let snapshot = manager.snapshot().expect("snapshot with shell");
    assert_eq!(snapshot.active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Shell),
        Some(&1)
    );

    shell.close().await.expect("close shell");
    let snapshot = manager.snapshot().expect("snapshot after shell close");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(backend.shell_close_count(), 1);
}
