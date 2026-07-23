//! TerminalManager PTY output and snapshot integration tests.
//!
//! @author kongweiguang

mod support;

#[path = "../src/services/terminal_manager/managed_shell_channel.rs"]
mod managed_shell_channel;
#[path = "../src/services/terminal_manager/utf8_decoder.rs"]
mod utf8_decoder;

use kerminal_lib::{
    models::terminal::{
        TerminalAgentKind, TerminalAgentStatus, TerminalOutputKind,
        TerminalPtyOutputPumpFlushReason,
    },
    services::terminal_manager::TerminalManager,
};
use managed_shell_channel::{
    managed_shell_command_channel, managed_shell_reader_channel, ManagedShellCommand,
    ManagedShellQueueError, ManagedShellReaderMessage, MANAGED_SSH_READER_CHANNEL_CAPACITY,
    MANAGED_SSH_READER_CHUNK_BYTES, MANAGED_SSH_WRITE_MAX_PENDING_BYTES, TERMINAL_WRITE_MAX_BYTES,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use support::terminal_manager::{
    agent_signal_marker_request, assert_data_event_before_closed, collect_additional_events,
    collect_until_closed_events, collect_until_output_events,
    collect_until_output_events_without_frontend_reply, fast_bulk_output_request,
    immediate_exit_request, interactive_shell_request, short_lived_echo_request,
    short_lived_tail_request, startup_cpr_query_request, stderr_tail_request, wait_for_output,
};
use utf8_decoder::IncrementalUtf8Decoder;

#[test]
fn incremental_utf8_decoder_preserves_every_multibyte_split_point() {
    let text = "A¢€😀中Z";
    let bytes = text.as_bytes();

    for split in 0..=bytes.len() {
        let mut decoder = IncrementalUtf8Decoder::new();
        let mut decoded = decoder.decode(&bytes[..split]);
        decoded.push_str(&decoder.decode(&bytes[split..]));
        decoded.push_str(&decoder.finish());
        assert_eq!(decoded, text, "split at byte {split}");
    }

    let mut decoder = IncrementalUtf8Decoder::new();
    let mut decoded = String::new();
    for byte in bytes {
        decoded.push_str(&decoder.decode(std::slice::from_ref(byte)));
    }
    decoded.push_str(&decoder.finish());
    assert_eq!(decoded, text);
}

#[test]
fn incremental_utf8_decoder_matches_lossy_semantics_for_invalid_sequences() {
    let bytes = [
        b'a', 0xf0, 0x28, 0x8c, 0x28, b'b', 0xe2, 0x82, b'c', 0xff, 0xc2, b'd',
    ];
    let expected = String::from_utf8_lossy(&bytes).into_owned();

    for split in 0..=bytes.len() {
        let mut decoder = IncrementalUtf8Decoder::new();
        let mut decoded = decoder.decode(&bytes[..split]);
        decoded.push_str(&decoder.decode(&bytes[split..]));
        decoded.push_str(&decoder.finish());
        assert_eq!(decoded, expected, "invalid sequence split at byte {split}");
    }

    let mut decoder = IncrementalUtf8Decoder::new();
    let mut decoded = String::new();
    for byte in bytes {
        decoded.push_str(&decoder.decode(std::slice::from_ref(&byte)));
    }
    decoded.push_str(&decoder.finish());
    assert_eq!(decoded, expected);
}

#[test]
fn incremental_utf8_decoder_flushes_incomplete_eof_once() {
    let mut decoder = IncrementalUtf8Decoder::new();

    assert_eq!(decoder.decode(&[b'a', 0xe4, 0xb8]), "a");
    assert_eq!(decoder.pending_len(), 2);
    assert_eq!(decoder.finish(), "\u{fffd}");
    assert_eq!(decoder.finish(), "");
    assert_eq!(decoder.pending_len(), 0);
}

#[test]
fn managed_ssh_command_queue_enforces_and_releases_pending_byte_budget() {
    let (sender, mut receiver) = managed_shell_command_channel();
    let chunk = vec![b'x'; TERMINAL_WRITE_MAX_BYTES];
    let accepted = MANAGED_SSH_WRITE_MAX_PENDING_BYTES / TERMINAL_WRITE_MAX_BYTES;

    for _ in 0..accepted {
        sender.try_send_write(chunk.clone()).unwrap();
    }
    assert_eq!(
        sender.pending_write_bytes(),
        accepted * TERMINAL_WRITE_MAX_BYTES
    );
    assert!(matches!(
        sender.try_send_write(vec![b'y']),
        Err(ManagedShellQueueError::Backpressure { .. })
    ));

    let mut queued = receiver.try_recv().expect("receive one queued write");
    assert_eq!(
        sender.pending_write_bytes(),
        accepted * TERMINAL_WRITE_MAX_BYTES
    );
    assert!(matches!(
        queued.take_command(),
        ManagedShellCommand::Write(data) if data.len() == TERMINAL_WRITE_MAX_BYTES
    ));
    drop(queued);
    assert_eq!(
        sender.pending_write_bytes(),
        (accepted - 1) * TERMINAL_WRITE_MAX_BYTES
    );
    sender.try_send_write(chunk).unwrap();
}

#[test]
fn managed_ssh_command_queue_rejects_single_oversized_write() {
    let (sender, _receiver) = managed_shell_command_channel();

    let error = sender
        .try_send_write(vec![0; TERMINAL_WRITE_MAX_BYTES + 1])
        .expect_err("oversized write should be rejected");
    assert!(matches!(
        &error,
        ManagedShellQueueError::InputTooLarge { .. }
    ));
    assert_eq!(
        error.into_io_error().kind(),
        std::io::ErrorKind::InvalidInput
    );
    assert_eq!(sender.pending_write_bytes(), 0);
}

#[test]
fn managed_ssh_command_queue_preserves_resize_and_closed_semantics() {
    let (sender, mut receiver) = managed_shell_command_channel();
    sender.try_send_resize(132, 43).unwrap();

    let mut queued = receiver.try_recv().expect("receive queued resize");
    assert!(matches!(
        queued.take_command(),
        ManagedShellCommand::Resize {
            cols: 132,
            rows: 43
        }
    ));
    drop(receiver);

    let error = sender
        .try_send_write(vec![b'x'])
        .expect_err("closed queue should reject writes");
    assert_eq!(error, ManagedShellQueueError::Closed);
    assert_eq!(error.into_io_error().kind(), std::io::ErrorKind::BrokenPipe);
}

#[test]
fn managed_ssh_command_queue_reports_message_capacity_backpressure() {
    let (sender, _receiver) = managed_shell_command_channel();
    let mut error = None;

    for _ in 0..=128 {
        if let Err(queue_error) = sender.try_send_resize(80, 24) {
            error = Some(queue_error);
            break;
        }
    }

    let error = error.expect("bounded command queue should reach message capacity");
    assert!(matches!(&error, ManagedShellQueueError::QueueFull { .. }));
    assert_eq!(error.into_io_error().kind(), std::io::ErrorKind::WouldBlock);
}

#[test]
fn managed_ssh_internal_write_waits_for_budget_and_resumes() {
    let (sender, mut receiver) = managed_shell_command_channel();
    let chunk = vec![b'x'; TERMINAL_WRITE_MAX_BYTES];
    let accepted = MANAGED_SSH_WRITE_MAX_PENDING_BYTES / TERMINAL_WRITE_MAX_BYTES;
    for _ in 0..accepted {
        sender.try_send_write(chunk.clone()).unwrap();
    }

    let keep_waiting = Arc::new(AtomicBool::new(true));
    let waiting_flag = Arc::clone(&keep_waiting);
    let waiting_sender = sender.clone();
    let (started_sender, started_receiver) = mpsc::channel();
    let (done_sender, done_receiver) = mpsc::channel();
    thread::spawn(move || {
        started_sender.send(()).unwrap();
        done_sender
            .send(
                waiting_sender
                    .send_write_with_backpressure(b"r", || waiting_flag.load(Ordering::SeqCst)),
            )
            .unwrap();
    });

    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("internal writer thread should start");
    assert!(done_receiver
        .recv_timeout(Duration::from_millis(100))
        .is_err());
    drop(receiver.try_recv().expect("release one pending write"));
    assert!(done_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("internal write should resume after budget is released")
        .is_ok());
    keep_waiting.store(false, Ordering::SeqCst);
}

#[test]
fn managed_ssh_reader_channel_blocks_before_exceeding_capacity_budget() {
    let (sender, receiver) = managed_shell_reader_channel();
    let payload =
        vec![b'x'; MANAGED_SSH_READER_CHUNK_BYTES * (MANAGED_SSH_READER_CHANNEL_CAPACITY + 1)];
    let (started_sender, started_receiver) = mpsc::channel();
    let (done_sender, done_receiver) = mpsc::channel();

    thread::spawn(move || {
        started_sender.send(()).unwrap();
        done_sender
            .send(sender.send_data_while(payload, || true))
            .unwrap();
    });

    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("reader sender thread should start");
    assert!(
        done_receiver
            .recv_timeout(Duration::from_millis(100))
            .is_err(),
        "sender must block before enqueueing a chunk beyond the channel budget"
    );

    let first = receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("receive the first bounded reader chunk");
    assert!(matches!(
        first,
        ManagedShellReaderMessage::Data(data)
            if data.len() == MANAGED_SSH_READER_CHUNK_BYTES
    ));
    assert!(done_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("sender should resume after capacity is released"));
}

#[test]
fn managed_ssh_reader_channel_preserves_error_then_closed_order() {
    let (sender, receiver) = managed_shell_reader_channel();
    assert!(sender.send_error("read failed".to_owned()));
    assert!(sender.send_closed());

    assert!(matches!(
        receiver.recv().unwrap(),
        ManagedShellReaderMessage::Error(message) if message == "read failed"
    ));
    assert!(matches!(
        receiver.recv().unwrap(),
        ManagedShellReaderMessage::Closed
    ));
}

#[test]
fn managed_ssh_reader_channel_aborts_capacity_wait_after_close() {
    let (sender, _receiver) = managed_shell_reader_channel();
    assert!(!sender.send_data_while(vec![b'x'], || false));
}

#[test]
fn pty_session_emits_output_for_short_lived_command() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
        }

        if received.contains("kerminal-pty-smoke") {
            break;
        }
    }

    manager.close(&summary.id).unwrap();

    assert!(
        received.contains("kerminal-pty-smoke"),
        "expected PTY output to contain smoke marker, got: {received:?}",
    );
    assert!(
        !received.contains("\u{1b}[6n"),
        "startup CPR query should be answered by the backend responder, not emitted to frontend data: {received:?}",
    );
}

