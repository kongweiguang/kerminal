//! 终端输出 pump 的聚合、flush 时序、统计与 delivery sink。
//!
//! @author kongweiguang

use super::{
    io_runtime::PtyOutputPumpMessage,
    output_state::{ActiveTerminalLog, TerminalOutputBuffer},
    pump_metrics::{flush_metadata_since, publish_pump_stats, SharedPtyOutputPumpStats},
    OutputEmitter, PTY_OUTPUT_COALESCE, PTY_OUTPUT_FLUSH_BYTES, PTY_OUTPUT_MAX_IDLE,
    PTY_OUTPUT_MAX_PENDING_BYTES,
};
use crate::{
    models::terminal::{
        TerminalAgentSignalSummary, TerminalOutputEvent, TerminalOutputKind,
        TerminalPtyOutputPumpFlushReason,
    },
    services::terminal_output_pump::{PtyOutputPump, PtyOutputPumpConfig, PtyOutputSink},
};
use std::{
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub(super) struct OutputFlusherState {
    pub(super) output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    pub(super) log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    pub(super) latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    pub(super) pump_stats: SharedPtyOutputPumpStats,
}

pub(super) fn spawn_output_flusher_thread(
    session_id: String,
    agent_session_id: Option<String>,
    receiver: mpsc::Receiver<PtyOutputPumpMessage>,
    state: OutputFlusherState,
    output: OutputEmitter,
) {
    thread::spawn(move || {
        let OutputFlusherState {
            output_buffer,
            log_sink,
            latest_agent_signal,
            pump_stats,
        } = state;
        let mut pump = PtyOutputPump::new(session_id.clone(), terminal_output_pump_config());
        let mut sink = TerminalOutputDeliverySink {
            output_buffer,
            log_sink,
            output,
        };
        let mut first_pending_at: Option<Instant> = None;
        let mut last_input_at: Option<Instant> = None;

        loop {
            match receive_pump_message(&receiver, first_pending_at, last_input_at) {
                PumpReceiveResult::Message(PtyOutputPumpMessage::Data(data)) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let accepted = pump.push_data(&data, &mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Threshold));
                    if pump.pending_bytes() == 0 {
                        first_pending_at = None;
                        last_input_at = None;
                    } else {
                        first_pending_at.get_or_insert(now);
                        last_input_at = Some(now);
                    }
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, false);
                    if !accepted {
                        break;
                    }
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::AgentSignal(signal)) => {
                    let summary = TerminalAgentSignalSummary::new(
                        &session_id,
                        agent_session_id.as_deref(),
                        signal,
                    );
                    if let Ok(mut latest_agent_signal) = latest_agent_signal.lock() {
                        *latest_agent_signal = Some(summary.clone());
                    }
                    if !sink.on_terminal_output(TerminalOutputEvent::agent_signal(summary)) {
                        break;
                    }
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::Closed) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let prepared = pump.prepare_closed(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Closed));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    if prepared {
                        let _ = pump.emit_closed(&mut sink);
                    }
                    break;
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::Error(message)) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let prepared = pump.prepare_error(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Error));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    if prepared {
                        let _ = pump.emit_error(message, &mut sink);
                    }
                    break;
                }
                PumpReceiveResult::Timeout => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let accepted = pump.flush(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Idle));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, false);
                    if !accepted {
                        break;
                    }
                    first_pending_at = None;
                    last_input_at = None;
                }
                PumpReceiveResult::Disconnected => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let _ = pump.flush(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| {
                        (interval_ms, TerminalPtyOutputPumpFlushReason::Disconnected)
                    });
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    break;
                }
            }
        }
    });
}

enum PumpReceiveResult {
    Message(PtyOutputPumpMessage),
    Timeout,
    Disconnected,
}

fn receive_pump_message(
    receiver: &mpsc::Receiver<PtyOutputPumpMessage>,
    first_pending_at: Option<Instant>,
    last_input_at: Option<Instant>,
) -> PumpReceiveResult {
    let Some(timeout) = next_output_flush_timeout(first_pending_at, last_input_at) else {
        return receiver
            .recv()
            .map(PumpReceiveResult::Message)
            .unwrap_or(PumpReceiveResult::Disconnected);
    };

    match receiver.recv_timeout(timeout) {
        Ok(message) => PumpReceiveResult::Message(message),
        Err(mpsc::RecvTimeoutError::Timeout) => PumpReceiveResult::Timeout,
        Err(mpsc::RecvTimeoutError::Disconnected) => PumpReceiveResult::Disconnected,
    }
}

fn next_output_flush_timeout(
    first_pending_at: Option<Instant>,
    last_input_at: Option<Instant>,
) -> Option<Duration> {
    let first_pending_at = first_pending_at?;
    let last_input_at = last_input_at.unwrap_or(first_pending_at);
    let coalesce_due = last_input_at + PTY_OUTPUT_COALESCE;
    let max_idle_due = first_pending_at + PTY_OUTPUT_MAX_IDLE;
    let due = coalesce_due.min(max_idle_due);
    let now = Instant::now();
    Some(due.saturating_duration_since(now))
}

fn terminal_output_pump_config() -> PtyOutputPumpConfig {
    PtyOutputPumpConfig {
        flush_bytes: PTY_OUTPUT_FLUSH_BYTES,
        max_pending_bytes: PTY_OUTPUT_MAX_PENDING_BYTES,
        ..PtyOutputPumpConfig::default()
    }
}

struct TerminalOutputDeliverySink {
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    output: OutputEmitter,
}

impl PtyOutputSink for TerminalOutputDeliverySink {
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        if event.kind == TerminalOutputKind::Data {
            if let Ok(mut output_buffer) = self.output_buffer.lock() {
                output_buffer.push(&event.data);
            }
            if let Ok(mut log_sink) = self.log_sink.lock() {
                if let Some(active_log) = log_sink.as_mut() {
                    let _ = active_log.append(&event.data);
                }
            }
        }
        (self.output)(event)
    }
}
