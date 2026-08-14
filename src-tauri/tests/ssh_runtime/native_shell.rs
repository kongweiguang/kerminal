//! SSH runtime 原生 shell 集成测试。
//!
//! @author kongweiguang

use super::fixtures::*;
use super::*;

#[test]
fn native_shell_channel_reads_writes_resizes_and_closes_loopback_pty() {
    let server = LoopbackTerminalServer::start();
    let home = tempdir().expect("create native shell temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.root).expect("create kerminal root");
    trust_loopback_host_key(&paths, "127.0.0.1", server.addr.port(), &server.host_key)
        .expect("trust loopback host key");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let request = SshRuntimeConnectRequest::native(
        loopback_session_key(server.addr.port()),
        loopback_runtime_host(server.addr.port()),
        paths.root.join("known_hosts"),
        5,
    );

    let runtime = tokio::runtime::Runtime::new().expect("create native shell test runtime");
    runtime.block_on(async {
        let session = manager
            .acquire_session_with_request(request)
            .expect("acquire native session");
        let mut shell = session
            .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
            .await
            .expect("open native shell");

        let ready = read_shell_until(&shell, LOOPBACK_READY_MARKER).await;
        assert!(ready.contains(LOOPBACK_READY_MARKER), "{ready:?}");

        shell.resize(120, 36).await.expect("resize native shell");
        shell
            .write(format!("echo {COMMAND_MARKER}\r").into_bytes())
            .await
            .expect("write native shell command");
        let output = read_shell_until(&shell, COMMAND_MARKER).await;
        assert!(output.contains(COMMAND_MARKER), "{output:?}");

        shell.close().await.expect("close native shell");
        let snapshot = manager.snapshot().expect("snapshot after native shell");
        assert_eq!(snapshot.active_channels, 0);
        assert_eq!(
            snapshot.sessions[0]
                .channel_counts
                .get(&SshChannelKind::Shell),
            Some(&1)
        );
    });
}

#[test]
fn native_shell_channel_write_is_not_blocked_by_pending_read() {
    let server = LoopbackTerminalServer::start();
    let home = tempdir().expect("create native shell concurrent temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.root).expect("create kerminal root");
    trust_loopback_host_key(&paths, "127.0.0.1", server.addr.port(), &server.host_key)
        .expect("trust loopback host key");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let request = SshRuntimeConnectRequest::native(
        loopback_session_key(server.addr.port()),
        loopback_runtime_host(server.addr.port()),
        paths.root.join("known_hosts"),
        5,
    );

    let runtime = tokio::runtime::Runtime::new().expect("create native shell concurrent runtime");
    runtime.block_on(async {
        let session = manager
            .acquire_session_with_request(request)
            .expect("acquire native session");
        let shell = Arc::new(
            session
                .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
                .await
                .expect("open native shell"),
        );

        let ready = read_shell_until(shell.as_ref(), LOOPBACK_READY_MARKER).await;
        assert!(ready.contains(LOOPBACK_READY_MARKER), "{ready:?}");

        let reader_shell = Arc::clone(&shell);
        let reader = tokio::spawn(async move {
            tokio::time::timeout(Duration::from_secs(3), reader_shell.read_event())
                .await
                .expect("pending read should complete after write")
                .expect("read shell event")
        });
        tokio::time::sleep(Duration::from_millis(100)).await;

        tokio::time::timeout(
            Duration::from_millis(500),
            shell.write(format!("echo {COMMAND_MARKER}\r").into_bytes()),
        )
        .await
        .expect("write should not wait for pending read lock")
        .expect("write native shell command");

        let event = reader.await.expect("reader task");
        match event {
            SshRuntimeShellEvent::Data(data) | SshRuntimeShellEvent::ExtendedData { data, .. } => {
                let output = String::from_utf8_lossy(&data);
                assert!(output.contains(COMMAND_MARKER), "{output:?}");
            }
            other => panic!("expected shell data after write, got {other:?}"),
        }

        drop(shell);
        let snapshot = manager
            .snapshot()
            .expect("snapshot after native shell drop");
        assert_eq!(snapshot.active_channels, 0);
    });
}

/// 关闭同一 SSH transport 上的一个 shell 后继续读写兄弟 shell，防止 Tab 关闭误伤存活会话。
#[test]
fn closing_one_native_shell_keeps_sibling_shell_connected() {
    let server = LoopbackTerminalServer::start();
    let home = tempdir().expect("create native sibling shell temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.root).expect("create kerminal root");
    trust_loopback_host_key(&paths, "127.0.0.1", server.addr.port(), &server.host_key)
        .expect("trust loopback host key");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let request = SshRuntimeConnectRequest::native(
        loopback_session_key(server.addr.port()),
        loopback_runtime_host(server.addr.port()),
        paths.root.join("known_hosts"),
        5,
    );

    let runtime = tokio::runtime::Runtime::new().expect("create native sibling shell runtime");
    runtime.block_on(async {
        let first_session = manager
            .acquire_session_with_request(request.clone())
            .expect("acquire first native session lease");
        let second_session = manager
            .acquire_session_with_request(request)
            .expect("acquire second native session lease");
        let mut first_shell = first_session
            .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
            .await
            .expect("open first native shell");
        let mut second_shell = second_session
            .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
            .await
            .expect("open second native shell");

        assert!(read_shell_until(&first_shell, LOOPBACK_READY_MARKER)
            .await
            .contains(LOOPBACK_READY_MARKER));
        assert!(read_shell_until(&second_shell, LOOPBACK_READY_MARKER)
            .await
            .contains(LOOPBACK_READY_MARKER));
        second_shell.close().await.expect("close sibling shell");

        first_shell
            .write(format!("echo {COMMAND_MARKER}\r").into_bytes())
            .await
            .expect("write surviving native shell");
        let output = read_shell_until(&first_shell, COMMAND_MARKER).await;
        assert!(output.contains(COMMAND_MARKER), "{output:?}");

        let snapshot = manager.snapshot().expect("snapshot after sibling close");
        assert_eq!(snapshot.active_sessions, 1);
        assert_eq!(snapshot.active_channels, 1);
        assert_eq!(snapshot.sessions[0].ref_count, 2);
        first_shell.close().await.expect("close surviving shell");
    });
}