#[test]
fn pty_session_answers_startup_cpr_without_frontend_renderer_reply() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(startup_cpr_query_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_output_events_without_frontend_reply(&receiver, "kerminal-cpr-ok");
    let data = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();

    manager.close(&summary.id).unwrap();

    assert!(
        data.contains("kerminal-cpr-ok"),
        "PTY child should receive backend CPR response without frontend renderer reply: {data:?}",
    );
    assert!(
        !data.contains("\u{1b}[6n"),
        "backend-answered CPR query must not be forwarded to terminal data: {data:?}",
    );
}

#[test]
fn pty_session_emits_agent_signal_events_without_writing_markers_to_data() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(agent_signal_marker_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    let data = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();
    let signals = events
        .iter()
        .filter_map(|event| event.agent_signal.as_ref())
        .collect::<Vec<_>>();
    let session_summary = manager.session_summary(&summary.id).unwrap();
    let (_snapshot_session, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(summary.agent_session_id.as_deref(), Some("ags-codex"));
    assert!(
        data.contains("beforeafter"),
        "agent marker must be removed without dropping surrounding output: {data:?}",
    );
    assert!(
        !data.contains("777;notify;Kerminal"),
        "agent marker must not be written into terminal data: {data:?}",
    );
    assert!(
        !snapshot.data.contains("777;notify;Kerminal"),
        "agent marker must not be persisted into output snapshot: {:?}",
        snapshot.data,
    );
    assert_eq!(
        signals.len(),
        3,
        "expected working, finished, exited: {events:?}"
    );
    assert_eq!(signals[0].agent, TerminalAgentKind::Codex);
    assert_eq!(signals[0].status, TerminalAgentStatus::Working);
    assert_eq!(signals[1].status, TerminalAgentStatus::Finished);
    assert_eq!(signals[2].status, TerminalAgentStatus::Exited);
    for signal in &signals {
        assert_eq!(signal.agent_session_id.as_deref(), Some("ags-codex"));
        assert_eq!(signal.terminal_session_id, summary.id);
    }
    assert_eq!(
        session_summary
            .agent_signal
            .as_ref()
            .map(|signal| signal.status),
        Some(TerminalAgentStatus::Exited),
    );
}

#[test]
fn output_snapshot_returns_recent_terminal_output() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    wait_for_output(&manager, &summary.id, &receiver, "kerminal-pty-smoke");

    let (snapshot_session, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();
    let (_, tiny_snapshot) = manager.output_snapshot(&summary.id, 8).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(snapshot_session.id, summary.id);
    assert!(snapshot.data.contains("kerminal-pty-smoke"));
    assert!(snapshot.captured_bytes <= snapshot.max_bytes);
    assert!(tiny_snapshot.captured_bytes <= 8);
    assert!(tiny_snapshot.truncated);
}

#[test]
fn pty_session_flushes_short_lived_tail_without_waiting_for_threshold() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events =
        collect_until_output_events(&manager, &summary.id, &receiver, "kerminal-final-tail");
    manager.close(&summary.id).unwrap();

    assert!(
        events.iter().any(|event| {
            event.kind == TerminalOutputKind::Data && event.data.contains("kerminal-final-tail")
        }),
        "short output tail must be delivered by idle flush before close: {events:?}",
    );
}

