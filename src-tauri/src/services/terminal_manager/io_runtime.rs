//! 终端 reader、过滤链、有界 channel、child waiter 与清理资源所有权。
//!
//! @author kongweiguang

use super::{
    secret_input::TerminalSecretInputResponder, transport::SharedWriterHandle,
    utf8_decoder::IncrementalUtf8Decoder, PTY_OUTPUT_FLUSH_BYTES,
};
use crate::{
    error::{AppError, AppResult},
    models::terminal::{TerminalAgentSignal, TerminalSecretInputPlan},
    services::{
        pty_process_guard::SharedPtyChildHandle,
        terminal_agent_signal_detector::TerminalAgentSignalDetector,
        terminal_escape_responder::TerminalEscapeResponder,
    },
};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

const READ_BUFFER_SIZE: usize = 16 * 1024;
const PTY_OUTPUT_CHANNEL_DATA_BYTES: usize = PTY_OUTPUT_FLUSH_BYTES;
const PTY_OUTPUT_CHANNEL_MAX_PENDING_BYTES: usize = 1024 * 1024;
const PTY_OUTPUT_CHANNEL_CAPACITY: usize =
    PTY_OUTPUT_CHANNEL_MAX_PENDING_BYTES / PTY_OUTPUT_CHANNEL_DATA_BYTES;
const PTY_CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(20);
const PTY_READER_EOF_GRACE: Duration = Duration::from_millis(500);

/// 固定容量 output channel 的同步发送端；首次进入背压时只记录脱敏容量信息。
#[derive(Clone)]
pub(super) struct PtyOutputPumpSender {
    backpressure_observed: Arc<AtomicBool>,
    sender: mpsc::SyncSender<PtyOutputPumpMessage>,
    session_id: Arc<str>,
}

impl PtyOutputPumpSender {
    fn send(
        &self,
        message: PtyOutputPumpMessage,
    ) -> Result<(), mpsc::SendError<PtyOutputPumpMessage>> {
        match self.sender.try_send(message) {
            Ok(()) => Ok(()),
            Err(mpsc::TrySendError::Full(message)) => {
                if !self.backpressure_observed.swap(true, Ordering::AcqRel) {
                    tauri_plugin_log::log::warn!(
                        target: "terminal.output",
                        "event=queue.backpressure session_id={} capacity_messages={} max_data_bytes={} budget_bytes={}",
                        self.session_id,
                        PTY_OUTPUT_CHANNEL_CAPACITY,
                        PTY_OUTPUT_CHANNEL_DATA_BYTES,
                        PTY_OUTPUT_CHANNEL_MAX_PENDING_BYTES
                    );
                }
                self.sender.send(message)
            }
            Err(mpsc::TrySendError::Disconnected(message)) => Err(mpsc::SendError(message)),
        }
    }
}

pub(super) fn pty_output_channel(
    session_id: &str,
) -> (PtyOutputPumpSender, mpsc::Receiver<PtyOutputPumpMessage>) {
    let (sender, receiver) = mpsc::sync_channel(PTY_OUTPUT_CHANNEL_CAPACITY);
    (
        PtyOutputPumpSender {
            backpressure_observed: Arc::new(AtomicBool::new(false)),
            sender,
            session_id: Arc::from(session_id),
        },
        receiver,
    )
}

/// 启动唯一的 PTY reader，并确保 EOF 前将任何跨分片敏感前缀安全收口。
///
/// reader 是输出脱敏的单一所有者；在结束时仍经由同一过滤链发送占位，避免一个没有后续
/// 分片的敏感值前缀被静默重新暴露或遗留在内部缓冲。
pub(super) fn spawn_reader_thread(
    mut reader: Box<dyn Read + Send>,
    cleanup_paths: Vec<PathBuf>,
    writer: SharedWriterHandle,
    secret_input_plan: Option<TerminalSecretInputPlan>,
    pump_sender: PtyOutputPumpSender,
    agent_detector: Arc<Mutex<TerminalAgentSignalDetector>>,
) -> mpsc::Receiver<()> {
    let (reader_done_sender, reader_done_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = vec![0_u8; READ_BUFFER_SIZE];
        let mut decoder = IncrementalUtf8Decoder::new();
        let mut escape_responder = TerminalEscapeResponder::new();
        let mut secret_responder = secret_input_plan.map(TerminalSecretInputResponder::new);

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    if !forward_decoded_terminal_output(
                        decoder.finish(),
                        &mut escape_responder,
                        &mut secret_responder,
                        &writer,
                        &pump_sender,
                        &agent_detector,
                    ) {
                        break;
                    }
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Closed);
                    break;
                }
                Ok(bytes_read) => {
                    let data = decoder.decode(&buffer[..bytes_read]);
                    debug_assert!(decoder.pending_len() <= 3);
                    if !forward_decoded_terminal_output(
                        data,
                        &mut escape_responder,
                        &mut secret_responder,
                        &writer,
                        &pump_sender,
                        &agent_detector,
                    ) {
                        break;
                    }
                }
                Err(error) => {
                    if !forward_decoded_terminal_output(
                        decoder.finish(),
                        &mut escape_responder,
                        &mut secret_responder,
                        &writer,
                        &pump_sender,
                        &agent_detector,
                    ) {
                        break;
                    }
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(error.to_string()));
                    break;
                }
            }
        }
        let _ = reader_done_sender.send(());
        cleanup_session_paths(&cleanup_paths);
    });
    reader_done_receiver
}