#[test]
fn pty_session_emits_final_tail_before_closed_for_short_lived_command() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    manager.close(&summary.id).unwrap();

    assert_data_event_before_closed(&events, "kerminal-final-tail");
}

#[test]
fn pty_session_exposes_non_sensitive_output_pump_stats() {
    let manager = Arc::new(TerminalManager::new());
    let (sender, receiver) = mpsc::channel();
    let (session_id_sender, session_id_receiver) = mpsc::sync_channel::<String>(1);
    let (stats_sender, stats_receiver) = mpsc::sync_channel(1);
    let manager_for_output = Arc::clone(&manager);

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            if event.kind == TerminalOutputKind::Closed {
                let session_id = session_id_receiver
                    .recv_timeout(Duration::from_secs(5))
                    .expect("test must provide the session id before observing Closed");
                let stats = manager_for_output
                    .pty_output_pump_stats(&session_id)
                    .expect("Closed must observe a registered session");
                stats_sender.send(stats).is_ok() && sender.send(event).is_ok()
            } else {
                sender.send(event).is_ok()
            }
        })
        .unwrap();

    session_id_sender.send(summary.id.clone()).unwrap();
    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    let stats = stats_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("Closed callback must receive final output pump stats");
    let serialized = serde_json::to_string(&stats).unwrap();

    manager.close(&summary.id).unwrap();

    assert_data_event_before_closed(&events, "kerminal-final-tail");
    assert_eq!(stats.session_id, summary.id);
    assert_eq!(stats.pending_bytes, 0);
    assert!(stats.input_chunks > 0);
    assert!(stats.input_bytes > 0);
    assert!(stats.data_events > 0);
    assert!(stats.output_bytes > 0);
    assert!(stats.flush_count > 0);
    assert!(stats.coalesced_chunks > 0);
    assert_eq!(stats.closed_events, 1);
    assert!(matches!(
        stats.last_flush_reason,
        Some(TerminalPtyOutputPumpFlushReason::Closed)
            | Some(TerminalPtyOutputPumpFlushReason::Idle)
    ));
    assert!(stats.finished);
    assert!(!serialized.contains("kerminal-final-tail"));
}

#[test]
fn pty_session_emits_stderr_tail_before_closed() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(stderr_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    manager.close(&summary.id).unwrap();

    assert_data_event_before_closed(&events, "kerminal-stderr-tail");
}

#[test]
fn pty_session_immediate_exit_emits_closed_once() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(immediate_exit_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut events = collect_until_closed_events(&manager, &summary.id, &receiver);
    events.extend(collect_additional_events(
        &receiver,
        Duration::from_millis(500),
    ));
    manager.close(&summary.id).unwrap();

    let closed_count = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Closed)
        .count();
    assert_eq!(
        closed_count, 1,
        "closed event must be emitted once: {events:?}"
    );
}

#[test]
fn pty_session_tolerates_output_consumer_closing_before_session_exit() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            let _ = sender.send(event.kind.clone());
            false
        })
        .unwrap();

    let first_event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("output consumer should receive at least one event before closing");
    manager.close(&summary.id).unwrap();

    assert_eq!(first_event, TerminalOutputKind::Data);
}

#[test]
fn pty_session_coalesces_fast_bulk_output_and_snapshot_keeps_tail() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(fast_bulk_output_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events =
        collect_until_output_events(&manager, &summary.id, &receiver, "kerminal-bulk-tail");
    let received = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();
    let data_events = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .count();
    let (_, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert!(
        received.contains("kerminal-bulk-tail"),
        "expected bulk output tail, got {} events and {} bytes",
        data_events,
        received.len(),
    );
    assert!(
        data_events <= 16,
        "fast 128 KiB output should be coalesced before emitting, got {data_events} data events",
    );
    assert!(snapshot.data.contains("kerminal-bulk-tail"));
}

#[test]
fn terminal_write_rejects_input_larger_than_per_write_budget() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(interactive_shell_request(), |_| true)
        .expect("create interactive terminal session");
    let oversized = "x".repeat(TERMINAL_WRITE_MAX_BYTES + 1);

    let error = manager
        .write(&summary.id, &oversized)
        .expect_err("oversized terminal input must be rejected");
    manager.close(&summary.id).unwrap();

    let message = error.to_string();
    assert!(message.contains("terminal input exceeds per-write limit"));
    assert!(message.contains(&(TERMINAL_WRITE_MAX_BYTES + 1).to_string()));
    assert!(message.contains(&TERMINAL_WRITE_MAX_BYTES.to_string()));
}