/// 让每个解码结果依次经过 escape、secret 和 agent 过滤，再进入有界 output queue。
///
/// 空解码结果只在 EOF 或读取错误收尾时进入此函数，此时 secret filter 会输出安全占位来
/// 覆盖跨分片敏感前缀；普通空读仍保持无输出。
fn forward_decoded_terminal_output(
    mut data: String,
    escape_responder: &mut TerminalEscapeResponder,
    secret_responder: &mut Option<TerminalSecretInputResponder>,
    writer: &SharedWriterHandle,
    pump_sender: &PtyOutputPumpSender,
    agent_detector: &Arc<Mutex<TerminalAgentSignalDetector>>,
) -> bool {
    if data.is_empty() {
        if let Some(responder) = secret_responder.as_mut() {
            data = responder.finish_output();
        }
        if data.is_empty() {
            return true;
        }
    }

    let observation = escape_responder.observe(&data);
    if let Err(error) = write_terminal_escape_responses(writer, &observation.responses) {
        let _ = pump_sender.send(PtyOutputPumpMessage::Error(error.to_string()));
        return false;
    }
    data = observation.data;
    if let Some(responder) = secret_responder.as_mut() {
        responder.observe_and_maybe_respond(&data, writer);
        data = responder.redact_output(&data);
    }
    let observed = match agent_detector.lock() {
        Ok(mut detector) => detector.observe_and_filter(&data),
        Err(_) => {
            let _ = pump_sender.send(PtyOutputPumpMessage::Error(
                "terminal agent signal detector lock poisoned".to_owned(),
            ));
            return false;
        }
    };
    for signal in observed.signals {
        if pump_sender
            .send(PtyOutputPumpMessage::AgentSignal(signal))
            .is_err()
        {
            return false;
        }
    }
    send_bounded_output_data(pump_sender, &observed.data)
}

/// 在进入固定容量 channel 前按 UTF-8 边界切分，形成精确的队列字节上限。
fn send_bounded_output_data(pump_sender: &PtyOutputPumpSender, data: &str) -> bool {
    let mut start = 0;
    while start < data.len() {
        let mut end = (start + PTY_OUTPUT_CHANNEL_DATA_BYTES).min(data.len());
        while end > start && !data.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            end = data[start..]
                .char_indices()
                .nth(1)
                .map_or(data.len(), |(offset, _)| start + offset);
        }
        if pump_sender
            .send(PtyOutputPumpMessage::Data(data[start..end].to_owned()))
            .is_err()
        {
            return false;
        }
        start = end;
    }
    true
}

fn write_terminal_escape_responses(
    writer: &SharedWriterHandle,
    responses: &[&'static str],
) -> AppResult<()> {
    if responses.is_empty() {
        return Ok(());
    }

    let mut writer = writer
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("terminal_writer"))?;
    for response in responses {
        writer.write_all(response.as_bytes())?;
    }
    writer.flush()?;
    Ok(())
}

pub(super) enum PtyOutputPumpMessage {
    Data(String),
    AgentSignal(TerminalAgentSignal),
    Closed,
    Error(String),
}

pub(super) fn spawn_child_exit_waiter_thread(
    session_id: String,
    child: SharedPtyChildHandle,
    pump_sender: PtyOutputPumpSender,
    reader_done: mpsc::Receiver<()>,
    cleanup_paths: Vec<PathBuf>,
    agent_detector: Arc<Mutex<TerminalAgentSignalDetector>>,
) {
    thread::spawn(move || loop {
        match reader_done.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) => {}
        }

        let child_exited = {
            let mut child = match child.lock() {
                Ok(child) => child,
                Err(_) => {
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(
                        "terminal child lock poisoned".to_owned(),
                    ));
                    return;
                }
            };
            match child.try_wait() {
                Ok(Some(_status)) => true,
                Ok(None) => false,
                Err(error) => {
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(format!(
                        "failed to monitor terminal process {session_id}: {error}"
                    )));
                    return;
                }
            }
        };

        if child_exited {
            cleanup_session_paths(&cleanup_paths);
            match reader_done.recv_timeout(PTY_READER_EOF_GRACE) {
                Ok(()) => return,
                Err(mpsc::RecvTimeoutError::Timeout)
                | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Closed);
                    return;
                }
            }
        }

        thread::sleep(PTY_CHILD_EXIT_POLL_INTERVAL);
    });
}

pub(super) struct CleanupPathGuard {
    active: Mutex<bool>,
    paths: Vec<PathBuf>,
}

impl CleanupPathGuard {
    pub(super) fn new(paths: Vec<PathBuf>) -> Self {
        Self {
            active: Mutex::new(true),
            paths,
        }
    }

    pub(super) fn disarm(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = false;
        }
    }
}

impl Drop for CleanupPathGuard {
    fn drop(&mut self) {
        if self.active.lock().map(|active| *active).unwrap_or(true) {
            cleanup_session_paths(&self.paths);
        }
    }
}

pub(super) fn cleanup_session_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn send_finished_agent_signal(
    agent_detector: &Arc<Mutex<TerminalAgentSignalDetector>>,
    pump_sender: &PtyOutputPumpSender,
) {
    let Some(signal) = agent_detector
        .lock()
        .ok()
        .and_then(|mut detector| detector.finish_pty())
    else {
        return;
    };
    let _ = pump_sender.send(PtyOutputPumpMessage::AgentSignal(signal));
}
